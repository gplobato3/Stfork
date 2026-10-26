import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFFECT_LIMITS, EFFECT_TYPES } from '../../src/contract/constants.js';
import { getRelation } from '../../src/contract/worldState.js';
import { createEngine } from '../../src/engine/index.js';
import { buildScenario } from './fixtures.js';

const engine = createEngine();
const fresh = (nationId = 'BRA', bookmarkId = 'b2026') => engine.newGame(buildScenario(), { bookmarkId, nationId, leaderName: 'Teste', seed: 'efeitos' });

test('every contract effect type has a test below', () => {
    assert.deepEqual([...EFFECT_TYPES].sort(), ['bloc', 'crisis', 'flag', 'front', 'modifier', 'news', 'pact', 'pc', 'relation', 'resource', 'tension', 'war']);
});

test('resource: applies, clamps to EFFECT_LIMITS and 0..100, resolves PLAYER and names', () => {
    const s = fresh();
    const before = s.nations.BRA.resources.economy;
    const r = engine.applyEffects(s, [{ type: 'resource', target: 'PLAYER', resource: 'economy', delta: 5 }]);
    assert.equal(r.state.nations.BRA.resources.economy, before + 5);
    assert.deepEqual(r.details, ['Economia +5']);
    const big = engine.applyEffects(s, [{ type: 'resource', target: 'China', resource: 'military', delta: -999 }]);
    assert.equal(big.state.nations.CHN.resources.military, s.nations.CHN.resources.military - EFFECT_LIMITS.resource);
    assert.equal(big.details[0], 'Força Militar da China \u221225');
    const capped = engine.applyEffects(s, [
        { type: 'resource', target: 'BRA', resource: 'stability', delta: 25 },
        { type: 'resource', target: 'BRA', resource: 'stability', delta: 25 },
    ]);
    assert.equal(capped.state.nations.BRA.resources.stability, 100);
    const bad = engine.applyEffects(s, [{ type: 'resource', target: 'BRA', resource: 'gold', delta: 5 }]);
    assert.deepEqual(bad.details, []);
    assert.deepEqual(bad.state.nations.BRA.resources, s.nations.BRA.resources);
});

test('relation: symmetric, clamped to ±50, phrased from the player perspective', () => {
    const s = fresh();
    const r = engine.applyEffects(s, [{ type: 'relation', target: 'PLAYER', targetB: 'CHN', delta: 10 }]);
    assert.equal(getRelation(r.state, 'CHN', 'BRA'), getRelation(s, 'BRA', 'CHN') + 10);
    assert.deepEqual(r.details, ['Relação com a China +10']);
    const r2 = engine.applyEffects(s, [{ type: 'relation', target: 'IND', targetB: 'PAK', delta: -300 }]);
    assert.equal(getRelation(r2.state, 'IND', 'PAK'), Math.max(-100, getRelation(s, 'IND', 'PAK') - EFFECT_LIMITS.relation));
    const same = engine.applyEffects(s, [{ type: 'relation', target: 'BRA', targetB: 'BRA', delta: 10 }]);
    assert.deepEqual(same.details, []);
});

test('tension: clamped per effect and 0..100', () => {
    const s = fresh();
    const r = engine.applyEffects(s, [{ type: 'tension', delta: 50 }]);
    assert.equal(r.state.globalTension, s.globalTension + EFFECT_LIMITS.tension);
    assert.deepEqual(r.details, ['Tensão global +20']);
    const low = engine.applyEffects(s, [{ type: 'tension', delta: -20 }, { type: 'tension', delta: -20 }, { type: 'tension', delta: -20 }]);
    assert.equal(low.state.globalTension, 0);
});

