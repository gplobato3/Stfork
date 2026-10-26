/**
 * @file src/contract/worldState.js
 * World-state schema for the HOI Grande Estrategia SillyTavern extension.
 *
 * This file is part of the SHARED CONTRACT (src/contract/*). Every other
 * module (engine, scenario, llm, ui) imports from here. The shapes and the
 * factory below are STABLE: parallel modules code against them.
 *
 * Scenario: modern-day / near-future WW3. The player is the head of state of
 * a chosen nation. Display strings in these typedefs are pt-BR; identifiers
 * and comments are English.
 *
 * Pure data + factory only. No ST imports, no side effects. Safe under node.
 */

/** Current schema version. Bump when the world-state shape changes. */
export const SCHEMA_VERSION = 1;

/**
 * Canonical list of the 7 resource keys every Nation tracks.
 * Order is stable and may be relied upon by the UI.
 * @type {ReadonlyArray<ResourceKey>}
 */
export const RESOURCE_KEYS = Object.freeze([
    'economy',
    'military',
    'stability',
    'influence',
    'tech',
    'manpower',
    'warSupport',
]);

/**
 * Known blocs. NON_ALIGNED is the catch-all; the list is not exhaustive and
 * scenario data MAY introduce additional string blocs.
 * @type {ReadonlyArray<string>}
 */
export const BLOCS = Object.freeze(['NATO', 'CSTO', 'EU', 'BRICS', 'NON_ALIGNED']);

/** Game phases. Drives which UI/controls are active. */
export const PHASES = Object.freeze({
    /** Before a campaign exists: show the nation picker. */
    SETUP: 'SETUP',
    /** Waiting for the player to resolve the current event / take decisions. */
    PLAYER_TURN: 'PLAYER_TURN',
    /** The LLM/engine is resolving the turn. */
    RESOLVING: 'RESOLVING',
    /** Terminal state (nation collapsed, nuclear war, victory, etc.). */
    GAME_OVER: 'GAME_OVER',
});

/** Inclusive bounds shared contract-wide. */
export const BOUNDS = Object.freeze({
    RESOURCE_MIN: 0,
    RESOURCE_MAX: 100,
    RELATION_MIN: -100,
    RELATION_MAX: 100,
    TENSION_MIN: 0,
    TENSION_MAX: 100,
});

/** Starting in-game date for the modern-day / near-future scenario. */
export const START_DATE = Object.freeze({ year: 2027, month: 1 });

/**
 * @typedef {('economy'|'military'|'stability'|'influence'|'tech'|'manpower'|'warSupport')} ResourceKey
 */

/**
 * @typedef {Object} Resources
 * All values are integers in [0..100] unless noted. Semantics:
 * @property {number} economy    Economic strength / budget headroom. 0..100.
 * @property {number} military   Readiness and size of the armed forces. 0..100.
 * @property {number} stability  Domestic political/social stability. 0..100.
 *                               Hitting 0 can trigger collapse/coup crises.
 * @property {number} influence  Diplomatic/soft power on the world stage. 0..100.
 * @property {number} tech       Technological/industrial edge. 0..100.
 * @property {number} manpower   Available mobilizable population pool. 0..100.
 * @property {number} warSupport Public appetite for conflict. 0..100.
 *                               Low warSupport makes aggressive options costly.
 */

/**
 * @typedef {Object} Nation
 * @property {string} id         ISO-3166-1 alpha-3 code, e.g. 'BRA', 'USA', 'RUS'. Primary key.
 * @property {string} name       pt-BR display name, e.g. 'Brasil'.
 * @property {string} flagEmoji  Flag emoji, e.g. '🇧🇷'.
 * @property {string} bloc       One of BLOCS (string; scenario may extend).
 * @property {boolean} isPlayer  True for exactly one nation: the player's.
 * @property {string} capital    pt-BR capital name, e.g. 'Brasília'.
 * @property {Resources} resources The 7 tracked resources.
 * @property {string} government Government type (pt-BR), e.g. 'República Presidencialista'.
 * @property {string} leaderTitle Head-of-state title (pt-BR), e.g. 'Presidente', 'Rei', 'Chanceler'.
 * @property {string[]} traits   National modifiers/tags (pt-BR or English tags),
 *                               e.g. ['Potência Nuclear', 'Economia Emergente'].
 */

/**
 * @typedef {Object} TurnLogEntry
 * @property {number} turn      Turn index this entry belongs to.
 * @property {{year:number, month:number}} date In-game date when logged.
 * @property {string} kind      'event' | 'decision' | 'effect' | 'system' | 'crisis'.
 * @property {string} text      pt-BR human-readable summary line.
 * @property {Object} [data]    Optional structured payload (effect applied, option chosen, etc.).
 */

