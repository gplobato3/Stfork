/**
 * @file src/contract/schemas.js
 * JSON Schemas for SillyTavern structured outputs + a dependency-free,
 * hand-written validator (validateEvent) that runs in both node and browser.
 *
 * Part of the SHARED CONTRACT. The LLM layer (Module C) passes EVENT_SCHEMA to
 * ST's structured-output generation; validateEvent() is the belt-and-braces
 * check applied to whatever the model returns before the engine (Module A)
 * trusts it. NEVER import a JSON-schema library here: this must be pure.
 */

import {
    EFFECT_TYPES,
    CRISIS_SEVERITIES,
    CRISIS_ACTIONS,
    WAR_ACTIONS,
    OPTION_COUNT,
    EFFECT_DELTA_BOUNDS,
    isResourceKey,
} from './events.js';
import { RESOURCE_KEYS, BLOCS } from './worldState.js';

/**
 * JSON Schema (draft-07-ish, the subset ST/providers accept) constraining a
 * single Effect. Discriminated-union-ish: `type` is an enum; optional fields
 * carry the per-type payloads. We deliberately keep additionalProperties
 * permissive-but-bounded so provider structured-output stays reliable, and we
 * do the strict per-type checking in validateEvent().
 * @type {object}
 */
export const EFFECT_SCHEMA = {
    type: 'object',
    properties: {
        type: { type: 'string', enum: [...EFFECT_TYPES] },
        target: { type: 'string' },
        targetB: { type: 'string' },
        resource: { type: 'string', enum: [...RESOURCE_KEYS] },
        delta: { type: 'number' },
        value: { type: 'number' },
        action: { type: 'string', enum: [...CRISIS_ACTIONS, ...WAR_ACTIONS] },
        bloc: { type: 'string', enum: [...BLOCS] },
        crisisId: { type: 'string' },
        note: { type: 'string' },
        crisis: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                severity: { type: 'string', enum: [...CRISIS_SEVERITIES] },
                involvedNationIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'severity'],
            additionalProperties: true,
        },
    },
    required: ['type'],
    additionalProperties: true,
};

/**
 * JSON Schema for a single player Option.
 * @type {object}
 */
export const OPTION_SCHEMA = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        label: { type: 'string', minLength: 1 },
        rationale: { type: 'string' },
        effects: { type: 'array', items: EFFECT_SCHEMA },
    },
    required: ['label', 'effects'],
    additionalProperties: true,
};

/**
 * JSON Schema for the full per-turn GameEvent the LLM must return.
 * Passed to ST's structured-output generation by the LLM module.
 * @type {object}
 */
export const EVENT_SCHEMA = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        title: { type: 'string', minLength: 1 },
        narrative: { type: 'string', minLength: 1 },
        context: { type: 'string' },
        tensionDelta: { type: 'number' },
        options: {
            type: 'array',
            minItems: OPTION_COUNT.MIN,
            maxItems: OPTION_COUNT.MAX,
            items: OPTION_SCHEMA,
        },
    },
    required: ['title', 'narrative', 'options'],
    additionalProperties: true,
};

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} ok        True if the value is a usable GameEvent.
 * @property {string[]} errors   Human-readable (English) error strings; empty when ok.
 * @property {import('./events.js').GameEvent|null} value Normalized GameEvent when ok, else null.
 */

/**
 * Hand-written, dependency-free validator + normalizer for an LLM GameEvent.
 * Accepts a parsed object (or JSON string) and returns {ok, errors, value}.
 * On success, `value` is a normalized GameEvent with ids filled in, effects
 * cleaned per-type, and deltas clamped to EFFECT_DELTA_BOUNDS.
 *
 * This runs identically in node and the browser. It never throws.
 *
 * @param {unknown} input Parsed object or JSON string from the model.
 * @returns {ValidationResult}
 */
