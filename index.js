/**
 * @file index.js
 * Composition root for the "HOI - Grande Estrategia" SillyTavern extension.
 *
 * Assembles the four modules (engine A, scenario B, llm C, ui D) into a single
 * GameController (src/game/gameLoop.js), registers the slash commands, mounts
 * the UI, restores any saved campaign for the current chat, and subscribes to
 * the ST events that keep the campaign in sync with the active chat.
 *
 * Hard rules this file honors:
 *   - MUST import cleanly under node and NEVER throw at load time. All ST access
 *     is funneled through stContext + gated on isLive().
 *   - The REAL generate-interceptor (installed by src/llm/interceptor.js at
 *     import time) is the global SillyTavern calls. This file does NOT overwrite
 *     globalThis.hoiGenerateInterceptor with a stub; it merely routes the
 *     manifest's named global to the real llm.interceptor body, idempotently.
 *
 * Display strings are pt-BR (via t()); identifiers and comments are English.
 */

import { INTERCEPTOR_NAME, MODULE_NAME } from './src/contract/interfaces.js';
import { loadLocale } from './src/i18n/i18n.js';
import { getContext, isLive } from './src/core/stContext.js';

// Module factories.
import { createEngine } from './src/engine/engine.js';
import { createScenario } from './src/scenario/scenario.js';
import { createLlm } from './src/llm/llm.js';
import { createUi } from './src/ui/ui.js';

// The LLM module installs the REAL interceptor on globalThis at import time;
// importing it here guarantees the real body is wired before any generation.
import { hoiGenerateInterceptor } from './src/llm/interceptor.js';

// Glue.
import { createGameController } from './src/game/gameLoop.js';
import { registerSlashCommands } from './src/game/slashCommands.js';

/** Console tag so logs are easy to filter. */
const TAG = '[HOI]';

/** Leveled logger used across the glue (never throws). */
function log(level, ...args) {
    try {
        // eslint-disable-next-line no-console
        (console[level] || console.log)(TAG, ...args);
    } catch {
        /* ignore */
    }
}

/* -------------------------------------------------------------------------- */
/* Interceptor wiring                                                         */
/* -------------------------------------------------------------------------- */

// Route the manifest's named global to the REAL interceptor body. interceptor.js
// already set this at its own import time; we (re)assert it here to make the
// wiring explicit and robust to import order. We intentionally do NOT install a
// no-op stub (the previous skeleton did; that would silence the injector).
if (typeof globalThis !== 'undefined') {
    globalThis[INTERCEPTOR_NAME] = hoiGenerateInterceptor;
}

/* -------------------------------------------------------------------------- */
/* Singleton controller + bootstrap state                                     */
/* -------------------------------------------------------------------------- */

/** @type {ReturnType<typeof createGameController>|null} */
let controller = null;
/** True once we've wired commands + events (so activate is idempotent). */
let booted = false;
/** Keep references so onDisable can detach listeners. */
let eventBindings = [];

/**
 * Load bundled pt-BR strings into the i18n dictionary. Fetches the shipped
 * locale file when running inside ST; silently degrades under node.
 * @returns {Promise<void>}
 */
async function bootstrapI18n() {
    if (!isLive() || typeof fetch !== 'function') return;
    try {
        const url = new URL('./i18n/pt-br.json', import.meta.url);
        const res = await fetch(url);
        if (res && res.ok) {
            const obj = await res.json();
            loadLocale(obj, 'pt-br');
        }
    } catch (e) {
        log('warn', 'i18n bootstrap failed (non-fatal):', e);
    }
}

/**
 * Build the GameController (idempotent). Assembles engine/scenario/llm/ui and
 * wires the UI handlers to the controller actions.
 * @returns {ReturnType<typeof createGameController>}
 */
function buildController() {
    if (controller) return controller;

    const engine = createEngine();
    const scenario = createScenario();

    // The UI handlers reference `controller` lazily via the closure below; the
    // UI is created first so the LLM can route fallback toasts through it.
    let ui;
    const llm = createLlm({ toast: (msg) => ui && ui.toast(msg) });

    ui = createUi({
        onNewGame: () => controller && controller.startNewGame(),
        onNextTurn: () => controller && controller.nextTurn(),
        onSave: () => controller && controller.saveCampaign(),
        onSelectNation: (id) => controller && controller.pickNation(id),
        onPickNation: (id) => controller && controller.pickNation(id),
        onChooseOption: () => {
            /* handled per-call by the controller's showEventModal callback */
        },
        onResetCampaign: () => controller && controller.resetCampaign(),
    });

    controller = createGameController({
        engine,
        scenario,
        llm,
        ui,
        postNarration: postNarrationToChat,
        log,
    });

    return controller;
}

/**
 * Append an immersive narration line into the current chat as a system-styled
 * message, then refresh the chat view. Guarded; degrades under node.
 * @param {string} text pt-BR narration
 * @returns {Promise<void>}
 */
