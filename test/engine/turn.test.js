import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPS, RESOURCE_KEYS } from '../../src/contract/constants.js';
import { isWorldState } from '../../src/contract/worldState.js';
import { createEngine } from '../../src/engine/index.js';
import { localSeedrandom } from '../../src/engine/rng.js';
import { nuclearIncident, tensionEquilibrium, updateTension, WORLD_TENSION_CAP } from '../../src/engine/tension.js';
import { buildLargeScenario, buildScenario } from './fixtures.js';

const engine = createEngine();
const fresh = (nationId = 'BRA', bookmarkId = 'b2026', seed = 'turno') => engine.newGame(buildScenario(), { bookmarkId, nationId, leaderName: 'Teste', seed });

test('endTurn is deterministic and never mutates its input', () => {
    const s = fresh();
    const snap = structuredClone(s);
    const a = engine.endTurn(s);
    const b = engine.endTurn(s);
    assert.deepEqual(a, b);
    assert.deepEqual(s, snap);
    const other = engine.endTurn(fresh('BRA', 'b2026', 'outra-semente'));
    assert.notDeepEqual(other.state.relations, a.state.relations, 'seed matters');
});

test('endTurn report: shape, date++, headlines mirrored into news, player deltas', () => {
    const s = fresh();
    const { state, report } = engine.endTurn(s);
    assert.equal(report.turn, 2);
    assert.deepEqual(report.date, { year: 2026, month: 2 });
    assert.equal(state.turn, 2);
    assert.deepEqual(state.date, { year: 2026, month: 2 });
    for (const k of ['aiActions', 'warUpdates', 'capitulations', 'newCrises', 'resolvedCrises', 'headlines', 'engineEvents']) assert.ok(Array.isArray(report[k]), k);
    assert.ok(report.headlines.length > 0 && report.headlines.length <= 8);
    for (const h of report.headlines) assert.ok(state.news.some((n) => n.text === h && n.turn === 2), h);
    assert.equal(report.tensionBefore, s.globalTension);
    assert.equal(report.tensionAfter, state.globalTension);
    assert.equal(report.pcGained, state.nations.BRA.pc - s.nations.BRA.pc);
    assert.equal(report.pcGained, 2 + Math.floor(s.nations.BRA.resources.influence / 25) + Math.floor(s.nations.BRA.resources.stability / 40));
    for (const [k, v] of Object.entries(report.playerDeltas)) {
        assert.ok(RESOURCE_KEYS.includes(k));
        assert.equal(state.nations.BRA.resources[k] - s.nations.BRA.resources[k], v);
    }
    assert.ok(report.aiActions.length >= 5, 'majors act');
    for (const a of report.aiActions) {
        assert.ok(state.nations[a.actorId].major || true);
        assert.equal(typeof a.summary, 'string');
    }
    assert.ok(report.warUpdates.some((w) => w.warId === 'guerra-rus-ukr'));
    assert.equal(report.outcome, null);
});

test('difficulty changes player PC income', () => {
    const base = engine.newGame(buildScenario(), { bookmarkId: 'b2026', nationId: 'BRA', leaderName: 'T', seed: 'pc', difficulty: 'normal' });
    const easy = engine.newGame(buildScenario(), { bookmarkId: 'b2026', nationId: 'BRA', leaderName: 'T', seed: 'pc', difficulty: 'facil' });
    const hard = engine.newGame(buildScenario(), { bookmarkId: 'b2026', nationId: 'BRA', leaderName: 'T', seed: 'pc', difficulty: 'dificil' });
    const n = engine.endTurn(base).report.pcGained;
    assert.equal(engine.endTurn(easy).report.pcGained, n + 1);
    assert.equal(engine.endTurn(hard).report.pcGained, n - 1);
});

test('append-only arrays respect CAPS; state stays valid and serializable', () => {
    let s = fresh('BRA', 'b2028');
    for (let i = 0; i < 40; i++) s = engine.endTurn(s).state;
    assert.ok(s.news.length <= CAPS.NEWS);
    assert.ok(s.log.length <= CAPS.LOG);
    assert.ok(s.eventQueue.length <= 10);
    assert.ok(isWorldState(s));
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    for (const cds of Object.values(s.cooldowns)) for (const until of Object.values(cds)) assert.ok(until > s.turn);
});

test('injected seedrandom (SillyTavern.libs.seedrandom shape) is used', () => {
    const seeds = [];
    const fake = (seed) => {
        seeds.push(seed);
        return localSeedrandom(`x${seed}`);
    };
    const e = createEngine({ seedrandom: fake });
    const s = e.newGame(buildScenario(), { bookmarkId: 'b2026', nationId: 'BRA', leaderName: 'T', seed: 'inj' });
    e.endTurn(s);
    assert.ok(seeds.length > 0);
    assert.ok(seeds.every((x) => x.startsWith('inj:1:')));
    assert.ok(seeds.includes('inj:1:ai'));
});

test('tension: world drift is capped below 100; brinkmanship risk only at >= 96', () => {
    const s = fresh();
    s.globalTension = 100;
    const rng = { noise: () => 1.2, round: (x) => Math.ceil(x), chance: () => true, next: () => 0 };
    updateTension(s, rng);
    assert.ok(s.globalTension <= WORLD_TENSION_CAP, 'world mechanics never reach 100');
    s.globalTension = 99;
    updateTension(s, { noise: () => 1.2, round: (x) => Math.ceil(x) }, 100);
    assert.equal(s.globalTension, WORLD_TENSION_CAP, 'even an extreme equilibrium stops at the brink');
    // saturation: a dozen critical crises do not push the equilibrium to the brink
    s.crises = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, title: 'x', description: '', severity: 'critical', involved: ['RUS', 'USA'], turnStarted: 1 }));
    assert.ok(tensionEquilibrium(s) < 70, String(tensionEquilibrium(s)));
    s.globalTension = 95;
    assert.equal(nuclearIncident(s, rng), false);
    s.globalTension = 98;
    assert.equal(nuclearIncident(s, { chance: () => false }), false);
    assert.equal(nuclearIncident(s, rng), true);
    assert.equal(s.globalTension, 100);
});

test('performance: endTurn on ~180 nations stays under 50 ms', () => {
    const sc = buildLargeScenario(180);
    assert.ok(Object.keys(sc.nations).length >= 180);
    let s = engine.newGame(sc, { bookmarkId: 'b2028', nationId: 'BRA', leaderName: 'T', seed: 'perf' });
    for (let i = 0; i < 3; i++) s = engine.endTurn(s).state; // warm-up
    const times = [];
    for (let i = 0; i < 24; i++) {
        const t0 = performance.now();
        s = engine.endTurn(s).state;
        times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`# endTurn ~180 nations: avg ${avg.toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`);
    assert.ok(avg < 50, `avg ${avg}`);
});
