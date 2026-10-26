import test from 'node:test';
import assert from 'node:assert/strict';

import { createSt, COUNCIL_CHARACTER_NAME } from '../../src/st/index.js';
import { getContext, isLive, extensionBaseUrl, extensionAssetUrl, getLibs } from '../../src/core/stContext.js';
import { MODULE_KEY, INJECTION_KEY } from '../../src/contract/constants.js';
import { createFakeContext, installFakeSillyTavern } from './fakeContext.js';
import { makeState } from './worldFixture.js';

const deps = { getState: () => null, buildSitrep: () => 'S' };

test('stContext: null-safe without ST; fresh context per call with ST', () => {
    assert.equal(getContext(), null);
    assert.equal(getLibs(), null);
    assert.equal(isLive(), false);
    let n = 0;
    globalThis.SillyTavern = { getContext: () => ({ n: ++n }), libs: { seedrandom: 1 } };
    try {
        assert.equal(getContext().n, 1);
        assert.equal(getContext().n, 2);
        assert.equal(isLive(), true);
        assert.deepEqual(getLibs(), { seedrandom: 1 });
        globalThis.SillyTavern = { getContext: () => { throw new Error('not ready'); } };
        assert.equal(getContext(), null);
    } finally {
        delete globalThis.SillyTavern;
    }
});

test('stContext: extension URL derived from import.meta.url (no hardcoded folder)', () => {
    const base = extensionBaseUrl();
    assert.ok(base.endsWith('/'));
    assert.ok(new URL('src/core/stContext.js', base).href.endsWith('/src/core/stContext.js'));
    assert.equal(extensionAssetUrl('/assets/character/conselho.json'), `${base}assets/character/conselho.json`);
});

test('campaign persistence reads a FRESH chatMetadata every call (object replaced on chat change)', async () => {
    const ctx = createFakeContext();
    const uninstall = installFakeSillyTavern(ctx);
    try {
        const st = createSt(deps);
        assert.equal(st.loadCampaign(), null);
        const state = makeState();
        await st.saveCampaign(state);
        assert.equal(ctx.calls.saveMetadata, 1);
        assert.deepEqual(st.loadCampaign(), state);
        assert.notEqual(ctx.chatMetadata[MODULE_KEY], state, 'stored copy, caller object not aliased');

        // Chat change: ST replaces chat_metadata (script.js:7657); StAPI must see the new object.
        ctx.chatMetadata = {};
        ctx.chatId = 'chat-2';
        assert.equal(st.loadCampaign(), null);
        assert.equal(st.currentChatId(), 'chat-2');
        await st.saveCampaign(makeState({ turn: 9 }));
        assert.equal(ctx.chatMetadata[MODULE_KEY].turn, 9);

        await st.clearCampaign();
        assert.equal(MODULE_KEY in ctx.chatMetadata, false);
        assert.equal(ctx.calls.saveMetadata, 3);
        assert.equal(ctx.calls.setExtensionPrompt.at(-1).key, INJECTION_KEY);
        assert.equal(ctx.calls.setExtensionPrompt.at(-1).value, '');
    } finally {
        uninstall();
    }
});

test('currentChatId: null without chat', () => {
    const ctx = createFakeContext();
    ctx.chatId = undefined;
    const uninstall = installFakeSillyTavern(ctx);
    try {
        assert.equal(createSt(deps).currentChatId(), null);
    } finally {
        uninstall();
    }
    assert.equal(createSt(deps).currentChatId(), null);
});

