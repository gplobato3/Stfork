import test from 'node:test';
import assert from 'node:assert/strict';

import { createLlm } from '../../src/llm/index.js';
import { buildFallbackEvent } from '../../src/llm/fallback.js';
import { EVENT_SCHEMA } from '../../src/llm/schemas.js';
import { createSt } from '../../src/st/index.js';
import { EFFECT_TYPES, EVENT_CATEGORIES, OPTION_COUNT } from '../../src/contract/constants.js';
import { createFakeContext, installFakeSillyTavern } from '../st/fakeContext.js';
import { makeState, makeReport, makeEngine, validEventJson, deepFreeze } from '../st/worldFixture.js';

function makeSt({ responses = [], settings = {} } = {}) {
    const calls = [];
    return {
        calls,
        getSettings: () => ({ llmEvents: true, eventMaxTokens: 1500, ...settings }),
        async generateStructured(req) {
            calls.push(req);
            const r = responses.shift();
            return typeof r === 'function' ? r(req) : r ?? { ok: false, error: 'sem resposta' };
        },
        async generateQuiet() {
            return '';
        },
        recentChatText: () => 'Gabriel: Quero respostas sobre a Venezuela.',
    };
}

function assertPlayableEvent(ev, state) {
    assert.equal(typeof ev.id, 'string');
    assert.ok(EVENT_CATEGORIES.includes(ev.category), ev.category);
    assert.ok(ev.title.length > 5);
    assert.ok(ev.options.length >= OPTION_COUNT.MIN && ev.options.length <= OPTION_COUNT.MAX);
    for (const o of ev.options) {
        assert.ok(o.label && o.label.length <= 60, o.label);
        assert.ok(o.rationale);
        assert.ok(o.effects.length >= 1, `option "${o.label}" has real effects`);
        for (const e of o.effects) assert.ok(EFFECT_TYPES.includes(e.type));
    }
    assert.equal(ev.turn, state.turn);
}

