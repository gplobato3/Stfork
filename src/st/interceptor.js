/**
 * @file src/st/interceptor.js
 * The generate interceptor body (manifest.generate_interceptor).
 *
 * ST: public/scripts/extensions.js:2024 runGenerationInterceptors(chat, contextSize, type)
 *     calls `await globalThis[name](chat, contextSize, abort, type)` inside a
 *     try/catch, for non-dry-run generations only (script.js:4562-4564).
 * ST: public/script.js:4496 `chat` is a FILTERED COPY (is_system messages removed,
 *     items are `{...chatItem, mes: regexedMessage, index}`, script.js:4501-4527).
 *     Pushing into it does not create a proper prompt message (AUDIT 1.3), so it
 *     is only read here.
 * ST: public/script.js:4700-4701 / :5647 extension prompts are collected AFTER
 *     the interceptors run, so refreshing setExtensionPrompt here lands in this
 *     very generation.
 *
 * Generation `type` values (ST: public/scripts/constants.js:36 GENERATION_TYPE_TRIGGERS):
 *   'normal'      user pressed Send (script.js:1744/1764), /trigger, /ask; group
 *                 chats map regenerate to 'normal' per member (group-chats.js:1062)
 *   'continue'    script.js:1757 / :11660
 *   'impersonate' script.js:11646
 *   'swipe'       script.js:10319
 *   'regenerate'  script.js:11640
 *   'quiet'       generateQuietPrompt (script.js:3108) — includes our own bulletins
 * For 'normal', the user's new message is pushed into chat BEFORE the filtered
 * copy is made (sendMessageAsUser at script.js:4453), so it is the last element.
 * Orders run only for 'normal' and are deduplicated by a stable message key, so
 * group regenerations, /trigger and "delete reply + send empty" never execute
 * the same order twice.
 */

import { PHASES } from '../contract/constants.js';

/** The only generation type that may execute chat orders. */
export const ORDER_GENERATION_TYPE = 'normal';

/**
 * FNV-1a 32-bit, hex. Stable across sessions (no randomness).
 * @param {string} text
 * @returns {string}
 */
export function hashString(text) {
    let h = 0x811c9dc5;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * Stable key of a chat message: send_date + mes.
 * @param {{send_date?: any, mes?: any}} msg
 * @returns {string}
 */
export function messageKey(msg) {
    const date = String(msg?.send_date ?? '');
    const mes = String(msg?.mes ?? '');
    return `m${hashString(`${date}\n${mes}`)}-${mes.length}`;
}

/**
 * The newest message when it is a user message (else null).
 * @param {any[]} chat
 * @returns {?{mes: string, send_date?: any, name?: string}}
 */
export function lastUserMessage(chat) {
    if (!Array.isArray(chat) || !chat.length) return null;
    const last = chat[chat.length - 1];
    if (!last || last.is_user !== true || last.is_system) return null;
    if (typeof last.mes !== 'string' || !last.mes.trim()) return null;
    return last;
}

/**
 * @param {{
 *   getState: () => any,
 *   getSettings: () => import('../contract/interfaces.js').HoiSettings,
 *   refresh: (state: any, contextSize?: number) => void,
 *   onUserOrder?: (text: string) => Promise<string[]>,
 *   isProcessed: (key: string, state: any) => boolean,
 *   markProcessed: (key: string) => void,
 * }} deps
 * @returns {(chat: any[], contextSize: number, abort: Function, type: string) => Promise<void>}
 */
export function createInterceptor(deps) {
    const safeState = () => {
        try {
            return deps.getState() || null;
        } catch {
            return null;
        }
    };

    const safeRefresh = (state, contextSize) => {
        try {
            deps.refresh(state, contextSize);
        } catch (error) {
            console.warn('[HOI] injection refresh failed', error);
        }
    };

    return async function hoiGenerateInterceptor(chat, contextSize, abort, type) {
        try {
            const settings = deps.getSettings();
            const state = safeState();
            safeRefresh(state, contextSize);

            if (!state || !settings.enabled) return;
            if (settings.ordersMode !== 'auto' || typeof deps.onUserOrder !== 'function') return;
            if (type !== ORDER_GENERATION_TYPE) return;
            if (state.phase === PHASES.GAME_OVER) return;

            const msg = lastUserMessage(chat);
            if (!msg) return;
            const text = msg.mes.trim();
            const key = messageKey(msg);
            if (deps.isProcessed(key, state)) return;

            // Mark BEFORE running: a failure or a concurrent generation must not re-run it.
            deps.markProcessed(key);
            try {
                await deps.onUserOrder(text);
            } catch (error) {
                console.warn('[HOI] onUserOrder failed', error);
            }
            safeRefresh(safeState(), contextSize);
        } catch (error) {
            console.warn('[HOI] interceptor failed', error);
        }
    };
}
