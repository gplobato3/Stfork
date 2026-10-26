/**
 * GLUE controller regressions found by the end-to-end run inside SillyTavern 1.19.
 * Uses the real engine and scenario (node loader) with fake StAPI / LlmAPI / UiAPI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../../src/engine/index.js';
import { createScenarioLoader } from '../../src/scenario/index.js';
import { createController } from '../../src/game/controller.js';
import { normalizeSettings } from '../../src/st/settings.js';

function setup({ orders = [] } = {}) {
    const engine = createEngine();
    const scenario = createScenarioLoader();
    let saved = null;
    const st = {
        getSettings: () => normalizeSettings({ postBulletins: false }),
        loadCampaign: () => saved,
        saveCampaign: async (s) => { saved = JSON.parse(JSON.stringify(s)); },
        clearCampaign: async () => { saved = null; },
        refreshInjection() {},
        personaName: () => 'Gabriel',
        recentChatText: () => '',
        postNarrator: async () => {},
        listConnectionProfiles: () => [],
        toast() {},
    };
    const llm = {
        interpretOrders: async () => ({ orders }),
        generateTurnEvent: async () => null,
        writeBulletin: async () => '',
        buildSitrep: () => '',
    };
    /** @type {Array<[string, any]>} */
    const calls = [];
    let ctl = null;
    const ui = {
        mount: async () => {},
        refresh: () => calls.push(['refresh', ctl.isBusy()]),
        setBusy: () => {},
        toast: () => {},
        showActionResult: (r) => calls.push(['result', r && r.summary]),
        showNewCampaignWizard: async () => ({ bookmarkId: 'b2026', nationId: 'BRA', leaderName: 'Gabriel', difficulty: 'normal' }),
        openWarRoom: async () => {},
        showEvent: async () => null,
        showTurnReport: () => {},
        showGameOver: async () => {},
        confirm: async () => true,
    };
    ctl = createController({ engine, scenario, llm, st, getUi: () => ui, seedSource: () => 'controller-test' });
    return { ctl, calls };
}

test('chat orders: the UI is refreshed after the busy lock is released', async () => {
    const { ctl, calls } = setup({ orders: [{ actionId: 'mil_partial_mobilization', targetId: null, quote: 'mobilização' }] });
    await ctl.start();
    await ctl.newCampaign();
    calls.length = 0;
    const summaries = await ctl.handleChatOrder('Ordeno a mobilização parcial das Forças Armadas.');
    assert.equal(summaries.length, 1);
    assert.equal(ctl.isBusy(), false);
    const refreshes = calls.filter(([kind]) => kind === 'refresh');
    assert.ok(refreshes.length > 0, 'the UI was refreshed');
    // Regression: the last refresh ran while `busy` was still true, so the HUD kept
    // "Avançar Mês" disabled ("Processando…") after every chat order.
    assert.equal(refreshes[refreshes.length - 1][1], false, 'last refresh sees busy=false');
});

test('slash-command actions show their result (ST drops the pipe of a typed command)', async () => {
    const { ctl, calls } = setup();
    await ctl.start();
    await ctl.newCampaign();
    calls.length = 0;
    const result = await ctl.doAction('dip_improve_relations', 'ARG', 'command');
    assert.ok(result && result.ok);
    assert.ok(calls.some(([kind]) => kind === 'result'), 'showActionResult called for source "command"');
    calls.length = 0;
    await ctl.doAction('dip_improve_relations', 'ARG', 'order');
    assert.ok(!calls.some(([kind]) => kind === 'result'), 'orders report through handleOrder, not doAction');
});
