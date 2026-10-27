# Contract requests: ST + LLM

All items below are implemented as backward-compatible extensions. Nothing in
`src/contract/` was edited.

## 1. `generateRaw` + `jsonSchema` returns `'{}'` on Text Completion (DESIGN §5 correction)

DESIGN §5 says "With `jsonSchema` the return value is a JSON string (already
extracted)". That only holds for `main_api === 'openai'`.
`generateRawData` returns `extractJsonFromData(data, ...)` whenever `jsonSchema`
is set (`public/script.js:4102`), and `extractJsonFromData` only has a
`case 'openai'`. For every Text Completion API it returns
`JSON.stringify({})`, which throws away the model output (`script.js:6311-6365`).

What `StAPI.generateStructured` does instead:
- It passes `jsonSchema` only when `ctx.mainApi === 'openai'`.
- On Text Completion it sends `prefill: '{'` and parses the text itself.
- It treats `{}` as a failure.

Suggested DESIGN wording: "jsonSchema only on Chat Completion; Text Completion
relies on the prompt plus parsing."

## 2. `StAPI.generateStructured`: `schema: null` means prompt-only

The LLM repair retry sends `schema: null` when the first structured request
produced no usable JSON. In that case the provider may not support structured
output, or ST may have returned `{}`. Suggested typedef: `schema: ?object`.

## 3. `LlmAPI.buildSitrep(state, opts)`: add `opts.detail`

`opts` is `{ budgetTokens?: number, detail?: 'compact'|'full' }`. The default
is `'compact'`. StAPI passes `settings.injection.detail`, and the event
generator uses `'full'`. Suggested typedef: add `detail?: 'compact'|'full'`.

## 4. `createSt(deps)`: optional `deps.getCatalog`

`deps.getCatalog?: () => ActionDef[]` (GLUE: `() => engine.getCatalog()`). It
lets `/hoi-acao` reject unknown action ids and check whether a target is
required, and it fills autocomplete for `acao=`. Without it, the command
validates formats and the roster only, and lets `controller.doAction` reject the
rest.

## 5. Notes for GLUE (no contract change)

- `deps.onUserOrder(text)` runs inside the generate interceptor, so the user's
  generation waits for it. It should execute the orders and save the campaign.
  It must not post chat messages: the chat is mid-generation, and the results
  reach the model through the refreshed sitrep. Return the summaries
  (`string[]`).
- StAPI writes `state.flags.stLastOrderKey` (`ORDER_KEY_FLAG` exported from
  `src/st/index.js`) on `saveCampaign` and directly in `chatMetadata` when an
  order message is processed. `engine.migrate` / `newGame` should keep unknown
  `flags` keys. If a key is lost, only the in-session dedupe remains.
- `/hoi-apagar` calls `controller.reset()` directly. The controller should ask
  for confirmation because this action is hard to reverse.
- `st.refreshInjection(state)` has an optional internal 2nd parameter
  (`budgetTokens`). Callers should keep using the 1-argument form; the last
  budget derived from the interceptor's `contextSize` is reused.

## 6. Test command (DESIGN §2)

On Node 22, `node --test test/st/` fails: the directory is treated as a module
path (`MODULE_NOT_FOUND`). Use globs instead:
`node --test 'test/st/*.test.js' 'test/llm/*.test.js'`.