async function postNarrationToChat(text) {
    if (!isLive()) return;
    try {
        const ctx = getContext();
        if (!ctx || !Array.isArray(ctx.chat)) return;
        const message = {
            is_user: false,
            is_system: false,
            name: 'HOI',
            send_date: Date.now(),
            mes: text,
            extra: { hoi: true, type: 'narration' },
        };
        ctx.chat.push(message);
        if (typeof ctx.addOneMessage === 'function') ctx.addOneMessage(message);
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    } catch (e) {
        log('warn', 'postNarration failed (non-fatal):', e);
    }
}

/**
 * Subscribe to ST events that keep the campaign in sync with the active chat.
 * Each chat owns one campaign, so CHAT_CHANGED reloads/clears it. Listeners are
 * recorded so onDisable can detach them. Guarded; no-op under node.
 */
function subscribeEvents(ctrl) {
    if (!isLive()) return;
    try {
        const ctx = getContext();
        const es = ctx && ctx.eventSource;
        const types = (ctx && ctx.event_types) || {};
        if (!es || typeof es.on !== 'function') return;

        const onChatChanged = () => {
            void ctrl.onChatChanged();
        };
        if (types.CHAT_CHANGED) {
            es.on(types.CHAT_CHANGED, onChatChanged);
            eventBindings.push([types.CHAT_CHANGED, onChatChanged]);
        }
        // GENERATION_ENDED is reserved for optional post-turn hooks; we simply
        // refresh the panel so any chat-driven state stays visually in sync.
        if (types.GENERATION_ENDED) {
            const onGenEnded = () => {
                try {
                    const state = ctrl.getState();
                    if (state) ctrl.ui.update(state);
                } catch {
                    /* ignore */
                }
            };
            es.on(types.GENERATION_ENDED, onGenEnded);
            eventBindings.push([types.GENERATION_ENDED, onGenEnded]);
        }
    } catch (e) {
        log('warn', 'subscribeEvents failed (non-fatal):', e);
    }
}

/** Detach all previously-bound ST event listeners (guarded). */
function unsubscribeEvents() {
    if (!isLive()) {
        eventBindings = [];
        return;
    }
    try {
        const ctx = getContext();
        const es = ctx && ctx.eventSource;
        if (es && typeof es.removeListener === 'function') {
            for (const [type, fn] of eventBindings) {
                try {
                    es.removeListener(type, fn);
                } catch {
                    /* ignore */
                }
            }
        }
    } catch {
        /* ignore */
    }
    eventBindings = [];
}

/**
 * Boot the full extension: i18n, controller, slash commands, events, UI mount,
 * and campaign restore. Idempotent and guarded end-to-end.
 * @returns {Promise<void>}
 */
async function boot() {
    await bootstrapI18n();

    const ctrl = buildController();
    // Expose for debugging / console inspection inside ST.
    try {
        if (typeof globalThis !== 'undefined') globalThis[MODULE_NAME] = ctrl;
    } catch {
        /* ignore */
    }

    if (!booted) {
        registerSlashCommands(ctrl, { log });
        subscribeEvents(ctrl);
        booted = true;
    }

    // Load scenario, restore any saved campaign, and mount/refresh the panel.
    await ctrl.start();
}

/* -------------------------------------------------------------------------- */
/* Lifecycle hooks (referenced by manifest.json "hooks")                      */
/* -------------------------------------------------------------------------- */

/**
 * Called when the extension is activated / ST is ready. Boots the controller.
 * @returns {Promise<void>}
 */
export async function onActivate() {
    log('info', 'onActivate — module:', MODULE_NAME);
    try {
        await boot();
    } catch (e) {
        log('error', 'onActivate boot failed:', e);
    }
}

/**
 * Called once when the extension is installed. No persistent one-time state is
 * required (campaigns live per-chat), so this just logs.
 * @returns {Promise<void>}
 */
export async function onInstall() {
    log('info', 'onInstall');
}

/**
 * Called when the extension is enabled by the user. (Re)boots the controller so
 * the panel reappears for any active campaign.
 * @returns {Promise<void>}
 */
export async function onEnable() {
    log('info', 'onEnable');
    try {
        await boot();
    } catch (e) {
        log('error', 'onEnable boot failed:', e);
    }
}

/**
 * Called when the extension is disabled by the user. Detaches event listeners.
 * The DOM panel is left in place (ST removes extension UI on reload); clearing
 * our in-memory controller lets a later enable rebuild cleanly.
 * @returns {Promise<void>}
 */
export async function onDisable() {
    log('info', 'onDisable');
    unsubscribeEvents();
    booted = false;
}

/* -------------------------------------------------------------------------- */
/* Generate interceptor (referenced by manifest.json "generate_interceptor")  */
/* -------------------------------------------------------------------------- */

/**
 * Re-export the real interceptor so tooling that imports index.js can find it.
 * The global SillyTavern invokes (globalThis.hoiGenerateInterceptor) is the
 * same function, installed by src/llm/interceptor.js and reasserted above.
 * @see src/llm/interceptor.js
 */
export { hoiGenerateInterceptor };

// Auto-bootstrap i18n when imported inside ST (safe no-op under node). The full
// boot runs from onActivate, but loading strings early keeps any pre-activate
// UI text correct.
bootstrapI18n();
