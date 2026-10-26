import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFFECT_LIMITS, EVENT_CATEGORIES } from '../../src/contract/constants.js';
import { getRelation } from '../../src/contract/worldState.js';
import { createEngine } from '../../src/engine/index.js';
import { buildScenario } from './fixtures.js';

const engine = createEngine();
const fresh = (nationId = 'BRA') => engine.newGame(buildScenario(), { bookmarkId: 'b2026', nationId, leaderName: 'Teste', seed: 'eventos' });

const opt = (label, effects = [], rationale = 'Consequência.') => ({ label, rationale, effects });
const llmEvent = (over = {}) => ({
    category: 'economy',
    title: 'Crise cambial',
    narrative: 'O real despenca nos mercados internacionais.',
    headlines: ['Real cai 8%'],
    involved: ['PLAYER', 'CHN'],
    options: [opt('Subir os juros', [{ type: 'resource', target: 'PLAYER', resource: 'economy', delta: -2 }]), opt('Pedir ajuda à China', [{ type: 'relation', target: 'PLAYER', targetB: 'CHN', delta: 5 }])],
    ...over,
});

test('sanitizeEvent: garbage never throws and is rejected', () => {
    const s = fresh();
    for (const raw of [null, undefined, 42, 'texto', [], {}, { options: 'x' }, { options: [1, 2, 3] }, { title: 'a', options: [{}, {}] }]) {
        let r;
        assert.doesNotThrow(() => {
            r = engine.sanitizeEvent(raw, s);
        });
        assert.equal(r.ok, false);
        assert.equal(r.value, null);
        assert.ok(r.errors.length > 0);
    }
    assert.equal(engine.sanitizeEvent(llmEvent(), null).ok, false);
    const cyclic = llmEvent();
    cyclic.self = cyclic;
    assert.equal(engine.sanitizeEvent(cyclic, s).ok, true);
});

test('sanitizeEvent: fills defaults, resolves PLAYER, keeps valid content', () => {
    const s = fresh();
    const { ok, value, errors } = engine.sanitizeEvent(llmEvent(), s);
    assert.equal(ok, true, errors.join());
    assert.match(value.id, /^evt-1-/);
    assert.equal(value.source, 'llm');
    assert.equal(value.turn, s.turn);
    assert.deepEqual(value.involved, ['BRA', 'CHN']);
    assert.deepEqual(value.options[0].effects, [{ type: 'resource', target: 'BRA', resource: 'economy', delta: -2 }]);
    assert.deepEqual(value.options[1].effects, [{ type: 'relation', target: 'BRA', targetB: 'CHN', delta: 5 }]);
    const again = engine.sanitizeEvent(llmEvent(), s);
    assert.deepEqual(again.value, value, 'deterministic id');
    assert.deepEqual(engine.sanitizeEvent(value, s).value, value, 'idempotent');
});

test('sanitizeEvent: unknown ids and effect types dropped, deltas clamped, names resolved', () => {
    const s = fresh();
    const ev = llmEvent({
        involved: ['ATL', 'Índia', 'usa'],
        options: [
            opt('Opção A', [
                { type: 'resource', target: 'ATL', resource: 'economy', delta: 5 },
                { type: 'teleport', target: 'BRA' },
                { type: 'resource', target: 'Brasil', resource: 'Estabilidade', delta: 400 },
                { type: 'relation', target: 'PLAYER', targetB: 'China', delta: -999 },
                { type: 'tension', delta: 77 },
                { type: 'front', target: 'RUS', targetB: 'UKR', delta: 300 },
                { type: 'pc', target: 'PLAYER', delta: -99 },
                { type: 'resource', target: 'TARGET', resource: 'economy', delta: 1 },
            ]),
            opt('Opção B', [{ type: 'modifier', target: 'PLAYER', label: 'x'.repeat(200), perTurn: { economy: 50, magic: 2 }, turns: 500 }]),
        ],
    });
    const { ok, value, errors } = engine.sanitizeEvent(ev, s);
    assert.equal(ok, true);
    assert.deepEqual(value.involved, ['IND', 'USA']);
    const a = value.options[0].effects;
    assert.deepEqual(a.map((e) => e.type), ['resource', 'relation', 'tension', 'front', 'pc']);
    assert.equal(a[0].delta, EFFECT_LIMITS.resource);
    assert.equal(a[0].resource, 'stability');
    assert.equal(a[1].delta, -EFFECT_LIMITS.relation);
    assert.equal(a[1].targetB, 'CHN');
    assert.equal(a[2].delta, EFFECT_LIMITS.tension);
    assert.equal(a[3].delta, EFFECT_LIMITS.front);
    assert.equal(a[4].delta, -EFFECT_LIMITS.pc);
    const m = value.options[1].effects[0];
    assert.deepEqual(m.perTurn, { economy: EFFECT_LIMITS.modifierPerTurn });
    assert.equal(m.turns, EFFECT_LIMITS.modifierTurns);
    assert.ok(m.label.length <= 60);
    assert.ok(errors.some((e) => /teleport/.test(e)));
    assert.ok(errors.some((e) => /desconhecida/.test(e)));
});

test('sanitizeEvent: option count bounds and max 6 effects per option', () => {
    const s = fresh();
    const many = Array.from({ length: 9 }, () => ({ type: 'tension', delta: 1 }));
    const r = engine.sanitizeEvent(llmEvent({ options: [opt('A', many), opt('B'), opt('C'), opt('D'), opt('E'), opt('F')] }), s);
    assert.equal(r.ok, true);
    assert.equal(r.value.options.length, 4);
    assert.equal(r.value.options[0].effects.length, 6);
    const one = engine.sanitizeEvent(llmEvent({ options: [opt('Só uma'), { label: '' }, null, 'x'] }), s);
    assert.equal(one.ok, false);
    assert.ok(one.errors.some((e) => /pelo menos 2/.test(e)));
});

