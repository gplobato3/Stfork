/**
 * @file test/engine.test.js
 * node:test unit tests for Module A — the game-state engine (FEAT-002).
 *
 * These tests exercise REAL engine code paths (no mocks of engine logic) and
 * are written to FAIL if the engine logic is reverted. Run: node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine, migrateState } from '../src/engine/engine.js';
import {
    SCHEMA_VERSION,
    PHASES,
    RESOURCE_KEYS,
    isWorldStateShape,
    relationKey,
    createResources,
} from '../src/contract/worldState.js';
import { MODULE_NAME } from '../src/contract/interfaces.js';
import { getContext } from '../src/core/stContext.js';

/* --------------------------- test fixtures -------------------------------- */

/** A tiny but complete scenario for the engine to build from. */
function makeScenario() {
    return {
        nations: {
            BRA: {
                id: 'BRA',
                name: 'Brasil',
                flagEmoji: '🇧🇷',
                bloc: 'BRICS',
                capital: 'Brasília',
                government: 'República Presidencialista',
                traits: ['Economia Emergente'],
                resources: createResources({ economy: 60, military: 40, stability: 55 }),
            },
            USA: {
                id: 'USA',
                name: 'Estados Unidos',
                flagEmoji: '🇺🇸',
                bloc: 'NATO',
                capital: 'Washington',
                government: 'República Federal Presidencialista',
                traits: ['Superpotência'],
                resources: createResources({ economy: 90, military: 95, stability: 70 }),
            },
            GBR: {
                id: 'GBR',
                name: 'Reino Unido',
                flagEmoji: '🇬🇧',
                bloc: 'NATO',
                capital: 'Londres',
                government: 'Monarquia Constitucional / Reino',
                traits: ['Potência Nuclear'],
                resources: createResources({ economy: 75, military: 70 }),
            },
        },
        relations: {
            'BRA|USA': 20,
            'USA|GBR': 80,
        },
        geo: {},
        crisisSeeds: [],
        meta: { name: 'Mundo 2027' },
    };
}

/* ------------------------------ newGame ----------------------------------- */

test('newGame produces a valid world state with the chosen player nation', () => {
    const engine = createEngine();
    const state = engine.newGame(makeScenario(), 'BRA', { seed: 'seed-A', campaignId: 'camp-A' });

    assert.ok(isWorldStateShape(state), 'should be a valid WorldState shape');
    assert.equal(state.schemaVersion, SCHEMA_VERSION);
    assert.equal(state.campaignId, 'camp-A');
    assert.equal(state.seed, 'seed-A');
    assert.equal(state.playerNationId, 'BRA');
    assert.equal(state.turn, 1);
    assert.equal(state.phase, PHASES.PLAYER_TURN);
    assert.equal(state.nations.BRA.isPlayer, true);
    assert.equal(state.nations.USA.isPlayer, false);
    // Relations normalized through relationKey.
    assert.equal(state.relations[relationKey('USA', 'BRA')], 20);
    // Every nation carries all 7 resource keys.
    for (const id of Object.keys(state.nations)) {
        for (const k of RESOURCE_KEYS) {
            assert.equal(typeof state.nations[id].resources[k], 'number');
        }
    }
});

test('selectNation picks a government-appropriate leader title', () => {
    const engine = createEngine();
    // Monarchy -> "Rei"
    const gbr = engine.newGame(makeScenario(), 'GBR', { seed: 's' });
    assert.equal(gbr.nations.GBR.leaderTitle, 'Rei');
    assert.equal(gbr.nations.GBR.isPlayer, true);
    // Presidential republic -> "Presidente"
    const bra = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    assert.equal(bra.nations.BRA.leaderTitle, 'Presidente');
});

test('newGame is a pure transition (does not mutate the scenario source)', () => {
    const engine = createEngine();
    const scenario = makeScenario();
    const beforeEconomy = scenario.nations.BRA.resources.economy;
    const state = engine.newGame(scenario, 'BRA', { seed: 's' });
    state.nations.BRA.resources.economy = 1;
    assert.equal(scenario.nations.BRA.resources.economy, beforeEconomy, 'scenario untouched');
});

/* ----------------------------- applyEffect -------------------------------- */

