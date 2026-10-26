/**
 * @file src/contract/events.js
 * Event / decision / effect schema for the HOI Grande Estrategia extension.
 *
 * Part of the SHARED CONTRACT. Defines the shapes the LLM returns each turn
 * (GameEvent -> Option[] -> Effect[]) and the Crisis shape stored in world
 * state. The Effect taxonomy here is EXHAUSTIVE: the engine (Module A) can
 * apply any effect whose `type` is in EFFECT_TYPES. If you add an effect type,
 * add it here, in schemas.js (EVENT_SCHEMA + validateEvent), and in the engine.
 *
 * Display fields (title/narrative/label/rationale/description) are pt-BR.
 * Pure data only. Safe under node.
 */

import { RESOURCE_KEYS } from './worldState.js';

/**
 * Exhaustive list of effect `type` values the engine understands.
 * Keep in sync with EFFECT_SCHEMAS below and the engine's applyEffect().
 * @type {ReadonlyArray<EffectType>}
 */
export const EFFECT_TYPES = Object.freeze([
    'resource', // adjust one resource of a nation by a signed delta
    'relation', // adjust the relation score between two nations by a signed delta
    'tension', // adjust the global WW3 tension meter by a signed delta
    'crisis', // start or resolve a crisis
    'flag', // set/clear a story flag on world state
    'bloc', // move a nation into a different bloc
    'war', // declare or end war between two nations (relation + tension side effects)
    'resourceSet', // set a nation resource to an absolute value (rare; prefer 'resource')
]);

/**
 * Severity scale for crises.
 * @type {ReadonlyArray<CrisisSeverity>}
 */
export const CRISIS_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);

/** Allowed crisis actions for a 'crisis' effect. */
export const CRISIS_ACTIONS = Object.freeze(['start', 'escalate', 'deescalate', 'resolve']);

/** Allowed war actions for a 'war' effect. */
export const WAR_ACTIONS = Object.freeze(['declare', 'ceasefire', 'peace']);

/** Min / max number of options a GameEvent may present to the player. */
export const OPTION_COUNT = Object.freeze({ MIN: 2, MAX: 4 });

/** Soft bounds the validator enforces on effect deltas (keeps the LLM sane). */
export const EFFECT_DELTA_BOUNDS = Object.freeze({
    resource: { min: -50, max: 50 },
    relation: { min: -100, max: 100 },
    tension: { min: -50, max: 50 },
});

/**
 * @typedef {('resource'|'relation'|'tension'|'crisis'|'flag'|'bloc'|'war'|'resourceSet')} EffectType
 */

/**
 * @typedef {('low'|'medium'|'high'|'critical')} CrisisSeverity
 */

/**
 * @typedef {Object} Crisis
 * @property {string} id            Stable crisis id (slug/uuid).
 * @property {string} title         pt-BR short title.
 * @property {string} description   pt-BR description of the situation.
 * @property {CrisisSeverity} severity Severity bucket.
 * @property {string[]} involvedNationIds ISO alpha-3 ids of nations involved.
 * @property {number} turnStarted   Turn index when the crisis began.
 * @property {Object} [data]        Optional free-form crisis payload.
 */

/**
 * A single deterministic delta the engine applies. Exactly one shape per
 * `type`. All numeric deltas are signed unless the type says otherwise.
 *
 * @typedef {Object} Effect
 * @property {EffectType} type           Discriminator.
 * @property {string} [target]           Primary target. For 'resource'/'resourceSet'/'bloc': a nationId.
 *                                       For 'flag': the flag name. For 'relation'/'war': nationId A.
 * @property {string} [targetB]          Secondary nationId for 'relation'/'war'.
 * @property {ResourceKey} [resource]    Which resource, for 'resource'/'resourceSet'.
 * @property {number} [delta]            Signed delta for 'resource'/'relation'/'tension'.
 * @property {number} [value]            Absolute value for 'resourceSet', or flag value for 'flag'.
 * @property {CrisisAction} [action]     For 'crisis' (start/escalate/deescalate/resolve) and 'war'.
 * @property {string} [bloc]             For 'bloc': the destination bloc string.
 * @property {Partial<Crisis>} [crisis]  For 'crisis' action 'start': the crisis payload.
 * @property {string} [crisisId]         For 'crisis' escalate/deescalate/resolve: which crisis.
 * @property {string} [note]             Optional pt-BR note the engine may log.
 */

/**
 * @typedef {('start'|'escalate'|'deescalate'|'resolve')} CrisisAction
 */

/**
 * A player-selectable option attached to a GameEvent.
 * @typedef {Object} Option
 * @property {string} id         Stable option id (e.g. 'opt_a').
 * @property {string} label      pt-BR short action label shown on the button.
 * @property {string} rationale  pt-BR one-line explanation of consequences/tone.
 * @property {Effect[]} effects  Deterministic effects applied if chosen (may be empty).
 */

/**
 * The per-turn object the LLM returns (validated by validateEvent/EVENT_SCHEMA).
 * @typedef {Object} GameEvent
 * @property {string} id         Stable event id.
 * @property {string} title      pt-BR headline.
 * @property {string} narrative  pt-BR flavor text / situation description (the "story").
 * @property {string} [context]  Optional pt-BR extra context the UI may show.
 * @property {Option[]} options  2..4 options for the player.
 * @property {number} [tensionDelta] Optional baseline global-tension change applied
 *                                   regardless of which option is chosen. Signed.
 */

/**
 * Create a Crisis object with sane defaults.
 * @param {Partial<Crisis>} [p]
 * @returns {Crisis}
 */
export function createCrisis(p = {}) {
    return {
        id: p.id || `crisis-${Date.now().toString(36)}`,
        title: p.title || '',
        description: p.description || '',
        severity: CRISIS_SEVERITIES.includes(/** @type {any} */ (p.severity)) ? p.severity : 'medium',
        involvedNationIds: Array.isArray(p.involvedNationIds) ? p.involvedNationIds.slice() : [],
        turnStarted: typeof p.turnStarted === 'number' ? p.turnStarted : 0,
        ...(p.data ? { data: p.data } : {}),
    };
}

/**
 * Is `t` a recognized effect type?
 * @param {any} t
 * @returns {boolean}
 */
export function isEffectType(t) {
    return EFFECT_TYPES.includes(t);
}

/**
 * Is `r` one of the 7 resource keys?
 * @param {any} r
 * @returns {boolean}
 */
export function isResourceKey(r) {
    return RESOURCE_KEYS.includes(r);
}
