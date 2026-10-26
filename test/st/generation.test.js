import test from 'node:test';
import assert from 'node:assert/strict';

import { createSt } from '../../src/st/index.js';
import { buildJsonSchemaWrapper, generateStructuredWith } from '../../src/st/generation.js';
import { MODULE_KEY } from '../../src/contract/constants.js';
import { createFakeContext, installFakeSillyTavern } from './fakeContext.js';

const SCHEMA = { type: 'object', description: 'Test schema', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const REQ = { systemPrompt: 'SYS', prompt: 'USER', schemaName: 'hoi event!', schema: SCHEMA, maxTokens: 777 };

function withSt(ctx, fn) {
    const uninstall = installFakeSillyTavern(ctx);
    const st = createSt({ getState: () => null, buildSitrep: () => '' });
    return Promise.resolve(fn(st)).finally(uninstall);
}

test('jsonSchema wrapper has the ST JsonSchema shape (script.js:4261)', () => {
    const w = buildJsonSchemaWrapper('hoi event!', SCHEMA);
    assert.deepEqual(Object.keys(w).sort(), ['description', 'name', 'returnInvalid', 'strict', 'value']);
    assert.equal(w.name, 'hoi_event_');
    assert.equal(w.description, 'Test schema');
    assert.equal(w.strict, false);
    assert.equal(w.returnInvalid, true);
    assert.equal(w.value, SCHEMA);
});

test('Chat Completion: generateRaw receives systemPrompt, prompt, responseLength and the wrapper', async () => {
    const ctx = createFakeContext({ mainApi: 'openai' });
    ctx.responders.model = async () => '{"ok":true}';
    await withSt(ctx, async (st) => {
        const res = await st.generateStructured(REQ);
        assert.deepEqual(res, { ok: true, value: { ok: true }, raw: '{"ok":true}' });
        const call = ctx.calls.generateRaw[0];
        assert.equal(call.systemPrompt, 'SYS');
        assert.equal(call.prompt, 'USER');
        assert.equal(call.responseLength, 777);
        assert.equal(call.prefill, '');
        assert.deepEqual(call.jsonSchema, { name: 'hoi_event_', description: 'Test schema', strict: false, value: SCHEMA, returnInvalid: true });
    });
});

test('Chat Completion: invalid JSON returned as-is (returnInvalid) is parsed loosely', async () => {
    const ctx = createFakeContext({ mainApi: 'openai' });
    ctx.responders.model = async () => 'Sure!\n```json\n{"ok":true,}\n```';
    await withSt(ctx, async (st) => {
        const res = await st.generateStructured(REQ);
        assert.equal(res.ok, true);
        assert.deepEqual(res.value, { ok: true });
    });
});

test('Chat Completion: "{}" (ST extraction failure, e.g. Claude without tool_use) is a failure', async () => {
    const ctx = createFakeContext({ mainApi: 'openai' });
    ctx.responders.model = async () => '{}';
    await withSt(ctx, async (st) => {
        const res = await st.generateStructured(REQ);
        assert.equal(res.ok, false);
        assert.equal(res.raw, '{}');
        assert.match(res.error, /vazio/);
    });
});

test('Text Completion: no jsonSchema (ST would return "{}", script.js:6365), prefill "{" and brace restored', async () => {
    const ctx = createFakeContext({ mainApi: 'textgenerationwebui' });
    // The backend continues after the prefill, so the output lacks the opening brace.
    ctx.responders.model = async () => '"ok": true}\nExtra prose.';
    await withSt(ctx, async (st) => {
        const res = await st.generateStructured(REQ);
        assert.equal(res.ok, true);
        assert.deepEqual(res.value, { ok: true });
        const call = ctx.calls.generateRaw[0];
        assert.equal(call.jsonSchema, null);
        assert.equal(call.prefill, '{');
    });
});

test('Text Completion: the fake reproduces the ST quirk, proving why jsonSchema must not be sent', async () => {
    const ctx = createFakeContext({ mainApi: 'textgenerationwebui' });
    ctx.responders.model = async () => '{"ok":true}';
    const out = await ctx.generateRaw({ prompt: 'x', jsonSchema: buildJsonSchemaWrapper('x', SCHEMA) });
    assert.equal(out, '{}');
});

test('schema:null requests prompt-only output even on Chat Completion', async () => {
    const ctx = createFakeContext({ mainApi: 'openai' });
    ctx.responders.model = async () => '{"ok":true}';
    await withSt(ctx, async (st) => {
        const res = await st.generateStructured({ ...REQ, schema: null });
        assert.equal(res.ok, true);
        assert.equal(ctx.calls.generateRaw[0].jsonSchema, null);
    });
});

test('generateRaw throwing resolves to {ok:false, error}', async () => {
    const ctx = createFakeContext({ mainApi: 'openai' });
    ctx.responders.model = async () => {
        throw new Error('HTTP 400');
    };
    await withSt(ctx, async (st) => {
        const res = await st.generateStructured(REQ);
        assert.equal(res.ok, false);
        assert.match(res.error, /HTTP 400/);
    });
});

test('engineProfileId (Chat Completion profile): ConnectionManager with json_schema in overridePayload', async () => {
    const ctx = createFakeContext({ mainApi: 'textgenerationwebui' });
    ctx.extensionSettings.connectionManager.profiles = [{ id: 'p-cc', name: 'GPT', api: 'openai', model: 'gpt-x', preset: 'Default' }];
    ctx.extensionSettings[MODULE_KEY] = { engineProfileId: 'p-cc' };
    ctx.responders.model = async () => '{"ok":true}';
    await withSt(ctx, async (st) => {
        const res = await st.generateStructured(REQ);
        assert.deepEqual(res.value, { ok: true });
        assert.equal(ctx.calls.generateRaw.length, 0);
        const call = ctx.calls.sendRequest[0];
        assert.equal(call.profileId, 'p-cc');
        assert.deepEqual(call.prompt, [
            { role: 'system', content: 'SYS' },
            { role: 'user', content: 'USER' },
        ]);
        assert.equal(call.maxTokens, 777);
        assert.equal(call.custom.stream, false);
        assert.equal(call.custom.extractData, true);
        assert.equal(call.custom.includePreset, true);
        assert.deepEqual(call.overridePayload, { json_schema: { name: 'hoi_event_', description: 'Test schema', strict: false, value: SCHEMA, returnInvalid: true } });
    });
});

test('ConnectionManager CC: parsed object content "{}" is a failure', async () => {
    const ctx = createFakeContext();
    ctx.extensionSettings.connectionManager.profiles = [{ id: 'p-cc', name: 'Claude', api: 'claude' }];
    ctx.responders.model = async () => 'not json at all';
    const res = await generateStructuredWith(ctx, { engineProfileId: 'p-cc' }, REQ);
    assert.equal(res.ok, false);
    assert.equal(res.raw, '{}');
});

test('engineProfileId (Text Completion profile): no json_schema, text parsed', async () => {
    const ctx = createFakeContext({ mainApi: 'openai' });
    ctx.extensionSettings.connectionManager.profiles = [{ id: 'p-tc', name: 'Kobold', api: 'koboldcpp' }];
    ctx.responders.model = async () => '<think>hmm</think>{"ok":true}';
    const res = await generateStructuredWith(ctx, { engineProfileId: 'p-tc' }, REQ);
    assert.equal(res.ok, true);
    assert.deepEqual(res.value, { ok: true });
    assert.deepEqual(ctx.calls.sendRequest[0].overridePayload, {});
});

test('missing profile or disabled Connection Manager falls back to generateRaw', async () => {
    const ctx = createFakeContext({ mainApi: 'openai' });
    ctx.responders.model = async () => '{"ok":true}';
    let res = await generateStructuredWith(ctx, { engineProfileId: 'gone' }, REQ);
    assert.equal(res.ok, true);
    assert.equal(ctx.calls.sendRequest.length, 0);
    assert.equal(ctx.calls.generateRaw.length, 1);

    ctx.extensionSettings.connectionManager.profiles = [{ id: 'p-cc', api: 'openai' }];
    ctx.extensionSettings.disabledExtensions = ['connection-manager'];
    res = await generateStructuredWith(ctx, { engineProfileId: 'p-cc' }, REQ);
    assert.equal(res.ok, true);
    assert.equal(ctx.calls.sendRequest.length, 0);
    assert.equal(ctx.calls.generateRaw.length, 2);
});

test('ConnectionManager errors resolve to {ok:false} with the cause', async () => {
    const ctx = createFakeContext();
    ctx.extensionSettings.connectionManager.profiles = [{ id: 'p-cc', api: 'openai' }];
    ctx.ConnectionManagerRequestService.sendRequest = async () => {
        throw new Error('API request failed', { cause: new Error('quota') });
    };
    const res = await generateStructuredWith(ctx, { engineProfileId: 'p-cc' }, REQ);
    assert.equal(res.ok, false);
    assert.match(res.error, /API request failed \(quota\)/);
});

test('generateQuiet uses the object signature of generateQuietPrompt (script.js:3084)', async () => {
    const ctx = createFakeContext();
    ctx.responders.quiet = async ({ quietPrompt }) => `eco:${quietPrompt}`;
    await withSt(ctx, async (st) => {
        assert.equal(await st.generateQuiet('olá'), 'eco:olá');
        const call = ctx.calls.generateQuietPrompt[0];
        assert.equal(call.quietPrompt, 'olá');
        assert.equal(call.removeReasoning, true);
        assert.equal(call.jsonSchema, null);
        ctx.responders.quiet = async () => {
            throw new Error('boom');
        };
        assert.equal(await st.generateQuiet('x'), '');
    });
});

test('listConnectionProfiles: supported profiles only, [] when Connection Manager is disabled', async () => {
    const ctx = createFakeContext();
    ctx.extensionSettings.connectionManager.profiles = [
        { id: 'a', name: 'GPT', api: 'openai' },
        { id: 'b', name: 'Kobold', api: 'koboldcpp' },
        { id: 'c', name: 'Sem API' },
        { id: 'd', name: 'Desconhecida', api: 'weird' },
    ];
    await withSt(ctx, async (st) => {
        assert.deepEqual(st.listConnectionProfiles(), [{ id: 'a', name: 'GPT' }, { id: 'b', name: 'Kobold' }]);
        ctx.extensionSettings.disabledExtensions = ['connection-manager'];
        assert.deepEqual(st.listConnectionProfiles(), []);
    });
});
