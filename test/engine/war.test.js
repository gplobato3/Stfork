import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRelation } from '../../src/contract/worldState.js';
import { createEngine } from '../../src/engine/index.js';
import { buildScenario } from './fixtures.js';

const engine = createEngine();
const fresh = (nationId = 'BRA', bookmarkId = 'b2026', seed = 'guerra') => engine.newGame(buildScenario(), { bookmarkId, nationId, leaderName: 'Teste', seed });

/** Makes `id` militarily irrelevant so fronts against it collapse quickly. */
function cripple(state, id) {
    for (const k of ['military', 'economy', 'manpower', 'warSupport', 'tech']) state.nations[id].resources[k] = 1;
    state.engine.base[id] = { ...state.nations[id].resources };
}

test('declare war (action): creates the war with one front per reachable pair and side effects', () => {
    const s = fresh('IND');
    const r = engine.executeAction(s, 'IND', 'dip_declare_war', 'PAK');
    assert.equal(r.result.ok, true, r.result.reasons && r.result.reasons.join());
    const w = r.state.wars.find((x) => x.attackers.includes('IND'));
    assert.ok(w);
    assert.equal(w.name, 'Guerra Índia–Paquistão');
    assert.deepEqual(w.defenders, ['PAK']);
    assert.deepEqual(w.fronts, [{ attacker: 'IND', defender: 'PAK', progress: 0 }]);
    assert.deepEqual(w.exhaustion, { IND: 0, PAK: 0 });
    assert.equal(getRelation(r.state, 'IND', 'PAK'), Math.max(-100, getRelation(s, 'IND', 'PAK') - 40));
    assert.ok(r.state.globalTension >= s.globalTension + 10, 'nuclear powers on both sides');
    assert.ok(r.state.news.some((n) => n.text === 'Índia declara guerra ao Paquistão'));
    assert.equal(r.state.nations.IND.pc, s.nations.IND.pc - 6);
});

test('major powers project force: fronts against non-neighbors', () => {
    const s = fresh();
    const r = engine.applyEffects(s, [{ type: 'war', action: 'declare', target: 'USA', targetB: 'IRN' }]);
    const w = r.state.wars.find((x) => x.attackers[0] === 'USA');
    assert.deepEqual(w.fronts, [{ attacker: 'USA', defender: 'IRN', progress: 0 }]);
});

test('fronts move every month and exhaustion grows', () => {
    let s = fresh();
    const start = s.wars[0].fronts[0].progress;
    const exh = s.wars[0].exhaustion.UKR;
    const first = engine.endTurn(s).state;
    assert.ok(first.wars[0].exhaustion.UKR > exh, 'exhaustion grows while fighting');
    const seen = new Set([start]);
    for (let i = 0; i < 6; i++) {
        const { state, report } = engine.endTurn(s);
        s = state;
        if (s.wars[0]) seen.add(`${s.wars[0].fronts[0].attacker}:${s.wars[0].fronts[0].progress}`);
        assert.ok(report.warUpdates.length <= s.wars.length + 1);
    }
    assert.ok(seen.size > 2, 'front progress changed');
});

/** Player IND at war with non-nuclear IRN, IRN on the verge of collapse. */
function indiaWinning() {
    let s = fresh('IND');
    s = engine.applyEffects(s, [{ type: 'war', action: 'declare', target: 'IND', targetB: 'IRN' }]).state;
    s.wars.find((w) => w.attackers[0] === 'IND').fronts[0].progress = 99;
    cripple(s, 'IRN');
    return s;
}

