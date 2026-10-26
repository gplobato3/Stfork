import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEMA_VERSION } from '../../src/contract/constants.js';
import { RELATION_TIERS, WAR_TIER } from '../../src/contract/presentation.js';
import { addMonths, isWorldState } from '../../src/contract/worldState.js';
import { createEngine } from '../../src/engine/index.js';
import { buildScenario } from './fixtures.js';

const engine = createEngine();
const opts = (o = {}) => ({ bookmarkId: 'b2026', nationId: 'BRA', leaderName: 'Ana Souza', seed: 'estado', ...o });

test('newGame: player, dates, tension, nation defaults and empty arrays', () => {
    const sc = buildScenario();
    const snap = structuredClone(sc);
    const s = engine.newGame(sc, opts());
    assert.deepEqual(sc, snap, 'scenario not mutated');
    assert.equal(s.schemaVersion, SCHEMA_VERSION);
    assert.ok(isWorldState(s));
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'JSON-serializable');
    assert.deepEqual(s.player, { nationId: 'BRA', leaderName: 'Ana Souza', title: 'Presidente', difficulty: 'normal' });
    assert.deepEqual(s.date, { year: 2026, month: 1 });
    assert.deepEqual(s.endDate, { year: 2036, month: 1 });
    assert.equal(s.globalTension, 42);
    assert.equal(s.turn, 1);
    assert.equal(s.phase, 'PLAYER_TURN');
    assert.equal(s.bookmarkId, 'b2026');
    assert.equal(s.scenarioId, 'teste-ww3');
    for (const [id, n] of Object.entries(s.nations)) {
        assert.equal(n.status, 'active');
        assert.equal(n.controller, id);
        assert.equal(n.overlord, null);
        assert.ok(n.pc >= 0 && n.pc <= 30);
    }
    assert.equal(s.nations.BRA.pc, 9);
    for (const k of ['modifiers', 'eventQueue', 'recentActions', 'decisions']) assert.deepEqual(s[k], []);
    assert.equal(s.pendingEvent, null);
    assert.equal(s.outcome, null);
    assert.ok(s.news.length === 1 && s.news[0].text === 'Presidente Ana Souza assume o governo do Brasil');
    assert.deepEqual(s.neighbors.PAK, ['CHN', 'IND', 'IRN']);
    assert.ok(s.neighbors.IRN.includes('PAK'), 'symmetric');
    assert.deepEqual(engine.newGame(buildScenario(), opts()), s, 'deterministic');
    assert.equal(engine.newGame(buildScenario(), opts({ difficulty: 'facil' })).nations.BRA.pc, 12);
    assert.equal(engine.newGame(buildScenario(), opts({ difficulty: 'dificil' })).nations.BRA.pc, 6);
    assert.equal(engine.newGame(buildScenario(), opts({ nationId: 'JPN' })).player.title, 'Primeiro-Ministro');
    assert.throws(() => engine.newGame(buildScenario(), opts({ nationId: 'XXX' })), /nação desconhecida/);
});

test('newGame: bookmark overrides replace wars/crises and patch nations/relations', () => {
    const s = engine.newGame(buildScenario(), opts({ bookmarkId: 'b2031', nationId: 'USA' }));
    assert.deepEqual(s.date, { year: 2031, month: 3 });
    assert.equal(s.globalTension, 84);
    assert.deepEqual(s.wars.map((w) => w.id).sort(), ['ww3-europa', 'ww3-pacifico']);
    assert.deepEqual(s.crises.map((c) => c.id).sort(), ['crise-bloqueio', 'crise-nuclear-europa']);
    assert.equal(s.nations.RUS.resources.warSupport, 75);
    assert.equal(s.nations.RUS.resources.economy, 40);
    assert.equal(s.nations.RUS.resources.military, 82, 'untouched keys keep base values');
    assert.equal(s.relations['RUS|USA'], -90);
    assert.equal(s.pacts.length, buildScenario().pacts.length, 'pacts not overridden');
    const eu = s.wars.find((w) => w.id === 'ww3-europa');
    assert.ok(eu.fronts.some((f) => f.attacker === 'RUS' && f.defender === 'UKR' && f.progress === 40));
    assert.ok(eu.fronts.length > 3, 'missing reachable pairs get fronts');
    const b28 = engine.newGame(buildScenario(), opts({ bookmarkId: 'b2028' }));
    assert.equal(b28.relations['CHN|TWN'], -85);
    assert.ok(b28.crises.some((c) => c.title === 'Bloqueio Naval de Taiwan'));
    assert.equal(b28.wars.length, 1, 'base wars kept when the bookmark has no wars override');
});

test('migrate: v2 states pass (missing optional arrays filled), v1 and garbage are null', () => {
    const s = engine.newGame(buildScenario(), opts());
    const m = engine.migrate(s);
    assert.ok(isWorldState(m));
    assert.notEqual(m, s);
    const partial = structuredClone(s);
    delete partial.news;
    delete partial.eventQueue;
    delete partial.modifiers;
    delete partial.neighbors;
    delete partial.engine;
    const m2 = engine.migrate(partial);
    assert.deepEqual(m2.news, []);
    assert.deepEqual(m2.eventQueue, []);
    assert.deepEqual(m2.modifiers, []);
    assert.ok(m2.engine && m2.engine.base.BRA);
    assert.doesNotThrow(() => engine.endTurn(m2));
    const v1 = { schemaVersion: 1, campaignId: 'c', turn: 3, date: { year: 2027, month: 1 }, player: { nationId: 'BRA' }, nations: {}, wars: [], crises: [], phase: 'PLAYER_TURN', activeCrises: [] };
    assert.equal(engine.migrate(v1), null);
    for (const g of [null, undefined, 0, 'save', [], {}, { schemaVersion: 2 }]) assert.equal(engine.migrate(g), null);
});