test('pc: adds political capital within 0..30', () => {
    const s = fresh();
    const r = engine.applyEffects(s, [{ type: 'pc', target: 'PLAYER', delta: 5 }]);
    assert.equal(r.state.nations.BRA.pc, s.nations.BRA.pc + 5);
    assert.deepEqual(r.details, ['Capital Político +5']);
    const max = engine.applyEffects(s, [{ type: 'pc', target: 'PLAYER', delta: 99 }]);
    assert.equal(max.state.nations.BRA.pc, 30);
});

test('modifier: clamps perTurn/turns, ticks in endTurn and expires', () => {
    const s = fresh();
    const r = engine.applyEffects(s, [{ type: 'modifier', target: 'PLAYER', label: 'Boom', perTurn: { economy: 9, gold: 3, tech: 0 }, turns: 99 }]);
    const mod = r.state.modifiers.at(-1);
    assert.deepEqual(mod.perTurn, { economy: EFFECT_LIMITS.modifierPerTurn });
    assert.equal(mod.turnsLeft, EFFECT_LIMITS.modifierTurns);
    assert.match(r.details[0], /^Boom: Economia \+5\/mês por 24 meses$/);
    const short = engine.applyEffects(s, [{ type: 'modifier', target: 'PLAYER', label: 'Curto', perTurn: { tech: 2 }, turns: 1 }]);
    const t1 = engine.endTurn(short.state).state;
    assert.equal(t1.modifiers.some((m) => m.label === 'Curto'), false);
    const none = engine.applyEffects(s, [{ type: 'modifier', target: 'PLAYER', perTurn: {}, turns: 3 }]);
    assert.equal(none.state.modifiers.length, s.modifiers.length);
});

test('crisis: start, escalate, deescalate, resolve', () => {
    const s = fresh();
    const a = engine.applyEffects(s, [{ type: 'crisis', action: 'start', title: 'Crise Teste', description: 'x', severity: 'low', involved: ['BRA', 'XXX', 'Índia'], category: 'economy' }]);
    const c = a.state.crises.find((x) => x.title === 'Crise Teste');
    assert.ok(c);
    assert.deepEqual(c.involved, ['BRA', 'IND']);
    assert.equal(c.category, 'economy');
    const b = engine.applyEffects(a.state, [{ type: 'crisis', action: 'escalate', crisisId: c.id }]);
    assert.equal(b.state.crises.find((x) => x.id === c.id).severity, 'medium');
    const d = engine.applyEffects(b.state, [{ type: 'crisis', action: 'deescalate', crisisId: c.id }]);
    assert.equal(d.state.crises.find((x) => x.id === c.id).severity, 'low');
    const e = engine.applyEffects(d.state, [{ type: 'crisis', action: 'resolve', crisisId: c.id }]);
    assert.equal(e.state.crises.some((x) => x.id === c.id), false);
    assert.deepEqual(e.details, ['Crise encerrada: Crise Teste']);
    const unknown = engine.applyEffects(s, [{ type: 'crisis', action: 'escalate', crisisId: 'nao-existe' }]);
    assert.deepEqual(unknown.details, []);
});

test('pact: create bilateral, break bilateral, leave a multi-member pact', () => {
    const s = fresh();
    const a = engine.applyEffects(s, [{ type: 'pact', action: 'create', pactType: 'defense', target: 'PLAYER', targetB: 'IND' }]);
    const p = a.state.pacts.find((x) => x.type === 'defense' && x.members.includes('BRA'));
    assert.ok(p);
    assert.equal(p.name, 'Pacto de Defesa Brasil–Índia');
    const dup = engine.applyEffects(a.state, [{ type: 'pact', action: 'create', pactType: 'defense', target: 'IND', targetB: 'BRA' }]);
    assert.equal(dup.state.pacts.length, a.state.pacts.length);
    const b = engine.applyEffects(a.state, [{ type: 'pact', action: 'break', pactType: 'defense', target: 'BRA', targetB: 'IND' }]);
    assert.equal(b.state.pacts.some((x) => x.id === p.id), false);
    const c = engine.applyEffects(s, [{ type: 'pact', action: 'break', pactType: 'alliance', target: 'POL', targetB: 'USA' }]);
    const otan = c.state.pacts.find((x) => x.id === 'otan');
    assert.deepEqual(otan.members, ['USA', 'FRA', 'DEU']);
});

