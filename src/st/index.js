/**
 * @file src/st/index.js
 * StAPI — the only module that performs SillyTavern side effects.
 * Imports cleanly under node: nothing touches ST or the DOM until a method runs,
 * and every method takes a FRESH getContext() (chatMetadata / chat / mainApi are
 * re-bound by ST on chat change, st-context.js:115).
 */

import { getContext, isLive, extensionAssetUrl } from '../core/stContext.js';
import { MODULE_KEY, INTERCEPTOR_NAME, INJECTION_KEY, NARRATOR_NAME } from '../contract/constants.js';
import {
    normalizeSettings,
    applySettingsPatch,
    injectionParams,
    sitrepBudget,
    EXTENSION_PROMPT_TYPES,
    EXTENSION_PROMPT_ROLES,
} from './settings.js';
import { generateStructuredWith, generateQuietWith, listProfiles } from './generation.js';
import { createInterceptor } from './interceptor.js';
import { buildMacroDefs, registerMacrosOn } from './macros.js';
import { buildCommandDefs, registerCommandsOn } from './commands.js';

/** ST: public/script.js:435 `system_avatar` (used by /sys, slash-commands.js:6034). */
export const SYSTEM_AVATAR = 'img/five.png';
/** ST: public/scripts/system-messages.js:23 system_message_types.NARRATOR. */
export const NARRATOR_TYPE = 'narrator';
/** Campaign flag holding the key of the last chat message whose orders ran. */
export const ORDER_KEY_FLAG = 'stLastOrderKey';
export const COUNCIL_CHARACTER_PATH = 'assets/character/conselho.json';
export const COUNCIL_CHARACTER_NAME = 'Conselho de Guerra';

const TOAST_KINDS = ['info', 'success', 'warning', 'error'];
const MESSAGE_CHARS = 500;

