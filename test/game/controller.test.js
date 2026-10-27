/**
 * GLUE controller regressions (end-to-end run inside SillyTavern 1.19 + semantic review).
 * Uses the real engine and scenario (node loader) with fake StAPI / LlmAPI / UiAPI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PHASES } from '../../src/contract/constants.js';
import { createEngine } from '../../src/engine/index.js';
import { createScenarioLoader } from '../../src/scenario/index.js';
import { createController } from '../../src/game/controller.js';
import { normalizeSettings } from '../../src/st/settings.js';

const scenario = createScenarioLoader();

/** A promise plus its resolver, to hold an LLM call open. */
function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

function setup({ orders = [], llm: llmOverrides = {}, confirm = true, engine: engineOverrides = {}, wizard = {} } = {}) {
    const engine = { ...createEngine(), ...engineOverrides };
    const chats = { 'chat-1': null, 'chat-2': null };
    const chat = { id: 'chat-1', refuseSaves: false };
    const posted = [];
    const st = {
        getSettings: () => normalizeSettings({ postBulletins: true }),
        loadCampaign: () => chats[chat.id],
        saveCampaign: async (s) => {
            if (chat.refuseSaves) return false;
            chats[chat.id] = JSON.parse(JSON.stringify(s));
            return true;
        },
        clearCampaign: async () => { chats[chat.id] = null; return true; },
        refreshInjection() {},
        personaName: () => 'Gabriel',
        recentChatText: () => '',
        postNarrator: async (text) => { posted.push(text); return true; },
        listConnectionProfiles: () => [],
        currentChatId: () => chat.id,
        toast() {},
    };
    const llm = {
        interpretOrders: async () => ({ orders }),
        generateTurnEvent: async () => null,
        writeBulletin: async () => '',
        buildSitrep: () => '',
        ...llmOverrides,
    };
    /** @type {Array<[string, any]>} */
    const calls = [];
    let ctl = null;
    const ui = {
        mount: async () => {},
        refresh: () => calls.push(['refresh', ctl.isBusy()]),
        setBusy: () => {},
        toast: (msg) => calls.push(['toast', msg]),
        showActionResult: (r) => calls.push(['result', r]),
        showNewCampaignWizard: async () => ({ bookmarkId: 'b2026', nationId: 'BRA', leaderName: 'Gabriel', difficulty: 'normal', ...wizard }),
        openWarRoom: async () => {},
        showEvent: async () => null,
        showTurnReport: () => {},
        showGameOver: async (o) => { calls.push(['gameOver', o]); },
        confirm: async (opts) => { calls.push(['confirm', opts.title]); return confirm; },
    };
    let seq = 0;
    ctl = createController({ engine, scenario, llm, st, getUi: () => ui, seedSource: () => `controller-test-${++seq}` });
    return { ctl, calls, chats, chat, posted };
}

const kinds = (calls, kind) => calls.filter(([k]) => k === kind);

test('chat orders: the UI is refreshed after the busy lock is released', async () => {
    const { ctl, calls } = setup({ orders: [{ actionId: 'mil_partial_mobilization', targetId: null, quote: 'mobilização' }] });
    await ctl.start();
    await ctl.newCampaign();
    calls.length = 0;
    const summaries = await ctl.handleChatOrder('Ordeno a mobilização parcial das Forças Armadas.');
    assert.equal(summaries.length, 1);
    assert.equal(ctl.isBusy(), false);
    const refreshes = kinds(calls, 'refresh');
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
    assert.ok(kinds(calls, 'result').length > 0, 'showActionResult called for source "command"');
    calls.length = 0;
    await ctl.doAction('dip_improve_relations', 'ARG', 'order');
    assert.equal(kinds(calls, 'result').length, 0, 'orders report through handleOrder, not doAction');
});

test('chat orders never execute confirm:true actions (war, strikes, nukes)', async () => {
    const { ctl, chats } = setup({ orders: [{ actionId: 'dip_declare_war', targetId: 'CUB', quote: 'guerra' }], wizard: { nationId: 'USA' } });
    await ctl.start();
    await ctl.newCampaign();
    const before = chats['chat-1'];
    assert.ok(ctl.query.getPlayerActions('CUB').find((a) => a.def.id === 'dip_declare_war').available, 'the war would be available');
    const summaries = await ctl.handleChatOrder('Declarem guerra a Cuba!');
    assert.equal(summaries.length, 1);
    assert.match(summaries[0], /exigem confirmação na Sala de Guerra/);
    const after = ctl.getState();
    assert.equal(after.wars.some((w) => w.attackers.includes('USA')), false, 'no war declared');
    assert.equal(after.nations.USA.pc, before.nations.USA.pc, 'no PC spent');
});

