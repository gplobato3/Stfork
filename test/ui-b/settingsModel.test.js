import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, LIMITS, normalizeSettings, settingsPatch } from '../../src/ui/settings/settingsModel.js';

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
    assert.deepEqual(normalizeSettings(DEFAULT_SETTINGS), normalizeSettings({}));
});

test('normalizeSettings coerces and clamps every field', () => {
    const s = normalizeSettings({
        enabled: 'false',
        injection: { enabled: 0, position: 'before_prompt', depth: '7', role: 'user', detail: 'full' },
        ordersMode: 'command',
        llmEvents: 'true',
        postBulletins: false,
        engineProfileId: '  abc  ',
        eventMaxTokens: '2000',
        showHud: false,
        showArt: 1,
        difficulty: 'dificil',
    });
    assert.deepEqual(s, {
        enabled: false,
        injection: { enabled: false, position: 'before_prompt', depth: 7, role: 'user', detail: 'full' },
        ordersMode: 'command',
        llmEvents: true,
        postBulletins: false,
        engineProfileId: 'abc',
        eventMaxTokens: 2000,
        showHud: false,
        showArt: true,
        difficulty: 'dificil',
    });
    const bad = normalizeSettings({
        enabled: 'maybe',
        injection: { position: 'top', depth: -5, role: 'narrator', detail: 'huge' },
        ordersMode: 'always',
        engineProfileId: 42,
        eventMaxTokens: 99999,
        difficulty: 'insane',
    });
    assert.equal(bad.enabled, true);
    assert.equal(bad.injection.position, 'in_chat');
    assert.equal(bad.injection.depth, LIMITS.depth.min);
    assert.equal(bad.injection.role, 'system');
    assert.equal(bad.injection.detail, 'compact');
    assert.equal(bad.ordersMode, 'auto');
    assert.equal(bad.engineProfileId, '');
    assert.equal(bad.eventMaxTokens, LIMITS.eventMaxTokens.max);
    assert.equal(bad.difficulty, 'normal');
    assert.equal(normalizeSettings({ injection: { depth: 999 } }).injection.depth, LIMITS.depth.max);
    assert.equal(normalizeSettings({ eventMaxTokens: '' }).eventMaxTokens, 1200);
    assert.equal(normalizeSettings({ injection: { depth: 2.6 } }).injection.depth, 3);
    assert.equal(normalizeSettings('garbage').ordersMode, 'auto');
});

test('normalizeSettings does not mutate its input', () => {
    const raw = { injection: { depth: '3' }, eventMaxTokens: '900' };
    const copy = JSON.stringify(raw);
    normalizeSettings(raw);
    assert.equal(JSON.stringify(raw), copy);
});

test('settingsPatch: top-level fields', () => {
    const cur = normalizeSettings({});
    assert.deepEqual(settingsPatch(cur, 'showHud', false), { showHud: false });
    assert.deepEqual(settingsPatch(cur, 'ordersMode', 'off'), { ordersMode: 'off' });
    assert.deepEqual(settingsPatch(cur, 'ordersMode', 'bogus'), { ordersMode: 'auto' }, 'invalid keeps current');
    assert.deepEqual(settingsPatch(normalizeSettings({ eventMaxTokens: 1500 }), 'eventMaxTokens', 'abc'), { eventMaxTokens: 1500 });
    assert.deepEqual(settingsPatch(cur, 'eventMaxTokens', '100'), { eventMaxTokens: LIMITS.eventMaxTokens.min });
    assert.deepEqual(settingsPatch(cur, 'engineProfileId', 'p-1'), { engineProfileId: 'p-1' });
    assert.deepEqual(settingsPatch(cur, 'difficulty', 'facil'), { difficulty: 'facil' });
    assert.deepEqual(settingsPatch(cur, 'nope', 1), {});
});

test('settingsPatch: nested injection fields are sent whole', () => {
    const cur = normalizeSettings({ injection: { position: 'in_prompt', depth: 4 } });
    assert.deepEqual(settingsPatch(cur, 'injection.depth', '2'), {
        injection: { enabled: true, position: 'in_prompt', depth: 2, role: 'system', detail: 'compact' },
    });
    assert.equal(settingsPatch(cur, 'injection.depth', 'abc').injection.depth, 4, 'invalid keeps current');
    assert.equal(settingsPatch(cur, 'injection.position', 'nowhere').injection.position, 'in_prompt');
    assert.equal(settingsPatch(cur, 'injection.role', 'assistant').injection.role, 'assistant');
    assert.equal(settingsPatch(cur, 'injection.enabled', false).injection.enabled, false);
    assert.equal(settingsPatch(cur, 'injection.detail', 'full').injection.detail, 'full');
});
