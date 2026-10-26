/**
 * @file test/llm.test.js
 * node:test unit tests for MODULE C (the LLM integration layer, FEAT-004).
 *
 * The ONLY thing mocked is the network generation call: we override
 * generateRaw / generateQuietPrompt on the node mock context returned by
 * stContext.getContext(). All parsing, validation, budget trimming, and chat
 * splicing is the REAL code under test.
 *
 * Run: node --test test/llm.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getContext } from '../src/core/stContext.js';
import { MODULE_NAME } from '../src/contract/interfaces.js';
import { validateEvent } from '../src/contract/schemas.js';
import { createEmptyWorldState, createResources } from '../src/contract/worldState.js';

import { buildSituationReport } from '../src/llm/situationReport.js';
import { generateTurnEvent } from '../src/llm/eventEngine.js';
import {
    hoiGenerateInterceptor,
    loadActiveWorldState,
    isSituationNote,
    SITUATION_NOTE_NAME,
} from '../src/llm/interceptor.js';
import { createLlm } from '../src/llm/llm.js';

/* --------------------------- test fixtures/helpers ------------------------ */

/** Build a realistic, active (nation chosen) world state for tests. */
function makeActiveState() {
    const s = createEmptyWorldState({ campaignId: 'camp-test', seed: 'seed-test' });
    s.turn = 3;
    s.phase = 'PLAYER_TURN';
    s.playerNationId = 'BRA';
    s.globalTension = 42;
    s.nations = {
        BRA: {
            id: 'BRA', name: 'Brasil', flagEmoji: '🇧🇷', bloc: 'BRICS', isPlayer: true,
            capital: 'Brasília', resources: createResources({ economy: 60, military: 40 }),
            government: 'República Presidencialista', leaderTitle: 'Presidente', traits: ['Economia Emergente'],
        },
        USA: {
            id: 'USA', name: 'Estados Unidos', flagEmoji: '🇺🇸', bloc: 'NATO', isPlayer: false,
            capital: 'Washington', resources: createResources(), government: 'República', leaderTitle: 'Presidente', traits: [],
        },
        RUS: {
            id: 'RUS', name: 'Rússia', flagEmoji: '🇷🇺', bloc: 'CSTO', isPlayer: false,
            capital: 'Moscou', resources: createResources(), government: 'República', leaderTitle: 'Presidente', traits: [],
        },
    };
    s.relations = { 'BRA|USA': 30, 'BRA|RUS': -45, 'RUS|USA': -80 };
    s.activeCrises = [
        { id: 'c1', title: 'Tensão no Atlântico Sul', description: 'Manobras navais.', severity: 'high', involvedNationIds: ['BRA', 'USA'], turnStarted: 2 },
        { id: 'c2', title: 'Disputa comercial', description: 'Tarifas.', severity: 'low', involvedNationIds: ['BRA'], turnStarted: 1 },
    ];
    return s;
}

/** A schema-valid GameEvent as a JSON string (simulates good model output). */
function goodEventJson() {
    return JSON.stringify({
        title: 'Incidente no Atlântico Sul',
        narrative: 'Uma fragata estrangeira cruza águas reivindicadas pelo Brasil.',
        tensionDelta: 3,
        options: [
            { label: 'Protesto diplomático', rationale: 'Desescalar com firmeza.', effects: [{ type: 'tension', delta: -4 }] },
            { label: 'Enviar a Marinha', rationale: 'Mostrar força.', effects: [{ type: 'resource', target: 'BRA', resource: 'warSupport', delta: 8 }, { type: 'tension', delta: 6 }] },
        ],
    });
}

/**
 * Install a mock generateRaw on the shared node mock context and ensure it is
 * restored afterwards. Returns a restore function.
 * @param {(args:any)=>any} impl
 */
function mockGenerateRaw(impl) {
    const ctx = getContext();
    const prev = ctx.generateRaw;
    ctx.generateRaw = async (args) => impl(args);
    return () => { ctx.generateRaw = prev; };
}

/**
 * Set/clear the active campaign save in the mock context's chatMetadata.
 * @param {object|null} state
 */
function setCampaign(state) {
    const ctx = getContext();
    if (state) ctx.chatMetadata[MODULE_NAME] = state;
    else delete ctx.chatMetadata[MODULE_NAME];
}

/* --------------------------------- tests ---------------------------------- */