test('getNationView and getRanking', () => {
    const s = engine.newGame(buildScenario(), opts({ nationId: 'UKR' }));
    const rus = engine.getNationView(s, 'RUS');
    assert.deepEqual(Object.keys(rus).sort(), ['allies', 'atWarWith', 'controller', 'crises', 'nation', 'occupation', 'occupier', 'pacts', 'power', 'relationTier', 'relationToPlayer'].sort());
    assert.equal(rus.relationTier, WAR_TIER.id);
    assert.deepEqual(rus.atWarWith, ['UKR']);
    assert.deepEqual(rus.allies, ['BLR']);
    const ukr = engine.getNationView(s, 'UKR');
    assert.equal(ukr.occupation, 18);
    assert.equal(ukr.occupier, 'RUS');
    const pol = engine.getNationView(s, 'POL');
    assert.equal(pol.relationTier, 'aliado');
    assert.equal(pol.relationToPlayer, 70);
    assert.deepEqual(pol.allies, ['DEU', 'FRA', 'USA']);
    assert.ok(RELATION_TIERS.some((t) => t.id === engine.getNationView(s, 'BRA').relationTier));
    assert.equal(engine.getNationView(s, 'IRN').relationTier, 'neutro');
    assert.equal(engine.getNationView(s, 'XXX'), null);
    const view = engine.getNationView(s, 'BRA');
    view.nation.name = 'mutated';
    assert.equal(s.nations.BRA.name, 'Brasil', 'view is a copy');

    const ranking = engine.getRanking(s);
    assert.equal(ranking.length, 15);
    assert.equal(ranking[0].id, 'USA');
    for (let i = 1; i < ranking.length; i++) assert.ok(ranking[i - 1].power >= ranking[i].power);
    assert.deepEqual(Object.keys(ranking[0]).sort(), ['id', 'name', 'power']);
    s.nations.BLR.status = 'annexed';
    assert.equal(engine.getRanking(s).some((r) => r.id === 'BLR'), false);
});

test('outcome: global nuclear war (tension 100) is defeat for everyone', () => {
    const s = engine.newGame(buildScenario(), opts());
    const r = engine.applyEffects(s, [{ type: 'tension', delta: 20 }, { type: 'tension', delta: 20 }, { type: 'tension', delta: 20 }]);
    assert.equal(r.state.globalTension, 100);
    assert.equal(r.state.outcome.kind, 'defeat');
    assert.match(r.state.outcome.reason, /^Guerra nuclear global/);
    assert.equal(r.state.phase, 'GAME_OVER');
    const after = engine.executeAction(r.state, 'BRA', 'eco_stimulus');
    assert.equal(after.result.ok, false);
    assert.ok(after.result.reasons.includes('A campanha terminou'));
    const t = engine.endTurn(r.state);
    assert.equal(t.state.turn, r.state.turn, 'no turns after game over');
    assert.equal(t.report.outcome.kind, 'defeat');
});

test('outcome: world mechanics alone stop at the brink (99)', () => {
    let s = engine.newGame(buildScenario(), opts());
    s.globalTension = 99;
    s = engine.applyEffects(s, [{ type: 'crisis', action: 'start', title: 'Crise máxima', severity: 'critical', involved: ['RUS', 'USA'] }]).state;
    assert.ok(s.globalTension <= 100);
});

test('outcome: coup after two months at zero stability', () => {
    let s = engine.newGame(buildScenario(), opts());
    s.nations.BRA.resources.stability = 0;
    s.engine.base.BRA.stability = 0;
    s = engine.endTurn(s).state;
    assert.equal(s.outcome, null);
    s.nations.BRA.resources.stability = 0;
    const { state, report } = engine.endTurn(s);
    assert.equal(report.outcome.kind, 'defeat');
    assert.match(state.outcome.reason, /^Golpe de Estado/);
});

test('outcome: survival victory at endDate with a score', () => {
    const s = engine.newGame(buildScenario(), opts());
    s.endDate = addMonths(s.date, 1);
    const { state, report } = engine.endTurn(s);
    assert.equal(report.outcome.kind, 'victory');
    assert.match(state.outcome.reason, /^Sobrevivência: o Brasil chegou a Fevereiro de 2026 na \d+ª posição do ranking de poder\. Pontuação: \d+\.$/);
    assert.equal(state.outcome.turn, 2);
});

test('outcome: Hegemonia when every enemy capitulated and the player is rank 1', () => {
    let s = engine.newGame(buildScenario(), opts({ nationId: 'USA' }));
    s = engine.applyEffects(s, [{ type: 'war', action: 'declare', target: 'USA', targetB: 'IRN' }]).state;
    s.wars.find((w) => w.attackers[0] === 'USA').fronts[0].progress = 99;
    for (const k of ['military', 'economy', 'manpower', 'warSupport', 'tech']) s.nations.IRN.resources[k] = 1;
    s.engine.base.IRN = { ...s.nations.IRN.resources };
    let r = engine.endTurn(s);
    assert.deepEqual(r.report.capitulations, ['IRN']);
    assert.equal(r.state.outcome && r.state.outcome.kind, 'victory');
    assert.match(r.state.outcome.reason, /^Hegemonia/);
    // annexed player => defeat
    const lost = engine.newGame(buildScenario(), opts({ nationId: 'UKR' }));
    lost.nations.UKR.status = 'annexed';
    lost.nations.UKR.controller = 'RUS';
    r = engine.endTurn(lost);
    assert.match(r.state.outcome.reason, /^A Ucrânia foi anexada pela Rússia/);
});
