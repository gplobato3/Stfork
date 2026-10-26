/**
 * @file src/contract/interfaces.js
 * SINGLE SOURCE OF TRUTH for the module interface contracts.
 *
 * The four parallel modules (A engine, B scenario, C llm, D ui) code AGAINST
 * the signatures documented here. This file contains JSDoc typedefs only (no
 * runtime behavior) plus string constants that all modules share, so importing
 * it is cheap and side-effect-free under node.
 *
 * File map the parallel agents must respect:
 *   - Module A (engine):   src/engine/engine.js   -> EngineAPI
 *   - Module B (scenario): src/scenario/scenario.js -> ScenarioAPI
 *   - Module C (llm):      src/llm/llm.js          -> LlmAPI
 *   - Module D (ui):       src/ui/ui.js            -> UiAPI
 * Shared contract (this folder) is imported by all four.
 */

/** Settings/namespace key under ctx.extensionSettings and on window. */
export const MODULE_NAME = 'hoiGrandeEstrategia';

/** Folder passed to renderExtensionTemplateAsync('third-party/<DIR>', tpl). */
export const EXTENSION_DIR = 'third-party/Stfork';

/** Name of the global generate-interceptor function (see manifest.json). */
export const INTERCEPTOR_NAME = 'hoiGenerateInterceptor';

/**
 * Custom DOM/event names emitted on ctx.eventSource for cross-module comms.
 * Modules should use these instead of inventing their own strings.
 */
export const HOI_EVENTS = Object.freeze({
    STATE_CHANGED: 'hoi:stateChanged',
    TURN_ADVANCED: 'hoi:turnAdvanced',
    EVENT_READY: 'hoi:eventReady',
    GAME_OVER: 'hoi:gameOver',
});

/* -------------------------------------------------------------------------- */
/* Module A — Engine                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic game-state engine. Pure w.r.t. world state (no DOM, no LLM).
 * Persistence uses ST chatMetadata + saveMetadata via stContext.
 *
 * @typedef {Object} EngineAPI
 *
 * @property {(scenario: import('./interfaces.js').ScenarioData, playerNationId: string, opts?: {seed?: string, campaignId?: string}) => import('./worldState.js').WorldState} newGame
 *   Build a fresh WorldState from scenario data with the chosen player nation.
 *
 * @property {(state: import('./worldState.js').WorldState, nationId: string) => import('./worldState.js').WorldState} selectNation
 *   Mark `nationId` as the player's nation (used during SETUP). Returns the state.
 *
 * @property {(state: import('./worldState.js').WorldState, effect: import('./events.js').Effect) => import('./worldState.js').WorldState} applyEffect
 *   Apply ONE validated effect in place (and return the state). Clamps values.
 *
 * @property {(state: import('./worldState.js').WorldState, event: import('./events.js').GameEvent, optionId: string) => import('./worldState.js').WorldState} applyEvent
 *   Apply the chosen option's effects (plus event.tensionDelta) to the state,
 *   append a log entry, and return the state.
 *
 * @property {(state: import('./worldState.js').WorldState) => import('./worldState.js').WorldState} advanceTurn
 *   Advance turn + date by one month, run passive per-turn mechanics
 *   (tension drift, stability/economy ticks), set phase appropriately.
 *
 * @property {(state: import('./worldState.js').WorldState) => Promise<void>} saveState
 *   Persist the world state into ST chatMetadata under MODULE_NAME + saveMetadata().
 *
 * @property {() => Promise<import('./worldState.js').WorldState|null>} loadState
 *   Load the world state for the current chat from chatMetadata, or null if none.
 *
 * @property {(state: import('./worldState.js').WorldState) => string|null} checkGameOver
 *   Return a pt-BR game-over reason if a terminal condition is met, else null.
 */

/* -------------------------------------------------------------------------- */
/* Module B — Scenario                                                        */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} ScenarioData
 * @property {Object.<string, import('./worldState.js').Nation>} nations Map id -> Nation (ISO alpha-3).
 * @property {Object.<string, number>} relations Map 'A|B' -> score (-100..100).
 * @property {Object} geo        Map geometry: GeoJSON FeatureCollection (or SVG descriptor) for the UI.
 * @property {import('./events.js').Crisis[]} crisisSeeds Initial crises seeded at game start.
 * @property {Object} [meta]     Optional scenario metadata (name pt-BR, startDate, description).
 */

/**
 * @typedef {Object} ScenarioAPI
 * @property {() => Promise<ScenarioData>} loadScenario
 *   Load + assemble the scenario (nations.json, relations, geo, crisis seeds).
 *   Must resolve even under node (paths are extension-relative; guard fetch).
 * @property {() => string[]} listPlayableNationIds
 *   Ids the player may choose at setup (ISO alpha-3), in display order.
 */

/* -------------------------------------------------------------------------- */
/* Module C — LLM                                                             */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} LlmAPI
 * @property {(state: import('./worldState.js').WorldState) => string} buildSituationReport
 *   Produce a compact pt-BR situation report (player nation stats, tension,
 *   active crises, key relations) to inject as context for the LLM.
 *
 * @property {(state: import('./worldState.js').WorldState, opts?: {retries?: number}) => Promise<import('./events.js').GameEvent>} generateTurnEvent
 *   Ask the LLM (via generateRaw/structured output using EVENT_SCHEMA) for the
 *   next GameEvent, validate with validateEvent, retry once on failure, and
 *   fall back to a deterministic local event if generation fails. Never throws.
 *
 * @property {(chat: Array, contextSize: number, abort: (b?: boolean) => void, type: string) => Promise<void>} interceptor
 *   The body behind globalThis.hoiGenerateInterceptor: injects the situation
 *   report into the chat array when a campaign is active. Idempotent, never throws.
 */

/* -------------------------------------------------------------------------- */
/* Module D — UI                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} UiAPI
 * @property {(container?: HTMLElement) => Promise<void>} mount
 *   Build and attach the extension UI (map + dashboard + controls). Idempotent.
 *
 * @property {(state: import('./worldState.js').WorldState) => void} update
 *   Re-render all panels from the given world state.
 *
 * @property {(state: import('./worldState.js').WorldState) => void} renderMap
 *   Render/refresh the world map, highlighting the player nation + tension.
 *
 * @property {(state: import('./worldState.js').WorldState) => void} renderDashboard
 *   Render the ruler dashboard (7 resources, tension meter, date/turn, crises).
 *
 * @property {(event: import('./events.js').GameEvent, onChoose: (optionId: string) => void) => void} showEventModal
 *   Show the per-turn event with its options; call onChoose(optionId) on click.
 *
 * @property {(nationIds: string[], onPick: (nationId: string) => void) => void} showNationPicker
 *   Show the nation-selection screen; call onPick(nationId) when chosen.
 *
 * @property {(messagePtBr: string) => void} toast
 *   Surface a pt-BR message to the user (uses ST toastr when available).
 */

/* -------------------------------------------------------------------------- */
/* Glue (wired in FEAT-006)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The composition root FEAT-006 assembles. Documented here so module authors
 * know what their exports will be plugged into.
 * @typedef {Object} GameController
 * @property {EngineAPI} engine
 * @property {ScenarioAPI} scenario
 * @property {LlmAPI} llm
 * @property {UiAPI} ui
 * @property {() => Promise<void>} start      Boot: load or show setup.
 * @property {(nationId: string) => Promise<void>} startNewGame
 * @property {() => Promise<void>} nextTurn   Advance one turn end-to-end.
 */

// Intentionally no runtime exports beyond the shared constants above.
export default null;
