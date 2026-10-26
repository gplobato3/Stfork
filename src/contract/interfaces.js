/**
 * @file src/contract/interfaces.js
 * Module APIs (JSDoc only). Every module codes against these signatures.
 * Node-safe; no runtime behaviour.
 *
 *   ENGINE    src/engine/index.js      export function createEngine(): EngineAPI          (pure, no ST access)
 *   SCENARIO  src/scenario/index.js    export function createScenarioLoader(): ScenarioAPI
 *   MAP DATA  assets/map/world.map.json (MapData, built by tools/build-map.mjs)
 *   LLM       src/llm/index.js         export function createLlm(deps): LlmAPI
 *   ST        src/st/index.js          export function createSt(deps): StAPI               (ALL SillyTavern side effects)
 *   UI        src/ui/index.js          export function createUi(deps): UiAPI
 *   GLUE      src/game/controller.js   export function createController(deps): ControllerAPI
 *             index.js                 composition root (manifest entry)
 *
 * @typedef {import('./worldState.js').WorldState} WorldState
 * @typedef {import('./worldState.js').Nation} Nation
 * @typedef {import('./events.js').GameEvent} GameEvent
 * @typedef {import('./events.js').ActionDef} ActionDef
 * @typedef {import('./events.js').ActionAvailability} ActionAvailability
 * @typedef {import('./events.js').ActionResult} ActionResult
 * @typedef {import('./events.js').TurnReport} TurnReport
 * @typedef {import('./events.js').Effect} Effect
 */

/* ------------------------------------------------------------------ SCENARIO */

/**
 * A start date ("período") the player picks before choosing a nation.
 * @typedef {Object} Bookmark
 * @property {string} id                 'b2026' | 'b2028' | 'b2031'
 * @property {string} name               pt-BR ('O Mundo Hoje')
 * @property {{year:number, month:number}} date
 * @property {{year:number, month:number}} endDate
 * @property {string} description        pt-BR, 2-4 sentences.
 * @property {string} art                'bookmark-b2026' -> assets/art/bookmark-b2026.webp
 * @property {number} tension            Starting global tension.
 * @property {string[]} recommended      Nation ids highlighted in the picker.
 * @property {Object} overrides          Applied on top of base nations/relations:
 *   { nations?: Record<id, Partial<Nation>>, relations?: Record<'A|B', number>,
 *     pacts?: Pact[], wars?: War[], crises?: Crisis[] }  (pacts/wars/crises REPLACE base lists when present)
 */

/**
 * Everything engine.newGame needs. Produced by ScenarioAPI.load().
 * @typedef {Object} ScenarioData
 * @property {string} id                 'modern-ww3'
 * @property {string} name               pt-BR
 * @property {Record<string, Nation>} nations   ALL map countries: authored + generated minors.
 * @property {Record<string, number>} relations relationKey -> score
 * @property {import('./worldState.js').Pact[]} pacts
 * @property {import('./worldState.js').War[]} wars
 * @property {import('./worldState.js').Crisis[]} crises
 * @property {Bookmark[]} bookmarks
 * @property {Record<string, string[]>} neighbors   nationId -> land/maritime neighbor ids (from MapData)
 */

/**
 * @typedef {Object} ScenarioAPI
 * @property {() => Promise<ScenarioData>} load      Cached after first call. Throws only on missing assets.
 * @property {() => Promise<MapData>} loadMap        Cached.
 * @property {(path: string) => string} assetUrl     'art/event-war.webp' -> absolute URL inside the extension folder.
 */