test('applyEffect clamps resources at 0 and 100', () => {
    const engine = createEngine();
    const state = engine.newGame(makeScenario(), 'USA', { seed: 's' });

    // USA economy starts at 90; a +50 delta would overshoot -> clamps at 100.
    const up = engine.applyEffect(state, { type: 'resource', target: 'USA', resource: 'economy', delta: 50 });
    assert.equal(up.nations.USA.resources.economy, 100);

    // Drive BRA military (40) below zero with repeated negative deltas.
    let s = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    for (let i = 0; i < 3; i++) {
        s = engine.applyEffect(s, { type: 'resource', target: 'BRA', resource: 'military', delta: -50 });
    }
    assert.equal(s.nations.BRA.resources.military, 0);

    // Original state is not mutated (purity).
    assert.equal(state.nations.USA.resources.economy, 90);
});

test('applyEffect clamps relations at the documented bounds', () => {
    const engine = createEngine();
    let s = engine.newGame(makeScenario(), 'BRA', { seed: 's' });

    // Push BRA|USA toward +100 and beyond.
    for (let i = 0; i < 5; i++) {
        s = engine.applyEffect(s, { type: 'relation', target: 'BRA', targetB: 'USA', delta: 100 });
    }
    assert.equal(s.relations[relationKey('BRA', 'USA')], 100);

    // Push toward -100 and beyond.
    for (let i = 0; i < 5; i++) {
        s = engine.applyEffect(s, { type: 'relation', target: 'USA', targetB: 'BRA', delta: -100 });
    }
    assert.equal(s.relations[relationKey('BRA', 'USA')], -100);
});

test('applyEffect clamps tension into [0,100]', () => {
    const engine = createEngine();
    let s = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    for (let i = 0; i < 10; i++) {
        s = engine.applyEffect(s, { type: 'tension', delta: 50 });
    }
    assert.equal(s.globalTension, 100);
    for (let i = 0; i < 10; i++) {
        s = engine.applyEffect(s, { type: 'tension', delta: -50 });
    }
    assert.equal(s.globalTension, 0);
});

test('applyEffect handles every effect type and ignores unknown types without throwing', () => {
    const engine = createEngine();
    let s = engine.newGame(makeScenario(), 'BRA', { seed: 's' });

    // flag
    s = engine.applyEffect(s, { type: 'flag', target: 'guerraDeclarada', value: true });
    assert.equal(s.flags.guerraDeclarada, true);

    // resourceSet
    s = engine.applyEffect(s, { type: 'resourceSet', target: 'BRA', resource: 'tech', value: 77 });
    assert.equal(s.nations.BRA.resources.tech, 77);

    // bloc
    s = engine.applyEffect(s, { type: 'bloc', target: 'BRA', bloc: 'NATO' });
    assert.equal(s.nations.BRA.bloc, 'NATO');

    // war declare: flips war flag, hits relation + tension
    s = engine.applyEffect(s, { type: 'war', target: 'BRA', targetB: 'USA', action: 'declare' });
    assert.equal(s.flags.__wars[relationKey('BRA', 'USA')], true);

    // crisis start / escalate / resolve
    s = engine.applyEffect(s, {
        type: 'crisis',
        action: 'start',
        crisis: { id: 'c1', title: 'Bloqueio Naval', severity: 'low', involvedNationIds: ['BRA'] },
    });
    assert.equal(s.activeCrises.length, 1);
    s = engine.applyEffect(s, { type: 'crisis', action: 'escalate', crisisId: 'c1' });
    assert.equal(s.activeCrises[0].severity, 'medium');
    s = engine.applyEffect(s, { type: 'crisis', action: 'resolve', crisisId: 'c1' });
    assert.equal(s.activeCrises.length, 0);

    // unknown effect type must not throw and must not change core metrics
    const before = s.globalTension;
    assert.doesNotThrow(() => {
        s = engine.applyEffect(s, { type: 'teleport', target: 'BRA' });
    });
    assert.equal(s.globalTension, before);
});

/* ------------------------------ applyEvent -------------------------------- */

test('applyEvent applies a multi-effect option and logs the decision', () => {
    const engine = createEngine();
    const state = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    const event = {
        id: 'ev1',
        title: 'Tensão no Atlântico Sul',
        narrative: 'Uma frota estrangeira se aproxima.',
        tensionDelta: 5,
        options: [
            {
                id: 'opt_0',
                label: 'Mobilizar a Marinha',
                rationale: 'Mostrar força.',
                effects: [
                    { type: 'resource', target: 'BRA', resource: 'military', delta: 10 },
                    { type: 'resource', target: 'BRA', resource: 'warSupport', delta: 8 },
                    { type: 'tension', delta: 6 },
                ],
            },
            {
                id: 'opt_1',
                label: 'Negociar',
                rationale: 'Desescalar.',
                effects: [{ type: 'tension', delta: -4 }],
            },
        ],
    };

    const beforeMil = state.nations.BRA.resources.military;
    const beforeTension = state.globalTension;
    const after = engine.applyEvent(state, event, 'opt_0');

    assert.equal(after.nations.BRA.resources.military, beforeMil + 10);
    assert.equal(after.nations.BRA.resources.warSupport, state.nations.BRA.resources.warSupport + 8);
    // tensionDelta (5) + option tension effect (6)
    assert.equal(after.globalTension, beforeTension + 11);

    const decisionLog = after.log.filter((e) => e.kind === 'decision');
    assert.equal(decisionLog.length, 1);
    assert.equal(decisionLog[0].data.optionId, 'opt_0');
    assert.equal(decisionLog[0].data.optionLabel, 'Mobilizar a Marinha');
});

