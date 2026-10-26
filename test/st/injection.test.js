import test from 'node:test';
import assert from 'node:assert/strict';

import { createSt } from '../../src/st/index.js';
import { INJECTION_KEY, MODULE_KEY } from '../../src/contract/constants.js';
import { createFakeContext, installFakeSillyTavern } from './fakeContext.js';
import { makeState } from './worldFixture.js';

function setup(settings) {
    const ctx = createFakeContext();
    if (settings) ctx.extensionSettings[MODULE_KEY] = settings;
    const uninstall = installFakeSillyTavern(ctx);
    const sitrepCalls = [];
    const st = createSt({
        getState: () => null,
        buildSitrep: (state, opts) => {
            sitrepCalls.push(opts);
            return `[SITUAÇÃO — teste] turno ${state.turn}`;
        },
    });
    return { ctx, st, sitrepCalls, uninstall };
}

const last = (ctx) => ctx.calls.setExtensionPrompt[ctx.calls.setExtensionPrompt.length - 1];

test('default settings: IN_CHAT (1), depth 1, role SYSTEM (0), scan false', () => {
    const { ctx, st, uninstall } = setup();
    try {
        st.refreshInjection(makeState());
        const call = last(ctx);
        assert.equal(call.key, INJECTION_KEY);
        assert.equal(call.value, '[SITUAÇÃO — teste] turno 3');
        assert.equal(call.position, 1);
        assert.equal(call.depth, 1);
        assert.equal(call.scan, false);
        assert.equal(call.role, 0);
    } finally {
        uninstall();
    }
});

test('position / role / depth mapping for every option', () => {
    const cases = [
        [{ position: 'in_prompt', role: 'user', depth: 0 }, { position: 0, role: 1, depth: 0 }],
        [{ position: 'before_prompt', role: 'assistant', depth: 3 }, { position: 2, role: 2, depth: 3 }],
        [{ position: 'in_chat', role: 'assistant', depth: 12 }, { position: 1, role: 2, depth: 12 }],
    ];
    for (const [injection, expected] of cases) {
        const { ctx, st, uninstall } = setup({ injection });
        try {
            st.refreshInjection(makeState());
            const call = last(ctx);
            assert.equal(call.position, expected.position);
            assert.equal(call.role, expected.role);
            assert.equal(call.depth, expected.depth);
        } finally {
            uninstall();
        }
    }
});

test('detail and budget are passed to buildSitrep', () => {
    const { st, sitrepCalls, uninstall } = setup({ injection: { detail: 'full' } });
    try {
        st.refreshInjection(makeState());
        assert.deepEqual(sitrepCalls[0], { budgetTokens: 800, detail: 'full' });
    } finally {
        uninstall();
    }
});

test('clears with "" when there is no campaign', () => {
    const { ctx, st, uninstall } = setup();
    try {
        st.refreshInjection(makeState());
        st.refreshInjection(null);
        assert.equal(last(ctx).value, '');
        assert.equal(last(ctx).key, INJECTION_KEY);
        assert.equal(ctx.extensionPrompts[INJECTION_KEY].value, '');
    } finally {
        uninstall();
    }
});

test('clears with "" when the extension or the injection is disabled', () => {
    for (const settings of [{ enabled: false }, { injection: { enabled: false } }]) {
        const { ctx, st, uninstall } = setup(settings);
        try {
            st.refreshInjection(makeState());
            assert.equal(last(ctx).value, '');
        } finally {
            uninstall();
        }
    }
});

test('updateSettings re-applies the injection with the new position', () => {
    const ctx = createFakeContext();
    const uninstall = installFakeSillyTavern(ctx);
    try {
        const state = makeState();
        const st = createSt({ getState: () => state, buildSitrep: () => 'SITREP' });
        st.updateSettings({ injection: { position: 'before_prompt' } });
        assert.equal(last(ctx).position, 2);
        assert.equal(last(ctx).value, 'SITREP');
        st.updateSettings({ injection: { enabled: false } });
        assert.equal(last(ctx).value, '');
    } finally {
        uninstall();
    }
});

test('a throwing buildSitrep clears instead of throwing', () => {
    const ctx = createFakeContext();
    const uninstall = installFakeSillyTavern(ctx);
    try {
        const st = createSt({ getState: () => null, buildSitrep: () => { throw new Error('bad'); } });
        assert.doesNotThrow(() => st.refreshInjection(makeState()));
        assert.equal(last(ctx).value, '');
    } finally {
        uninstall();
    }
});

test('no SillyTavern: refreshInjection is a no-op', () => {
    const st = createSt({ getState: () => null, buildSitrep: () => 'x' });
    assert.doesNotThrow(() => st.refreshInjection(makeState()));
});