/**
 * @typedef {Object} WorldState
 * @property {number} schemaVersion   Equals SCHEMA_VERSION at creation time.
 * @property {string} campaignId      Unique id for this campaign/save.
 * @property {string} seed            Seed string for seedrandom (deterministic mechanics).
 * @property {number} turn            Integer turn counter, starts at 0 (setup) / 1 (first played turn).
 * @property {{year:number, month:number}} date In-game date. month is 1..12.
 * @property {string} phase           One of PHASES.
 * @property {?string} playerNationId id of the player's Nation (null during SETUP).
 * @property {Object.<string, Nation>} nations Map of nationId -> Nation (ISO alpha-3 keys).
 * @property {Object.<string, number>} relations Map of 'A|B' -> score in [-100..100].
 *                                     Key is the normalized pair (see relationKey()).
 * @property {import('./events.js').Crisis[]} activeCrises Ongoing crises.
 * @property {number} globalTension   WW3 escalation meter in [0..100]. 100 = global war.
 * @property {TurnLogEntry[]} log      Append-only history of notable turn events.
 * @property {Object} flags           Free-form boolean/scalar story flags set by effects.
 */

/**
 * Build the canonical, normalized key for a relation between two nation ids.
 * Order-independent: relationKey('USA','RUS') === relationKey('RUS','USA').
 * @param {string} a nationId
 * @param {string} b nationId
 * @returns {string} 'A|B' with A,B sorted ascending.
 */
export function relationKey(a, b) {
    const x = String(a);
    const y = String(b);
    return x <= y ? `${x}|${y}` : `${y}|${x}`;
}

/**
 * Create a Resources object with all 7 keys, clamped to [0..100].
 * @param {Partial<Resources>} [overrides]
 * @returns {Resources}
 */
export function createResources(overrides = {}) {
    /** @type {Resources} */
    const base = {
        economy: 50,
        military: 50,
        stability: 50,
        influence: 50,
        tech: 50,
        manpower: 50,
        warSupport: 50,
    };
    for (const key of RESOURCE_KEYS) {
        if (overrides && typeof overrides[key] === 'number') {
            base[key] = clampResource(overrides[key]);
        }
    }
    return base;
}

/**
 * Clamp a number into the resource range [0..100] and round to an integer.
 * @param {number} n
 * @returns {number}
 */
export function clampResource(n) {
    return clamp(Math.round(Number(n) || 0), BOUNDS.RESOURCE_MIN, BOUNDS.RESOURCE_MAX);
}

/**
 * Clamp a relation score into [-100..100].
 * @param {number} n
 * @returns {number}
 */
export function clampRelation(n) {
    return clamp(Math.round(Number(n) || 0), BOUNDS.RELATION_MIN, BOUNDS.RELATION_MAX);
}

/**
 * Clamp the global tension meter into [0..100].
 * @param {number} n
 * @returns {number}
 */
export function clampTension(n) {
    return clamp(Math.round(Number(n) || 0), BOUNDS.TENSION_MIN, BOUNDS.TENSION_MAX);
}

/**
 * Generic numeric clamp.
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(n, min, max) {
    const v = Number(n);
    if (Number.isNaN(v)) return min;
    return Math.min(max, Math.max(min, v));
}

/**
 * Create a brand-new, empty world state in the SETUP phase.
 * The engine (Module A) fills nations/relations from the scenario (Module B)
 * once the player picks a nation.
 *
 * @param {Object} [opts]
 * @param {string} [opts.campaignId] Stable campaign id. A fallback is generated.
 * @param {string} [opts.seed]       Seed string for seedrandom. Falls back to campaignId.
 * @returns {WorldState}
 */
export function createEmptyWorldState(opts = {}) {
    const campaignId =
        (opts && opts.campaignId) ||
        `hoi-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const seed = (opts && opts.seed) || campaignId;
    return {
        schemaVersion: SCHEMA_VERSION,
        campaignId,
        seed,
        turn: 0,
        date: { year: START_DATE.year, month: START_DATE.month },
        phase: PHASES.SETUP,
        playerNationId: null,
        nations: {},
        relations: {},
        activeCrises: [],
        globalTension: 20,
        log: [],
        flags: {},
    };
}

/**
 * Shallow structural check that an object looks like a WorldState.
 * Used by save/load and tests; NOT a deep validator.
 * @param {any} obj
 * @returns {boolean}
 */
export function isWorldStateShape(obj) {
    return (
        !!obj &&
        typeof obj === 'object' &&
        typeof obj.schemaVersion === 'number' &&
        typeof obj.campaignId === 'string' &&
        typeof obj.seed === 'string' &&
        typeof obj.turn === 'number' &&
        !!obj.date &&
        typeof obj.date.year === 'number' &&
        typeof obj.date.month === 'number' &&
        typeof obj.phase === 'string' &&
        !!obj.nations &&
        typeof obj.nations === 'object' &&
        !!obj.relations &&
        typeof obj.relations === 'object' &&
        Array.isArray(obj.activeCrises) &&
        typeof obj.globalTension === 'number' &&
        Array.isArray(obj.log) &&
        !!obj.flags &&
        typeof obj.flags === 'object'
    );
}
