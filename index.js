/**
 * @file index.js
 * Composition root of "Grande Estratégia" (manifest.json entry point).
 *
 * Import time (safe, no DOM): builds the module graph and installs the generate
 * interceptor so it exists before SillyTavern's first generation.
 * activate hook: registers slash commands and macros.
 * APP_READY: mounts the UI (wand menu, HUD, settings drawer, War Room) and
 * restores the campaign of the current chat. CHAT_CHANGED reloads it.
 */

import { INJECTION_KEY, INTERCEPTOR_NAME } from './src/contract/constants.js';
import { getContext, getLibs } from './src/core/stContext.js';
import { createEngine } from './src/engine/index.js';
import { createController } from './src/game/controller.js';
import { buildSitrep, createLlm } from './src/llm/index.js';
import { createScenarioLoader } from './src/scenario/index.js';
import { createSt } from './src/st/index.js';
import { closeAllModals } from './src/ui/dialogs/modalHost.js';
import { createUi } from './src/ui/index.js';

const libs = getLibs() || {};
const engine = createEngine({ seedrandom: typeof libs.seedrandom === 'function' ? libs.seedrandom : undefined });
const scenario = createScenarioLoader();

/** @type {ReturnType<typeof createController>} */
let controller = null;
/** @type {?import('./src/contract/interfaces.js').UiAPI} */
let ui = null;

const st = createSt({
    getState: () => (controller ? controller.getState() : null),
    buildSitrep: (state, opts) => buildSitrep(state, opts),
    onUserOrder: (text) => (controller ? controller.handleChatOrder(text) : Promise.resolve([])),
    getCatalog: () => engine.getCatalog(),
});
const llm = createLlm({ st, engine });

controller = createController({ engine, scenario, llm, st, getUi: () => ui });

ui = createUi({
    scenario,
    handlers: {
        onNewCampaign: () => void controller.newCampaign(),
        onEndTurn: () => void controller.endTurn(),
        onAction: (actionId, targetId) => void controller.doAction(actionId, targetId, 'ui'),
        onOrder: (text) => void controller.handleOrder(text, 'warroom'),
        onOpenEvent: () => void controller.openPendingEvent(),
        onSave: () => void controller.save(),
        onResetCampaign: () => void controller.reset(),
        onSettingsChange: (patch) => {
            st.updateSettings(patch);
            ui.refresh();
        },
        onImportCharacter: async () => {
            const res = await st.importCouncilCharacter();
            ui.toast(res.message, res.ok ? 'success' : 'error');
        },
    },
    query: controller.query,
});

// The interceptor must exist before ST's first generation (manifest generate_interceptor).
st.installInterceptor();

let activated = false;
let uiStarted = false;

function eventTypes() {
    const ctx = getContext();
    return (ctx && (ctx.eventTypes || ctx.event_types)) || {};
}

async function startUi() {
    if (uiStarted) return;
    uiStarted = true;
    try {
        await controller.start();
    } catch (error) {
        console.error('[HOI] start failed', error);
    }
}

/** manifest hooks.activate */
export async function onActivate() {
    if (activated) return;
    activated = true;
    try {
        st.installInterceptor();
        st.registerCommands(controller);
        st.registerMacros();
        const types = eventTypes();
        if (types.CHAT_CHANGED) {
            st.on(types.CHAT_CHANGED, () => {
                closeAllModals();
                void controller.onChatChanged();
            });
        }
        // APP_READY auto-fires for listeners attached after the app is ready.
        if (types.APP_READY) st.on(types.APP_READY, () => void startUi());
        else void startUi();
    } catch (error) {
        console.error('[HOI] activation failed', error);
    }
}

/** manifest hooks.disable */
export async function onDisable() {
    try {
        closeAllModals();
        st.offAll();
        if (ui) ui.unmount();
        const ctx = getContext();
        if (ctx && typeof ctx.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_KEY, '', -1, 0);
        delete globalThis[INTERCEPTOR_NAME];
    } catch (error) {
        console.error('[HOI] disable failed', error);
    }
    activated = false;
    uiStarted = false;
}

/** manifest hooks.enable */
export async function onEnable() {
    st.installInterceptor();
}
