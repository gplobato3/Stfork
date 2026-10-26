/**
 * @file src/ui/settings/settingsModel.js
 * Pure normalization of HoiSettings for the settings panel (defaults from
 * DESIGN §5, enums from interfaces.js HoiSettings). No DOM, node-safe.
 * The ST module owns persistence; this only makes UI input safe.
 */

export const INJECTION_POSITIONS = Object.freeze(['in_chat', 'in_prompt', 'before_prompt']);
export const INJECTION_ROLES = Object.freeze(['system', 'user', 'assistant']);
export const INJECTION_DETAILS = Object.freeze(['compact', 'full']);
export const ORDERS_MODES = Object.freeze(['auto', 'command', 'off']);
export const DIFFICULTIES = Object.freeze(['facil', 'normal', 'dificil']);

export const LIMITS = Object.freeze({
    depth: { min: 0, max: 50 },
    eventMaxTokens: { min: 300, max: 8000, step: 100 },
});

/** @type {Readonly<import('../../contract/interfaces.js').HoiSettings>} */
export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    injection: Object.freeze({ enabled: true, position: 'in_chat', depth: 1, role: 'system', detail: 'compact' }),
    ordersMode: 'auto',
    llmEvents: true,
    postBulletins: true,
    engineProfileId: '',
    eventMaxTokens: 1200,
    showHud: true,
    showArt: true,
    difficulty: 'normal',
});

const bool = (v, d) => {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1 || v === '1' || v === 'on') return true;
    if (v === 'false' || v === 0 || v === '0' || v === 'off') return false;
    return d;
};
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const int = (v, { min, max }, d) => {
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(max, Math.max(min, Math.round(n)));
};

/**
 * Full, valid HoiSettings from anything (missing/invalid fields -> defaults).
 * @param {any} raw
 * @returns {import('../../contract/interfaces.js').HoiSettings}
 */
export function normalizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const inj = r.injection && typeof r.injection === 'object' ? r.injection : {};
    const D = DEFAULT_SETTINGS;
    return {
        enabled: bool(r.enabled, D.enabled),
        injection: {
            enabled: bool(inj.enabled, D.injection.enabled),
            position: oneOf(inj.position, INJECTION_POSITIONS, D.injection.position),
            depth: int(inj.depth, LIMITS.depth, D.injection.depth),
            role: oneOf(inj.role, INJECTION_ROLES, D.injection.role),
            detail: oneOf(inj.detail, INJECTION_DETAILS, D.injection.detail),
        },
        ordersMode: oneOf(r.ordersMode, ORDERS_MODES, D.ordersMode),
        llmEvents: bool(r.llmEvents, D.llmEvents),
        postBulletins: bool(r.postBulletins, D.postBulletins),
        engineProfileId: typeof r.engineProfileId === 'string' ? r.engineProfileId.trim() : D.engineProfileId,
        eventMaxTokens: int(r.eventMaxTokens, LIMITS.eventMaxTokens, D.eventMaxTokens),
        showHud: bool(r.showHud, D.showHud),
        showArt: bool(r.showArt, D.showArt),
        difficulty: oneOf(r.difficulty, DIFFICULTIES, D.difficulty),
    };
}

/**
 * Patch for one control. `path` is a field name or 'injection.<field>'.
 * Nested objects are sent whole so a shallow merge on the ST side is safe.
 * The value is coerced through normalizeSettings (invalid -> current value).
 * @param {any} current
 * @param {string} path
 * @param {any} value
 * @returns {Partial<import('../../contract/interfaces.js').HoiSettings>}
 */
export function settingsPatch(current, path, value) {
    const cur = normalizeSettings(current);
    const [head, sub] = String(path).split('.');
    if (head === 'injection' && sub) {
        const next = normalizeSettings({ ...cur, injection: { ...cur.injection, [sub]: value } });
        // Invalid input keeps the current value instead of jumping to the default.
        const keep = { ...next.injection };
        if (!isValidField(`injection.${sub}`, value)) keep[sub] = cur.injection[sub];
        return { injection: keep };
    }
    if (!(head in DEFAULT_SETTINGS)) return {};
    if (!isValidField(head, value)) return { [head]: cur[head] };
    const next = normalizeSettings({ ...cur, [head]: value });
    return { [head]: next[head] };
}

function isValidField(path, value) {
    switch (path) {
        case 'injection.position': return INJECTION_POSITIONS.includes(value);
        case 'injection.role': return INJECTION_ROLES.includes(value);
        case 'injection.detail': return INJECTION_DETAILS.includes(value);
        case 'injection.depth': return Number.isFinite(Number(value)) && String(value).trim() !== '';
        case 'eventMaxTokens': return Number.isFinite(Number(value)) && String(value).trim() !== '';
        case 'ordersMode': return ORDERS_MODES.includes(value);
        case 'difficulty': return DIFFICULTIES.includes(value);
        case 'engineProfileId': return typeof value === 'string';
        default: return value !== undefined && value !== null;
    }
}
