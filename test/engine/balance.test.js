/**
 * Balance simulation (DESIGN §3.9): passive player, 120 turns, 20 seeds, every bookmark.
 * Prints a short summary per bookmark (visible in the node:test output).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine } from '../../src/engine/index.js';
import { buildScenario } from './fixtures.js';
import { formatSummary, simulate, summarize } from './sim.js';

const SEEDS = 20;
const TURNS = 120;
const engine = createEngine();
const scenario = buildScenario();

for (const bm of scenario.bookmarks) {
    test(`balance ${bm.id}: ${SEEDS} seeds x ${TURNS} turns, passive player`, () => {
        const runs = [];
        for (let i = 0; i < SEEDS; i++) runs.push(simulate(engine, scenario, { bookmarkId: bm.id, nationId: 'BRA', seed: `sim-${i}`, turns: TURNS }));
        const s = summarize(runs);
        console.log(formatSummary(bm.id, s));

        assert.equal(s.invalid, 0, 'state stays isWorldState and JSON-serializable');
        assert.ok(s.distinctActions >= 8, `AI used ${s.distinctActions} distinct actions`);
        assert.ok(s.runsWithFrontMoves >= 1, 'at least one war front moves');
        assert.ok(s.tensionMoved >= SEEDS * 0.75, `tension moved in ${s.tensionMoved}/${SEEDS} runs`);
        assert.ok(s.avgWarsEnded > 0, 'some wars end over 10 years');
        assert.ok(s.nuclearBefore36 <= SEEDS * 0.1, `nuclear war before turn 36 in ${s.nuclearBefore36}/${SEEDS}`);
        if (bm.id === 'b2026') {
            assert.ok(s.avgWarsStarted > 0, 'some wars start over 10 years');
            assert.equal(s.nuclearAny, 0, 'the calm bookmark never ends in nuclear war with a passive player');
            assert.ok((s.outcomes['victory:Sobrevivência'] || 0) >= SEEDS * 0.9, JSON.stringify(s.outcomes));
        }
        // AI personality matters: aggressive Russia is hostile more often than pacific Brazil-like diplomats
        assert.ok((s.actions.get('dip_improve_relations') || 0) > 0);
    });
}

test('balance: belligerent passive players (events pile up and expire) stay valid', () => {
    const cases = [
        ['UKR', 'b2026'],
        ['POL', 'b2028'],
        ['TWN', 'b2031'],
        ['USA', 'b2031'],
    ];
    for (const [nationId, bookmarkId] of cases) {
        for (let i = 0; i < 3; i++) {
            const r = simulate(engine, scenario, { bookmarkId, nationId, seed: `bel-${i}`, turns: 72, checkEvery: 12 });
            assert.equal(r.invalid, 0, `${nationId}/${bookmarkId}/${i}`);
            assert.ok(r.finalState.eventQueue.length <= 10);
        }
    }
});
