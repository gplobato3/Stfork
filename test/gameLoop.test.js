/**
 * @file test/gameLoop.test.js
 * node:test coverage for the end-to-end game loop (FEAT-006 glue).
 *
 * Uses the REAL engine (pure, deterministic) and REAL contract, with a tiny
 * in-memory scenario and lightweight fakes for the UI and the LLM. Only the
 * network-bound generate call is faked (via a stub llm.generateTurnEvent); the
 * engine's state transitions and the controller's orchestration are exercised
 * for real. Nothing here touches SillyTavern.
 *
 * Run: node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameController } from '../src/game/gameLoop.js';
import { createEngine } from '../src/engine/engine.js';
import { getContext } from '../src/core/stContext.js';

/** Minimal two-nation scenario sufficient for engine.newGame. */
function makeScenario() {
    const nations = {
        BRA: {
            id: 'BRA',
            name: 'Brasil',
            flagEmoji: '🇧🇷',
            bloc: 'BRICS',
            capital: 'Brasília',
            government: 'República Presidencialista',
            leaderTitle: 'Presidente',
            traits: [],
            resources: { economy: 55, military: 45, stability: 60, influence: 50, tech: 48, manpower: 70, warSupport: 40 },
        },
        USA: {
            id: 'USA',
            name: 'Estados Unidos',
            flagEmoji: '🇺🇸',
            bloc: 'NATO',
            capital: 'Washington',
            government: 'República Federal Presidencialista',
            leaderTitle: 'Presidente',
            traits: [],
            resources: { economy: 90, military: 95, stability: 70, influence: 90, tech: 92, manpower: 80, warSupport: 60 },
        },
    };
    const data = {
        nations,
        relations: { 'BRA|USA': 20 },
        geo: { type: 'FeatureCollection', features: [] },
        crisisSeeds: [],
        meta: { name: 'Test', startDate: { year: 2027, month: 1 } },
    };
    return {
        async loadScenario() {
            return data;
        },
        listPlayableNationIds() {
            return ['USA', 'BRA'];
        },
    };
}

/** A fake UI that records calls and drives the event-modal callback. */
function makeFakeUi(autoChooseIndex = 0) {
    const calls = { update: 0, mount: 0, toast: [], picker: 0, event: 0, loading: 0, closed: 0 };
    return {
        calls,
        async mount() {
            calls.mount += 1;
        },
        update() {
            calls.update += 1;
        },
        renderMap() {},
        renderDashboard() {},
        showNationPicker() {
            calls.picker += 1;
        },
        showEventModal(event, onChoose) {
            calls.event += 1;
            // Simulate the player clicking an option synchronously.
            const opt = event.options[autoChooseIndex] || event.options[0];
            onChoose(opt.id);
        },
        showEventLoading() {
            calls.loading += 1;
        },
        showEventError() {},
        closeModal() {
            calls.closed += 1;
        },
        toast(msg) {
            calls.toast.push(String(msg));
        },
    };
}

/** A fake LLM: only the network generate call is stubbed. */
function makeFakeLlm(event) {
    return {
        buildSituationReport() {
            return 'RELATÓRIO DE SITUAÇÃO (teste)';
        },
        async generateTurnEvent() {
            return event;
        },
        async generateFlavorNarration() {
            return 'As consequências se desenrolam.';
        },
        interceptor: async () => {},
    };
}

/** A schema-valid event with a single deterministic effect. */
function makeEvent() {
    return {
        id: 'evt-test-1',
        title: 'Manobra Naval',
        narrative: 'Uma frota rival aproxima-se da costa.',
        options: [
            {
                id: 'opt_calm',
                label: 'Reagir com diplomacia',
                rationale: 'Desescalar.',
                effects: [{ type: 'resource', target: 'BRA', resource: 'influence', delta: 5 }],
            },
            {
                id: 'opt_force',
                label: 'Mobilizar a frota',
                rationale: 'Mostrar força.',
                effects: [{ type: 'tension', delta: 8 }],
            },
        ],
        tensionDelta: 2,
    };
}

/** Reset the shared mock chat metadata between tests. */
function clearSave() {
    const ctx = getContext();
    ctx.chatMetadata = {};
}

test('startNewGame shows the nation picker', async () => {
    clearSave();
    const ui = makeFakeUi();
    const controller = createGameController({
        engine: createEngine(),
        scenario: makeScenario(),
        llm: makeFakeLlm(makeEvent()),
        ui,
    });
    await controller.startNewGame();
    assert.equal(ui.calls.picker, 1, 'picker should be shown once');
});