test('capitulation with the player as winning attacker queues "Termos de Paz"; annex recolors the map', () => {
    const s = indiaWinning();
    const { state, report } = engine.endTurn(s);
    assert.deepEqual(report.capitulations, ['IRN']);
    assert.equal(state.nations.IRN.status, 'capitulated');
    assert.equal(state.wars.some((w) => w.defenders.includes('IRN')), false);
    const ev = report.engineEvents.find((e) => e.title === 'Termos de Paz: Irã');
    assert.ok(ev, 'peace terms event');
    assert.equal(ev.source, 'engine');
    assert.equal(ev.options.length, 4);
    assert.ok(state.eventQueue.some((e) => e.id === ev.id));
    assert.ok(report.headlines.includes('Irã capitula diante da Índia'));
    const annexed = engine.resolvePendingEvent(state, 0);
    assert.equal(annexed.state.nations.IRN.status, 'annexed');
    assert.equal(annexed.state.nations.IRN.controller, 'IND');
    assert.equal(engine.getNationView(annexed.state, 'IRN').controller, 'IND');
    assert.ok(engine.getRanking(annexed.state).every((r) => r.id !== 'IRN'));
    assert.equal(annexed.state.crises.some((c) => c.involved.includes('IRN')), false);
    assert.ok(annexed.state.nations.IND.resources.economy >= state.nations.IND.resources.economy);
    assert.ok(annexed.details.some((d) => /anexação/.test(d)), annexed.details.join(' | '));
});

test('puppet terms: overlord set, bloc aligned, still self-controlled', () => {
    const { state } = engine.endTurn(indiaWinning());
    const r = engine.resolvePendingEvent(state, 1);
    assert.equal(r.state.nations.IRN.status, 'puppet');
    assert.equal(r.state.nations.IRN.overlord, 'IND');
    assert.equal(r.state.nations.IRN.bloc, 'BRICS');
    assert.equal(r.state.nations.IRN.controller, 'IRN');
    assert.equal(engine.getAvailableActions(r.state, 'IND', 'IRN').find((a) => a.def.id === 'dip_send_aid').available, false);
});

test('nuclear powers cannot be conquered conventionally (front capped below capitulation)', () => {
    let s = fresh('IND');
    s = engine.executeAction(s, 'IND', 'dip_declare_war', 'PAK').state;
    s.wars.find((w) => w.attackers[0] === 'IND').fronts[0].progress = 99;
    cripple(s, 'PAK');
    const { state, report } = engine.endTurn(s);
    assert.deepEqual(report.capitulations, []);
    assert.equal(state.nations.PAK.status, 'active');
});

test('AI winner dictates terms by personality; Russia takes Ukraine', () => {
    const s = fresh('BRA');
    s.wars[0].fronts[0].progress = 99;
    cripple(s, 'UKR');
    const { state, report } = engine.endTurn(s);
    assert.deepEqual(report.capitulations, ['UKR']);
    assert.ok(['annexed', 'puppet'].includes(state.nations.UKR.status), state.nations.UKR.status);
    assert.equal(state.wars.length, 0);
    assert.equal(report.engineEvents.some((e) => e.title.startsWith('Termos de Paz')), false);
});

test('player capitulation means defeat', () => {
    const s = fresh('UKR');
    s.wars[0].fronts[0].progress = 99;
    cripple(s, 'UKR');
    const { state, report } = engine.endTurn(s);
    assert.equal(report.outcome.kind, 'defeat');
    assert.match(report.outcome.reason, /A Ucrânia capitulou/);
    assert.equal(state.phase, 'GAME_OVER');
});

test('call to arms: the player gets "Chamado às Armas"; honoring it joins the war', () => {
    let s = fresh('POL');
    s = engine.applyEffects(s, [{ type: 'war', action: 'declare', target: 'RUS', targetB: 'DEU' }]).state;
    const { state, report } = engine.endTurn(s);
    const cta = report.engineEvents.find((e) => e.title === 'Chamado às Armas');
    assert.ok(cta, 'call to arms event');
    assert.deepEqual(cta.involved, ['DEU', 'RUS']);
    const war = state.wars.find((w) => w.defenders[0] === 'DEU');
    for (const m of ['USA', 'FRA', 'POL']) assert.ok(war.called.includes(m), m);
    const s2 = engine.setPendingEvent(state, cta);
    const joined = engine.resolvePendingEvent(s2, 0);
    const w2 = joined.state.wars.find((w) => w.id === war.id);
    assert.ok(w2.defenders.includes('POL'));
    assert.ok(w2.fronts.some((f) => (f.attacker === 'RUS' && f.defender === 'POL') || (f.attacker === 'POL' && f.defender === 'RUS')));
    // refusing costs relation and influence
    const refused = engine.resolvePendingEvent(s2, 2);
    assert.equal(getRelation(refused.state, 'POL', 'DEU'), getRelation(s2, 'POL', 'DEU') - 20);
    assert.equal(refused.state.nations.POL.resources.influence, s2.nations.POL.resources.influence - 5);
});