/**
 * Pre-projected map geometry (built offline; the browser never projects).
 * Coordinates are in a fixed viewBox: MapData.width x MapData.height.
 * @typedef {Object} MapData
 * @property {number} width
 * @property {number} height
 * @property {string} projection         e.g. 'naturalEarth1'
 * @property {Record<string, MapCountry>} countries
 * @property {string} graticule          SVG path "d" for the 30° graticule.
 * @property {string} outline            SVG path "d" for the globe outline (sphere).
 *
 * @typedef {Object} MapCountry
 * @property {string} id
 * @property {string} d                  SVG path data.
 * @property {[number, number]} label    Label anchor (pole of inaccessibility / largest polygon centroid).
 * @property {[number, number]} capital  Capital marker position (approximate is fine).
 * @property {number} area               Projected area (for label sizing / visibility).
 * @property {[number, number, number, number]} bbox  [minX, minY, maxX, maxY]
 * @property {string[]} neighbors
 */

/* -------------------------------------------------------------------- ENGINE */

/**
 * Pure game rules. Never touches SillyTavern, DOM or network. Deterministic:
 * same input state (+ same args) => identical output. Never mutates inputs.
 *
 * @typedef {Object} EngineAPI
 * @property {(scenario: ScenarioData, opts: {bookmarkId:string, nationId:string, leaderName:string, seed?:string, difficulty?:'facil'|'normal'|'dificil'}) => WorldState} newGame
 * @property {() => ActionDef[]} getCatalog
 * @property {(state: WorldState, actorId: string, targetId?: ?string) => ActionAvailability[]} getAvailableActions
 *           All catalog actions for this actor (targeted ones evaluated against targetId; when targetId is
 *           null, targeted actions are returned with available=false and reason 'Selecione um alvo').
 * @property {(state: WorldState, actorId: string, actionId: string, targetId?: ?string, opts?: {source?: 'ui'|'order'|'ai'|'command'}) => {state: WorldState, result: ActionResult}} executeAction
 * @property {(state: WorldState) => {state: WorldState, report: TurnReport}} endTurn
 *           Month upkeep: modifiers, economy, PC income, AI actions, war resolution, calls to arms,
 *           capitulations, crisis evolution, tension, date++, outcome check. Never calls the LLM.
 * @property {(state: WorldState, event: GameEvent) => WorldState} setPendingEvent
 *           Sets state.pendingEvent (LLM events). If one is already pending, queues the new one.
 * @property {(state: WorldState, optionIndex: number) => {state: WorldState, summary: string, details: string[]}} resolvePendingEvent
 *           Applies option effects of state.pendingEvent, records the decision, promotes the next queued event.
 * @property {(state: WorldState, effects: Effect[], ctx?: {actorId?:string, targetId?:string}) => {state: WorldState, details: string[]}} applyEffects
 *           Validates + clamps every effect; unknown/invalid effects are skipped (never throws).
 * @property {(state: WorldState, id: string) => NationView} getNationView
 * @property {(state: WorldState) => Array<{id:string, name:string, power:number}>} getRanking   Active nations by power, desc.
 * @property {(raw: any) => ?WorldState} migrate        Returns a valid v2 state or null (v1 saves => null).
 * @property {(event: any, state: WorldState) => {ok: boolean, value: ?GameEvent, errors: string[]}} sanitizeEvent
 *           Normalizes an LLM event: resolves 'PLAYER', drops effects with unknown nation ids / types,
 *           clamps deltas, enforces OPTION_COUNT, fills id/source/turn/category defaults.
 *
 * @typedef {Object} NationView
 * @property {Nation} nation
 * @property {number} power               0..100 composite.
 * @property {number} relationToPlayer
 * @property {string} relationTier        'aliado' | 'amistoso' | 'neutro' | 'tenso' | 'hostil' | 'guerra'
 * @property {string[]} atWarWith
 * @property {string[]} allies            Alliance/defense pact partners.
 * @property {import('./worldState.js').Pact[]} pacts
 * @property {string} controller          Who controls its territory.
 * @property {number} occupation          0..100 max progress of any front against it.
 * @property {?string} occupier           Attacker with the highest progress.
 * @property {import('./worldState.js').Crisis[]} crises
 */

/* ----------------------------------------------------------------------- LLM */

