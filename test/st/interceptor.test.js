import test from 'node:test';
import assert from 'node:assert/strict';

import { createSt, ORDER_KEY_FLAG } from '../../src/st/index.js';
import { messageKey, hashString, lastUserMessage } from '../../src/st/interceptor.js';
import { INTERCEPTOR_NAME, INJECTION_KEY, MODULE_KEY } from '../../src/contract/constants.js';
import { createFakeContext, installFakeSillyTavern } from './fakeContext.js';
import { makeState, deepFreeze } from './worldFixture.js';

/**
 * ST: script.js:4496-4527 — the interceptor receives a filtered COPY of the chat
 * whose items are {...chatItem, mes, index}.
 */
function coreChat(messages) {
    return messages.filter((m) => !m.is_system).map((m, index) => ({ ...m, index }));
}

const userMsg = (mes, send_date = '2026-10-26T21:00:00.000Z') => ({ name: 'Gabriel', is_user: true, is_system: false, send_date, mes, extra: {} });
const botMsg = (mes) => ({ name: 'Conselho de Guerra', is_user: false, is_system: false, send_date: '2026-10-26T21:00:05.000Z', mes, extra: {} });

function setup({ settings, onUserOrder, state = makeState() } = {}) {
    const ctx = createFakeContext();
    if (settings) ctx.extensionSettings[MODULE_KEY] = settings;
    ctx.chatMetadata[MODULE_KEY] = state;
    const uninstall = installFakeSillyTavern(ctx);
    let current = state;
    const orders = [];
    const budgets = [];
    const st = createSt({
        getState: () => current,
        buildSitrep: (s, opts) => {
            budgets.push(opts.budgetTokens);
            return `SITREP turno=${s.turn} ações=${(s.recentActions || []).length}`;
        },
        onUserOrder: onUserOrder ?? (async (text) => {
            orders.push(text);
            current = { ...current, recentActions: [...current.recentActions, { turn: current.turn, actorId: 'BRA', actionId: 'x', targetId: null, success: true, source: 'order', summary: 'ok' }] };
            return ['ok'];
        }),
    });
    // The controller always loads the campaign (which binds writes to this chat) first.
    st.loadCampaign();
    st.installInterceptor();
    const run = (chat, type, contextSize = 8192) => globalThis[INTERCEPTOR_NAME](chat, contextSize, () => {}, type);
    return { ctx, st, orders, budgets, run, uninstall, setState: (s) => { current = s; } };
}

test('installInterceptor defines globalThis[INTERCEPTOR_NAME] with the ST call shape', () => {
    const { uninstall } = setup();
    try {
        assert.equal(typeof globalThis[INTERCEPTOR_NAME], 'function');
        assert.equal(globalThis[INTERCEPTOR_NAME].length, 4); // (chat, contextSize, abort, type)
    } finally {
        uninstall();
        delete globalThis[INTERCEPTOR_NAME];
    }
});

test('only type "normal" runs orders; every type refreshes the injection', async () => {
    const { ctx, orders, run, uninstall } = setup();
    try {
        const chat = coreChat([botMsg('Bem-vindo'), userMsg('Mobilizem as reservas imediatamente')]);
        for (const type of ['quiet', 'impersonate', 'continue', 'swipe', 'regenerate', undefined, 'weird']) {
            await run(chat, type);
        }
        assert.equal(orders.length, 0);
        assert.equal(ctx.calls.setExtensionPrompt.length, 7);
        assert.ok(ctx.calls.setExtensionPrompt.every((c) => c.key === INJECTION_KEY && c.value.startsWith('SITREP')));

        await run(chat, 'normal');
        assert.deepEqual(orders, ['Mobilizem as reservas imediatamente']);
    } finally {
        uninstall();
    }
});

test('after the order runs, the injection is refreshed again with the updated state', async () => {
    const { ctx, run, uninstall } = setup();
    try {
        await run(coreChat([userMsg('Mobilizem as reservas')]), 'normal');
        const values = ctx.calls.setExtensionPrompt.map((c) => c.value);
        assert.deepEqual(values, ['SITREP turno=3 ações=3', 'SITREP turno=3 ações=4']);
    } finally {
        uninstall();
    }
});

test('dedupe: same message never runs twice (regenerate in groups = normal, /trigger, empty send)', async () => {
    const { orders, run, uninstall } = setup();
    try {
        const chat = coreChat([userMsg('Mobilizem as reservas')]);
        await run(chat, 'normal');
        await run(chat, 'normal');
        await run(chat, 'swipe');
        await run(chat, 'regenerate');
        await run(coreChat([userMsg('Mobilizem as reservas')]), 'normal');
        assert.equal(orders.length, 1);
        // a new message (different send_date) runs
        await run(coreChat([userMsg('Mobilizem as reservas', '2026-10-26T22:00:00.000Z')]), 'normal');
        assert.equal(orders.length, 2);
    } finally {
        uninstall();
    }
});

test('the processed key is persisted in the campaign and survives a reload (new StAPI instance)', async () => {
    const { ctx, run, uninstall } = setup();
    try {
        const msg = userMsg('Declarem apoio à Argentina');
        await run(coreChat([msg]), 'normal');
        assert.equal(ctx.chatMetadata[MODULE_KEY].flags[ORDER_KEY_FLAG], messageKey(msg));
        assert.ok(ctx.calls.saveMetadataDebounced >= 1);

        // Reload: fresh StAPI, state loaded from metadata (contains the flag).
        const orders2 = [];
        const stored = ctx.chatMetadata[MODULE_KEY];
        const st2 = createSt({ getState: () => stored, buildSitrep: () => 'S', onUserOrder: async (t) => { orders2.push(t); return []; } });
        st2.loadCampaign();
        st2.installInterceptor();
        await globalThis[INTERCEPTOR_NAME](coreChat([msg]), 4096, () => {}, 'normal');
        assert.equal(orders2.length, 0);
    } finally {
        uninstall();
    }
});

