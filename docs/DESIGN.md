# HOI — Grande Estratégia v2: design and build contract

Read `docs/AUDIT.md` first: it explains why v1 did not work inside a real SillyTavern.
This document is the contract every module builds against. Code/comments in English,
every player-facing string in **pt-BR**. The shared contract lives in `src/contract/*.js`
and `css/base.css`; those files are READ-ONLY for module agents.

Reference SillyTavern source (1.19.0) is checked out read-only at
`/projects/sandbox/.st-ref` — grep it to confirm any API before using it. Never guess an
ST API shape; cite the file/line in a comment when the behaviour is non-obvious.

---

## 1. Product in one paragraph

A Hearts-of-Iron-style grand strategy campaign that lives inside a SillyTavern chat. The
player picks a **period** (bookmark: 2026 "O Mundo Hoje", 2028 "À Beira do Abismo", 2031
"A Terceira Guerra Mundial"), a **nation** and their **ruler name**. A full-screen **Sala de
Guerra** (War Room) shows an HOI-like world map with map modes, a top bar with resources /
political capital / DEFCON, nation dossiers, an action catalog, wars with moving fronts and
a news ticker. Each month the player spends **Capital Político** on actions, then ends the
turn: the deterministic engine runs the world (AI nations act, fronts move, crises evolve),
the LLM writes one **decision event** grounded in that state and in the recent chat, and a
**bulletin** is posted in the chat. Meanwhile the normal chat (with the user's own preset
and character) is the role-play layer: a compact situation report is injected through
`setExtensionPrompt`, and free-form orders typed in chat ("Mobilizem as tropas na fronteira
com a Venezuela") are interpreted by an LLM **arbiter** into catalog actions that the engine
executes with real costs and dice. The chat narrates; the engine decides.

## 2. Architecture and ownership

```
index.js                     composition root (GLUE)
manifest.json                GLUE
style.css -> css/*.css       base.css = contract; others owned per module
src/contract/*               contract (read-only)
src/core/stContext.js        ST    — safe access to SillyTavern.getContext()/libs
src/st/**                    ST    — every SillyTavern side effect
src/llm/**                   ST    — prompts, structured calls, sitrep, arbiter, bulletins
src/engine/**                ENGINE — pure rules, catalog, AI, wars
src/scenario/**              SCENARIO — loaders, asset URLs
assets/scenario/**           SCENARIO — nations, relations, pacts, wars, crises, bookmarks
assets/map/world.map.json    SCENARIO — pre-projected map (tools/build-map.mjs)
assets/flags/*.svg           SCENARIO — flags by nation id
assets/art/*.webp            ORCHESTRATOR — generated illustrations (list in §8)
assets/character/**          ST    — "Conselho de Guerra" character card
src/ui/index.js              UI-A  — createUi facade
src/ui/warroom/**, src/ui/map/**, css/warroom.css, css/map.css         UI-A
src/ui/dialogs/**, src/ui/hud/**, src/ui/settings/**, src/ui/wand.js,
css/dialogs.css, css/hud.css, css/settings.css                         UI-B
src/game/controller.js       GLUE
test/<module>/*.test.js      each module its own folder
```

Rules for module agents:
- Only create/edit files you own. If you need a contract change, write the request in
  `docs/contract-requests/<module>.md` and work around it locally.
- Do not commit, do not push, do not touch git state. The orchestrator commits.
- Run only your own tests: `node --test "test/<module>/*.test.js"` (Node ≥ 21 no longer
  expands a directory argument; `npm test` runs everything). Other agents are writing files at
  the same time; their half-written code is not your problem.
- No runtime npm dependencies. The extension ships as plain ES modules. Dev-only tooling
  (map build) may use npm packages; only SCENARIO may edit `package.json` devDependencies.
- v1 code is available via `git show main:<path>` if you want to reuse something.
- Every module must import cleanly under node (no DOM/ST access at import time).

## 3. Game rules (ENGINE)

All numbers below are starting points; ENGINE owns balance and must back it with a
simulation test (see §3.9).

### 3.1 State
`WorldState` v2 in `src/contract/worldState.js`. The engine never mutates inputs and is
deterministic: per-call RNG = `seedrandom(seed + ':' + turn + ':' + salt)` (use
`SillyTavern.libs.seedrandom` when present, otherwise a local PRNG; keep it injectable so
node tests are deterministic).

### 3.2 Political capital (PC)
- Every nation has `pc` (0..30). Income per turn ≈ `2 + floor(influence/25) + floor(stability/40)`,
  difficulty `facil` +1 / `dificil` −1 for the player.
- Actions cost PC plus optional resources. PC is the per-turn action budget.

### 3.3 Action catalog (`src/engine/catalog.js`)
~28 `ActionDef`s across `diplomacy`, `military`, `economy`, `internal`, `intel`. Must include at
least: improve relations, send aid, trade agreement, propose alliance/defense pact,
guarantee independence, sanctions, expel diplomats, ultimatum/demand concessions, declare
war, propose ceasefire, propose peace; partial mobilization, total mobilization,
demobilize, border exercises, military modernization, send expeditionary support to an
ally at war, limited strike, nuclear alert, nuclear test, (player-only, confirm) nuclear
strike; economic stimulus, austerity, industrial investment, research program, energy
deals; propaganda campaign, political reforms, crackdown on dissent, early elections;
espionage, cyberattack, destabilization operation, counter-intelligence.
Each with pt-BR `name`/`description`/`keywords`, Font Awesome icon, cost, cooldown,
requirements, chance and success/failure effects using `SELF`/`TARGET` placeholders.
Diplomatic proposals (alliance, peace, trade) succeed by AI acceptance: chance depends on
relation, target personality and power ratio.

### 3.4 Turn (`endTurn`)
Order: (1) timed modifiers tick, (2) economy/upkeep (wars cost economy, stability,
warSupport; economy < 20 hurts stability; mobilization costs economy), (3) PC income,
(4) AI actions — every `major` acts once, minors with ~15% chance, chosen by utility from
the same catalog using `personality`, never suicidal (no war on a much stronger nuclear
power without allies), (5) war resolution, (6) calls to arms, (7) crisis evolution
(escalate/deescalate/expire; low stability can spawn unrest crises), (8) tension update,
(9) date++ and cooldowns, (10) outcome check. Produces a deterministic pt-BR `TurnReport`
with headlines (also pushed to `state.news`) and `engineEvents` (pushed to
`state.eventQueue`).

### 3.5 Wars and the map
- `war.declare` creates a `War` with one `Front` per attacker/defender pair whose nations
  are neighbors or where the attacker is a major power. Allies with alliance/defense pacts
  get a call to arms (AI decides by `blocLoyalty`; the PLAYER gets an engine event:
  "Chamado às Armas" — join or refuse, refusing costs relation and influence).
- Monthly front progress ≈ `clamp((atk − def × 1.15) / 6 + noise, −8, +12)` with strength
  from military, tech, economy, manpower, warSupport and co-belligerent contributions.
  Exhaustion grows each month; high exhaustion drains stability and warSupport.
- Progress 100 against a defender ⇒ capitulation. AI attacker picks terms by personality.
  If the player is the winning attacker ⇒ engine event "Termos de Paz" (annex / puppet /
  reparations / white peace). If the player capitulates ⇒ defeat.
- Annex: `status='annexed'`, `controller=winner` (map recolors). Puppet: `status='puppet'`,
  `overlord=winner`. Peace ends the war; ceasefire freezes fronts.
- Nuclear: strikes and nuclear wars add large tension. Tension 100 ⇒ global nuclear war ⇒
  defeat for everyone.

### 3.6 LLM events are bounded
`sanitizeEvent` is the only gate for LLM output: resolve `PLAYER`, drop unknown nation ids
and effect types, clamp deltas to `EFFECT_LIMITS`, at most 6 effects per option, 2..4
options, default category `politics`. A war-declaration effect in an LLM event is allowed
only when the option text clearly says so (keep it; the player chose it).

### 3.7 Outcome
- Victory: reach `endDate` with the player nation active (score = power rank + stability +
  tension avoided); or every enemy at war with you capitulated while you are rank 1 (Hegemonia).
- Defeat: player annexed/capitulated, stability 0 for 2 consecutive turns (golpe de
  Estado), or global nuclear war.

### 3.8 Engine-generated decisions
Calls to arms, peace terms, AI peace offers to the player, capitulation offers. They are
`GameEvent`s with `source:'engine'`, queued in `state.eventQueue`; the controller shows
them before/alongside the LLM event.

### 3.9 Required tests
Unit tests for every effect type, action availability reasons, executeAction determinism,
war resolution, capitulation/annexation, calls to arms, sanitizeEvent, migrate(v1)=null.
Plus a **balance simulation**: passive player, 120 turns, 20 seeds, each bookmark —
assert e.g. b2026 does not end in nuclear war before turn 36 in ≥ 90% of seeds, at least
one war front moves, AI uses ≥ 8 distinct actions, no exceptions, state stays
JSON-serializable and `isWorldState`.

## 4. Scenario and map (SCENARIO)

- Keep the 26 v1 nations (`git show main:assets/scenario/nations.json`) and expand to
  **≥ 45 playable** nations with good regional coverage, including South America (ARG,
  VEN, COL, CHL, PER), Middle East (EGY, SYR, IRQ, ARE, QAT), Africa (NGA, ETH, DZA),
  Asia (VNM, THA, PHL, TWN, PAK, BGD, MYS), Europe (NLD, SWE, FIN, NOR, GRC, ROU, HUN, SRB).
  Every authored nation: all `Nation` fields, calibrated resources, `personality`,
  `nuclear`, 2-4 pt-BR traits, `blurb`, `difficulty`.
- Every other map country becomes a generated **minor** (`playable:false`, modest stats,
  passive personality, pt-BR name — map to pt-BR names, do not leave English).
- Base relations (≥ 200 authored pairs among majors/regionals), base pacts (OTAN,
  OTSC, ...), base wars (Russia–Ukraine is ongoing in 2026), base crises.
- `assets/scenario/bookmarks.json`: the three bookmarks of §1 with dates, endDate (+10
  years), tension (≈ 42 / 62 / 84), recommended nations, and `overrides` that change the
  world (2028: Taiwan blockade crisis, Baltic incidents; 2031: WW3 already started —
  NATO+allies vs RUS/CHN coalition with active fronts; nations' resources adjusted).
- `tools/build-map.mjs` (dev, may use `d3-geo`/`topojson`): read
  `assets/scenario/world.geo.json` (Natural Earth 110m, ids = ISO alpha-3), project with
  Natural Earth I (or Robinson) into a fixed viewBox (e.g. 1000 × 520), simplify, round to
  1 decimal, compute label points, capital positions, bbox, area and neighbors (shared
  border vertices within epsilon + a small maritime list: GBR–FRA, JPN–KOR, etc.), and
  write `assets/map/world.map.json` (target ≤ 350 KB). Include graticule and outline.
- Flags: `assets/flags/<ID>.svg` for every nation id (source: `flag-icons` npm package,
  MIT, 4x3; keep `LICENSE-flags` attribution). Minify; total ≤ 2 MB.
- `src/scenario/index.js`: `createScenarioLoader()` → `ScenarioAPI`. Resolve the extension
  base URL from `import.meta.url` (never hardcode the folder name). Works in node via fs
  for tests.
- Tests: every nation id has map geometry and a flag, every relation/pact/war/crisis
  references existing ids, bookmarks produce a valid world through their overrides,
  pt-BR names present for all map countries.

## 5. SillyTavern integration (ST) — verified facts

From `/projects/sandbox/.st-ref` (1.19.0):
- `SillyTavern.getContext()` exposes, among others: `chat`, `chatMetadata`,
  `saveMetadata`, `saveMetadataDebounced`, `extensionSettings`, `saveSettingsDebounced`,
  `eventSource`, `eventTypes`/`event_types`, `setExtensionPrompt`, `extensionPrompts`,
  `generateRaw`, `generateRawData`, `generateQuietPrompt`, `addOneMessage`, `saveChat`,
  `sendSystemMessage`, `substituteParams`, `SlashCommandParser`, `SlashCommand`,
  `SlashCommandArgument`, `SlashCommandNamedArgument`, `ARGUMENT_TYPE`, `macros`,
  `registerMacro` (deprecated), `callGenericPopup`, `Popup`, `POPUP_TYPE`,
  `ConnectionManagerRequestService`, `getCharacters`, `getRequestHeaders`, `name1`,
  `humanizedDateTime`, `getCurrentChatId`, `mainApi`. Always read `chatMetadata` through a
  fresh `getContext()` call: the object is replaced on chat change.
- **Prompt injection**: `setExtensionPrompt(key, value, position, depth, scan=false, role)`
  (`script.js:8926`). Positions: NONE −1, IN_PROMPT 0, IN_CHAT 1, BEFORE_PROMPT 2. Roles:
  SYSTEM 0, USER 1, ASSISTANT 2 (the enums are not on the context; use the numbers).
  Extension prompts are collected after interceptors run, so the interceptor may refresh
  the value just in time. Clear with value `''`.
- **Interceptor** (`manifest.generate_interceptor`, `extensions.js:2024`): called as
  `globalThis[name](chat, contextSize, abort, type)` for non-dry-run generations. `chat`
  is a filtered copy (`script.js:4496`); do NOT inject messages into it (v1 bug).
  Use it only to (a) refresh the sitrep injection and (b) run the orders arbiter on the
  newest user message when `ordersMode==='auto'` and `type` is a normal send (not
  `quiet`, `impersonate`, `continue`, `swipe`, `regenerate`). Remember which message was
  processed (hash of `send_date`+`mes` in campaign flags) so swipes/regenerations never
  execute orders twice — they reuse the last results in the sitrep.
- **Structured output**: `generateRaw({ systemPrompt, prompt, prefill, responseLength,
  jsonSchema })` where `jsonSchema = { name, description, strict:false, value: <schema>,
  returnInvalid:true }` (`script.js:4261`). Send `jsonSchema` ONLY on Chat Completion: for
  every Text Completion API, `extractJsonFromData` returns `'{}'` and discards the model
  output (`script.js:6311-6365`). Text Completion uses the prompt (which describes the JSON
  format) plus a `'{'` prefill. Always parse defensively, one repair
  retry, then fallback. Keep schemas to the portable subset (type, properties, required,
  enum, items, description — no oneOf/anyOf/additionalProperties/min/max constraints).
- **Optional engine connection profile**: `ConnectionManagerRequestService.sendRequest(
  profileId, messages, maxTokens, {stream:false, extractData:true, includePreset:true},
  overridePayload)` (`scripts/extensions/shared.js:392`). Verify how `json_schema` can be
  passed through `overridePayload` before relying on it; if unclear, use it without the
  schema and rely on prompt + parsing. Profiles are listed in
  `extensionSettings.connectionManager.profiles`.
- **Narrator messages** (as `/sys` does, `slash-commands.js:6020`):
  `{ name, is_user:false, is_system:false, send_date, mes, force_avatar:'img/five.png',
  extra:{ type:'narrator' } }` → `chat.push`, `addOneMessage(msg)`, `await saveChat()`.
  In Chat Completion these become `system` role messages (`openai.js:590`).
- **Macros**: prefer `ctx.macros.register(name, { handler, description, category })`
  (new engine), fallback `ctx.registerMacro(name, fn, description)`. Register
  `{{hoi_sitrep}}`, `{{hoi_nation}}`, `{{hoi_leader}}`, `{{hoi_title}}`, `{{hoi_date}}`,
  `{{hoi_defcon}}`, `{{hoi_orders}}` (last executed orders). Empty string when no campaign.
- **Slash commands** (pt-BR names + English aliases, real named/unnamed args):
  `/hoi` (open War Room), `/hoi-novojogo`, `/hoi-turno`, `/hoi-ordem <texto>`,
  `/hoi-acao acao=<id> alvo=<ID>`, `/hoi-status` (returns sitrep text for STscript),
  `/hoi-decisao` (re-open pending decision), `/hoi-salvar`, `/hoi-apagar`.
- **Character import**: POST `/api/characters/import` with FormData `avatar` (File),
  `file_type` ('json'), `user_name` (`script.js:10544`), headers from
  `getRequestHeaders()` without `Content-Type`; then `await ctx.getCharacters()`.
  Ship `assets/character/conselho.json` (Character Card V2, pt-BR): a Game Master that
  voices the cabinet (Defesa, Relações Exteriores, Economia, Inteligência, Interior) and
  world reactions, explicitly told to treat `[SITUAÇÃO]` injections as ground truth and
  never invent numbers. It must work with any preset.
- Settings live in `extensionSettings[MODULE_KEY]`, merged with defaults on load
  (`HoiSettings` in interfaces.js). Defaults: injection enabled, `in_chat`, depth 1,
  role system, compact; `ordersMode:'auto'`; `llmEvents:true`; `postBulletins:true`;
  `engineProfileId:''`; `eventMaxTokens:1200`; `showHud:true`; `showArt:true`;
  `difficulty:'normal'`.
- The sitrep (`buildSitrep`) is deterministic pt-BR, wrapped as `[SITUAÇÃO — ...]` …
  `[/SITUAÇÃO]`, compact ≈ 250-400 tokens, full ≈ 700. Content: date, ruler + nation +
  title, resources, PC, DEFCON, wars with fronts, key allies/rivals, top crises, last
  turn headlines, player actions/orders executed this turn with success/failure, pending
  decision title, and one instruction line telling the model to narrate consistently,
  never contradict or invent numbers, and that the user is the head of state.
- LLM prompts: event generator receives the sitrep (full), last TurnReport, the last ~8
  chat messages (so the world reacts to role-play), the valid nation ids with names, the
  catalog vocabulary for effects, and must return `{category, title, narrative,
  headlines[], involved[], options[{label, rationale, effects[]}]}`. Arbiter receives the
  order text, the player's available actions (id, name, description, keywords, target
  kind, cost, availability) and the nation roster (id + pt-BR name) and returns
  `{orders:[{actionId, targetId, quote}]}` — at most 3, empty when the text is just
  conversation. Bulletin uses `generateQuietPrompt` (user preset voice), 80-150 words.
- Tests: mock `getContext()` with the EXACT signatures above (cite source lines). Cover
  jsonSchema wrapper shape, injection position/role mapping, interceptor type filtering
  and dedupe, macro registration fallback, narrator message shape, sitrep budget.

## 6. UI (UI-A and UI-B)

Visual direction: HOI4 — dark steel/olive panels, brass accents, display serif small-caps
for headings, dense but readable. Use `css/base.css` variables and primitives; Font
Awesome icons; no external fonts or CDNs. Everything under `.hoi-root`. Must work on
desktop (≥ 1280 px) and degrade to a usable stacked layout on mobile (≤ 800 px).

### 6.1 UI-A — War Room + map + facade
- `src/ui/index.js` exports `createUi({ scenario, handlers, query })` → `UiAPI`
  (interfaces.js). It composes UI-B modules (§6.2) and the War Room.
- War Room overlay (`.hoi-root.hoi-overlay`): top bar (flag, nation, ruler title + name,
  date, PC, the 7 resources with icons and last-turn deltas, DEFCON gauge, pending
  decision button with pulse, "Avançar Mês" primary button, settings, close); left tabbed
  panel (Governo: untargeted actions by category with cost/chance/cooldown and disabled
  reasons; Diplomacia: relations list sortable; Guerras: wars with front progress bars and
  exhaustion; Crises; Ranking); center map; right dossier for the selected nation (flag,
  government, bloc, resources, relation tier, pacts, wars, occupation, targeted actions
  with cost/chance, confirm dialog for `confirm:true` actions); bottom: news ticker +
  "Ordem ao gabinete" input that calls `handlers.onOrder`.
- Turn report: non-blocking slide-in panel after each turn (headlines, war updates,
  player deltas, AI moves involving the player) + ticker update.
- Map (`src/ui/map/`): SVG from `MapData`; ocean gradient, graticule, outline; one path per
  country with fills by map mode — political (controller bloc color, puppets tinted to
  overlord), diplomatic (relation tier vs player), military (wars: enemies red, allies
  green, other belligerents amber, occupation hatch patterns in occupier color by
  progress), crisis (heat by crisis severity). Player nation gold outline/glow, selected
  nation bright outline. `vector-effect: non-scaling-stroke`. Labels sized in screen px,
  more labels as you zoom. Markers: capitals of majors, ⚔ at active fronts, pulsing ⚠ on
  crisis nations. Wheel zoom centered on cursor via viewBox, drag pan at any zoom,
  double-click zoom, pinch zoom on touch, keyboard +/−/0. Hover tooltip (name, controller,
  relation, war, occupation). Update fills incrementally without rebuilding DOM.
- Flags via `<img class="hoi-flag" src=scenario.assetUrl('flags/<ID>.svg')>` with emoji
  fallback on error.
- Tests: pure view-model functions (fills per mode, label visibility, tooltip text,
  action grouping, top-bar deltas) under `test/ui-a/`.

### 6.2 UI-B — dialogs, HUD, settings, wand menu
Exact exports (UI-A imports them):
- `src/ui/dialogs/modalHost.js`: `openModal({ className, content, dismissible, onDismiss })`
  → `{ close() }`. Focus trap, Esc to dismiss when dismissible, z-index `--hoi-z-modal`.
- `src/ui/dialogs/wizard.js`: `openWizard({ scenario, assetUrl, defaultLeaderName,
  defaultDifficulty })` → `Promise<{bookmarkId, nationId, leaderName, difficulty} | null>`.
  Step 1 Período (bookmark cards with art), step 2 Nação (search, bloc filter, flag grid,
  detail panel with stats/traits/blurb/difficulty, recommended badge), step 3 Governante
  (name defaulting to the persona, difficulty, summary) → "Assumir o Governo".
- `src/ui/dialogs/eventDialog.js`: `openEventDialog({ event, state, assetUrl, showArt,
  dismissible })` → `Promise<number | null>`. Art header `art/event-<category>.webp`,
  category chip, date, title, narrative, headlines, options as large buttons with
  rationale and effect preview chips; "Decidir depois" when dismissible (resolves null).
- `src/ui/dialogs/effectPreview.js`: `describeEffect(effect, state, ctx?)` (ctx = `{actorId, targetId}`) →
  `{ text, tone:'good'|'bad'|'neutral', icon }` (pure, pt-BR; resolves nation names and
  PLACEHOLDERS). UI-A uses it for action previews too.
- `src/ui/dialogs/gameOver.js`: `openGameOver({ outcome, state, ranking, assetUrl })` →
  `Promise<'new'|'close'>` (art `victory`/`defeat`).
- `src/ui/dialogs/confirm.js`: `openConfirm({ title, text, okLabel, cancelLabel, danger })`
  → `Promise<boolean>`.
- `src/ui/hud/hud.js`: `createHud({ onOpenWarRoom, onEndTurn, onOpenEvent, assetUrl })` →
  `{ mount(), unmount(), update(state, { busy, settings }) }`. Compact bar docked at the
  top of the chat column (`#sheld`) — flag, date, DEFCON, PC, pending-decision badge,
  buttons "Sala de Guerra" and "Avançar Mês". Collapsible; hidden without a campaign
  (shows a small "Iniciar campanha" chip instead) or when `settings.showHud` is false.
- `src/ui/settings/settingsPanel.js`: `mountSettingsPanel({ getSettings, onChange,
  onOpenWarRoom, onNewCampaign, onImportCharacter, onResetCampaign,
  listConnectionProfiles })` → `{ refresh(), unmount() }`. ST `inline-drawer` markup
  appended to `#extensions_settings2`, all `HoiSettings` controls with pt-BR help text.
- `src/ui/wand.js`: `addWandMenuItem({ label, icon, onClick })` → remove function. Appends
  `<div class="list-group-item flex-container flexGap5 interactable" tabindex="0">` with
  `<div class="fa-solid … extensionsMenuExtensionButton"></div>` to `#extensionsMenu`.
- Tests: pure helpers (effect preview text/tone, wizard filtering/sorting, settings
  normalization) under `test/ui-b/`.

## 7. Glue (orchestrator)

`src/game/controller.js` implements `ControllerAPI`: single in-memory state, every action
persists, busy-lock with `finally`, errors become pt-BR toasts, never throws into ST.
`endTurn`: engine.endTurn → save → UI turn report → (llmEvents) LLM event with recent chat
→ engine.setPendingEvent → save → bulletin (postBulletins) → show queued engine events then
the LLM event. Chat change reloads campaign, migrates or discards incompatible saves, and
refreshes injection/HUD.

## 8. Art (orchestrator)

`assets/art/*.webp`, 16:9, ~1280×720: `title`, `bookmark-b2026`, `bookmark-b2028`,
`bookmark-b2031`, `event-<category>` for every `EVENT_CATEGORIES` entry, `victory`, `defeat`.
UI must cope with a missing image (hide the art block).

## 9. Safety rules added after review (v2.0.0)

- **Chat binding for writes.** SillyTavern replaces `chat_metadata` with `{}` and empties
  `chat` at the start of a chat switch or reload, and emits `CHAT_CHANGED` only at the end
  (`script.js:875-900`, `:7744-7748`, `:7657`, `:7700`). StAPI binds writes to the chat read
  by `loadCampaign()` and refuses them while the chat id, the integrity slug or the message
  list say the chat is loading. The controller also checks the chat id before committing,
  retries a refused save when the same chat finishes reloading, and drops the write when the
  chat changed.
- **Busy lock with an owner token.** Only the flow that took the lock can release it; a chat
  switch revokes ownership.
- **Irreversible actions need a dialog.** `confirm: true` actions (war, limited strike,
  nuclear strike) never run from chat orders; War Room orders and slash commands ask first.
- **Nothing blocking inside the interceptor.** Chat orders may save and toast. A game over
  caused by a chat order is shown after `GENERATION_ENDED`/`GENERATION_STOPPED`.
- **Macro neutralizing** breaks every adjacent brace pair (`{{{x}}}` included) in text that
  goes into `generateRaw`.
- Order dedupe keeps the last 64 processed message keys per campaign.
- The contract requests in `docs/contract-requests/` are resolved: the typedefs in
  `src/contract/` now document every extra field the modules write.