test('pickNation builds a campaign, saves it, and refreshes the UI', async () => {
    clearSave();
    const ui = makeFakeUi();
    const controller = createGameController({
        engine: createEngine(),
        scenario: makeScenario(),
        llm: makeFakeLlm(makeEvent()),
        ui,
    });
    await controller.pickNation('BRA');

    const state = controller.getState();
    assert.ok(state, 'state should exist');
    assert.equal(state.playerNationId, 'BRA');
    assert.equal(state.turn, 1);
    assert.ok(state.nations.BRA.isPlayer);
    // Saved into chatMetadata under the module key.
    const ctx = getContext();
    assert.ok(ctx.chatMetadata.hoiGrandeEstrategia, 'save should be persisted');
    assert.ok(ui.calls.update >= 1, 'UI should refresh');
});

test('nextTurn runs the full loop: upkeep -> event -> decision -> save', async () => {
    clearSave();
    const event = makeEvent();
    const ui = makeFakeUi(0); // choose the first (diplomacy) option
    const controller = createGameController({
        engine: createEngine(),
        scenario: makeScenario(),
        llm: makeFakeLlm(event),
        ui,
    });
    await controller.pickNation('BRA');
    const before = controller.getState();
    const beforeInfluence = before.nations.BRA.resources.influence;

    await controller.nextTurn();
    const after = controller.getState();

    assert.equal(after.turn, before.turn + 1, 'turn advances by one');
    assert.equal(ui.calls.event, 1, 'event modal shown once');
    assert.equal(ui.calls.loading, 1, 'loading state shown once');
    // The chosen diplomacy option adds +5 influence to BRA (after upkeep drift).
    assert.ok(
        after.nations.BRA.resources.influence >= beforeInfluence,
        'influence should not drop after the diplomacy choice',
    );
    // A decision log entry exists.
    assert.ok(
        after.log.some((l) => l.kind === 'decision'),
        'a decision should be logged',
    );
});

test('nextTurn without a campaign toasts the no-campaign message', async () => {
    clearSave();
    const ui = makeFakeUi();
    const controller = createGameController({
        engine: createEngine(),
        scenario: makeScenario(),
        llm: makeFakeLlm(makeEvent()),
        ui,
    });
    await controller.nextTurn();
    assert.equal(ui.calls.event, 0, 'no event when there is no campaign');
    assert.ok(ui.calls.toast.length >= 1, 'should toast a message');
});

test('a thrown generateTurnEvent is caught and leaves the save intact', async () => {
    clearSave();
    const ui = makeFakeUi();
    const llm = makeFakeLlm(makeEvent());
    llm.generateTurnEvent = async () => {
        throw new Error('network boom');
    };
    const controller = createGameController({
        engine: createEngine(),
        scenario: makeScenario(),
        llm,
        ui,
    });
    await controller.pickNation('BRA');
    const savedTurn = controller.getState().turn;

    await controller.nextTurn(); // should NOT throw
    // The decision never applied; the in-memory state is unchanged (the loop
    // rolled back to the pre-advance save by not committing world).
    assert.equal(controller.getState().turn, savedTurn, 'save intact after failure');
    assert.ok(ui.calls.toast.some((m) => m.length > 0), 'an error toast was shown');
});

test('resetCampaign clears the save and in-memory state', async () => {
    clearSave();
    const controller = createGameController({
        engine: createEngine(),
        scenario: makeScenario(),
        llm: makeFakeLlm(makeEvent()),
        ui: makeFakeUi(),
    });
    await controller.pickNation('BRA');
    assert.ok(controller.getState());
    await controller.resetCampaign();
    assert.equal(controller.getState(), null, 'in-memory state cleared');
    const ctx = getContext();
    assert.ok(!ctx.chatMetadata.hoiGrandeEstrategia, 'save deleted');
});

test('buildSituationReport returns text for an active campaign, empty otherwise', async () => {
    clearSave();
    const controller = createGameController({
        engine: createEngine(),
        scenario: makeScenario(),
        llm: makeFakeLlm(makeEvent()),
        ui: makeFakeUi(),
    });
    assert.equal(controller.buildSituationReport(), '', 'empty before a campaign');
    await controller.pickNation('BRA');
    assert.ok(controller.buildSituationReport().length > 0, 'report after a campaign');
});