test('AI allies decide calls to arms by bloc loyalty (deterministic per seed)', () => {
    const s = fresh('BRA');
    const a = engine.applyEffects(s, [{ type: 'war', action: 'declare', target: 'RUS', targetB: 'POL' }]).state;
    const r1 = engine.endTurn(a);
    const r2 = engine.endTurn(a);
    assert.deepEqual(r1.state.wars, r2.state.wars);
    const war = r1.state.wars.find((w) => w.defenders[0] === 'POL');
    for (const m of ['USA', 'FRA', 'DEU']) assert.ok(war.called.includes(m));
    assert.ok(war.defenders.length >= 2, 'at least one loyal ally joined');
});

test('ceasefire freezes fronts and becomes an armistice after 12 months', () => {
    let s = fresh();
    s = engine.applyEffects(s, [{ type: 'war', action: 'ceasefire', target: 'UKR', targetB: 'RUS' }]).state;
    const p = s.wars[0].fronts[0].progress;
    for (let i = 0; i < 11; i++) {
        s = engine.endTurn(s).state;
        assert.equal(s.wars[0].fronts[0].progress, p);
    }
    const { state, report } = engine.endTurn(s);
    assert.equal(state.wars.length, 0);
    assert.ok(report.headlines.includes('Armistício encerra a Guerra Russo-Ucraniana'));
    assert.ok(state.pacts.some((x) => x.type === 'nonAggression' && x.members.includes('RUS') && x.members.includes('UKR')));
});

test('peace: whole war ends between leaders; truce blocks a new declaration', () => {
    const s = fresh('UKR');
    const r = engine.applyEffects(s, [{ type: 'war', action: 'peace', target: 'UKR', targetB: 'RUS', terms: 'annex' }]);
    assert.equal(r.state.wars.length, 0);
    assert.equal(r.state.nations.RUS.status, 'active', 'annex downgraded: no occupation');
    const s2 = structuredClone(r.state);
    s2.nations.RUS.pc = 30;
    const av = engine.getAvailableActions(s2, 'RUS', 'UKR').find((a) => a.def.id === 'dip_declare_war');
    assert.ok(av.reasons.includes('Já existe um pacto de não agressão com a Ucrânia'), av.reasons.join(' | '));
});

test('nuclear deterrence: conventional fronts never pass 50% of a strategic nuclear power', () => {
    let s = fresh();
    s.wars[0].fronts[0] = { attacker: 'UKR', defender: 'RUS', progress: 45 };
    cripple(s, 'RUS');
    for (let i = 0; i < 8 && s.wars[0]; i++) {
        s = engine.endTurn(s).state;
        const f = s.wars[0] && s.wars[0].fronts[0];
        if (f && f.defender === 'RUS') assert.ok(f.progress <= 50, String(f.progress));
    }
});

test('separate peace: a co-belligerent leaves, the war goes on', () => {
    let s = fresh();
    s.wars[0].called.push('POL'); // POL was called to arms in the Russia-Ukraine war
    s = engine.applyEffects(s, [{ type: 'war', action: 'declare', target: 'POL', targetB: 'RUS' }]).state;
    assert.equal(s.wars.length, 1, 'joined instead of opening a new war');
    const joined = s.wars[0];
    assert.ok(joined.defenders.includes('POL'));
    const r = engine.applyEffects(s, [{ type: 'war', action: 'peace', target: 'POL', targetB: 'RUS' }]);
    const w = r.state.wars.find((x) => x.id === joined.id);
    assert.ok(w, 'war continues');
    assert.equal(w.defenders.includes('POL') || w.attackers.includes('POL'), false);
});