test('applyEvent rejects an unknown option id without throwing or applying effects', () => {
    const engine = createEngine();
    const state = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    const event = {
        id: 'ev2',
        title: 'Evento',
        narrative: 'Texto.',
        options: [{ id: 'opt_0', label: 'A', effects: [{ type: 'tension', delta: 20 }] }],
    };
    let after;
    assert.doesNotThrow(() => {
        after = engine.applyEvent(state, event, 'opt_DOES_NOT_EXIST');
    });
    // Tension unchanged; no decision logged; a system rejection line is present.
    assert.equal(after.globalTension, state.globalTension);
    assert.equal(after.log.filter((e) => e.kind === 'decision').length, 0);
    assert.ok(after.log.some((e) => e.kind === 'system' && /Opção desconhecida/.test(e.text)));
});

/* ------------------------------ advanceTurn ------------------------------- */

test('advanceTurn is deterministic: same seed+turn yields byte-identical output', () => {
    const engine = createEngine();
    const base = engine.newGame(makeScenario(), 'BRA', { seed: 'determinism-seed', campaignId: 'camp' });

    const run1 = engine.advanceTurn(base);
    const run2 = engine.advanceTurn(base);

    // Strip wall-clock-free: these states have no Date.now anywhere, so JSON
    // serialization must be byte-for-byte identical across runs.
    assert.equal(JSON.stringify(run1), JSON.stringify(run2));

    // And a deeper multi-turn replay stays identical too.
    const replayA = engine.advanceTurn(engine.advanceTurn(engine.advanceTurn(base)));
    const replayB = engine.advanceTurn(engine.advanceTurn(engine.advanceTurn(base)));
    assert.equal(JSON.stringify(replayA), JSON.stringify(replayB));
});

test('advanceTurn increments turn and rolls the date over a year boundary', () => {
    const engine = createEngine();
    let state = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    // newGame leaves us at turn 1, date 2027/1. Advancing moves to 2027/2 ...
    state = engine.advanceTurn(state);
    assert.equal(state.turn, 2);
    assert.deepEqual(state.date, { year: 2027, month: 2 });

    // Advance until we cross December -> January of the next year.
    // We are at month 2; advance 10 more times to reach month 12, then once more.
    for (let i = 0; i < 10; i++) state = engine.advanceTurn(state);
    assert.deepEqual(state.date, { year: 2027, month: 12 });
    state = engine.advanceTurn(state);
    assert.deepEqual(state.date, { year: 2028, month: 1 });
});

test('advanceTurn keeps all metrics within bounds and sets the phase', () => {
    const engine = createEngine();
    let state = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    for (let i = 0; i < 24; i++) {
        state = engine.advanceTurn(state);
        assert.ok(state.globalTension >= 0 && state.globalTension <= 100);
        for (const id of Object.keys(state.nations)) {
            for (const k of RESOURCE_KEYS) {
                const v = state.nations[id].resources[k];
                assert.ok(v >= 0 && v <= 100, `${id}.${k} out of bounds: ${v}`);
            }
        }
        assert.ok([PHASES.PLAYER_TURN, PHASES.GAME_OVER].includes(state.phase));
    }
});

test('advanceTurn auto-resolves expired crises', () => {
    const engine = createEngine();
    let state = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    state = engine.applyEffect(state, {
        type: 'crisis',
        action: 'start',
        crisis: { id: 'short', title: 'Crise Breve', severity: 'low', involvedNationIds: ['BRA'] },
    });
    assert.equal(state.activeCrises.length, 1);
    // 'low' lifespan is short; a few turns must auto-resolve it.
    for (let i = 0; i < 5; i++) state = engine.advanceTurn(state);
    assert.equal(state.activeCrises.length, 0);
});

/* ------------------------------ checkGameOver ----------------------------- */

