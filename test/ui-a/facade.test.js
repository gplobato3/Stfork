import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashString, jitter, mix, rgbToHex, hexToRgb, colorKey } from '../../src/ui/map/color.js';

const UI_API_METHODS = [
    'mount', 'unmount', 'openWarRoom', 'closeWarRoom', 'refresh', 'showNewCampaignWizard', 'showEvent',
    'showTurnReport', 'showActionResult', 'showGameOver', 'setBusy', 'toast', 'confirm',
];

test('src/ui/index.js imports under node and createUi returns the full UiAPI without touching the DOM', async () => {
    assert.equal(typeof globalThis.document, 'undefined');
    const mod = await import('../../src/ui/index.js');
    assert.equal(typeof mod.createUi, 'function');
    const ui = mod.createUi({
        scenario: { assetUrl: (p) => `/ext/assets/${p}`, load: async () => ({}), loadMap: async () => ({}) },
        handlers: {},
        query: { getState: () => null, getSettings: () => ({}), isBusy: () => false },
    });
    for (const m of UI_API_METHODS) assert.equal(typeof ui[m], 'function', m);
    assert.equal(mod.WAND_LABEL, 'Grande Estratégia');
    assert.equal(mod.WAND_ICON, 'fa-earth-americas');
});

test('createUi requires its dependencies', async () => {
    const { createUi } = await import('../../src/ui/index.js');
    assert.throws(() => createUi({}), /required/);
});

test('every War Room / map module imports under node', async () => {
    for (const p of [
        '../../src/ui/warroom/warRoom.js', '../../src/ui/warroom/topBar.js', '../../src/ui/warroom/leftPanel.js',
        '../../src/ui/warroom/dossier.js', '../../src/ui/warroom/bottomBar.js', '../../src/ui/warroom/turnReport.js',
        '../../src/ui/warroom/gameMenu.js', '../../src/ui/warroom/toasts.js', '../../src/ui/warroom/actionList.js',
        '../../src/ui/map/mapView.js',
    ]) {
        const mod = await import(p);
        assert.ok(Object.keys(mod).length > 0, p);
    }
});

test('color helpers: mix, deterministic jitter, keys', () => {
    assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
    assert.equal(mix('#102030', '#102030', 0.7), '#102030');
    assert.equal(rgbToHex(hexToRgb('#abc')), '#aabbcc');
    assert.equal(hashString('BRA'), hashString('BRA'));
    assert.equal(jitter('#3d6fa8', 'BRA'), jitter('#3d6fa8', 'BRA'));
    assert.notEqual(jitter('#3d6fa8', 'BRA'), jitter('#3d6fa8', 'ARG'));
    assert.equal(colorKey('#A8433D'), 'a8433d');
    assert.equal(rgbToHex(hexToRgb('nonsense')), '#59605a');
});
