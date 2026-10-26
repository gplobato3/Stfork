/**
 * dev/ui-b/preview.js — standalone harness for the UI-B surfaces.
 * Query params:
 *   open=wizard|wizard2|wizard3|event|event-noart|event-engine|victory|defeat|confirm|danger|stack
 *   hud=campaign|calm|busy|over|none|collapsed|hidden
 *   panel=0       hide the dev panel (screenshots)
 *   data=real     load assets/scenario/*.json instead of the fixtures
 */

import { openWizard } from '../../src/ui/dialogs/wizard.js';
import { openEventDialog } from '../../src/ui/dialogs/eventDialog.js';
import { openGameOver } from '../../src/ui/dialogs/gameOver.js';
import { openConfirm } from '../../src/ui/dialogs/confirm.js';
import { closeAllModals } from '../../src/ui/dialogs/modalHost.js';
import { createHud, HUD_COLLAPSE_KEY } from '../../src/ui/hud/hud.js';
import { EVENT_ALL_EFFECTS, EVENT_ENGINE, RANKING, SCENARIO, makeState } from './fixtures.js';

const params = new URLSearchParams(location.search);
const assetUrl = (p) => new URL(`../../assets/${p}`, import.meta.url).href;
const logEl = document.getElementById('log');
const log = (label, value) => {
    const line = `${label}: ${JSON.stringify(value)}`;
    console.log('[preview]', line);
    if (logEl) logEl.textContent = line;
    window.__hoiLast = { label, value };
};

if (params.get('panel') === '0') document.body.classList.add('no-panel');
// Simulate ST's chat-column width setting (--sheldWidth), e.g. sheld=960 or sheld=683.
if (params.get('sheld')) document.getElementById('sheld').style.width = `min(${Number(params.get('sheld')) || 800}px, 100%)`;

async function loadRealScenario() {
    const base = new URL('../../assets/scenario/', import.meta.url);
    const get = async (f) => {
        const r = await fetch(new URL(f, base));
        if (!r.ok) throw new Error(`${f}: ${r.status}`);
        return r.json();
    };
    const [nations, relations, pacts, wars, crises, bookmarks] = await Promise.all(
        ['nations.json', 'relations.json', 'pacts.json', 'wars.json', 'crises.json', 'bookmarks.json'].map(get));
    let minors = {};
    try { minors = await get('minors.json'); } catch { /* optional */ }
    const all = {};
    const rel = Array.isArray(relations) ? Object.fromEntries(relations.map((r) => [[r.a, r.b].sort().join('|'), r.value])) : relations;
    for (const [id, n] of Object.entries({ ...(Array.isArray(minors) ? {} : minors), ...nations })) {
        all[id] = { pc: 5, status: 'active', controller: id, overlord: null, ...n, id: n.id || id };
    }
    return { id: 'real', name: 'Real', nations: all, relations: rel || {}, pacts, wars, crises, bookmarks, neighbors: {} };
}

let scenario = SCENARIO;
if (params.get('data') === 'real') {
    try {
        scenario = await loadRealScenario();
        log('data', `real scenario: ${Object.keys(scenario.nations).length} nations`);
    } catch (err) {
        log('data', `fixtures (real failed: ${err.message})`);
    }
}

// ------------------------------------------------------------------ HUD
const hud = createHud({
    onOpenWarRoom: () => log('hud', 'onOpenWarRoom'),
    onEndTurn: () => {
        log('hud', 'onEndTurn');
        setHud('busy');
        setTimeout(() => setHud('calm'), 1600);
    },
    onOpenEvent: () => open('event'),
    assetUrl,
});
hud.mount();

function setHud(mode) {
    const settings = { showHud: true, enabled: true };
    let state = makeState();
    let busy = false;
    try { localStorage.setItem(HUD_COLLAPSE_KEY, mode === 'collapsed' ? '1' : '0'); } catch { /* ignore */ }
    if (mode === 'calm') state = makeState({ pendingEvent: null, eventQueue: [] });
    if (mode === 'busy') { state = makeState({ pendingEvent: null, eventQueue: [] }); busy = true; }
    if (mode === 'over') state = makeState({ phase: 'GAME_OVER', outcome: { kind: 'victory', reason: 'Fim do mandato.', turn: 120 }, pendingEvent: null, eventQueue: [] });
    if (mode === 'none') state = null;
    if (mode === 'hidden') settings.showHud = false;
    hud.unmount();
    hud.mount();
    hud.update(state, { busy, settings });
    log('hud', mode);
}

