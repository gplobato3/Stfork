/**
 * @file src/st/settings.js
 * HoiSettings defaults, normalization and the numeric enums of
 * setExtensionPrompt. Pure and node-safe.
 */

/**
 * ST: public/script.js:484 `extension_prompt_types` (not exposed on getContext()).
 */
export const EXTENSION_PROMPT_TYPES = Object.freeze({
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
});

/**
 * ST: public/script.js:494 `extension_prompt_roles` (not exposed on getContext()).
 */
export const EXTENSION_PROMPT_ROLES = Object.freeze({
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
});

/** ST: public/script.js:503 MAX_INJECTION_DEPTH. */
export const MAX_INJECTION_DEPTH = 10000;

/** settings.injection.position -> extension_prompt_types */
export const POSITION_MAP = Object.freeze({
    in_prompt: EXTENSION_PROMPT_TYPES.IN_PROMPT,
    in_chat: EXTENSION_PROMPT_TYPES.IN_CHAT,
    before_prompt: EXTENSION_PROMPT_TYPES.BEFORE_PROMPT,
});

/** settings.injection.role -> extension_prompt_roles */
export const ROLE_MAP = Object.freeze({
    system: EXTENSION_PROMPT_ROLES.SYSTEM,
    user: EXTENSION_PROMPT_ROLES.USER,
    assistant: EXTENSION_PROMPT_ROLES.ASSISTANT,
});

export const ORDERS_MODES = Object.freeze(['auto', 'command', 'off']);
export const DIFFICULTIES = Object.freeze(['facil', 'normal', 'dificil']);
export const DETAIL_LEVELS = Object.freeze(['compact', 'full']);
export const EVENT_MAX_TOKENS = Object.freeze({ MIN: 300, MAX: 8000 });

/**
 * DESIGN §5 defaults.
 * @type {import('../contract/interfaces.js').HoiSettings}
 */
export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    injection: Object.freeze({
        enabled: true,
        position: 'in_chat',
        depth: 1,
        role: 'system',
        detail: 'compact',
    }),
    ordersMode: 'auto',
    llmEvents: true,
    postBulletins: true,
    engineProfileId: '',
    eventMaxTokens: 1200,
    showHud: true,
    showArt: true,
    difficulty: 'normal',
});

function pick(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function int(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Deep-merge a stored (possibly partial / outdated / hand-edited) settings
 * object with the defaults. Unknown keys are dropped; invalid values fall back
 * to the default.
 * @param {any} raw
 * @returns {import('../contract/interfaces.js').HoiSettings}
 */
export function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const inj = src.injection && typeof src.injection === 'object' ? src.injection : {};
    const d = DEFAULT_SETTINGS;
    return {
        enabled: bool(src.enabled, d.enabled),
        injection: {
            enabled: bool(inj.enabled, d.injection.enabled),
            position: pick(inj.position, Object.keys(POSITION_MAP), d.injection.position),
            depth: int(inj.depth, 0, MAX_INJECTION_DEPTH, d.injection.depth),
            role: pick(inj.role, Object.keys(ROLE_MAP), d.injection.role),
            detail: pick(inj.detail, DETAIL_LEVELS, d.injection.detail),
        },
        ordersMode: pick(src.ordersMode, ORDERS_MODES, d.ordersMode),
        llmEvents: bool(src.llmEvents, d.llmEvents),
        postBulletins: bool(src.postBulletins, d.postBulletins),
        engineProfileId: typeof src.engineProfileId === 'string' ? src.engineProfileId : d.engineProfileId,
        eventMaxTokens: int(src.eventMaxTokens, EVENT_MAX_TOKENS.MIN, EVENT_MAX_TOKENS.MAX, d.eventMaxTokens),
        showHud: bool(src.showHud, d.showHud),
        showArt: bool(src.showArt, d.showArt),
        difficulty: pick(src.difficulty, DIFFICULTIES, d.difficulty),
    };
}

/**
 * Apply a partial patch (injection may itself be partial) on top of settings.
 * @param {import('../contract/interfaces.js').HoiSettings} current
 * @param {any} patch
 * @returns {import('../contract/interfaces.js').HoiSettings}
 */
export function applySettingsPatch(current, patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const merged = { ...current, ...p };
    merged.injection = { ...current.injection, ...(p.injection && typeof p.injection === 'object' ? p.injection : {}) };
    return normalizeSettings(merged);
}

/**
 * setExtensionPrompt arguments for the current settings.
 * @param {import('../contract/interfaces.js').HoiSettings} settings
 * @returns {{position:number, depth:number, role:number}}
 */
export function injectionParams(settings) {
    const inj = settings.injection;
    return {
        position: POSITION_MAP[inj.position] ?? EXTENSION_PROMPT_TYPES.IN_CHAT,
        depth: inj.depth,
        role: ROLE_MAP[inj.role] ?? EXTENSION_PROMPT_ROLES.SYSTEM,
    };
}

/**
 * Sitrep token budget derived from the prompt budget ST passes to the
 * interceptor (getMaxPromptTokens(), script.js:4560).
 * @param {number|undefined} contextSize
 * @param {'compact'|'full'} detail
 * @returns {number}
 */
export function sitrepBudget(contextSize, detail) {
    const cap = detail === 'full' ? 800 : 400;
    const n = Number(contextSize);
    if (!Number.isFinite(n) || n <= 0) return cap;
    return Math.max(120, Math.min(cap, Math.floor(n * 0.06)));
}
