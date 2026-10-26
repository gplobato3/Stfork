# MODULE_CONTRACT.md — HOI Grande Estratégia

Single reference for the four parallel modules. Code against the files in
`src/contract/` — they are STABLE. Display strings are **pt-BR**; code,
identifiers, and comments are **English**.

- Shared constants: [`src/contract/interfaces.js`](./src/contract/interfaces.js)
- World state: [`src/contract/worldState.js`](./src/contract/worldState.js)
- Events / effects: [`src/contract/events.js`](./src/contract/events.js)
- JSON schemas + validator: [`src/contract/schemas.js`](./src/contract/schemas.js)
- ST bridge (node-safe): [`src/core/stContext.js`](./src/core/stContext.js)
- i18n: [`src/i18n/i18n.js`](./src/i18n/i18n.js) + [`i18n/pt-br.json`](./i18n/pt-br.json)

Everything in `src/contract/` and `src/core/stContext.js` imports cleanly under
node (no running SillyTavern). Keep it that way: never add a hard ST import that
throws at load, and add **no** runtime npm dependencies (use `SillyTavern.libs`).

---

## 1. Shared constants (`interfaces.js`)

| Constant | Value | Use |
|---|---|---|
| `MODULE_NAME` | `'hoiGrandeEstrategia'` | key under `ctx.extensionSettings` and on `window` |
| `EXTENSION_DIR` | `'third-party/Stfork'` | first arg to `renderExtensionTemplateAsync` |
| `INTERCEPTOR_NAME` | `'hoiGenerateInterceptor'` | global interceptor fn name (matches manifest) |
| `HOI_EVENTS` | `{STATE_CHANGED, TURN_ADVANCED, EVENT_READY, GAME_OVER}` | custom event names on `ctx.eventSource` |

---

## 2. World state (`worldState.js`)

`createEmptyWorldState({campaignId?, seed?}) -> WorldState`. Starts in
`PHASES.SETUP`, `turn: 0`, `date: {year: 2027, month: 1}`, `globalTension: 20`.

```
WorldState {
  schemaVersion: number        // SCHEMA_VERSION (=1)
  campaignId: string
  seed: string                 // for seedrandom (determinism)
  turn: number                 // int; 0 = setup, 1+ = played turns
  date: { year: number, month: number }   // month 1..12; starts 2027/1
  phase: string                // PHASES.{SETUP|PLAYER_TURN|RESOLVING|GAME_OVER}
  playerNationId: string|null  // ISO alpha-3; null during SETUP
  nations:   { [id: string]: Nation }      // id = ISO-3166 alpha-3 ('BRA','USA'...)
  relations: { [key: string]: number }     // key = relationKey(a,b); score -100..100
  activeCrises: Crisis[]
  globalTension: number        // 0..100 — WW3 escalation meter
  log: TurnLogEntry[]
  flags: { [name: string]: any }           // story flags set by 'flag' effects
}

Nation {
  id, name(pt-BR), flagEmoji, bloc, isPlayer, capital(pt-BR),
  resources: Resources, government(pt-BR), leaderTitle(pt-BR), traits: string[]
}

Resources (all int 0..100): economy, military, stability, influence, tech, manpower, warSupport
```

**7 resource keys** (stable order): `RESOURCE_KEYS` =
`['economy','military','stability','influence','tech','manpower','warSupport']`.

**Blocs**: `BLOCS` = `['NATO','CSTO','EU','BRICS','NON_ALIGNED']` (scenario may extend).

**Bounds** (`BOUNDS`): resources `0..100`, relations `-100..100`, tension `0..100`.

**Helpers**: `relationKey(a,b)` (order-independent `'A|B'`, sorted asc),
`createResources(overrides)`, `clampResource`, `clampRelation`, `clampTension`,
`clamp(n,min,max)`, `isWorldStateShape(obj)`.

> Always store/read relations through `relationKey()`. Never key by raw pair order.

---

## 3. Events, decisions, effects (`events.js`)

The LLM returns one **GameEvent** per turn:

```
GameEvent {
  id, title(pt-BR), narrative(pt-BR), context?(pt-BR),
  options: Option[]            // 2..4 (OPTION_COUNT.MIN/MAX)
  tensionDelta?: number        // signed; applied regardless of chosen option
}
Option { id, label(pt-BR), rationale(pt-BR), effects: Effect[] }
Crisis { id, title(pt-BR), description(pt-BR), severity, involvedNationIds: string[], turnStarted, data? }
```

`severity` ∈ `CRISIS_SEVERITIES` = `['low','medium','high','critical']`.

### Effect taxonomy (EXHAUSTIVE — `EFFECT_TYPES`)

The engine's `applyEffect` must handle every type below. Deltas are signed and
clamped to `EFFECT_DELTA_BOUNDS` (resource ±50, relation ±100, tension ±50).

| `type` | Payload fields | Meaning |
|---|---|---|
| `resource` | `target`=nationId, `resource`=ResourceKey, `delta` | adjust one resource |
| `resourceSet` | `target`=nationId, `resource`=ResourceKey, `value` | set resource to absolute value |
| `relation` | `target`=A, `targetB`=B, `delta` | adjust relation A↔B |
| `tension` | `delta` | adjust global tension |
| `flag` | `target`=flag name, `value` (default `true`) | set/clear a story flag |
| `bloc` | `target`=nationId, `bloc` (∈ BLOCS) | move a nation into a bloc |
| `war` | `target`=A, `targetB`=B, `action` ∈ `WAR_ACTIONS` `['declare','ceasefire','peace']` | war state change (engine also nudges relation/tension) |
| `crisis` | `action` ∈ `CRISIS_ACTIONS` `['start','escalate','deescalate','resolve']`; `crisis`(payload) for `start`, else `crisisId` | create/modify/resolve a crisis |

