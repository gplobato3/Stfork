import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = [
    ...readdirSync(path.join(root, 'src/ui/dialogs')).filter((f) => f.endsWith('.js')).map((f) => `src/ui/dialogs/${f}`),
    ...readdirSync(path.join(root, 'src/ui/hud')).filter((f) => f.endsWith('.js')).map((f) => `src/ui/hud/${f}`),
    ...readdirSync(path.join(root, 'src/ui/settings')).filter((f) => f.endsWith('.js')).map((f) => `src/ui/settings/${f}`),
    'src/ui/wand.js',
];

test('every UI-B module imports under node without DOM/ST access', async () => {
    assert.equal(typeof globalThis.document, 'undefined');
    for (const f of files) {
        await assert.doesNotReject(import(pathToFileURL(path.join(root, f)).href), f);
    }
});

test('DESIGN §6.2 exports exist with the documented names', async () => {
    const mod = async (f) => import(pathToFileURL(path.join(root, f)).href);
    const expected = {
        'src/ui/dialogs/modalHost.js': ['openModal'],
        'src/ui/dialogs/wizard.js': ['openWizard'],
        'src/ui/dialogs/eventDialog.js': ['openEventDialog'],
        'src/ui/dialogs/effectPreview.js': ['describeEffect'],
        'src/ui/dialogs/gameOver.js': ['openGameOver'],
        'src/ui/dialogs/confirm.js': ['openConfirm'],
        'src/ui/hud/hud.js': ['createHud'],
        'src/ui/settings/settingsPanel.js': ['mountSettingsPanel'],
        'src/ui/wand.js': ['addWandMenuItem'],
    };
    for (const [f, names] of Object.entries(expected)) {
        const m = await mod(f);
        for (const n of names) assert.equal(typeof m[n], 'function', `${f} exports ${n}`);
    }
});

test('DOM entry points degrade to no-ops without a document', async () => {
    const { addWandMenuItem } = await import(pathToFileURL(path.join(root, 'src/ui/wand.js')).href);
    const { mountSettingsPanel } = await import(pathToFileURL(path.join(root, 'src/ui/settings/settingsPanel.js')).href);
    const { createHud } = await import(pathToFileURL(path.join(root, 'src/ui/hud/hud.js')).href);
    const remove = addWandMenuItem({ label: 'Grande Estratégia', icon: 'fa-earth-americas', onClick() {} });
    assert.equal(typeof remove, 'function');
    assert.doesNotThrow(remove);
    const panel = mountSettingsPanel({ getSettings: () => ({}), onChange() {} });
    assert.equal(typeof panel.refresh, 'function');
    assert.equal(typeof panel.unmount, 'function');
    assert.doesNotThrow(() => panel.refresh());
    const hud = createHud({});
    assert.doesNotThrow(() => hud.mount());
    assert.doesNotThrow(() => hud.update(null, { busy: false, settings: {} }));
    assert.doesNotThrow(() => hud.unmount());
});