test('buildSituationReport includes player nation + tension and is non-empty', () => {
    const s = makeActiveState();
    const report = buildSituationReport(s, { maxTokensBudget: 1000 });
    assert.ok(report.length > 0, 'report should be non-empty');
    assert.match(report, /Brasil/, 'mentions the player nation');
    assert.match(report, /Presidente/, 'mentions the leader title');
    assert.match(report, /Tensão global/, 'mentions tension label');
    assert.match(report, /42\/100/, 'shows the tension value');
    // Rich budget should include crises + relations sections.
    assert.match(report, /Crises ativas/);
    assert.match(report, /Relações-chave/);
});

test('buildSituationReport shrinks with a tiny token budget', () => {
    const s = makeActiveState();
    const big = buildSituationReport(s, { maxTokensBudget: 1000 });
    const tiny = buildSituationReport(s, { maxTokensBudget: 24 });
    assert.ok(tiny.length < big.length, 'tiny budget output should be shorter');
    // At the smallest budget, low-priority sections are dropped but tension stays.
    assert.match(tiny, /Tensão global/);
    assert.doesNotMatch(tiny, /Relações-chave/, 'relations dropped under tiny budget');
});

test('generateTurnEvent returns a validateEvent-passing object for good mock JSON', async () => {
    const s = makeActiveState();
    const restore = mockGenerateRaw(() => goodEventJson());
    try {
        const ev = await generateTurnEvent(s);
        const res = validateEvent(ev);
        assert.ok(res.ok, 'returned event must pass validateEvent: ' + res.errors.join('; '));
        assert.equal(ev.title, 'Incidente no Atlântico Sul');
        assert.ok(Array.isArray(ev.options) && ev.options.length >= 2);
    } finally {
        restore();
    }
});

test('generateTurnEvent handles a markdown-fenced JSON object response', async () => {
    const s = makeActiveState();
    const restore = mockGenerateRaw(() => '```json\n' + goodEventJson() + '\n```');
    try {
        const ev = await generateTurnEvent(s);
        assert.ok(validateEvent(ev).ok);
        assert.equal(ev.title, 'Incidente no Atlântico Sul');
    } finally {
        restore();
    }
});

test('generateTurnEvent repairs once then succeeds (garbage, then good)', async () => {
    const s = makeActiveState();
    let calls = 0;
    const restore = mockGenerateRaw(() => {
        calls += 1;
        return calls === 1 ? 'total garbage, not json at all' : goodEventJson();
    });
    try {
        const ev = await generateTurnEvent(s);
        assert.equal(calls, 2, 'should have made exactly one repair retry');
        assert.ok(validateEvent(ev).ok);
        assert.equal(ev.title, 'Incidente no Atlântico Sul');
    } finally {
        restore();
    }
});

test('generateTurnEvent returns the SAFE FALLBACK (no throw) when mock returns garbage twice', async () => {
    const s = makeActiveState();
    let calls = 0;
    let toasted = '';
    const restore = mockGenerateRaw(() => { calls += 1; return 'still not json <<<'; });
    try {
        const ev = await generateTurnEvent(s, { toast: (m) => { toasted = m; } });
        assert.equal(calls, 2, 'tries once + one repair, then falls back');
        const res = validateEvent(ev);
        assert.ok(res.ok, 'fallback event must itself be schema-valid: ' + res.errors.join('; '));
        assert.match(ev.id, /fallback/, 'should be the deterministic fallback');
        assert.ok(ev.options.length >= 2);
        assert.ok(toasted.length > 0, 'fallback should surface a toast');
    } finally {
        restore();
    }
});

test('generateTurnEvent never throws even when generation itself throws', async () => {
    const s = makeActiveState();
    const restore = mockGenerateRaw(() => { throw new Error('backend exploded'); });
    try {
        const ev = await generateTurnEvent(s);
        assert.ok(validateEvent(ev).ok, 'must degrade to a valid fallback');
        assert.match(ev.id, /fallback/);
    } finally {
        restore();
    }
});

test('loadActiveWorldState reads the engine save shape from chatMetadata', () => {
    setCampaign(null);
    assert.equal(loadActiveWorldState(), null, 'no campaign -> null');
    const s = makeActiveState();
    setCampaign(s);
    const loaded = loadActiveWorldState();
    assert.ok(loaded, 'direct save shape should load');
    assert.equal(loaded.playerNationId, 'BRA');
    // Wrapped shape also supported.
    setCampaign({ state: s });
    assert.equal(loadActiveWorldState().playerNationId, 'BRA');
    setCampaign(null);
});

