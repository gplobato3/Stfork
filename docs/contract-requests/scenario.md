# Contract notes and requests — SCENARIO

None of these block other modules; the current output already satisfies the contract. They
document extra fields so UI-A / ENGINE can rely on them, and flag one tooling issue.

## 1. MapData / MapCountry extra fields (please add to the typedefs)

- `MapCountry.bbox` is the bbox of the country's **home cluster** (the polygon containing the
  capital plus nearby polygons). It excludes far-flung parts: French Guiana for FRA, Greenland for
  DNK, Hawaii for USA, the Chukotka sliver that wraps to the left edge for RUS. Use it for
  zoom-to-country.
- `MapCountry.fullBbox` (new) is the complete extent of every polygon. Use it for culling or
  hit-testing.
- `MapData.territories` (new): `{ GRL:'DNK', PRI:'USA', NCL:'FRA', ATF:'FRA', FLK:'GBR' }`.
  Dependent territories are drawn inside the sovereign's path and are not nations.
- `MapData.decor` (new): `[{ id:'ATA', d }]`. Antarctica is non-interactive land with no nation.
  Draw it with a neutral fill under the countries, or skip it.
- `MapData.source` (new): attribution string.

## 2. `War.startedDate` (optional extra)

Wars that predate the campaign (Russia–Ukraine since Feb 2022, the 2031 WW3 fronts) use
`startedTurn: 0` and carry `startedDate: {year, month}` so the UI can show the real duration.
Suggest adding `@property {{year:number, month:number}} [startedDate]` to `War`.

## 3. Bookmark overrides are pre-resolved

`ScenarioData.bookmarks[].overrides` contains only the contract keys. Inside `nations`, the
`resources` and `personality` objects are complete (merged with the base nation), so
`{...nation, ...override}` is safe. `pacts` is the full list: the raw file's `pactsAdd` /
`pactsRemove` shorthands are expanded by the loader.

## 4. Initial `pc`

The loader sets `pc` to `3 + floor(influence / 20)` for authored nations and
`2 + floor(influence / 25)` for minors. ENGINE may overwrite it in `newGame`.

## 5. Blocs for US treaty allies outside NATO

JPN, KOR, AUS, NZL, PHL, TWN and ISR use `NON_ALIGNED` because no `BLOCS` entry fits. They are
tied to the US through pacts. If the political map mode should show them as a Western camp,
consider a new bloc (e.g. `US_ALLIED`, label "Aliados dos EUA"). Until then the military map mode
and pacts carry that information.

## 6. Test runner on Node ≥ 21 (orchestrator)

`node --test test/<module>/` only scans directories on Node 20. On Node 22 and 24 the argument is
treated as a module path and fails with "Cannot find module". SCENARIO ships `test/scenario/index.js`,
a small shim that imports the suite only when started that way, so `node --test test/scenario/`
works on Node 20, 22 and 24. Other modules either need the same shim or should be run with
`node --test "test/<module>/*.test.js"`.
