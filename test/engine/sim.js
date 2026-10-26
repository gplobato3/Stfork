/**
 * @file test/engine/sim.js
 * Passive-player balance simulation (DESIGN §3.9). Used by balance.test.js and
 * runnable directly for tuning:  node test/engine/sim.js --run [turns] [seeds] [large]
 */

import { isWorldState } from '../../src/contract/worldState.js';
import { createEngine } from '../../src/engine/index.js';
import { buildLargeScenario, buildScenario } from './fixtures.js';

/**
 * Runs one campaign with a passive player (never acts, never answers decisions).
 * @returns {Object} stats
 */
export function simulate(engine, scenario, { bookmarkId, nationId, seed, turns = 120, checkEvery = 30 }) {
    let state = engine.newGame(scenario, { bookmarkId, nationId, leaderName: 'Simulação', seed });
    const st = {
        bookmarkId,
        seed,
        nationId,
        turnsPlayed: 0,
        tensionStart: state.globalTension,
        tensionMin: state.globalTension,
        tensionMax: state.globalTension,
        tensionEnd: state.globalTension,
        actions: new Map(),
        warsSeen: new Set(state.wars.map((w) => w.id)),
        initialWars: state.wars.length,
        warsStarted: 0,
        warsEnded: 0,
        frontMoves: 0,
        capitulations: 0,
        annexed: 0,
        puppets: 0,
        crisesStarted: 0,
        engineEvents: 0,
        nuclearTurn: null,
        outcome: null,
        invalid: 0,
        ms: 0,
    };
    let prevFronts = frontMap(state);
    for (let i = 0; i < turns; i++) {
        if (state.outcome) break;
        const t0 = performance.now();
        const { state: next, report } = engine.endTurn(state);
        st.ms += performance.now() - t0;
        state = next;
        st.turnsPlayed++;
        st.tensionMin = Math.min(st.tensionMin, state.globalTension);
        st.tensionMax = Math.max(st.tensionMax, state.globalTension);
        for (const a of report.aiActions) st.actions.set(a.actionId, (st.actions.get(a.actionId) || 0) + 1);
        const ids = new Set(state.wars.map((w) => w.id));
        for (const id of ids) if (!st.warsSeen.has(id)) {
            st.warsSeen.add(id);
            st.warsStarted++;
        }
        st.warsEnded += [...prevWarIds(prevFronts)].filter((id) => !ids.has(id)).length;
        const fm = frontMap(state);
        for (const [k, v] of fm) if (prevFronts.has(k) && prevFronts.get(k) !== v) st.frontMoves++;
        prevFronts = fm;
        st.capitulations += report.capitulations.length;
        st.crisesStarted += report.newCrises.length;
        st.engineEvents += report.engineEvents.length;
        if (report.outcome && /nuclear/i.test(report.outcome.reason)) st.nuclearTurn = state.turn;
        if (checkEvery && st.turnsPlayed % checkEvery === 0) {
            if (!isWorldState(state)) st.invalid++;
            const round = JSON.parse(JSON.stringify(state));
            if (JSON.stringify(round) !== JSON.stringify(state) || !isWorldState(round)) st.invalid++;
        }
    }
    st.tensionEnd = state.globalTension;
    st.outcome = state.outcome;
    st.annexed = Object.values(state.nations).filter((n) => n.status === 'annexed').length;
    st.puppets = Object.values(state.nations).filter((n) => n.status === 'puppet').length;
    st.finalState = state;
    if (!isWorldState(state)) st.invalid++;
    try {
        JSON.parse(JSON.stringify(state));
    } catch {
        st.invalid++;
    }
    return st;
}

function frontMap(state) {
    const m = new Map();
    for (const w of state.wars) for (const f of w.fronts) m.set(`${w.id}|${[f.attacker, f.defender].sort().join('-')}`, `${f.attacker}:${f.progress}`);
    return m;
}