function stripMarkup(text) {
    return String(text ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * @param {{
 *   getState: () => ?import('../contract/worldState.js').WorldState,
 *   buildSitrep: (state: any, opts?: {budgetTokens?: number, detail?: 'compact'|'full'}) => string,
 *   onUserOrder?: (text: string) => Promise<string[]>,
 *   getCatalog?: () => import('../contract/events.js').ActionDef[],
 * }} deps
 *   onUserOrder runs INSIDE the generate interceptor (the user's generation waits
 *   for it): it must update/save state but must not post chat messages.
 *   getCatalog (optional) enables /hoi-acao validation and autocomplete.
 * @returns {import('../contract/interfaces.js').StAPI}
 */
export function createSt(deps) {
    if (!deps || typeof deps.getState !== 'function' || typeof deps.buildSitrep !== 'function') {
        throw new TypeError('createSt: deps.getState and deps.buildSitrep are required');
    }
    const { getState, buildSitrep, onUserOrder, getCatalog } = deps;

    /** Used when ST is not available (node / early load). */
    let memorySettings = normalizeSettings(null);
    /** chatId -> last processed message key */
    const processedKeys = new Map();
    /** Last sitrep budget computed from the interceptor's contextSize. */
    let lastBudget = null;
    /** @type {Array<[string, Function]>} */
    const listeners = [];
    let macrosRegistered = false;
    let commandsRegistered = false;

    const safeState = () => {
        try {
            return getState() || null;
        } catch {
            return null;
        }
    };

    /* ------------------------------------------------------------ settings */

    function getSettings() {
        const ctx = getContext();
        const store = ctx?.extensionSettings;
        if (!store) return normalizeSettings(memorySettings);
        const stored = store[MODULE_KEY];
        const normalized = normalizeSettings(stored);
        if (!stored || typeof stored !== 'object' || JSON.stringify(stored) !== JSON.stringify(normalized)) {
            store[MODULE_KEY] = normalizeSettings(normalized);
        }
        return normalized;
    }

    function updateSettings(patch) {
        const next = applySettingsPatch(getSettings(), patch);
        const ctx = getContext();
        if (ctx?.extensionSettings) {
            ctx.extensionSettings[MODULE_KEY] = normalizeSettings(next);
            // ST: public/script.js:470 saveSettingsDebounced
            if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
        } else {
            memorySettings = normalizeSettings(next);
        }
        refreshInjection(safeState());
        return normalizeSettings(next);
    }

    /* ---------------------------------------------------------- campaign */

    function currentChatId() {
        const ctx = getContext();
        if (!ctx) return null;
        let id = null;
        try {
            id = typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : ctx.chatId;
        } catch {
            id = ctx.chatId;
        }
        return id === undefined || id === null || id === '' ? null : String(id);
    }

    function loadCampaign() {
        const ctx = getContext();
        const raw = ctx?.chatMetadata?.[MODULE_KEY];
        return raw && typeof raw === 'object' ? raw : null;
    }

    function stamp(state, key) {
        if (!key || state?.flags?.[ORDER_KEY_FLAG] === key) return { ...state };
        return { ...state, flags: { ...(state.flags || {}), [ORDER_KEY_FLAG]: key } };
    }

    async function saveCampaign(state) {
        const ctx = getContext();
        if (!ctx?.chatMetadata || !state || typeof state !== 'object') return;
        const key = processedKeys.get(currentChatId() ?? '');
        ctx.chatMetadata[MODULE_KEY] = stamp(state, key);
        // ST: public/script.js:9408 saveMetadata -> saveChatConditional
        if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
    }

    async function clearCampaign() {
        const ctx = getContext();
        processedKeys.delete(currentChatId() ?? '');
        if (ctx?.chatMetadata && MODULE_KEY in ctx.chatMetadata) {
            delete ctx.chatMetadata[MODULE_KEY];
        }
        refreshInjection(null);
        if (typeof ctx?.saveMetadata === 'function') await ctx.saveMetadata();
    }

    /* --------------------------------------------------------- injection */

    function sitrepFor(state, budgetTokens) {
        const settings = getSettings();
        const detail = settings.injection.detail;
        const budget = budgetTokens ?? lastBudget ?? sitrepBudget(undefined, detail);
        try {
            return String(buildSitrep(state, { budgetTokens: budget, detail }) || '');
        } catch (error) {
            console.warn('[HOI] buildSitrep failed', error);
            return '';
        }
    }

    /**
     * @param {?object} state
     * @param {number} [budgetTokens] Internal: budget from the interceptor.
     */
    function refreshInjection(state, budgetTokens) {
        const ctx = getContext();
        if (!ctx || typeof ctx.setExtensionPrompt !== 'function') return;
        const settings = getSettings();
        // ST: public/script.js:8926 setExtensionPrompt(key, value, position, depth, scan = false, role, filter)
        if (!state || !settings.enabled || !settings.injection.enabled) {
            ctx.setExtensionPrompt(INJECTION_KEY, '', EXTENSION_PROMPT_TYPES.NONE, 0, false, EXTENSION_PROMPT_ROLES.SYSTEM);
            return;
        }
        const { position, depth, role } = injectionParams(settings);
        const text = sitrepFor(state, budgetTokens);
        ctx.setExtensionPrompt(INJECTION_KEY, text, text ? position : EXTENSION_PROMPT_TYPES.NONE, depth, false, role);
    }

    /* -------------------------------------------------------- interceptor */

    function isProcessed(key, state) {
        if (processedKeys.get(currentChatId() ?? '') === key) return true;
        if (state?.flags?.[ORDER_KEY_FLAG] === key) return true;
        return loadCampaign()?.flags?.[ORDER_KEY_FLAG] === key;
    }

    function markProcessed(key) {
        processedKeys.set(currentChatId() ?? '', key);
        const ctx = getContext();
        const stored = ctx?.chatMetadata?.[MODULE_KEY];
        if (!stored || typeof stored !== 'object') return;
        ctx.chatMetadata[MODULE_KEY] = stamp(stored, key);
        // ST: public/scripts/extensions.js:89 saveMetadataDebounced (cancelled on chat change)
        if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
        else if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata().catch(() => {});
    }

    const interceptor = createInterceptor({
        getState: safeState,
        getSettings,
        refresh: (state, contextSize) => {
            const detail = getSettings().injection.detail;
            if (Number.isFinite(Number(contextSize)) && Number(contextSize) > 0) {
                lastBudget = sitrepBudget(contextSize, detail);
            }
            refreshInjection(state, lastBudget ?? undefined);
        },
        onUserOrder: typeof onUserOrder === 'function' ? onUserOrder : undefined,
        isProcessed,
        markProcessed,
    });

    function installInterceptor() {
        // manifest.json "generate_interceptor": INTERCEPTOR_NAME (extensions.js:2033-2036)
        globalThis[INTERCEPTOR_NAME] = interceptor;
    }

    /* ------------------------------------------------------------- macros */

    function registerMacros() {
        if (macrosRegistered) return;
        const ctx = getContext();
        if (!ctx) return;
        const defs = buildMacroDefs({
            getState: safeState,
            isEnabled: () => getSettings().enabled,
            sitrep: (state) => sitrepFor(state),
        });
        const { api } = registerMacrosOn(ctx, defs);
        macrosRegistered = api !== 'none';
    }

    /* ----------------------------------------------------------- commands */

    function registerCommands(controller) {
        if (commandsRegistered || !controller) return;
        const ctx = getContext();
        if (!ctx) return;
        const defs = buildCommandDefs(controller, {
            buildSitrep: (state, opts) => buildSitrep(state, opts),
            getCatalog,
            toast,
        });
        commandsRegistered = registerCommandsOn(ctx, defs).length > 0;
    }

    /* ------------------------------------------------------------ chat I/O */

    async function postNarrator(text, opts = {}) {
        const ctx = getContext();
        const body = String(text ?? '').trim();
        if (!ctx || !Array.isArray(ctx.chat) || !body) return;
        // Same shape as /sys (ST: public/scripts/slash-commands.js:6020-6043 sendNarratorMessage).
        // The text is NOT passed through substituteParams: it is LLM output and must
        // not be able to run macros such as {{setvar}}.
        const message = {
            name: String(opts?.name || NARRATOR_NAME),
            is_user: false,
            is_system: false,
            send_date: new Date().toISOString(), // ST: RossAscends-mods.js:192 getMessageTimeStamp()
            mes: body,
            force_avatar: SYSTEM_AVATAR,
            extra: {
                type: NARRATOR_TYPE,
                bias: null,
                gen_id: Date.now(),
                isSmallSys: false,
                api: 'manual',
                model: 'hoi-grande-estrategia',
            },
        };
        if (ctx.chatMetadata) ctx.chatMetadata.tainted = true;
        ctx.chat.push(message);
        const id = ctx.chat.length - 1;
        const types = ctx.eventTypes || ctx.event_types || {};
        if (ctx.eventSource && types.MESSAGE_SENT) await ctx.eventSource.emit(types.MESSAGE_SENT, id);
        // ST: public/script.js:2551 addOneMessage(mes, { type, insertAfter, scroll, ... })
        if (typeof ctx.addOneMessage === 'function') ctx.addOneMessage(message);
        if (ctx.eventSource && types.USER_MESSAGE_RENDERED) await ctx.eventSource.emit(types.USER_MESSAGE_RENDERED, id);
        // ctx.saveChat is saveChatConditional (st-context.js), group-safe.
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    }

    function recentChatText(n) {
        const ctx = getContext();
        const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
        const limit = Math.max(0, Math.floor(Number(n) || 0));
        const lines = [];
        for (let i = chat.length - 1; i >= 0 && lines.length < limit; i--) {
            const m = chat[i];
            if (!m || m.is_system) continue;
            if (m.extra?.type === NARRATOR_TYPE && m.name === NARRATOR_NAME) continue; // our own bulletins
            const text = stripMarkup(m.mes);
            if (!text) continue;
            const name = String(m.name || (m.is_user ? ctx?.name1 : ctx?.name2) || (m.is_user ? 'Usuário' : 'Personagem'));
            lines.push(`${name}: ${truncate(text, MESSAGE_CHARS)}`);
        }
        return lines.reverse().join('\n');
    }

    function personaName() {
        const name = getContext()?.name1;
        return typeof name === 'string' && name.trim() ? name.trim() : 'Governante';
    }

    function listConnectionProfiles() {
        try {
            return listProfiles(getContext());
        } catch {
            return [];
        }
    }

    /* ---------------------------------------------------------- generation */

    async function generateStructured(opts) {
        try {
            return await generateStructuredWith(getContext(), getSettings(), opts || {});
        } catch (error) {
            return { ok: false, error: String(error?.message || error) };
        }
    }

    async function generateQuiet(quietPrompt) {
        return generateQuietWith(getContext(), quietPrompt);
    }

    /* ------------------------------------------------------ character card */

    async function importCouncilCharacter() {
        const ctx = getContext();
        if (!ctx || typeof globalThis.fetch !== 'function') {
            return { ok: false, message: 'SillyTavern não está disponível.' };
        }
        try {
            const existing = Array.isArray(ctx.characters) ? ctx.characters.find((c) => c?.name === COUNCIL_CHARACTER_NAME) : null;
            if (existing) {
                return { ok: true, message: `O personagem "${COUNCIL_CHARACTER_NAME}" já está na sua lista.` };
            }
            const asset = await globalThis.fetch(extensionAssetUrl(COUNCIL_CHARACTER_PATH), { cache: 'no-cache' });
            if (!asset.ok) throw new Error(`não foi possível ler ${COUNCIL_CHARACTER_PATH} (${asset.status})`);
            const json = await asset.text();
            JSON.parse(json); // fail early on a broken asset

            // ST: public/script.js:10544-10557 importCharacter(): FormData avatar/file_type/user_name,
            // headers getRequestHeaders({ omitContentType: true }) (script.js:647).
            const file = new File([json], 'conselho.json', { type: 'application/json' });
            const formData = new FormData();
            formData.append('avatar', file);
            formData.append('file_type', 'json');
            formData.append('user_name', String(ctx.name1 ?? ''));
            const headers = typeof ctx.getRequestHeaders === 'function' ? ctx.getRequestHeaders({ omitContentType: true }) : {};
            const response = await globalThis.fetch('/api/characters/import', {
                method: 'POST',
                body: formData,
                headers,
                cache: 'no-cache',
            });
            if (!response.ok) throw new Error(`o servidor respondeu ${response.status} ${response.statusText || ''}`.trim());
            const data = await response.json();
            // ST: src/endpoints/characters.js:1594-1597 -> { file_name } or { error: true }
            if (!data || data.error || data.file_name === undefined) throw new Error('o servidor recusou o arquivo');
            // ST: public/script.js:1294 getCharacters() refreshes the character list.
            if (typeof ctx.getCharacters === 'function') await ctx.getCharacters();
            return { ok: true, message: `Personagem "${COUNCIL_CHARACTER_NAME}" importado. Abra-o na lista de personagens para jogar com o gabinete.` };
        } catch (error) {
            console.error('[HOI] character import failed', error);
            return { ok: false, message: `Não foi possível importar o personagem: ${error?.message || error}` };
        }
    }

    /* -------------------------------------------------------------- events */

    function on(type, fn) {
        const source = getContext()?.eventSource;
        if (!source || typeof source.on !== 'function' || !type || typeof fn !== 'function') return;
        source.on(type, fn);
        listeners.push([type, fn]);
    }

    function offAll() {
        const source = getContext()?.eventSource;
        // ST: public/lib/eventemitter.js:114 removeListener (there is no `off`)
        while (listeners.length) {
            const [type, fn] = listeners.pop();
            try {
                source?.removeListener?.(type, fn);
            } catch {
                /* ignore */
            }
        }
    }

    function toast(msg, kind = 'info') {
        const k = TOAST_KINDS.includes(kind) ? kind : 'info';
        const t = globalThis.toastr;
        if (t && typeof t[k] === 'function') {
            t[k](String(msg ?? ''), 'Grande Estratégia');
            return;
        }
        (k === 'error' ? console.error : console.log)(`[HOI] ${msg}`);
    }

    return {
        isLive,
        getSettings,
        updateSettings,
        loadCampaign,
        saveCampaign,
        clearCampaign,
        currentChatId,
        refreshInjection,
        installInterceptor,
        registerMacros,
        registerCommands,
        postNarrator,
        generateStructured,
        generateQuiet,
        recentChatText,
        personaName,
        listConnectionProfiles,
        importCouncilCharacter,
        on,
        offAll,
        toast,
    };
}
