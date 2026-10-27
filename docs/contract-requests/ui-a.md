# Contract requests — UI-A (War Room, map, `createUi`)

None of these block UI-A; each is already handled locally as described.

## 1. Document the optional MapData fields that `tools/build-map.mjs` emits

`assets/map/world.map.json` carries fields the `MapData` typedef in
`src/contract/interfaces.js` does not list:

- `decor: Array<{id, d}>`: non-interactive land (Antarctica).
- `territories: Record<id, sovereignId>`: dependencies folded into their sovereign.
- `MapCountry.fullBbox`: the whole extent, while `bbox` is the "home" cluster.

UI-A draws `decor` as dim, non-clickable land when present and ignores it otherwise.
**Request:** add these as optional properties to the typedef so other consumers know
they exist.

## 2. `describeEffect` takes a third `ctx` argument

DESIGN §6.2 documents `describeEffect(effect, state)`. UI-B's implementation is
`describeEffect(effect, state, ctx?)`, where `ctx = { actorId, targetId }` resolves
`SELF`/`TARGET`. UI-A passes `ctx` and also pre-resolves the placeholders in a copy of
the effect, so the previews are correct either way.
**Request:** update DESIGN §6.2 to the 3-argument signature.

## 3. `node --test test/<module>/` does not run anything on Node ≥ 21

Since Node 21 the test runner no longer expands a directory argument. Node tries to
execute the directory as a module and fails with `MODULE_NOT_FOUND`. This affects
every module's documented test command. UI-A ships `test/ui-a/index.js`, which imports
the folder's `*.test.js` only when it is invoked as a directory. That makes
`node --test test/ui-a/` work and avoids double runs under a root-level `node --test`.
**Request (orchestrator):** use glob commands such as
`node --test "test/<module>/*.test.js"` in DESIGN/CI, or adopt the same shim for
every module.

## 4. (Optional) let the controller focus a nation in the War Room

`UiAPI` has no way to centre or select a nation from outside, for example to highlight
`event.involved` after a decision or to support `/hoi <ID>`. The War Room already has
an internal `selectNation(id)`.
**Request (optional):** `UiAPI.focusNation(id: string): void`. Not implemented until
the contract adds it.
