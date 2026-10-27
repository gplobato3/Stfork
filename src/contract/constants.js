/**
 * @file src/contract/constants.js
 * Shared constants for every module. Pure data, no side effects, node-safe.
 * Changing anything here is a CONTRACT change: coordinate before editing.
 */

/** Key used for ctx.extensionSettings[MODULE_KEY] and ctx.chatMetadata[MODULE_KEY]. */
export const MODULE_KEY = 'hoiGrandeEstrategia';

/** WorldState schema version. v1 saves (schemaVersion 1) are NOT migrated. */
export const SCHEMA_VERSION = 2;

/** Global function name declared in manifest.json "generate_interceptor". */
export const INTERCEPTOR_NAME = 'hoiGenerateInterceptor';

/** Key passed to ctx.setExtensionPrompt() for the situation report. */
export const INJECTION_KEY = 'hoi_sitrep';

/** Name shown on narrator messages the extension posts into the chat. */
export const NARRATOR_NAME = 'Boletim Internacional';

/** The 7 tracked national resources, all integers in [0..100]. Order is stable. */
export const RESOURCE_KEYS = Object.freeze([
    'economy',
    'military',
    'stability',
    'influence',
    'tech',
    'manpower',
    'warSupport',
]);

/** Primary geopolitical alignment of a nation (map "political" mode colors). */
export const BLOCS = Object.freeze(['NATO', 'EU', 'CSTO', 'BRICS', 'NON_ALIGNED']);

/** Game phases. */
export const PHASES = Object.freeze({
    SETUP: 'SETUP',
    PLAYER_TURN: 'PLAYER_TURN',
    GAME_OVER: 'GAME_OVER',
});

/** Inclusive numeric bounds. */
export const BOUNDS = Object.freeze({
    RESOURCE_MIN: 0,
    RESOURCE_MAX: 100,
    RELATION_MIN: -100,
    RELATION_MAX: 100,
    TENSION_MIN: 0,
    TENSION_MAX: 100,
    PROGRESS_MIN: 0,
    PROGRESS_MAX: 100,
    PC_MAX: 30,
});

/** Max magnitude of a single effect delta (validators and engine clamp to these). */
export const EFFECT_LIMITS = Object.freeze({
    resource: 25,
    relation: 50,
    tension: 20,
    pc: 30,
    front: 40,
    modifierPerTurn: 5,
    modifierTurns: 24,
});

/**
 * Exhaustive effect taxonomy the engine applies. See events.js for shapes.
 * Adding a type is a contract change (engine + schemas + prompts).
 */
export const EFFECT_TYPES = Object.freeze([
    'resource',
    'relation',
    'tension',
    'pc',
    'modifier',
    'crisis',
    'pact',
    'war',
    'front',
    'bloc',
    'flag',
    'news',
]);

/** Placeholders allowed in effect target fields; the engine resolves them. */
export const PLACEHOLDERS = Object.freeze({
    SELF: 'SELF', // the acting nation of an action
    TARGET: 'TARGET', // the target nation of an action
    PLAYER: 'PLAYER', // the player nation
});

export const CRISIS_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
export const CRISIS_ACTIONS = Object.freeze(['start', 'escalate', 'deescalate', 'resolve']);
export const WAR_ACTIONS = Object.freeze(['declare', 'ceasefire', 'peace']);
export const PEACE_TERMS = Object.freeze(['whitePeace', 'reparations', 'puppet', 'annex']);
export const PACT_TYPES = Object.freeze(['alliance', 'defense', 'trade', 'nonAggression', 'guarantee']);
export const PACT_ACTIONS = Object.freeze(['create', 'break']);

/** Nation status. */
export const NATION_STATUS = Object.freeze({
    ACTIVE: 'active',
    CAPITULATED: 'capitulated', // surrendered, awaiting peace terms
    PUPPET: 'puppet', // exists but `overlord` controls its foreign policy
    ANNEXED: 'annexed', // gone; territory controlled by `controller`
});

/** Player action categories (UI tabs + catalog grouping). */
export const ACTION_CATEGORIES = Object.freeze(['diplomacy', 'military', 'economy', 'internal', 'intel']);

/**
 * Event categories. Each maps to bundled art at assets/art/event-<category>.webp.
 * The LLM must pick one of these for every GameEvent.
 */
export const EVENT_CATEGORIES = Object.freeze([
    'diplomacy',
    'military',
    'naval',
    'nuclear',
    'economy',
    'unrest',
    'cyber',
    'intel',
    'humanitarian',
    'tech',
    'politics',
    'energy',
    'war',
]);

/** Number of options a GameEvent offers. */
export const OPTION_COUNT = Object.freeze({ MIN: 2, MAX: 4 });

/** Map display modes. */
export const MAP_MODES = Object.freeze(['political', 'diplomatic', 'military', 'crisis']);

/** Size caps for append-only arrays in WorldState (engine trims oldest first). */
export const CAPS = Object.freeze({ LOG: 300, NEWS: 80, RECENT_ACTIONS: 12, DECISIONS: 40 });

/** Custom eventSource event names (string, emitted with ctx.eventSource.emit). */
export const HOI_EVENTS = Object.freeze({
    STATE_CHANGED: 'hoi:state_changed',
    TURN_ENDED: 'hoi:turn_ended',
    GAME_OVER: 'hoi:game_over',
});
