/**
 * dev/ui-b/st-shell.js — mounts the HUD, the settings drawer and the wand item
 * inside a SillyTavern DOM skeleton styled by ST's real CSS.
 * Query params:
 *   drawer=1     open the Extensions drawer with "Grande Estratégia" expanded
 *   wand=1       show the extensions (wand) menu
 *   hud=none|campaign|collapsed|busy
 */

import { createHud, HUD_COLLAPSE_KEY } from '../../src/ui/hud/hud.js';
import { mountSettingsPanel } from '../../src/ui/settings/settingsPanel.js';
import { addWandMenuItem } from '../../src/ui/wand.js';
import { normalizeSettings } from '../../src/ui/settings/settingsModel.js';
import { makeState } from './fixtures.js';

const params = new URLSearchParams(location.search);
const assetUrl = (p) => new URL(`../../assets/${p}`, import.meta.url).href;
const calls = [];
const record = (name, payload) => {
    calls.push(payload === undefined ? name : [name, payload]);
    window.__hoiCalls = calls;
    console.log('[st-shell]', name, payload ?? '');
};

// ---- Minimal stand-ins for ST behaviour this page relies on --------------
// public/script.js:12193 — delegated inline-drawer toggle.
document.addEventListener('click', (e) => {
    const toggle = e.target instanceof Element ? e.target.closest('.inline-drawer-toggle') : null;
    if (!toggle || (e.target instanceof Element && e.target.classList.contains('text_pole'))) return;
    const drawer = toggle.closest('.inline-drawer');
    const icon = drawer.querySelector(':scope > .inline-drawer-header .inline-drawer-icon');
    const content = drawer.querySelector(':scope > .inline-drawer-content');
    icon.classList.toggle('down');
    icon.classList.toggle('up');
    icon.classList.toggle('fa-circle-chevron-down');
    icon.classList.toggle('fa-circle-chevron-up');
    content.style.display = content.style.display === 'block' ? 'none' : 'block';
});
// public/scripts/keyboard.js handleGlobalKeyDown — Enter clicks the focused .interactable.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLElement)) return;
    const target = e.target.closest('.interactable');
    if (target) target.click();
});

// ---- Settings ------------------------------------------------------------
let settings = normalizeSettings({});
const panel = mountSettingsPanel({
    getSettings: () => settings,
    onChange: (patch) => {
        settings = normalizeSettings({ ...settings, ...patch });
        record('onChange', patch);
        hud.update(state, { busy, settings });
    },
    onOpenWarRoom: () => record('onOpenWarRoom'),
    onNewCampaign: () => record('onNewCampaign'),
    onImportCharacter: () => record('onImportCharacter'),
    onResetCampaign: () => record('onResetCampaign'),
    listConnectionProfiles: () => [
        { id: 'p-fast', name: 'Gemini Flash (rápido)' },
        { id: 'p-main', name: 'Claude — Roleplay' },
    ],
});

// ---- Wand ------------------------------------------------------------------
const removeWand = addWandMenuItem({ label: 'Grande Estratégia', icon: 'fa-earth-americas', onClick: () => record('wand') });
// Idempotency check: a second call with the same label replaces the item.
addWandMenuItem({ label: 'Grande Estratégia', icon: 'fa-earth-americas', onClick: () => record('wand') });

// ---- HUD -------------------------------------------------------------------
const mode = params.get('hud') || 'campaign';
try { localStorage.setItem(HUD_COLLAPSE_KEY, mode === 'collapsed' ? '1' : '0'); } catch { /* ignore */ }
let state = mode === 'none' ? null : makeState();
let busy = mode === 'busy';
const hud = createHud({
    onOpenWarRoom: () => record('hud:onOpenWarRoom'),
    onEndTurn: () => record('hud:onEndTurn'),
    onOpenEvent: () => record('hud:onOpenEvent'),
    assetUrl,
});
hud.mount();
hud.update(state, { busy, settings });

if (params.get('drawer') === '1') {
    const block = document.getElementById('rm_extensions_block');
    block.classList.remove('closedDrawer');
    block.classList.add('openDrawer');
    document.querySelector('#hoi_settings .inline-drawer-toggle')?.click();
}
if (params.get('wand') === '1') document.getElementById('extensionsMenu').classList.add('dev-open');

window.hoiShell = { panel, hud, removeWand, calls, setState: (s, b = false) => { state = s; busy = b; hud.update(state, { busy, settings }); } };