export function validateEvent(input) {
    /** @type {string[]} */
    const errors = [];

    let obj = input;
    if (typeof obj === 'string') {
        try {
            obj = JSON.parse(obj);
        } catch (e) {
            return { ok: false, errors: [`not valid JSON: ${String(e && e.message || e)}`], value: null };
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { ok: false, errors: ['event must be a non-array object'], value: null };
    }

    const ev = /** @type {Record<string, any>} */ (obj);

    if (!isNonEmptyString(ev.title)) errors.push('title must be a non-empty string');
    if (!isNonEmptyString(ev.narrative)) errors.push('narrative must be a non-empty string');

    if (!Array.isArray(ev.options)) {
        errors.push('options must be an array');
    } else if (ev.options.length < OPTION_COUNT.MIN || ev.options.length > OPTION_COUNT.MAX) {
        errors.push(`options must have between ${OPTION_COUNT.MIN} and ${OPTION_COUNT.MAX} items`);
    }

    /** @type {import('./events.js').Option[]} */
    const normOptions = [];
    if (Array.isArray(ev.options)) {
        ev.options.forEach((opt, i) => {
            if (!opt || typeof opt !== 'object') {
                errors.push(`options[${i}] must be an object`);
                return;
            }
            if (!isNonEmptyString(opt.label)) {
                errors.push(`options[${i}].label must be a non-empty string`);
            }
            if (!Array.isArray(opt.effects)) {
                errors.push(`options[${i}].effects must be an array`);
            }
            const normEffects = [];
            if (Array.isArray(opt.effects)) {
                opt.effects.forEach((eff, j) => {
                    const r = validateEffect(eff, `options[${i}].effects[${j}]`);
                    if (r.errors.length) errors.push(...r.errors);
                    else if (r.value) normEffects.push(r.value);
                });
            }
            normOptions.push({
                id: isNonEmptyString(opt.id) ? opt.id : `opt_${i}`,
                label: isNonEmptyString(opt.label) ? opt.label : `Opção ${i + 1}`,
                rationale: typeof opt.rationale === 'string' ? opt.rationale : '',
                effects: normEffects,
            });
        });
    }

    if (ev.tensionDelta !== undefined && typeof ev.tensionDelta !== 'number') {
        errors.push('tensionDelta must be a number when present');
    }

    if (errors.length) return { ok: false, errors, value: null };

    /** @type {import('./events.js').GameEvent} */
    const value = {
        id: isNonEmptyString(ev.id) ? ev.id : `evt-${Date.now().toString(36)}`,
        title: ev.title,
        narrative: ev.narrative,
        ...(isNonEmptyString(ev.context) ? { context: ev.context } : {}),
        options: normOptions,
        ...(typeof ev.tensionDelta === 'number'
            ? { tensionDelta: clampDelta(ev.tensionDelta, EFFECT_DELTA_BOUNDS.tension) }
            : {}),
    };
    return { ok: true, errors: [], value };
}

/**
 * Validate + normalize a single Effect object.
 * @param {any} eff
 * @param {string} path Dotted path for error messages.
 * @returns {{errors: string[], value: import('./events.js').Effect|null}}
 */
export function validateEffect(eff, path = 'effect') {
    /** @type {string[]} */
    const errors = [];
    if (!eff || typeof eff !== 'object' || Array.isArray(eff)) {
        return { errors: [`${path} must be an object`], value: null };
    }
    const type = eff.type;
    if (!EFFECT_TYPES.includes(type)) {
        return { errors: [`${path}.type must be one of ${EFFECT_TYPES.join(', ')}`], value: null };
    }

    /** @type {import('./events.js').Effect} */
    const out = { type };

    switch (type) {
        case 'resource': {
            if (!isNonEmptyString(eff.target)) errors.push(`${path}.target (nationId) required`);
            if (!isResourceKey(eff.resource)) errors.push(`${path}.resource must be one of ${RESOURCE_KEYS.join(', ')}`);
            if (typeof eff.delta !== 'number') errors.push(`${path}.delta must be a number`);
            if (!errors.length) {
                out.target = eff.target;
                out.resource = eff.resource;
                out.delta = clampDelta(eff.delta, EFFECT_DELTA_BOUNDS.resource);
            }
            break;
        }
        case 'resourceSet': {
            if (!isNonEmptyString(eff.target)) errors.push(`${path}.target (nationId) required`);
            if (!isResourceKey(eff.resource)) errors.push(`${path}.resource must be one of ${RESOURCE_KEYS.join(', ')}`);
            if (typeof eff.value !== 'number') errors.push(`${path}.value must be a number`);
            if (!errors.length) {
                out.target = eff.target;
                out.resource = eff.resource;
                out.value = eff.value;
            }
            break;
        }
        case 'relation': {
            if (!isNonEmptyString(eff.target)) errors.push(`${path}.target (nationId A) required`);
            if (!isNonEmptyString(eff.targetB)) errors.push(`${path}.targetB (nationId B) required`);
            if (typeof eff.delta !== 'number') errors.push(`${path}.delta must be a number`);
            if (!errors.length) {
                out.target = eff.target;
                out.targetB = eff.targetB;
                out.delta = clampDelta(eff.delta, EFFECT_DELTA_BOUNDS.relation);
            }
            break;
        }
        case 'tension': {
            if (typeof eff.delta !== 'number') errors.push(`${path}.delta must be a number`);
            if (!errors.length) out.delta = clampDelta(eff.delta, EFFECT_DELTA_BOUNDS.tension);
            break;
        }
        case 'flag': {
            if (!isNonEmptyString(eff.target)) errors.push(`${path}.target (flag name) required`);
            if (!errors.length) {
                out.target = eff.target;
                out.value = eff.value === undefined ? true : eff.value;
            }
            break;
        }
        case 'bloc': {
            if (!isNonEmptyString(eff.target)) errors.push(`${path}.target (nationId) required`);
            if (!isNonEmptyString(eff.bloc)) errors.push(`${path}.bloc required`);
            if (!errors.length) {
                out.target = eff.target;
                out.bloc = eff.bloc;
            }
            break;
        }
        case 'war': {
            if (!isNonEmptyString(eff.target)) errors.push(`${path}.target (nationId A) required`);
            if (!isNonEmptyString(eff.targetB)) errors.push(`${path}.targetB (nationId B) required`);
            if (!WAR_ACTIONS.includes(eff.action)) errors.push(`${path}.action must be one of ${WAR_ACTIONS.join(', ')}`);
            if (!errors.length) {
                out.target = eff.target;
                out.targetB = eff.targetB;
                out.action = eff.action;
            }
            break;
        }
        case 'crisis': {
            if (!CRISIS_ACTIONS.includes(eff.action)) {
                errors.push(`${path}.action must be one of ${CRISIS_ACTIONS.join(', ')}`);
            } else if (eff.action === 'start') {
                if (!eff.crisis || typeof eff.crisis !== 'object') {
                    errors.push(`${path}.crisis object required for action 'start'`);
                } else if (!isNonEmptyString(eff.crisis.title)) {
                    errors.push(`${path}.crisis.title required`);
                }
            } else if (!isNonEmptyString(eff.crisisId)) {
                errors.push(`${path}.crisisId required for action '${eff.action}'`);
            }
            if (!errors.length) {
                out.action = eff.action;
                if (eff.action === 'start') out.crisis = eff.crisis;
                else out.crisisId = eff.crisisId;
            }
            break;
        }
        default:
            errors.push(`${path}.type '${type}' not handled`);
    }

    if (isNonEmptyString(eff.note)) out.note = eff.note;
    if (errors.length) return { errors, value: null };
    return { errors: [], value: out };
}

/**
 * Clamp a signed delta into {min,max}.
 * @param {number} n
 * @param {{min:number,max:number}} bounds
 * @returns {number}
 */
function clampDelta(n, bounds) {
    const v = Math.round(Number(n) || 0);
    return Math.min(bounds.max, Math.max(bounds.min, v));
}

/**
 * @param {any} s
 * @returns {boolean}
 */
function isNonEmptyString(s) {
    return typeof s === 'string' && s.trim().length > 0;
}