test('saveCampaign stamps the processed key even when the controller state lacks it', async () => {
    const { ctx, st, run, uninstall, setState } = setup();
    try {
        const msg = userMsg('Mobilizem as reservas');
        await run(coreChat([msg]), 'normal');
        const controllerState = makeState({ flags: { other: 1 } });
        setState(controllerState);
        await st.saveCampaign(controllerState);
        assert.equal(ctx.chatMetadata[MODULE_KEY].flags[ORDER_KEY_FLAG], messageKey(msg));
        assert.equal(ctx.chatMetadata[MODULE_KEY].flags.other, 1);
        assert.equal(controllerState.flags[ORDER_KEY_FLAG], undefined, 'caller state not mutated');
    } finally {
        uninstall();
    }
});

test('never mutates the chat array or its messages', async () => {
    const { run, orders, uninstall } = setup();
    try {
        const chat = deepFreeze(coreChat([botMsg('Olá'), userMsg('Mobilizem as reservas')]));
        const before = JSON.stringify(chat);
        await run(chat, 'normal');
        assert.equal(JSON.stringify(chat), before);
        assert.equal(orders.length, 1);
    } finally {
        uninstall();
    }
});

test('never throws: bad chat, throwing getState / onUserOrder / setExtensionPrompt', async () => {
    const { ctx, run, uninstall } = setup({
        onUserOrder: async () => {
            throw new Error('order failed');
        },
    });
    try {
        await assert.doesNotReject(run(null, 'normal'));
        await assert.doesNotReject(run('not an array', 'normal'));
        await assert.doesNotReject(run(coreChat([userMsg('Mobilizem as reservas')]), 'normal'));
        ctx.setExtensionPrompt = () => {
            throw new Error('ST exploded');
        };
        await assert.doesNotReject(run(coreChat([userMsg('outra ordem', 'x')]), 'normal'));
    } finally {
        uninstall();
    }
    const ctx2 = createFakeContext();
    const un2 = installFakeSillyTavern(ctx2);
    try {
        const st = createSt({ getState: () => { throw new Error('no state'); }, buildSitrep: () => 'x', onUserOrder: async () => [] });
        st.installInterceptor();
        await assert.doesNotReject(globalThis[INTERCEPTOR_NAME]([userMsg('a b c d')], 100, () => {}, 'normal'));
    } finally {
        un2();
    }
});

test('a failed order is still marked as processed (no re-run on the next normal generation)', async () => {
    let calls = 0;
    const { run, uninstall } = setup({
        onUserOrder: async () => {
            calls++;
            throw new Error('fail');
        },
    });
    try {
        const chat = coreChat([userMsg('Mobilizem as reservas')]);
        await run(chat, 'normal');
        await run(chat, 'normal');
        assert.equal(calls, 1);
    } finally {
        uninstall();
    }
});

test('orders run only in ordersMode "auto", with a campaign, and when the newest message is the user\'s', async () => {
    for (const ordersMode of ['command', 'off']) {
        const { orders, run, uninstall } = setup({ settings: { ordersMode } });
        try {
            await run(coreChat([userMsg('Mobilizem as reservas')]), 'normal');
            assert.equal(orders.length, 0, ordersMode);
        } finally {
            uninstall();
        }
    }
    const { orders, run, uninstall, setState, ctx } = setup();
    try {
        await run(coreChat([userMsg('Mobilizem as reservas'), botMsg('Sim, senhor.')]), 'normal');
        assert.equal(orders.length, 0, 'last message is not from the user');
        setState(null);
        await run(coreChat([userMsg('Mobilizem as reservas')]), 'normal');
        assert.equal(orders.length, 0, 'no campaign');
        assert.equal(ctx.calls.setExtensionPrompt.at(-1).value, '', 'injection cleared without campaign');
        setState(makeState({ phase: 'GAME_OVER' }));
        await run(coreChat([userMsg('Mobilizem as reservas')]), 'normal');
        assert.equal(orders.length, 0, 'game over');
    } finally {
        uninstall();
    }
});

test('sitrep budget derives from contextSize and is reused by later refreshes', async () => {
    const { st, budgets, run, uninstall } = setup({ settings: { ordersMode: 'off' } });
    try {
        await run(coreChat([userMsg('oi')]), 'normal', 4096);
        assert.equal(budgets.at(-1), 245);
        await run(coreChat([userMsg('oi')]), 'normal', 100000);
        assert.equal(budgets.at(-1), 400);
        st.refreshInjection(makeState());
        assert.equal(budgets.at(-1), 400);
    } finally {
        uninstall();
    }
});

test('helpers: stable hash and message key, lastUserMessage', () => {
    assert.equal(hashString('abc'), hashString('abc'));
    assert.notEqual(hashString('abc'), hashString('abd'));
    const m = userMsg('x');
    assert.equal(messageKey(m), messageKey({ ...m }));
    assert.notEqual(messageKey(m), messageKey({ ...m, send_date: 'other' }));
    assert.equal(lastUserMessage([]), null);
    assert.equal(lastUserMessage([userMsg('  ')]), null);
    assert.equal(lastUserMessage([userMsg('a')]).mes, 'a');
});
