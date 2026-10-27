# Contract requests — UI-B (dialogs, HUD, settings, wand)

None of these block UI-B; each has a local workaround already in place.

## 1. `Nation.namePrep` (pt-BR contraction of the country name)

**Why:** the wizard summary reads "Você será {título} {nome} de {nação} em {data}".
Portuguese needs the contracted article: "do Brasil", "da China", "dos Estados Unidos",
"de Portugal", "das Filipinas". The article can't be derived reliably from the name
(Israel, Cuba, Portugal, Taiwan, Singapura take no article).

**Proposal:** optional `Nation.namePrep?: 'do'|'da'|'dos'|'das'|'de'` in
`src/contract/worldState.js`, filled by SCENARIO for authored nations. The sitrep, the
bulletins and the War Room could use the same field.

**Workaround in place:** `countryArticle()` / `ofCountry()` in
`src/ui/dialogs/wizardModel.js` (curated list plus suffix heuristics, unit-tested).

## 2. Event-category labels/icons in `presentation.js`

**Why:** `EVENT_CATEGORIES` has no shared pt-BR labels or icons. UI-B defines them in
`EVENT_CATEGORY_META` (`src/ui/dialogs/eventDialog.js`). The War Room's crisis list and
the LLM prompts may want the same wording.

**Proposal:** move them to `presentation.js` as `EVENT_CATEGORY_LABELS` /
`EVENT_CATEGORY_ICONS`. Current values: diplomacy Diplomacia, military Militar, naval
Naval, nuclear Nuclear, economy Economia, unrest Agitação Interna, cyber Guerra
Cibernética, intel Inteligência, humanitarian Crise Humanitária, tech Tecnologia,
politics Política, energy Energia, war Guerra.

## 3. Peace-terms direction in the `war` effect

**Why:** for `{ type:'war', action:'peace', target, targetB, terms }`, `events.js` does not
say who imposes the terms. `describeEffect` assumes **`target` = winner / imposer, `targetB`
= the side that accepts the terms** ("Anexar Venezuela" when `target` is the player).

**Proposal:** add that sentence to the effect-shape comment in `events.js`, so ENGINE and
the prompts use the same convention.

## Notes for GLUE / UI-A (no contract change)

- `node --test test/ui-b/` (a directory argument) fails on Node 22 with MODULE_NOT_FOUND.
  Use `node --test test/ui-b/*.test.js` instead.
- `modalHost.js` also exports `closeAllModals()`. It dismisses every open HOI dialog, so
  every pending promise resolves (null / false / 'close'). Calling it from
  `UiAPI.unmount()` and on chat change means no dialog promise is left dangling.
- `hud.update(state, { busy })` accepts a string for `busy` and shows it on the
  "Avançar Mês" button (e.g. "Gerando evento…"). Passing `busy: busyLabel || busy` gives
  the HUD the same label as the War Room.