test('interceptor splices exactly one situation note when a campaign is active', async () => {
    setCampaign(makeActiveState());
    const chat = [
        { is_user: false, name: 'char', mes: 'Olá, líder.' },
        { is_user: true, name: 'User', mes: 'O que acontece hoje?' },
    ];
    try {
        await hoiGenerateInterceptor(chat, 8192, () => {}, 'normal');
        const notes = chat.filter(isSituationNote);
        assert.equal(notes.length, 1, 'exactly one situation note injected');
        assert.equal(notes[0].name, SITUATION_NOTE_NAME);
        assert.equal(notes[0].is_user, false);
        assert.ok(typeof notes[0].send_date === 'number');
        assert.match(notes[0].mes, /Brasil/);
        // Inserted before the last (user) message, user message preserved last.
        assert.equal(chat[chat.length - 1].mes, 'O que acontece hoje?');

        // Idempotent: a second pass must NOT add another note.
        await hoiGenerateInterceptor(chat, 8192, () => {}, 'normal');
        assert.equal(chat.filter(isSituationNote).length, 1, 'still exactly one after re-entry');
    } finally {
        setCampaign(null);
    }
});

test('interceptor injects ZERO notes when no campaign is active', async () => {
    setCampaign(null);
    const chat = [{ is_user: true, name: 'User', mes: 'oi' }];
    await hoiGenerateInterceptor(chat, 8192, () => {}, 'normal');
    assert.equal(chat.filter(isSituationNote).length, 0);
    assert.equal(chat.length, 1, 'chat untouched');
});

test('interceptor skips inappropriate generation types', async () => {
    setCampaign(makeActiveState());
    try {
        for (const type of ['impersonate', 'continue', 'quiet']) {
            const chat = [{ is_user: true, name: 'User', mes: 'oi' }];
            await hoiGenerateInterceptor(chat, 8192, () => {}, type);
            assert.equal(chat.filter(isSituationNote).length, 0, `type ${type} should be skipped`);
        }
    } finally {
        setCampaign(null);
    }
});

test('interceptor never throws when state access is broken', async () => {
    // Make chatMetadata a hostile getter that throws when read.
    const ctx = getContext();
    const original = Object.getOwnPropertyDescriptor(ctx, 'chatMetadata');
    Object.defineProperty(ctx, 'chatMetadata', {
        configurable: true,
        get() { throw new Error('metadata access blew up'); },
    });
    try {
        const chat = [{ is_user: true, name: 'User', mes: 'oi' }];
        await assert.doesNotReject(hoiGenerateInterceptor(chat, 8192, () => {}, 'normal'));
        assert.equal(chat.length, 1, 'no mutation on error');
    } finally {
        // Restore chatMetadata to a plain object.
        if (original) Object.defineProperty(ctx, 'chatMetadata', original);
        else Object.defineProperty(ctx, 'chatMetadata', { configurable: true, writable: true, value: {} });
    }
});

test('interceptor is a no-op on a non-array chat argument', async () => {
    setCampaign(makeActiveState());
    try {
        await assert.doesNotReject(hoiGenerateInterceptor(null, 8192, () => {}, 'normal'));
        await assert.doesNotReject(hoiGenerateInterceptor(undefined, 8192, () => {}, 'normal'));
    } finally {
        setCampaign(null);
    }
});

test('global hoiGenerateInterceptor is wired by importing the module', () => {
    assert.equal(typeof globalThis.hoiGenerateInterceptor, 'function');
});

test('createLlm composes the LlmAPI surface', async () => {
    const llm = createLlm();
    assert.equal(typeof llm.buildSituationReport, 'function');
    assert.equal(typeof llm.generateTurnEvent, 'function');
    assert.equal(typeof llm.interceptor, 'function');
    assert.equal(typeof llm.generateFlavorNarration, 'function');

    const s = makeActiveState();
    const report = llm.buildSituationReport(s, { maxTokensBudget: 500 });
    assert.match(report, /Brasil/);

    // generateFlavorNarration degrades to '' when generation is a no-op (mock).
    const narration = await llm.generateFlavorNarration(s, { event: { title: 'X', narrative: 'Y', options: [{ id: 'a', label: 'A', effects: [] }] }, optionId: 'a' });
    assert.equal(typeof narration, 'string');
});