test('success path: one structured call with the event schema; sanitized event returned', async () => {
    const state = deepFreeze(makeState());
    const engine = makeEngine();
    const st = makeSt({ responses: [{ ok: true, value: validEventJson(), raw: '{}' }] });
    const llm = createLlm({ st, engine });
    const ev = await llm.generateTurnEvent(state, { report: makeReport(), recentChat: 'Gabriel: Reforcem Roraima!' });
    assert.equal(st.calls.length, 1);
    const req = st.calls[0];
    assert.equal(req.schemaName, 'hoi_event');
    assert.equal(req.schema, EVENT_SCHEMA);
    assert.equal(req.maxTokens, 1500);
    assert.match(req.systemPrompt, /Brazilian Portuguese/);
    assert.match(req.systemPrompt, /"type":"relation"/, 'effect vocabulary spelled out for Text Completion');
    assert.match(req.systemPrompt, /"options":\[/, 'compact JSON example');
    assert.match(req.prompt, /\[SITUAÇÃO — Outubro de 2026\]/);
    assert.match(req.prompt, /Gabriel: Reforcem Roraima!/);
    assert.match(req.prompt, /Venezuela realiza exercícios na fronteira com o Brasil \[targets the player\]/);
    assert.match(req.prompt, /BRA = Brasil \(jogador\)/);
    assert.match(req.prompt, /c1: Bloqueio no Estreito de Taiwan \[high\]/);
    assert.match(req.prompt, /RECENT EVENTS \(do not repeat\): Cúpula do BRICS/);

    assert.equal(engine.calls.sanitizeEvent.length, 1);
    assert.equal(engine.calls.sanitizeEvent[0].source, 'llm');
    assert.equal(ev.source, 'llm');
    assert.equal(ev.title, 'Caracas testa a fronteira');
    assert.equal(ev.options[0].effects[0].target, 'BRA', 'PLAYER resolved by sanitizeEvent');
    assertPlayableEvent(ev, state);
});

test('recentChat defaults to st.recentChatText(8)', async () => {
    const st = makeSt({ responses: [{ ok: true, value: validEventJson() }] });
    await createLlm({ st, engine: makeEngine() }).generateTurnEvent(makeState(), {});
    assert.match(st.calls[0].prompt, /Gabriel: Quero respostas sobre a Venezuela\./);
});

test('repair path: sanitize rejects the first answer -> second call with errors and raw, schema kept', async () => {
    const bad = { ...validEventJson(), options: [validEventJson().options[0]] };
    const st = makeSt({ responses: [{ ok: true, value: bad, raw: '{"bad":1}' }, { ok: true, value: validEventJson() }] });
    const ev = await createLlm({ st, engine: makeEngine() }).generateTurnEvent(makeState(), { report: makeReport() });
    assert.equal(st.calls.length, 2);
    assert.match(st.calls[1].prompt, /YOUR PREVIOUS ANSWER WAS REJECTED/);
    assert.match(st.calls[1].prompt, /not enough options/);
    assert.match(st.calls[1].prompt, /\{"bad":1\}/);
    assert.equal(st.calls[1].schema, EVENT_SCHEMA);
    assert.equal(ev.source, 'llm');
});

test('repair path: unparseable first answer -> retry prompt-only (schema null)', async () => {
    const st = makeSt({ responses: [{ ok: false, raw: 'Desculpe, não posso.', error: 'JSON inválido' }, { ok: true, value: validEventJson() }] });
    const ev = await createLlm({ st, engine: makeEngine() }).generateTurnEvent(makeState(), {});
    assert.equal(st.calls[1].schema, null);
    assert.match(st.calls[1].prompt, /Desculpe, não posso\./);
    assert.equal(ev.source, 'llm');
});

test('quality gate: gate-accepted event whose effects were all dropped triggers the repair', async () => {
    const noEffects = { ...validEventJson(), options: validEventJson().options.map((o) => ({ ...o, effects: [{ type: 'teleport', target: 'PLAYER' }] })) };
    const st = makeSt({ responses: [{ ok: true, value: noEffects, raw: 'x' }, { ok: true, value: validEventJson() }] });
    const ev = await createLlm({ st, engine: makeEngine() }).generateTurnEvent(makeState(), {});
    assert.equal(st.calls.length, 2);
    assert.match(st.calls[1].prompt, /fewer than 2 options with valid effects/);
    assert.equal(ev.source, 'llm');
    assert.ok(ev.options.every((o) => o.effects.length > 0));
});

test('wrapped {event:{...}} answers are unwrapped once', async () => {
    const st = makeSt({ responses: [{ ok: true, value: { event: validEventJson() } }] });
    const ev = await createLlm({ st, engine: makeEngine() }).generateTurnEvent(makeState(), {});
    assert.equal(st.calls.length, 1);
    assert.equal(ev.title, 'Caracas testa a fronteira');
});

test('fallback path: both attempts fail -> deterministic pt-BR event, source "fallback", sanitized', async () => {
    const state = makeState();
    const engine = makeEngine();
    const st = makeSt({ responses: [{ ok: false, error: 'HTTP 500' }, { ok: false, error: 'HTTP 500' }] });
    const llm = createLlm({ st, engine });
    const ev = await llm.generateTurnEvent(state, { report: makeReport() });
    assert.equal(st.calls.length, 2);
    assert.equal(ev.source, 'fallback');
    assertPlayableEvent(ev, state);
    assert.ok(ev.options.length >= 2 && ev.options.length <= 3);
    assert.equal(engine.calls.sanitizeEvent.at(-1).source, 'fallback', 'fallback also goes through the gate');
    const again = await createLlm({ st: makeSt({ responses: [{ ok: false }, { ok: false }] }), engine: makeEngine() }).generateTurnEvent(state, { report: makeReport() });
    assert.deepEqual(again, ev, 'deterministic');
});

test('fallback when generateStructured throws or sanitizeEvent throws', async () => {
    const st = makeSt({ responses: [() => { throw new Error('boom'); }] });
    const ev = await createLlm({ st, engine: makeEngine() }).generateTurnEvent(makeState(), {});
    assert.equal(ev.source, 'fallback');

    const engine = makeEngine({ sanitizeOverride: () => { throw new Error('gate down'); } });
    const st2 = makeSt({ responses: [{ ok: true, value: validEventJson() }, { ok: true, value: validEventJson() }] });
    const ev2 = await createLlm({ st: st2, engine }).generateTurnEvent(makeState(), {});
    assert.equal(ev2.source, 'fallback');
    assert.ok(ev2.options.length >= 2);
});

test('llmEvents:false -> fallback without any LLM call', async () => {
    const st = makeSt({ settings: { llmEvents: false } });
    const ev = await createLlm({ st, engine: makeEngine() }).generateTurnEvent(makeState(), { report: makeReport() });
    assert.equal(st.calls.length, 0);
    assert.equal(ev.source, 'fallback');
});

test('fallback scenarios: war, own crisis, domestic, world crisis, diplomacy', () => {
    const base = makeState();
    // war involving the player
    const war = makeState({
        wars: [{ id: 'w9', name: 'Guerra do Essequibo', attackers: ['VEN'], defenders: ['BRA'], startedTurn: 2, fronts: [{ attacker: 'VEN', defender: 'BRA', progress: 22 }], score: 5, exhaustion: {}, ceasefire: false }],
    });
    const w = buildFallbackEvent(war, makeReport());
    assert.equal(w.category, 'war');
    assert.match(w.title, /contra a Venezuela/);
    assert.match(w.narrative, /O inimigo ocupa cerca de 22% do nosso território/);
    assert.deepEqual(w.options[0].effects[0], { type: 'front', target: 'VEN', targetB: 'PLAYER', delta: -8 });
    assert.match(w.narrative, /Rússia avança no Donbas/, 'hooks a report headline');

    // crisis involving the player
    const own = makeState({ crises: [{ id: 'cb', title: 'Incidente em Roraima', description: 'Soldados trocam tiros na fronteira.', severity: 'high', involved: ['BRA', 'VEN'], turnStarted: 3, category: 'military' }] });
    const c = buildFallbackEvent(own);
    assert.equal(c.category, 'military');
    assert.match(c.narrative, /A Venezuela cobra uma resposta pública/);
    assert.deepEqual(c.options[0].effects[0], { type: 'crisis', action: 'deescalate', crisisId: 'cb' });

    // weak economy -> domestic economy event
    const poor = makeState({ crises: [] });
    poor.nations = { ...poor.nations, BRA: { ...poor.nations.BRA, resources: { ...poor.nations.BRA.resources, economy: 20 } } };
    assert.equal(buildFallbackEvent(poor).category, 'economy');
    const unrest = makeState({ crises: [] });
    unrest.nations = { ...unrest.nations, BRA: { ...unrest.nations.BRA, resources: { ...unrest.nations.BRA.resources, stability: 15 } } };
    assert.equal(buildFallbackEvent(unrest).category, 'unrest');

    // world crisis
    const world = buildFallbackEvent(base);
    assert.equal(world.category, 'naval');
    assert.match(world.title, /o mundo espera a nossa posição/);
    assert.ok(world.options.some((o) => o.label === 'Apoiar a China'));
    assert.match(world.narrative, /A China e Taiwan trocam acusações/);

    // nothing going on -> diplomatic opportunity with a major
    const calm = buildFallbackEvent(makeState({ crises: [] }));
    assert.equal(calm.category, 'diplomacy');
    assert.match(calm.title, /Proposta de parceria estratégica da China/);
    for (const ev of [w, c, world, calm]) {
        const words = ev.narrative.split(/\s+/).length;
        assert.ok(words >= 60 && words <= 180, `${ev.title}: ${words} words`);
    }
});

test('end-to-end through the real StAPI and a fake ST (Text Completion): prompt-only JSON parsed', async () => {
    const ctx = createFakeContext({ mainApi: 'textgenerationwebui' });
    // TC continues after the "{" prefill, with a reasoning block in front.
    ctx.responders.model = async () => `<think>ok</think>${JSON.stringify(validEventJson()).slice(1)}`;
    const uninstall = installFakeSillyTavern(ctx);
    try {
        const state = makeState();
        const st = createSt({ getState: () => state, buildSitrep: () => '' });
        const llm = createLlm({ st, engine: makeEngine() });
        const ev = await llm.generateTurnEvent(state, { report: makeReport(), recentChat: '' });
        assert.equal(ev.source, 'llm');
        assert.equal(ev.title, 'Caracas testa a fronteira');
        assert.equal(ctx.calls.generateRaw.length, 1);
        assert.equal(ctx.calls.generateRaw[0].jsonSchema, null);
        assert.equal(ctx.calls.generateRaw[0].prefill, '{');
        assert.equal(ctx.calls.generateRaw[0].responseLength, 1200);
    } finally {
        uninstall();
    }
});

test('end-to-end Chat Completion: jsonSchema wrapper sent; ST "{}" triggers prompt-only repair', async () => {
    const ctx = createFakeContext({ mainApi: 'openai' });
    let n = 0;
    ctx.responders.model = async ({ jsonSchema }) => {
        n++;
        return n === 1 ? 'I refuse to use tools' : JSON.stringify(validEventJson()) + (jsonSchema ? '' : '\n');
    };
    // First answer: invalid text with returnInvalid -> st reports !ok; second: prompt-only.
    const uninstall = installFakeSillyTavern(ctx);
    try {
        const state = makeState();
        const llm = createLlm({ st: createSt({ getState: () => state, buildSitrep: () => '' }), engine: makeEngine() });
        const ev = await llm.generateTurnEvent(state, {});
        assert.equal(ev.source, 'llm');
        assert.equal(ctx.calls.generateRaw[0].jsonSchema.name, 'hoi_event');
        assert.equal(ctx.calls.generateRaw[0].jsonSchema.value, EVENT_SCHEMA);
        assert.equal(ctx.calls.generateRaw[1].jsonSchema, null);
    } finally {
        uninstall();
    }
});

test('EVENT_SCHEMA stays in the portable subset', () => {
    const banned = ['oneOf', 'anyOf', 'allOf', 'additionalProperties', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', '$ref', 'nullable'];
    const walk = (schema) => {
        if (!schema || typeof schema !== 'object') return;
        for (const k of Object.keys(schema)) assert.ok(!banned.includes(k), `banned keyword ${k}`);
        assert.ok(['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(schema.type), `type ${schema.type}`);
        for (const child of Object.values(schema.properties || {})) walk(child);
        if (schema.items) walk(schema.items);
    };
    walk(EVENT_SCHEMA);
    assert.deepEqual(EVENT_SCHEMA.properties.category.enum, [...EVENT_CATEGORIES]);
});
