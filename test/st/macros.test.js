import test from 'node:test';
import assert from 'node:assert/strict';

import { createSt } from '../../src/st/index.js';
import { MACRO_NAMES, lastOrderSummaries, registerMacrosOn, buildMacroDefs } from '../../src/st/macros.js';
import { MODULE_KEY } from '../../src/contract/constants.js';
import { createFakeContext, installFakeSillyTavern } from './fakeContext.js';
import { makeState } from './worldFixture.js';

function setup(mutate, state = makeState()) {
    const ctx = createFakeContext();
    if (mutate) mutate(ctx);
    const uninstall = installFakeSillyTavern(ctx);
    let current = state;
    const st = createSt({ getState: () => current, buildSitrep: (s, o) => `SITREP ${s.turn} ${o.detail}` });
    return { ctx, st, uninstall, setState: (s) => { current = s; } };
}

test('new engine: ctx.macros.register(name, { handler, description, category }) for all 7 macros', () => {
    const { ctx, st, uninstall } = setup();
    try {
        st.registerMacros();
        assert.deepEqual(ctx.calls.macrosRegister.map((c) => c.name), MACRO_NAMES);
        for (const { options } of ctx.calls.macrosRegister) {
            assert.equal(typeof options.handler, 'function');
            assert.equal(typeof options.description, 'string');
            assert.equal(options.category, 'misc');
        }
        assert.equal(ctx.calls.registerMacro.length, 0, 'legacy API not used while the new engine is active');
        const value = (name) => ctx.macros.registry.get(name).handler({});
        assert.equal(value('hoi_nation'), 'Brasil');
        assert.equal(value('hoi_leader'), 'Gabriel Lobato');
        assert.equal(value('hoi_title'), 'Presidente');
        assert.equal(value('hoi_date'), 'Outubro de 2026');
        assert.equal(value('hoi_defcon'), 'DEFCON 3 (Alerta)');
        assert.equal(value('hoi_sitrep'), 'SITREP 3 compact');
        assert.equal(value('hoi_orders'), 'Mobilização parcial decretada Aproximação com a Argentina');
    } finally {
        uninstall();
    }
});

test('registerMacros is idempotent', () => {
    const { ctx, st, uninstall } = setup();
    try {
        st.registerMacros();
        st.registerMacros();
        assert.equal(ctx.calls.macrosRegister.length, MACRO_NAMES.length);
    } finally {
        uninstall();
    }
});

test('fallback: ctx.registerMacro(key, fn, description) when ctx.macros is missing', () => {
    const { ctx, st, uninstall } = setup((c) => {
        delete c.macros;
    });
    try {
        st.registerMacros();
        assert.deepEqual(ctx.calls.registerMacro.map((c) => c.key), MACRO_NAMES);
        for (const call of ctx.calls.registerMacro) {
            assert.equal(typeof call.value, 'function');
            assert.equal(typeof call.description, 'string');
        }
        assert.equal(ctx.calls.registerMacro.find((c) => c.key === 'hoi_nation').value(), 'Brasil');
    } finally {
        uninstall();
    }
});

test('both APIs when the user turned the new macro engine off (power-user.js:302)', () => {
    const { ctx, st, uninstall } = setup((c) => {
        c.powerUserSettings.experimental_macro_engine = false;
    });
    try {
        st.registerMacros();
        assert.equal(ctx.calls.macrosRegister.length, MACRO_NAMES.length);
        assert.equal(ctx.calls.registerMacro.length, MACRO_NAMES.length);
    } finally {
        uninstall();
    }
});

test('macros return "" without a campaign or when the extension is disabled', () => {
    const { ctx, st, uninstall, setState } = setup();
    try {
        st.registerMacros();
        setState(null);
        for (const name of MACRO_NAMES) assert.equal(ctx.macros.registry.get(name).handler({}), '', name);
        setState(makeState());
        ctx.extensionSettings[MODULE_KEY] = { enabled: false };
        assert.equal(ctx.macros.registry.get('hoi_nation').handler({}), '');
    } finally {
        uninstall();
    }
});

test('registerMacrosOn: new-engine rejection (returns null) falls back to legacy', () => {
    const ctx = createFakeContext();
    ctx.macros.register = () => null; // MacroRegistry.registerMacro returns null on failure (MacroRegistry.js:226)
    const defs = buildMacroDefs({ getState: () => null, isEnabled: () => true, sitrep: () => '' });
    const res = registerMacrosOn(ctx, defs);
    assert.equal(res.api, 'legacy');
    assert.equal(ctx.calls.registerMacro.length, MACRO_NAMES.length);
    assert.deepEqual(registerMacrosOn(null, defs), { api: 'none', names: [] });
});

test('lastOrderSummaries: latest turn with chat orders, max 3', () => {
    assert.deepEqual(lastOrderSummaries(makeState()), ['Mobilização parcial decretada', 'Aproximação com a Argentina']);
    assert.deepEqual(lastOrderSummaries(makeState({ recentActions: [] })), []);
});