test('war: declare creates fronts, ceasefire freezes, peace ends it', () => {
    const s = fresh();
    const a = engine.applyEffects(s, [{ type: 'war', action: 'declare', target: 'IND', targetB: 'PAK' }]);
    const w = a.state.wars.find((x) => x.attackers[0] === 'IND');
    assert.ok(w);
    assert.deepEqual(w.fronts, [{ attacker: 'IND', defender: 'PAK', progress: 0 }]);
    assert.ok(a.state.globalTension > s.globalTension);
    const b = engine.applyEffects(a.state, [{ type: 'war', action: 'ceasefire', target: 'PAK', targetB: 'IND' }]);
    assert.equal(b.state.wars.find((x) => x.id === w.id).ceasefire, true);
    const c = engine.applyEffects(b.state, [{ type: 'war', action: 'peace', target: 'IND', targetB: 'PAK', terms: 'whitePeace' }]);
    assert.equal(c.state.wars.some((x) => x.id === w.id), false);
    assert.ok(c.state.pacts.some((p) => p.type === 'nonAggression' && p.members.includes('IND') && p.members.includes('PAK')));
});

test('front: pushes occupation and flips when pushed back below zero', () => {
    const s = fresh();
    const a = engine.applyEffects(s, [{ type: 'front', target: 'RUS', targetB: 'UKR', delta: 10 }]);
    assert.equal(a.state.wars[0].fronts[0].progress, 28);
    assert.match(a.details[0], /Frente Rússia → Ucrânia: ocupação 28%/);
    const b = engine.applyEffects(s, [{ type: 'front', target: 'UKR', targetB: 'RUS', delta: 25 }]);
    const f = b.state.wars[0].fronts[0];
    assert.deepEqual([f.attacker, f.defender, f.progress], ['UKR', 'RUS', 7]);
    const none = engine.applyEffects(s, [{ type: 'front', target: 'BRA', targetB: 'IND', delta: 10 }]);
    assert.deepEqual(none.details, []);
});

test('bloc, flag, news', () => {
    const s = fresh();
    const a = engine.applyEffects(s, [
        { type: 'bloc', target: 'PLAYER', bloc: 'OTAN' },
        { type: 'flag', key: 'acordoAmazonia', value: 'assinado' },
        { type: 'flag', key: '_engine', value: 1 },
        { type: 'news', text: 'Brasil anuncia nova política externa' },
    ]);
    assert.equal(a.state.nations.BRA.bloc, 'NATO');
    assert.equal(a.state.flags.acordoAmazonia, 'assinado');
    assert.equal('_engine' in a.state.flags, false);
    assert.equal(a.state.news.at(-1).text, 'Brasil anuncia nova política externa');
    assert.deepEqual(a.details, ['Brasil passa ao bloco OTAN']);
});

test('applyEffects never throws, skips garbage and never mutates its input', () => {
    const s = fresh();
    const snapshot = structuredClone(s);
    const garbage = [null, 42, 'x', [], {}, { type: 'nuke' }, { type: 'resource' }, { type: 'war', action: 'declare', target: 'ZZZ', targetB: 'BRA' }, { type: 'relation', target: {}, targetB: [] }, { type: 'tension', delta: 'muito' }];
    const r = engine.applyEffects(s, garbage);
    assert.deepEqual(r.details, []);
    assert.deepEqual(s, snapshot);
    assert.doesNotThrow(() => engine.applyEffects(s, 'not an array'));
    assert.doesNotThrow(() => engine.applyEffects(null, []));
    assert.deepEqual(engine.applyEffects(s, null).details, []);
});