test('War Room orders and slash commands ask before confirm:true actions', async () => {
    const order = [{ actionId: 'dip_declare_war', targetId: 'CUB', quote: 'guerra' }];
    const declined = setup({ orders: order, confirm: false, wizard: { nationId: 'USA' } });
    await declined.ctl.start();
    await declined.ctl.newCampaign();
    const res = await declined.ctl.handleOrder('Declarem guerra a Cuba', 'warroom');
    assert.equal(res[0].ok, false);
    assert.ok(kinds(declined.calls, 'confirm').length >= 1, 'confirmation asked');
    assert.equal(declined.ctl.getState().wars.some((w) => w.attackers.includes('USA')), false);
    const cmd = await declined.ctl.doAction('dip_declare_war', 'CUB', 'command');
    assert.equal(cmd.ok, false, 'declined command does not run');

    const accepted = setup({ orders: order, confirm: true, wizard: { nationId: 'USA' } });
    await accepted.ctl.start();
    await accepted.ctl.newCampaign();
    const ok = await accepted.ctl.handleOrder('Declarem guerra a Cuba', 'warroom');
    assert.equal(ok[0].ok, true);
    assert.ok(accepted.ctl.getState().wars.some((w) => w.attackers.includes('USA')), 'war declared after confirmation');
});

test('a stale flow from the previous chat cannot release the new chat\'s busy lock', async () => {
    const llmA = deferred();
    const llmB = deferred();
    let call = 0;
    const { ctl, chats, chat } = setup({ llm: { generateTurnEvent: () => (++call === 1 ? llmA.promise : llmB.promise) } });
    await ctl.start();
    await ctl.newCampaign();
    const campaignA = ctl.getState().campaignId;

    const turnA = ctl.endTurn(); // waits on llmA
    await new Promise((r) => setImmediate(r));
    assert.equal(ctl.isBusy(), true);

    chat.id = 'chat-2';
    await ctl.onChatChanged();
    assert.equal(ctl.isBusy(), false, 'switching chats revokes the old lock');
    await ctl.newCampaign();
    const turnB = ctl.endTurn(); // waits on llmB
    await new Promise((r) => setImmediate(r));
    assert.equal(ctl.isBusy(), true);

    llmA.resolve(null);
    await turnA;
    assert.equal(ctl.isBusy(), true, 'chat B still owns the lock after chat A\'s flow ends');
    assert.notEqual(chats['chat-2'].campaignId, campaignA, 'chat A never wrote into chat B');

    llmB.resolve(null);
    await turnB;
    assert.equal(ctl.isBusy(), false);
});

test('a chat order that ends the game shows the ending only after the generation', async () => {
    const real = createEngine();
    const { ctl, calls, posted } = setup({
        orders: [{ actionId: 'mil_partial_mobilization', targetId: null, quote: 'mobilização' }],
        engine: {
            executeAction: (s, ...rest) => {
                const out = real.executeAction(s, ...rest);
                if (!out.result.ok) return out;
                return { ...out, state: { ...out.state, phase: PHASES.GAME_OVER, outcome: { kind: 'defeat', reason: 'Teste.', turn: out.state.turn } } };
            },
        },
    });
    await ctl.start();
    await ctl.newCampaign();
    posted.length = 0;
    calls.length = 0;
    await ctl.handleChatOrder('Mobilizem tudo.');
    assert.equal(posted.length, 0, 'no chat message posted from inside the interceptor');
    assert.equal(kinds(calls, 'gameOver').length, 0, 'no dialog awaited inside the interceptor');
    ctl.afterGeneration();
    await new Promise((r) => setImmediate(r));
    assert.equal(posted.length, 1);
    assert.match(posted[0], /DERROTA/);
    assert.equal(kinds(calls, 'gameOver').length, 1);
});

test('a write refused while ST reloads the same chat is retried on CHAT_CHANGED', async () => {
    const { ctl, chats, chat } = setup();
    await ctl.start();
    await ctl.newCampaign();
    chat.refuseSaves = true; // reloadCurrentChat window
    const res = await ctl.doAction('dip_improve_relations', 'ARG', 'ui');
    assert.ok(res.ok);
    const live = ctl.getState();
    assert.notEqual(chats['chat-1'].nations.BRA.pc, live.nations.BRA.pc, 'not saved yet');
    chat.refuseSaves = false;
    await ctl.onChatChanged(); // same chat id: keep the live campaign and flush it
    assert.equal(ctl.getState(), live, 'same-chat reload keeps the live state');
    assert.equal(chats['chat-1'].nations.BRA.pc, live.nations.BRA.pc, 'flushed after the reload');
});
