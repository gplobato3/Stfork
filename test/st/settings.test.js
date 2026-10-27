import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_SETTINGS,
    normalizeSettings,
    applySettingsPatch,
    injectionParams,
    sitrepBudget,
    EXTENSION_PROMPT_TYPES,
    EXTENSION_PROMPT_ROLES,
} from '../../src/st/settings.js';
import { createSt } from '../../src/st/index.js';
import { MODULE_KEY } from '../../src/contract/constants.js';
import { createFakeContext, installFakeSillyTavern } from './fakeContext.js';

const deps = { getState: () => null, buildSitrep: () => '' };

test('defaults match DESIGN §5', () => {
    assert.deepEqual(normalizeSettings(undefined), {
        enabled: true,
        injection: { enabled: true, position: 'in_chat', depth: 1, role: 'system', detail: 'compact' },
        ordersMode: 'auto',
        llmEvents: true,
        postBulletins: true,
        engineProfileId: '',
        eventMaxTokens: 1200,
        showHud: true,
        showArt: true,
        difficulty: 'normal',
    });
    assert.equal(DEFAULT_SETTINGS.injection.position, 'in_chat');
});

test('normalizeSettings deep-merges partial and invalid stored values', () => {
    const s = normalizeSettings({
        injection: { position: 'before_prompt', depth: '4', role: 'nonsense' },
        ordersMode: 'banana',
        eventMaxTokens: 99999,
        showArt: false,
        legacyKey: 1,
    });
    assert.equal(s.injection.position, 'before_prompt');
    assert.equal(s.injection.depth, 4);
    assert.equal(s.injection.role, 'system');
    assert.equal(s.injection.enabled, true);
    assert.equal(s.injection.detail, 'compact');
    assert.equal(s.ordersMode, 'auto');
    assert.equal(s.eventMaxTokens, 8000);
    assert.equal(s.showArt, false);
    assert.equal('legacyKey' in s, false);
});

test('applySettingsPatch merges nested injection patches', () => {
    const base = normalizeSettings({ injection: { depth: 3 } });
    const next = applySettingsPatch(base, { injection: { role: 'user' }, llmEvents: false });
    assert.equal(next.injection.depth, 3);
    assert.equal(next.injection.role, 'user');
    assert.equal(next.llmEvents, false);
});

test('injectionParams maps names to the numeric ST enums (script.js:484/494)', () => {
    const cases = [
        ['in_prompt', 'system', 0, 0],
        ['in_chat', 'user', 1, 1],
        ['before_prompt', 'assistant', 2, 2],
    ];
    for (const [position, role, p, r] of cases) {
        const params = injectionParams(normalizeSettings({ injection: { position, role, depth: 7 } }));
        assert.deepEqual(params, { position: p, depth: 7, role: r });
    }
    assert.equal(EXTENSION_PROMPT_TYPES.NONE, -1);
    assert.equal(EXTENSION_PROMPT_ROLES.ASSISTANT, 2);
});

test('sitrepBudget scales with contextSize and caps per detail', () => {
    assert.equal(sitrepBudget(undefined, 'compact'), 400);
    assert.equal(sitrepBudget(undefined, 'full'), 800);
    assert.equal(sitrepBudget(2000, 'compact'), 120);
    assert.equal(sitrepBudget(4096, 'compact'), 245);
    assert.equal(sitrepBudget(32000, 'compact'), 400);
    assert.equal(sitrepBudget(32000, 'full'), 800);
});

test('StAPI settings store: merges extensionSettings[MODULE_KEY] and saves debounced', () => {
    const ctx = createFakeContext();
    ctx.extensionSettings[MODULE_KEY] = { ordersMode: 'command', injection: { depth: 2 } };
    const uninstall = installFakeSillyTavern(ctx);
    try {
        const st = createSt(deps);
        const s = st.getSettings();
        assert.equal(s.ordersMode, 'command');
        assert.equal(s.injection.depth, 2);
        assert.equal(s.injection.position, 'in_chat');
        // normalized object written back for ST to persist
        assert.equal(ctx.extensionSettings[MODULE_KEY].injection.role, 'system');

        const updated = st.updateSettings({ injection: { detail: 'full' }, difficulty: 'dificil' });
        assert.equal(updated.injection.detail, 'full');
        assert.equal(updated.injection.depth, 2);
        assert.equal(ctx.extensionSettings[MODULE_KEY].difficulty, 'dificil');
        assert.equal(ctx.calls.saveSettingsDebounced, 1);

        // returned objects are copies
        updated.injection.depth = 99;
        assert.equal(st.getSettings().injection.depth, 2);
    } finally {
        uninstall();
    }
});

test('StAPI settings work without SillyTavern (node / early load)', () => {
    const st = createSt(deps);
    assert.equal(st.isLive(), false);
    assert.equal(st.getSettings().ordersMode, 'auto');
    assert.equal(st.updateSettings({ ordersMode: 'off' }).ordersMode, 'off');
    assert.equal(st.getSettings().ordersMode, 'off');
});