// -------------------------------------------------------------- dialogs
async function open(name) {
    const state = makeState();
    switch (name) {
        case 'wizard':
        case 'wizard2':
        case 'wizard3': {
            const p = openWizard({ scenario, assetUrl, defaultLeaderName: 'Helena Duarte', defaultDifficulty: 'normal' });
            const steps = name === 'wizard3' ? 2 : name === 'wizard2' ? 1 : 0;
            for (let i = 0; i < steps; i += 1) {
                await new Promise((r) => setTimeout(r, 30));
                document.querySelector('.hoi-wizard__next')?.click();
            }
            log('wizard', await p);
            break;
        }
        case 'event':
            log('event', await openEventDialog({ event: EVENT_ALL_EFFECTS, state, assetUrl, showArt: true, dismissible: true }));
            break;
        case 'event-dip':
            log('event', await openEventDialog({ event: { ...EVENT_ALL_EFFECTS, category: 'diplomacy' }, state, assetUrl, showArt: true, dismissible: true }));
            break;
        case 'event-noart':
            log('event', await openEventDialog({ event: { ...EVENT_ALL_EFFECTS, category: 'cyber', source: 'fallback' }, state, assetUrl, showArt: false, dismissible: true }));
            break;
        case 'event-engine':
            log('event', await openEventDialog({ event: EVENT_ENGINE, state, assetUrl, showArt: true, dismissible: false }));
            break;
        case 'victory':
            log('gameover', await openGameOver({
                outcome: { kind: 'victory', reason: 'O Brasil chegou a 2036 inteiro, respeitado e fora da guerra nuclear. Seu governo entra para a história como o que manteve o continente em paz.' },
                state: makeState({ turn: 121, date: { year: 2036, month: 10 }, globalTension: 38 }),
                ranking: RANKING,
                assetUrl,
            }));
            break;
        case 'defeat':
            log('gameover', await openGameOver({
                outcome: { kind: 'defeat', reason: 'Golpe de Estado: com a estabilidade em zero por dois meses, os militares tomaram o Palácio do Planalto.' },
                state: makeState({ turn: 31, date: { year: 2029, month: 4 }, globalTension: 81 }),
                ranking: RANKING,
                assetUrl,
            }));
            break;
        case 'confirm':
            log('confirm', await openConfirm({ title: 'Declarar guerra à Venezuela?', text: 'A declaração ativa chamados às armas dos aliados de Caracas e eleva a tensão global.\nCusto: 8 de Capital Político.', okLabel: 'Declarar guerra', cancelLabel: 'Voltar' }));
            break;
        case 'danger':
            log('confirm', await openConfirm({ title: 'Apagar campanha?', text: 'A campanha salva neste chat será apagada de vez.\nAs mensagens do chat não são afetadas.', okLabel: 'Apagar campanha', cancelLabel: 'Manter', danger: true }));
            break;
        case 'stack': {
            const ev = openEventDialog({ event: EVENT_ALL_EFFECTS, state, assetUrl, showArt: true, dismissible: true });
            await new Promise((r) => setTimeout(r, 60));
            log('stack-confirm', await openConfirm({ title: 'Confirmar mobilização?', text: 'Diálogo empilhado sobre o evento. Esc fecha só este.', okLabel: 'Confirmar' }));
            log('stack-event', await ev);
            break;
        }
        default:
            break;
    }
}

for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => open(b.dataset.open));
for (const b of document.querySelectorAll('[data-hud]')) b.addEventListener('click', () => setHud(b.dataset.hud));

window.hoiPreview = { open, setHud, closeAllModals, hud, scenario };

setHud(params.get('hud') || 'campaign');
if (params.get('open')) open(params.get('open'));
if (params.get('selftest') === '1') {
    const { runSelftest } = await import('./selftest.js');
    await runSelftest();
}