/**
 * All LLM calls. Never throws: failures resolve to fallbacks / empty results.
 * deps: { st: StAPI, engine: EngineAPI }
 *
 * @typedef {Object} LlmAPI
 * @property {(state: WorldState, ctx: {report?: TurnReport, recentChat?: string}) => Promise<GameEvent>} generateTurnEvent
 *           Structured output. Returns an engine.sanitizeEvent()-clean event; source 'fallback' on failure.
 * @property {(state: WorldState, text: string) => Promise<{orders: Array<{actionId:string, targetId:?string, quote:string}>, error?: string}>} interpretOrders
 *           Maps a free-form pt-BR order to catalog actions (max 3). Empty list when the text is not an order.
 * @property {(state: WorldState, ctx: {report: TurnReport, decision?: {eventTitle:string, optionLabel:string}}) => Promise<string>} writeBulletin
 *           Short pt-BR news bulletin for the chat (uses generateQuietPrompt so the user's preset voice applies).
 *           '' on failure.
 * @property {(state: WorldState, opts?: {budgetTokens?: number}) => string} buildSitrep
 *           Deterministic pt-BR situation report used by the prompt injection and macros.
 */

/* ------------------------------------------------------------------------ ST */

/**
 * The ONLY module allowed to touch SillyTavern APIs (plus src/core/stContext.js).
 * deps: { getState: () => ?WorldState, buildSitrep: (state, opts) => string, onUserOrder?: (text) => Promise<string[]> }
 *
 * @typedef {Object} StAPI
 * @property {() => boolean} isLive
 * @property {() => HoiSettings} getSettings
 * @property {(patch: Partial<HoiSettings>) => HoiSettings} updateSettings
 * @property {() => ?WorldState} loadCampaign            Reads ctx.chatMetadata[MODULE_KEY] (raw; caller migrates).
 * @property {(state: WorldState) => Promise<void>} saveCampaign
 * @property {() => Promise<void>} clearCampaign
 * @property {() => string|null} currentChatId
 * @property {(state: ?WorldState) => void} refreshInjection   setExtensionPrompt (or clears it when state is null / disabled).
 * @property {() => void} installInterceptor                  Defines globalThis[INTERCEPTOR_NAME].
 * @property {() => void} registerMacros
 * @property {(controller: ControllerAPI) => void} registerCommands
 * @property {(text: string, opts?: {name?: string}) => Promise<void>} postNarrator   Narrator-type chat message.
 * @property {(opts: {systemPrompt: string, prompt: string, schemaName: string, schema: object, maxTokens?: number}) => Promise<{ok: boolean, value?: any, raw?: string, error?: string}>} generateStructured
 *           Correct ST structured output: jsonSchema = {name, description, strict:false, value, returnInvalid:true}.
 *           Uses settings.engineProfileId via ConnectionManagerRequestService when set, else ctx.generateRaw.
 * @property {(quietPrompt: string) => Promise<string>} generateQuiet
 * @property {(n: number) => string} recentChatText          Last n non-system messages as "Nome: texto" (truncated).
 * @property {() => string} personaName                       ctx.name1 (user persona) or 'Governante'.
 * @property {() => Array<{id:string, name:string}>} listConnectionProfiles
 * @property {() => Promise<{ok:boolean, message:string}>} importCouncilCharacter   Imports assets/character/conselho.json.
 * @property {(type: string, fn: Function) => void} on       eventSource.on wrapper (records for cleanup).
 * @property {() => void} offAll
 * @property {(msg: string, kind?: 'info'|'success'|'warning'|'error') => void} toast
 *
 * @typedef {Object} HoiSettings
 * @property {boolean} enabled
 * @property {{enabled:boolean, position:'in_chat'|'in_prompt'|'before_prompt', depth:number, role:'system'|'user'|'assistant', detail:'compact'|'full'}} injection
 * @property {'auto'|'command'|'off'} ordersMode   auto: interpret every user message while a campaign is active.
 * @property {boolean} llmEvents                    false = only engine/fallback events (no LLM calls per turn).
 * @property {boolean} postBulletins                Post a narrator bulletin into the chat after each turn.
 * @property {string} engineProfileId               '' = current connection.
 * @property {number} eventMaxTokens
 * @property {boolean} showHud
 * @property {boolean} showArt
 * @property {'facil'|'normal'|'dificil'} difficulty
 */