if (params.get('selftest') === '1') {
    const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
    const results = [];
    const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
    const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const count = (name) => calls.filter((c) => c === name || (Array.isArray(c) && c[0] === name)).length;

    // Settings drawer markup + placement.
    const root = document.getElementById('hoi_settings');
    check('settings: inside #extensions_settings2', root && root.parentElement.id === 'extensions_settings2');
    check('settings: ST inline-drawer structure', root.querySelector(':scope > .inline-drawer > .inline-drawer-toggle.inline-drawer-header .inline-drawer-icon') && root.querySelector(':scope > .inline-drawer > .inline-drawer-content'));
    check('settings: title', root.querySelector('.inline-drawer-header b').textContent === 'Grande Estratégia');

    const cb = document.getElementById('hoi_show_hud');
    cb.click();
    await wait();
    check('settings: checkbox -> onChange({showHud:false})', JSON.stringify(calls.at(-1)) === JSON.stringify(['onChange', { showHud: false }]), JSON.stringify(calls.at(-1)));
    check('settings: HUD hidden after showHud=false', document.getElementById('hoi_hud').hidden === true);
    cb.click();
    await wait();
    check('settings: HUD back', document.getElementById('hoi_hud').hidden === false);

    const pos = document.getElementById('hoi_injection_position');
    pos.value = 'in_prompt';
    pos.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
    check('settings: nested injection patch sent whole', JSON.stringify(calls.at(-1)[1]) === JSON.stringify({ injection: { enabled: true, position: 'in_prompt', depth: 1, role: 'system', detail: 'compact' } }), JSON.stringify(calls.at(-1)));
    check('settings: depth disabled outside in_chat', document.getElementById('hoi_injection_depth').disabled === true);
    const depth = document.getElementById('hoi_injection_depth');
    pos.value = 'in_chat';
    pos.dispatchEvent(new Event('change', { bubbles: true }));
    depth.value = '999';
    depth.dispatchEvent(new Event('change', { bubbles: true }));
    await wait();
    check('settings: depth clamped and re-synced', depth.value === '50' && settings.injection.depth === 50, depth.value);
    const prof = document.getElementById('hoi_engine_profile');
    check('settings: profiles listed', prof.options.length === 3 && prof.options[1].textContent === 'Gemini Flash (rápido)');

    const before = count('onNewCampaign');
    const bNew = document.getElementById('hoi_new_campaign');
    bNew.focus();
    press(bNew, 'Enter');
    press(bNew, ' ');
    bNew.click();
    check('settings: Enter/Space/click fire exactly once each (no ST double-fire)', count('onNewCampaign') - before === 3, count('onNewCampaign') - before);

    document.getElementById('hoi_reset_campaign').click();
    await wait(60);
    const danger = document.querySelector('.hoi-modal-layer:not(.is-closing) .hoi-btn--danger');
    check('settings: reset asks for confirmation', !!danger && count('onResetCampaign') === 0);
    danger.click();
    await wait(60);
    check('settings: confirmed reset calls onResetCampaign', count('onResetCampaign') === 1);

    panel.refresh();
    check('settings: refresh keeps values', document.getElementById('hoi_injection_depth').value === '50');

    // Wand.
    const items = document.querySelectorAll('#extensionsMenu #hoi_wand_grande_estrategia');
    check('wand: one item (idempotent by id)', items.length === 1, items.length);
    const item = items[0];
    check('wand: ST markup', item.matches('.list-group-item.flex-container.flexGap5.interactable[tabindex="0"]') && item.querySelector('.fa-solid.fa-earth-americas.extensionsMenuExtensionButton'));
    item.focus();
    press(item, 'Enter');
    check('wand: Enter fires once', count('wand') === 1, count('wand'));
    removeWand();
    check('wand: remove()', !document.getElementById('hoi_wand_grande_estrategia'));

    // HUD.
    const hudEl = document.getElementById('hoi_hud');
    check('hud: first flow child before #chat', hudEl.nextElementSibling && hudEl.nextElementSibling.id === 'chat' && hudEl.parentElement.id === 'sheld');
    const top = document.getElementById('top-bar').getBoundingClientRect();
    const hb = hudEl.getBoundingClientRect();
    const chat = document.getElementById('chat').getBoundingClientRect();
    check('hud: below the top bar', hb.top >= top.bottom - 1, `${hb.top} vs ${top.bottom}`);
    check('hud: chat starts below the HUD (no overlap)', chat.top >= hb.bottom - 1, `${chat.top} vs ${hb.bottom}`);
    check('hud: form still visible', document.getElementById('form_sheld').getBoundingClientRect().bottom <= window.innerHeight + 1);
    hudEl.querySelector('.hoi-hud__end').click();
    hudEl.querySelector('.hoi-hud__pending').click();
    hudEl.querySelector('.hoi-hud__warroom').click();
    check('hud: handlers', count('hud:onEndTurn') === 1 && count('hud:onOpenEvent') === 1 && count('hud:onOpenWarRoom') === 1);
    window.hoiShell.setState(makeState(), true);
    check('hud: busy disables Avançar Mês', hudEl.querySelector('.hoi-hud__end').disabled === true);
    hudEl.querySelector('.hoi-hud__collapse').click();
    check('hud: collapse persists', localStorage.getItem(HUD_COLLAPSE_KEY) === '1' && hudEl.querySelector('.hoi-hud__chip'));
    hudEl.querySelector('.hoi-hud__chip').click();
    check('hud: expand persists', localStorage.getItem(HUD_COLLAPSE_KEY) === '0' && hudEl.querySelector('.hoi-hud__bar'));
    window.hoiShell.setState(null);
    hudEl.querySelector('.hoi-hud__chip--start').click();
    check('hud: start chip -> onOpenWarRoom', count('hud:onOpenWarRoom') === 2);
    hud.unmount();
    check('hud: unmount', !document.getElementById('hoi_hud'));
    panel.unmount();
    check('settings: unmount', !document.getElementById('hoi_settings'));

    const failed = results.filter((x) => !x.ok);
    window.__selftest = { passed: results.length - failed.length, failed, total: results.length };
}