test('sanitizeEvent: text trimming and category default', () => {
    const s = fresh();
    const r = engine.sanitizeEvent(
        llmEvent({ title: '  T'.repeat(200), narrative: 'palavra '.repeat(1000), headlines: ['a', '', 'b', 'c', 'd'], category: 'alienígenas', source: 'hacker', id: 'meu id!!' }),
        s,
    );
    assert.equal(r.ok, true);
    assert.ok(r.value.title.length <= 120);
    assert.ok(r.value.narrative.length <= 1500);
    assert.ok(r.value.narrative.endsWith('…'));
    assert.deepEqual(r.value.headlines, ['a', 'b', 'c']);
    assert.equal(r.value.category, 'politics');
    assert.equal(r.value.source, 'llm');
    assert.equal(r.value.id, 'meuid');
    for (const c of EVENT_CATEGORIES) assert.equal(engine.sanitizeEvent(llmEvent({ category: c }), s).value.category, c);
    const noTitle = engine.sanitizeEvent(llmEvent({ title: '' }), s);
    assert.equal(noTitle.value.title, 'Decisão de Estado');
});

test('sanitizeEvent: war declarations survive only when the option says so', () => {
    const s = fresh();
    const declare = { type: 'war', action: 'declare', target: 'PLAYER', targetB: 'VEN' };
    const war = { type: 'war', action: 'declare', target: 'PLAYER', targetB: 'IND' };
    const r = engine.sanitizeEvent(llmEvent({ options: [opt('Declarar guerra à Índia', [war]), opt('Assinar um acordo', [war]), opt('Invadir', [declare])] }), s);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value.options[0].effects, [{ type: 'war', action: 'declare', target: 'BRA', targetB: 'IND' }]);
    assert.deepEqual(r.value.options[1].effects, []);
    assert.deepEqual(r.value.options[2].effects, [], 'unknown nation id');
    assert.ok(r.errors.some((e) => /declaração de guerra removida/.test(e)));
});

test('setPendingEvent / resolvePendingEvent: queueing, effects, records, promotion', () => {
    let s = fresh();
    const e1 = llmEvent({ id: 'e1' });
    const e2 = llmEvent({ id: 'e2', title: 'Segunda decisão' });
    s = engine.setPendingEvent(s, e1);
    assert.equal(s.pendingEvent.id, 'e1');
    s = engine.setPendingEvent(s, e2);
    assert.equal(s.pendingEvent.id, 'e1');
    assert.deepEqual(s.eventQueue.map((e) => e.id), ['e2']);
    assert.equal(engine.setPendingEvent(s, e2).eventQueue.length, 1, 'no duplicates');
    assert.equal(engine.setPendingEvent(s, { junk: true }).eventQueue.length, 1, 'invalid ignored');

    const bad = engine.resolvePendingEvent(s, 7);
    assert.equal(bad.summary, 'Opção inválida.');
    assert.equal(bad.state, s);

    const before = getRelation(s, 'BRA', 'CHN');
    const r = engine.resolvePendingEvent(s, 1);
    assert.equal(getRelation(r.state, 'BRA', 'CHN'), before + 5);
    assert.deepEqual(r.details, ['Relação com a China +5']);
    assert.equal(r.summary, 'Crise cambial: Pedir ajuda à China.');
    assert.deepEqual(r.state.decisions.at(-1), { turn: 1, eventTitle: 'Crise cambial', optionLabel: 'Pedir ajuda à China' });
    assert.equal(r.state.pendingEvent.id, 'e2');
    assert.equal(r.state.eventQueue.length, 0);
    const r2 = engine.resolvePendingEvent(r.state, 0);
    assert.equal(r2.state.pendingEvent, null);
    assert.equal(engine.resolvePendingEvent(r2.state, 0).summary, 'Nenhuma decisão pendente.');
});

test('resolvePendingEvent resolves the queue head when nothing is pending (engine events)', () => {
    const s = fresh();
    const ai = engine.executeAction(s, 'IND', 'dip_trade_agreement', 'BRA').state;
    assert.equal(ai.pendingEvent, null);
    assert.equal(ai.eventQueue.length, 1);
    const r = engine.resolvePendingEvent(ai, 1);
    assert.equal(r.state.eventQueue.length, 0);
    assert.equal(getRelation(r.state, 'BRA', 'IND'), getRelation(ai, 'BRA', 'IND') - 5);
});

test('unanswered engine decisions expire after 6 months with their default option', () => {
    let s = fresh('POL');
    s = engine.applyEffects(s, [{ type: 'war', action: 'declare', target: 'RUS', targetB: 'DEU' }]).state;
    s = engine.endTurn(s).state;
    const cta = s.eventQueue.find((e) => e.title === 'Chamado às Armas');
    assert.ok(cta);
    assert.equal(cta.defaultOption, 2);
    const influence = s.nations.POL.resources.influence;
    for (let i = 0; i < 6; i++) s = engine.endTurn(s).state;
    assert.equal(s.eventQueue.some((e) => e.id === cta.id), false);
    assert.ok(s.log.some((l) => l.kind === 'decision' && l.text.startsWith('Prazo esgotado: Chamado às Armas')));
    assert.ok(s.nations.POL.resources.influence <= influence);
});