/* ------------------------------------------------------------------------ UI */

/**
 * deps: { scenario: ScenarioAPI, handlers: UiHandlers, query: UiQuery }
 *
 * @typedef {Object} UiHandlers
 * @property {() => void} onNewCampaign
 * @property {() => void} onEndTurn
 * @property {(actionId: string, targetId: ?string) => void} onAction
 * @property {(text: string) => void} onOrder                 Order typed in the War Room order box.
 * @property {() => void} onOpenEvent                          Re-open the pending decision.
 * @property {() => void} onSave
 * @property {() => void} onResetCampaign
 * @property {(patch: Partial<HoiSettings>) => void} onSettingsChange
 * @property {() => void} onImportCharacter
 *
 * @typedef {Object} UiQuery
 * @property {() => ?WorldState} getState
 * @property {(targetId: ?string) => ActionAvailability[]} getPlayerActions
 * @property {(id: string) => NationView} getNationView
 * @property {() => Array<{id:string, name:string, power:number}>} getRanking
 * @property {() => HoiSettings} getSettings
 * @property {() => Array<{id:string, name:string}>} listConnectionProfiles
 * @property {() => boolean} isBusy
 *
 * @typedef {Object} UiAPI
 * @property {() => Promise<void>} mount                       Wand-menu entry, HUD, settings drawer, overlay root. Idempotent.
 * @property {() => void} unmount
 * @property {() => Promise<void>} openWarRoom
 * @property {() => void} closeWarRoom
 * @property {() => void} refresh                              Re-render everything visible from query.getState().
 * @property {(scenario: ScenarioData, opts: {defaultLeaderName: string}) => Promise<?{bookmarkId:string, nationId:string, leaderName:string, difficulty:string}>} showNewCampaignWizard
 * @property {(event: GameEvent, opts?: {dismissible?: boolean}) => Promise<?number>} showEvent   Resolves option index, or null if postponed.
 * @property {(report: TurnReport) => void} showTurnReport     Non-blocking summary (toast/panel + ticker).
 * @property {(result: ActionResult) => void} showActionResult
 * @property {(outcome: {kind:'victory'|'defeat', reason:string}) => Promise<void>} showGameOver
 * @property {(busy: boolean, label?: string) => void} setBusy
 * @property {(msg: string, kind?: 'info'|'success'|'warning'|'error') => void} toast
 * @property {(opts: {title:string, text:string, okLabel?:string}) => Promise<boolean>} confirm
 */

/* ---------------------------------------------------------------------- GLUE */

/**
 * @typedef {Object} ControllerAPI
 * @property {() => Promise<void>} start                     Load scenario, restore campaign for current chat, mount UI.
 * @property {() => Promise<void>} openWarRoom
 * @property {() => Promise<void>} newCampaign               Wizard -> engine.newGame -> save -> open War Room.
 * @property {(actionId: string, targetId?: ?string, source?: string) => Promise<?ActionResult>} doAction
 * @property {() => Promise<void>} endTurn                   engine.endTurn -> LLM event -> save -> report -> bulletin -> show decision.
 * @property {() => Promise<void>} openPendingEvent
 * @property {(text: string, source?: 'chat'|'warroom'|'command') => Promise<ActionResult[]>} handleOrder
 * @property {() => Promise<void>} save
 * @property {() => Promise<void>} reset
 * @property {() => Promise<void>} onChatChanged
 * @property {() => ?WorldState} getState
 * @property {() => string} statusText                       pt-BR sitrep for /hoi-status.
 * @property {() => boolean} isBusy
 */

export {};