function prevWarIds(fm) {
    const s = new Set();
    for (const k of fm.keys()) s.add(k.split('|')[0]);
    return s;
}

/** Aggregates runs for one bookmark. */
export function summarize(runs) {
    const n = runs.length;
    const actions = new Map();
    for (const r of runs) for (const [k, v] of r.actions) actions.set(k, (actions.get(k) || 0) + v);
    const avg = (f) => Math.round((runs.reduce((s, r) => s + f(r), 0) / n) * 10) / 10;
    return {
        runs: n,
        distinctActions: actions.size,
        actions,
        nuclearBefore36: runs.filter((r) => r.nuclearTurn !== null && r.nuclearTurn < 36).length,
        nuclearAny: runs.filter((r) => r.nuclearTurn !== null).length,
        avgTensionMin: avg((r) => r.tensionMin),
        avgTensionMax: avg((r) => r.tensionMax),
        avgTensionEnd: avg((r) => r.tensionEnd),
        tensionMoved: runs.filter((r) => r.tensionMax - r.tensionMin >= 8).length,
        avgWarsStarted: avg((r) => r.warsStarted),
        avgWarsEnded: avg((r) => r.warsEnded),
        runsWithFrontMoves: runs.filter((r) => r.frontMoves > 0).length,
        avgCapitulations: avg((r) => r.capitulations),
        avgAnnexed: avg((r) => r.annexed),
        avgPuppets: avg((r) => r.puppets),
        avgCrises: avg((r) => r.crisesStarted),
        avgEngineEvents: avg((r) => r.engineEvents),
        invalid: runs.reduce((s, r) => s + r.invalid, 0),
        outcomes: runs.reduce((m, r) => {
            const k = r.outcome ? `${r.outcome.kind}:${r.outcome.reason.split(':')[0]}` : 'none';
            m[k] = (m[k] || 0) + 1;
            return m;
        }, {}),
        msPerTurn: Math.round((runs.reduce((s, r) => s + r.ms, 0) / Math.max(1, runs.reduce((s, r) => s + r.turnsPlayed, 0))) * 100) / 100,
    };
}

export function formatSummary(bookmarkId, s) {
    const top = [...s.actions.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`);
    return [
        `[${bookmarkId}] runs=${s.runs} ms/turn=${s.msPerTurn} invalid=${s.invalid}`,
        `  tension min/max/end avg = ${s.avgTensionMin}/${s.avgTensionMax}/${s.avgTensionEnd}; moved(>=8) in ${s.tensionMoved}/${s.runs}`,
        `  nuclear war: before t36 ${s.nuclearBefore36}/${s.runs}, any ${s.nuclearAny}/${s.runs}`,
        `  wars started/ended avg = ${s.avgWarsStarted}/${s.avgWarsEnded}; front moves in ${s.runsWithFrontMoves}/${s.runs}; capitulations ${s.avgCapitulations}; annexed ${s.avgAnnexed}; puppets ${s.avgPuppets}`,
        `  crises started avg ${s.avgCrises}; engine events avg ${s.avgEngineEvents}; outcomes ${JSON.stringify(s.outcomes)}`,
        `  AI distinct actions ${s.distinctActions}: ${top.join(' ')}`,
    ].join('\n');
}

// CLI (only with --run, so test runners that import every file under test/ skip it)
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--run')) {
    const args = process.argv.slice(2).filter((a) => a !== '--run');
    const turns = Number(args[0]) || 120;
    const seeds = Number(args[1]) || 20;
    const large = args[2] === 'large';
    const engine = createEngine();
    const scenario = large ? buildLargeScenario(180) : buildScenario();
    for (const bm of scenario.bookmarks) {
        const runs = [];
        for (let i = 0; i < seeds; i++) runs.push(simulate(engine, scenario, { bookmarkId: bm.id, nationId: 'BRA', seed: `sim-${i}`, turns }));
        console.log(formatSummary(bm.id, summarize(runs)));
    }
}
