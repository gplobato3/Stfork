/**
 * @file src/core/stContext.js
 * Defensive bridge to the SillyTavern runtime.
 *
 * In SillyTavern, the real context comes from the global
 * `SillyTavern.getContext()` and shared libs from `SillyTavern.libs`. Under
 * node (tests / validation) none of that exists, so every accessor here falls
 * back to a minimal, side-effect-free mock. NOTHING in this file throws at
 * import time, so the shared contract can be imported anywhere.
 *
 * Core ST functions that are normally imported from '../../../../script.js'
 * are resolved LAZILY and defensively (the extension lives at
 * scripts/extensions/third-party/Stfork/, four levels under ST root). A failed
 * resolution yields a safe no-op/placeholder rather than an exception.
 */

/* global SillyTavern */

/**
 * True when running inside a browser with the SillyTavern global available.
 * @returns {boolean}
 */
export function hasSillyTavern() {
    return (
        typeof globalThis !== 'undefined' &&
        typeof globalThis.SillyTavern === 'object' &&
        globalThis.SillyTavern !== null &&
        typeof globalThis.SillyTavern.getContext === 'function'
    );
}

/**
 * Minimal mock context used under node / before ST is ready. Shapes mirror the
 * real ctx closely enough for pure-logic modules and unit tests.
 * @returns {object}
 */
function createMockContext() {
    const noop = () => {};
    const asyncNoop = async () => {};
    return {
        // Data surfaces
        chat: [],
        characters: [],
        characterId: null,
        groups: [],
        groupId: null,
        extensionSettings: {},
        chatMetadata: {},
        // Persistence
        saveSettingsDebounced: noop,
        saveMetadata: asyncNoop,
        writeExtensionField: asyncNoop,
        // Rendering + i18n
        renderExtensionTemplateAsync: async () => '',
        addLocaleData: noop,
        // Preset
        getPresetManager: () => ({ getCompletionPresetByName: noop, getAllPresets: () => [] }),
        // Events
        eventSource: createMockEventSource(),
        event_types: createMockEventTypes(),
        // Generation
        generateRaw: asyncNoop,
        generateQuietPrompt: asyncNoop,
        // Flag so callers can detect the mock
        __hoiMock: true,
    };
}

/** @returns {{on:Function,once:Function,off:Function,emit:Function,removeListener:Function}} */
function createMockEventSource() {
    const noop = () => {};
    return { on: noop, once: noop, off: noop, removeListener: noop, emit: async () => {} };
}

/** @returns {Object.<string,string>} */
function createMockEventTypes() {
    return {
        APP_READY: 'app_ready',
        APP_INITIALIZED: 'app_initialized',
        CHAT_CHANGED: 'chat_id_changed',
        MESSAGE_RECEIVED: 'message_received',
        GENERATION_STARTED: 'generation_started',
        GENERATION_ENDED: 'generation_ended',
    };
}

let _mock = null;

/**
 * Return the live SillyTavern context, or a stable mock under node.
 * @returns {object}
 */
export function getContext() {
    if (hasSillyTavern()) {
        try {
            return globalThis.SillyTavern.getContext();
        } catch {
            /* fall through to mock */
        }
    }
    if (!_mock) _mock = createMockContext();
    return _mock;
}

/**
 * Access SillyTavern.libs (lodash, seedrandom, droll, Handlebars, DOMPurify,
 * moment, localforage, Fuse, yaml, showdown, Popper, morphdom). Returns an
 * empty object under node so callers can feature-detect each lib.
 * @returns {object}
 */
export function getLibs() {
    if (
        typeof globalThis !== 'undefined' &&
        typeof globalThis.SillyTavern === 'object' &&
        globalThis.SillyTavern !== null &&
        typeof globalThis.SillyTavern.libs === 'object'
    ) {
        return globalThis.SillyTavern.libs;
    }
    return {};
}

/**
 * Get a seedrandom factory. Uses SillyTavern.libs.seedrandom when present;
 * otherwise returns a small, deterministic Mulberry32-based PRNG factory so
 * engine logic stays deterministic and testable under node.
 * @returns {(seed?: string) => () => number}
 */
export function getSeedRandom() {
    const libs = getLibs();
    if (typeof libs.seedrandom === 'function') {
        return libs.seedrandom;
    }
    return function fallbackSeedRandom(seed = 'hoi') {
        let h = 1779033703 ^ String(seed).length;
        for (let i = 0; i < String(seed).length; i++) {
            h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        let a = h >>> 0;
        return function mulberry32() {
            a |= 0;
            a = (a + 0x6d2b79f5) | 0;
            let tt = Math.imul(a ^ (a >>> 15), 1 | a);
            tt = (tt + Math.imul(tt ^ (tt >>> 7), 61 | tt)) ^ tt;
            return ((tt ^ (tt >>> 14)) >>> 0) / 4294967296;
        };
    };
}

/**
 * Convenience accessor for a named core generation/UI function. Returns the
 * ctx-provided function when available, else a safe async no-op.
 * @param {string} name e.g. 'generateRaw', 'generateQuietPrompt'
 * @returns {Function}
 */
export function getCoreFn(name) {
    const ctx = getContext();
    if (ctx && typeof ctx[name] === 'function') return ctx[name].bind(ctx);
    return async () => undefined;
}

/**
 * Resolve the SlashCommand registration primitives if ST exposes them on the
 * context; otherwise return no-op stubs. (ST provides these via globals in the
 * browser; modules should guard registration with isLive().)
 * @returns {{SlashCommandParser: any, SlashCommand: any}}
 */
export function getSlashCommandApi() {
    const ctx = getContext();
    const SlashCommandParser =
        (ctx && ctx.SlashCommandParser) ||
        (typeof globalThis !== 'undefined' && globalThis.SlashCommandParser) ||
        { addCommandObject: () => {} };
    const SlashCommand =
        (ctx && ctx.SlashCommand) ||
        (typeof globalThis !== 'undefined' && globalThis.SlashCommand) ||
        { fromProps: (p) => p };
    return { SlashCommandParser, SlashCommand };
}

/**
 * Is the real SillyTavern runtime present? Modules use this to decide whether
 * to register UI/slash commands/events.
 * @returns {boolean}
 */
export function isLive() {
    return hasSillyTavern();
}