All effects accept an optional `note` (pt-BR) the engine may log.

**Helpers**: `createCrisis(partial)`, `isEffectType(t)`, `isResourceKey(r)`.

---

## 4. JSON schemas + validator (`schemas.js`)

- `EVENT_SCHEMA` — JSON Schema for a full GameEvent. Pass to ST structured
  output. Requires `title`, `narrative`, `options` (2..4; each with `label` +
  `effects`).
- `OPTION_SCHEMA`, `EFFECT_SCHEMA` — building blocks.
- `validateEvent(input) -> { ok, errors, value }` — dependency-free, never
  throws, runs in node + browser. Accepts a parsed object or JSON string.
  On `ok`, `value` is a **normalized** GameEvent (ids filled, effects cleaned
  per-type, deltas clamped). The LLM module MUST run this before the engine
  trusts any model output.
- `validateEffect(eff, path) -> { errors, value }` — per-type validation.

> Flow: LLM output → `validateEvent` → (if `!ok`) retry once / local fallback →
> engine applies `value`. Invalid output must degrade gracefully (toast), never
> crash ST.

---

## 5. ST bridge (`stContext.js`) — node-safe

| Export | Returns |
|---|---|
| `getContext()` | `SillyTavern.getContext()` if live, else a stable mock (`__hoiMock:true`) |
| `getLibs()` | `SillyTavern.libs` or `{}` |
| `getSeedRandom()` | `libs.seedrandom` or a deterministic Mulberry32 fallback factory `(seed)=>()=>number` |
| `getCoreFn(name)` | ctx fn (e.g. `generateRaw`) bound, or async no-op |
| `getSlashCommandApi()` | `{ SlashCommandParser, SlashCommand }` or no-op stubs |
| `isLive()` / `hasSillyTavern()` | boolean — gate UI / slash-command / event registration on this |

Mock ctx surfaces: `chat`, `characters`, `characterId`, `groups`, `groupId`,
`extensionSettings`, `chatMetadata`, `saveSettingsDebounced`, `saveMetadata`,
`writeExtensionField`, `renderExtensionTemplateAsync`, `addLocaleData`,
`getPresetManager`, `eventSource`, `event_types`, `generateRaw`,
`generateQuietPrompt`.

---

## 6. i18n (`i18n.js` + `i18n/pt-br.json`)

- `t(key, vars?)` — translate; interpolates `{placeholder}`; unknown key returns
  the key itself (UI never breaks).
- `loadLocale(obj, locale='pt-br')` — merge strings; forwards to
  `ctx.addLocaleData` when live.
- `hasKey(key)`, `dumpStrings()`.

All user-facing copy goes through `t()`. Seed keys live in `i18n/pt-br.json`
(app title, buttons `Novo Jogo`/`Avançar Turno`/`Mapa`/`Painel`, 7 resource
labels `hoi_res_*`, tension label, error/toast text). Add new keys there.

---

## 7. Module interfaces (`interfaces.js` JSDoc — code against these)

### Module A — Engine → `src/engine/engine.js` (export a factory returning `EngineAPI`)
`newGame(scenario, playerNationId, opts?)`, `selectNation(state, nationId)`,
`applyEffect(state, effect)`, `applyEvent(state, event, optionId)`,
`advanceTurn(state)`, `saveState(state): Promise`, `loadState(): Promise<WorldState|null>`,
`checkGameOver(state): string|null`. Pure w.r.t. state; persistence via
`chatMetadata`+`saveMetadata` under `MODULE_NAME`. Deterministic via seedrandom
seeded from `state.seed`.

### Module B — Scenario → `src/scenario/scenario.js` (export a factory returning `ScenarioAPI`)
`loadScenario(): Promise<ScenarioData>` where
`ScenarioData = { nations, relations, geo, crisisSeeds, meta? }`;
`listPlayableNationIds(): string[]`. Must resolve under node (guard `fetch`;
extension-relative paths). Authored assets under `assets/scenario/`.

### Module C — LLM → `src/llm/llm.js` (export a factory returning `LlmAPI`)
`buildSituationReport(state): string` (compact pt-BR),
`generateTurnEvent(state, opts?): Promise<GameEvent>` (uses `generateRaw` +
`EVENT_SCHEMA`, `validateEvent`, retry once, local fallback; never throws),
`interceptor(chat, contextSize, abort, type): Promise<void>` (body for
`globalThis.hoiGenerateInterceptor`; injects the situation report as a system
note WITHOUT replacing the user's preset/character; idempotent; never throws).

### Module D — UI → `src/ui/ui.js` (export a factory returning `UiAPI`)
`mount(container?)`, `update(state)`, `renderMap(state)`,
`renderDashboard(state)`, `showEventModal(event, onChoose)`,
`showNationPicker(nationIds, onPick)`, `toast(messagePtBr)`. Templates in
`templates/*.html` via `renderExtensionTemplateAsync(EXTENSION_DIR, name, data)`;
styles in `style.css`.

### Glue — FEAT-006 (`index.js`)
Assembles a `GameController { engine, scenario, llm, ui, start, startNewGame,
nextTurn }`, registers slash commands + ST events, mounts the UI, and routes the
real interceptor body through `globalThis.hoiGenerateInterceptor`. `index.js` is
currently a thin shell with lifecycle stubs only.

---

## Validation (run before any commit)

```sh
node tools/check.mjs   # JS syntax + JSON parse + validateEvent fixtures; exits 0
node --test            # node:test contract tests
```

No hardcoded secrets/tokens anywhere (no `r8_`, no Replicate token, no `api_key=`).
Image generation is deferred to post-v1 and, when added, reads its key only from
an environment variable.