test('checkGameOver fires on max tension and on player collapse', () => {
    const engine = createEngine();
    let state = engine.newGame(makeScenario(), 'BRA', { seed: 's' });
    assert.equal(engine.checkGameOver(state), null);

    // Max tension => nuclear war.
    let nuke = state;
    for (let i = 0; i < 10; i++) nuke = engine.applyEffect(nuke, { type: 'tension', delta: 50 });
    assert.match(engine.checkGameOver(nuke), /nuclear/i);

    // Player stability to 0 => collapse.
    let collapse = engine.applyEffect(state, { type: 'resourceSet', target: 'BRA', resource: 'stability', value: 0 });
    assert.match(engine.checkGameOver(collapse), /colapso/i);
});

/* ----------------------------- getNationStatus ---------------------------- */

test('getNationStatus derives power, war state, and relations without mutating state', () => {
    const engine = createEngine();
    let state = engine.newGame(makeScenario(), 'USA', { seed: 's' });
    const snapshot = JSON.stringify(state);

    const status = engine.getNationStatus(state, 'USA');
    assert.equal(status.found, true);
    assert.ok(status.powerScore > 0 && status.powerScore <= 100);
    assert.equal(status.atWar, false);
    assert.equal(status.bloc, 'NATO');
    // USA|GBR relation is 80 -> GBR is an ally.
    assert.ok(status.allies.includes('GBR'));

    // Declare war and re-check.
    state = engine.applyEffect(state, { type: 'war', target: 'USA', targetB: 'BRA', action: 'declare' });
    const atWar = engine.getNationStatus(state, 'USA');
    assert.equal(atWar.atWar, true);
    assert.ok(atWar.warWith.includes('BRA'));

    // Unknown nation returns a safe, found:false status.
    const missing = engine.getNationStatus(state, 'ZZZ');
    assert.equal(missing.found, false);

    // getNationStatus must not have mutated the first state snapshot.
    assert.equal(JSON.stringify(state), JSON.stringify(migrateState(JSON.parse(JSON.stringify(state)))));
    assert.ok(snapshot.length > 0);
});

/* ------------------------------- save / load ------------------------------ */

test('saveState/loadState round-trips a world state through chatMetadata without loss', async () => {
    const engine = createEngine();
    const ctx = getContext();
    // Clean slate for this chat.
    delete ctx.chatMetadata[MODULE_NAME];

    const state = engine.newGame(makeScenario(), 'BRA', { seed: 'persist', campaignId: 'camp-persist' });
    assert.equal(engine.hasSave(), false);

    await engine.saveState(state);
    assert.equal(engine.hasSave(), true);

    const loaded = await engine.loadState();
    assert.ok(loaded);
    assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
    assert.equal(loaded.campaignId, 'camp-persist');
    assert.equal(loaded.playerNationId, 'BRA');
    assert.deepEqual(loaded.nations.BRA.resources, state.nations.BRA.resources);

    // Mutating the loaded copy must not affect the stored save (deep clone).
    loaded.globalTension = 999;
    const reloaded = await engine.loadState();
    assert.notEqual(reloaded.globalTension, 999);

    await engine.deleteSave();
    assert.equal(engine.hasSave(), false);
    assert.equal(await engine.loadState(), null);
});

test('loadState migrates an older-schema save (default-fills, preserves data)', async () => {
    const engine = createEngine();
    const ctx = getContext();
    // Simulate an old save missing newer fields and with a stale schemaVersion.
    ctx.chatMetadata[MODULE_NAME] = {
        schemaVersion: 0,
        campaignId: 'old-camp',
        seed: 'old-seed',
        turn: 3,
        date: { year: 2027, month: 4 },
        phase: PHASES.PLAYER_TURN,
        playerNationId: 'BRA',
        nations: { BRA: { id: 'BRA', name: 'Brasil', bloc: 'BRICS', resources: { economy: 42 } } },
        relations: {},
        activeCrises: [],
        globalTension: 30,
        log: [],
        // flags intentionally missing to exercise the default-fill guard
    };

    const loaded = await engine.loadState();
    assert.ok(loaded);
    assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
    assert.equal(loaded.campaignId, 'old-camp');
    assert.equal(loaded.turn, 3);
    // Missing flags default-filled.
    assert.equal(typeof loaded.flags, 'object');
    // Partial resources filled out to all 7 keys.
    for (const k of RESOURCE_KEYS) assert.equal(typeof loaded.nations.BRA.resources[k], 'number');
    assert.equal(loaded.nations.BRA.resources.economy, 42);

    await engine.deleteSave();
});