test('importCouncilCharacter: POST /api/characters/import like script.js:10544-10557, then getCharacters()', async () => {
    const ctx = createFakeContext();
    const uninstall = installFakeSillyTavern(ctx);
    const realFetch = globalThis.fetch;
    const requests = [];
    const card = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../assets/character/conselho.json', import.meta.url), 'utf8'));
    globalThis.fetch = async (url, init = {}) => {
        requests.push({ url: String(url), init });
        if (String(url).endsWith('assets/character/conselho.json')) return new Response(card, { status: 200 });
        if (url === '/api/characters/import') return new Response(JSON.stringify({ file_name: 'Conselho de Guerra' }), { status: 200 });
        return new Response('nope', { status: 404 });
    };
    try {
        const st = createSt(deps);
        const res = await st.importCouncilCharacter();
        assert.equal(res.ok, true, res.message);
        assert.equal(requests.length, 2);
        const post = requests[1];
        assert.equal(post.url, '/api/characters/import');
        assert.equal(post.init.method, 'POST');
        assert.equal(post.init.cache, 'no-cache');
        assert.ok(post.init.body instanceof FormData);
        const file = post.init.body.get('avatar');
        assert.ok(file instanceof Blob);
        assert.equal(file.name, 'conselho.json');
        assert.equal(JSON.parse(await file.text()).data.name, COUNCIL_CHARACTER_NAME);
        assert.equal(post.init.body.get('file_type'), 'json');
        assert.equal(post.init.body.get('user_name'), 'Gabriel');
        assert.deepEqual(post.init.headers, { 'X-CSRF-Token': 'tok' }, 'no Content-Type: the browser sets the multipart boundary');
        assert.deepEqual(ctx.calls.getRequestHeaders, [{ omitContentType: true }]);
        assert.equal(ctx.calls.getCharacters, 1);

        // Already imported -> no duplicate upload.
        ctx.characters = [{ name: COUNCIL_CHARACTER_NAME, avatar: 'Conselho de Guerra.png' }];
        const again = await st.importCouncilCharacter();
        assert.equal(again.ok, true);
        assert.equal(requests.length, 2);
    } finally {
        globalThis.fetch = realFetch;
        uninstall();
    }
});

test('importCouncilCharacter: server error -> {ok:false} pt-BR message', async () => {
    const ctx = createFakeContext();
    const uninstall = installFakeSillyTavern(ctx);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => (String(url).includes('conselho.json')
        ? new Response('{"spec":"chara_card_v2"}', { status: 200 })
        : new Response(JSON.stringify({ error: true }), { status: 200 }));
    try {
        const res = await createSt(deps).importCouncilCharacter();
        assert.equal(res.ok, false);
        assert.match(res.message, /Não foi possível importar/);
        assert.equal(ctx.calls.getCharacters, 0);
    } finally {
        globalThis.fetch = realFetch;
        uninstall();
    }
});

test('Conselho de Guerra card is a valid Character Card V2 that leaves the preset in control', async () => {
    const fs = await import('node:fs');
    const card = JSON.parse(fs.readFileSync(new URL('../../assets/character/conselho.json', import.meta.url), 'utf8'));
    assert.equal(card.spec, 'chara_card_v2');
    assert.equal(card.spec_version, '2.0');
    const d = card.data;
    for (const key of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'alternate_greetings', 'tags', 'creator', 'character_version', 'extensions']) {
        assert.ok(key in d, key);
    }
    assert.equal(d.name, 'Conselho de Guerra');
    assert.equal(d.system_prompt, '');
    assert.equal(d.post_history_instructions, '');
    assert.deepEqual(d.extensions, {});
    assert.ok(Array.isArray(d.alternate_greetings) && d.alternate_greetings.length >= 2);
    assert.match(d.description, /\[SITUAÇÃO/);
    assert.match(d.description, /\{\{user\}\}/);
    assert.match(d.description, /\{\{hoi_nation\}\}/);
    for (const role of ['Ministro da Defesa', 'Chanceler', 'Ministra da Economia', 'Diretor de Inteligência', 'Ministro do Interior']) {
        assert.ok(d.description.includes(role), role);
    }
    assert.match(d.mes_example, /<START>/);
});

test('on/offAll wrap eventSource.on/removeListener', () => {
    const ctx = createFakeContext();
    const uninstall = installFakeSillyTavern(ctx);
    try {
        const st = createSt(deps);
        const fn = () => {};
        st.on('chat_id_changed', fn);
        st.on('app_ready', fn);
        assert.equal(ctx.eventSource.listenerCount('chat_id_changed'), 1);
        st.offAll();
        assert.equal(ctx.eventSource.listenerCount('chat_id_changed'), 0);
        assert.equal(ctx.eventSource.listenerCount('app_ready'), 0);
    } finally {
        uninstall();
    }
});

test('toast uses the global toastr with a valid kind', () => {
    const seen = [];
    globalThis.toastr = { info: (m, t) => seen.push(['info', m, t]), success() {}, warning: (m) => seen.push(['warning', m]), error() {} };
    try {
        const st = createSt(deps);
        st.toast('Olá');
        st.toast('Cuidado', 'warning');
        st.toast('x', 'bogus');
        assert.deepEqual(seen, [['info', 'Olá', 'Grande Estratégia'], ['warning', 'Cuidado'], ['info', 'x', 'Grande Estratégia']]);
    } finally {
        delete globalThis.toastr;
    }
});

test('createSt requires getState and buildSitrep', () => {
    assert.throws(() => createSt({}), TypeError);
});
