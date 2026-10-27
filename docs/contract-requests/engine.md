# Contract requests — ENGINE

The engine works today with the contract as it is: the items below are extra fields the
engine already writes/reads (harmless to other modules, all JSON-serializable, ignored by
`isWorldState`). The request is to **document** them in `src/contract/*` so other modules
know they exist and do not strip or rewrite them.

## 1. `WorldState.neighbors: Record<string, string[]>` (new top-level field)

`endTurn(state)` has no access to `ScenarioData`, but fronts (`targetNeighborOrMajor`,
front creation, front flips), border incidents and AI target selection need the map
neighbors. `newGame` copies `scenario.neighbors`, filtered to existing ids and made
symmetric. Size ≈ 5 KB for 177 nations. `migrate` fills `{}` when missing.

## 2. `WorldState.engine: Object` (new top-level field, opaque)

Engine-private bookkeeping. Other modules must not read or write it.
`{ seq, base: {id: Resources}, baseRel: {key: number}, zeroStability, lowStability,
foughtEnemies: string[], lastProposalTurn }`:
- `seq`: deterministic id / RNG-salt counter.
- `base` / `baseRel`: resource and relation baselines captured at `newGame`; resources
  and relations drift back toward them (5% and 3% of the gap per month).
- `zeroStability`: consecutive turns at stability 0 (golpe de Estado defeat).
- `foughtEnemies`: nations the player fought (Hegemonia victory).

## 3. `WorldState.player.difficulty: 'facil'|'normal'|'dificil'`

The PC income bonus (DESIGN §3.2) must survive reloads; `newGame` stores it here.

## 4. Optional `War` fields

`called: string[]` (nations already called to arms in this war), `ceasefireTurn: ?number`
(armistice after 12 months), `lastOfferTurn?`, `lastSurrenderTurn?` (throttle engine
events). UI can ignore them.

## 5. Optional `GameEvent.defaultOption?: number` (source `'engine'` only)

Engine decisions (calls to arms, peace terms, offers, proposals) that stay unanswered for
6 turns are resolved with this option (e.g. refuse the call, reparations). `sanitizeEvent`
keeps it only for `source: 'engine'`. The UI may show "Sem resposta em 6 meses: <opção>".

## 6. ActionDef / Requirement extensions (engine catalog only)

- `ActionDef.acceptance?: 'trade'|'energy'|'alliance'|'defense'|'ceasefire'|'peace'`:
  proposals decided by AI acceptance; `ActionAvailability.chance` is the acceptance odds.
- `ActionDef.special?: string`: scripted hook name.
- Requirement keys: `noPactWithTarget` (pact type; `'nonAggression'` = post-war truce),
  `strongerThanTarget`, `targetAtWar`, `mobilized`, `notMobilized`, `notCeasefireWithTarget`.
  `atWar: false` means "not at war".

## 7. Pact semantics

- Peace (white peace / reparations) and armistices create a `nonAggression` pact
  "Tratado de Paz A–B" that expires after 36 turns and blocks `dip_declare_war`.
- Trade agreements expire after 60 turns (`expiresTurn` set).
- Only the original war leaders call partners to arms, and only through pacts that
  predate the war.

## 8. API clarifications

- `getNationView(state, unknownId)` returns `null` (typedef says `NationView`).
- `endTurn` pushes engine events to `state.eventQueue` only (never `pendingEvent`), as the
  contract says. `resolvePendingEvent` resolves the head of the queue when nothing is
  pending, so the controller can answer engine events without `setPendingEvent`.
- `setPendingEvent` sanitizes its input (idempotent for already-clean events).
- `newGame` throws `Error` for an unknown nation id or a scenario without nations; the
  default seed is derived from scenario/bookmark/nation/leader/difficulty, so the
  controller should pass a unique `seed` (it may use `Date.now()`, the engine may not).
- `newGame` honors explicit `status` / `controller` / `overlord` in bookmark
  `overrides.nations` (otherwise `active` / self / `null`).
- Tension: world mechanics (AI, crises, drift) stop at 99. At ≥ 96 a monthly "nuclear
  incident" risk of `(tension − 95) × 1.2%` exists. Player actions and decisions can reach
  100 directly (global nuclear war, defeat).
- `flag` effects cannot write keys starting with `_` (reserved).

## 9. Optional `Nation.article?: 'o'|'a'|'os'|'as'|''` (SCENARIO)

Headlines need pt-BR articles ("declara guerra **à** Ucrânia", "**aos** Estados Unidos",
"**a** Israel"). The engine infers them from the name with an exception table; SCENARIO
may set `article` on nations where the heuristic is wrong and the engine will use it.
