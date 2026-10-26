/**
 * @file dev/ui-a/preview.js
 * DEV ONLY. Mounts the real UI facade (src/ui/index.js) with the real
 * ScenarioAPI and either the real engine (when src/engine/index.js exists)
 * or the fixture world from ./fixtureWorld.js.
 *
 * URL params: nation=BRA bookmark=b2031 mode=political|diplomatic|military|crisis
 *             select=USA tab=gov|diplo|wars|crises|rank report=1 busy=1 empty=1
 *             pane=map|gov|dossier|news engine=0 focus=ID expand=actionId
 */

import { createScenarioLoader } from '../../src/scenario/index.js';
import { createUi } from '../../src/ui/index.js';
import * as fx from './fixtureWorld.js';

const params = new URLSearchParams(location.search);
const P = (k, d) => params.get(k) ?? d;

async function boot() {
    const scenario = createScenarioLoader();
    const scn = await scenario.load();

    let catalog = [];
    try {
        catalog = (await import('../../src/engine/catalog.js')).CATALOG || [];
    } catch (err) {
        console.warn('[preview] catalog unavailable', err);
    }

    let engine = null;
    if (P('engine', '1') !== '0') {
        try {
            const mod = await import('../../src/engine/index.js');
            engine = mod.createEngine();
        } catch {
            engine = null;
        }
    }

    const opts = { bookmarkId: P('bookmark', 'b2031'), nationId: P('nation', 'BRA'), leaderName: P('leader', 'Helena Duarte') };
    let state = null;
    if (P('empty', '0') !== '1') {
        if (engine) {
            try {
                state = engine.newGame(scn, { ...opts, seed: 'preview' });
            } catch (err) {
                console.warn('[preview] engine.newGame failed, using fixture', err);
                engine = null;
            }
        }
        if (!state) state = fx.buildFixtureState(scn, opts);
    }
    document.documentElement.dataset.engine = engine ? 'real' : 'fixture';

    let settings = {
        enabled: true, ordersMode: 'auto', llmEvents: true, postBulletins: true, engineProfileId: '',
        eventMaxTokens: 1200, showHud: true, showArt: true, difficulty: 'normal',
        injection: { enabled: true, position: 'in_chat', depth: 1, role: 'system', detail: 'compact' },
    };
    let busy = false;
    let ui = null;

    const query = {
        getState: () => state,
        getPlayerActions: (targetId) => {
            if (!state) return [];
            if (engine) return engine.getAvailableActions(state, state.player.nationId, targetId || null);
            return fx.availability(state, catalog, targetId || null);
        },
        getNationView: (id) => (engine ? engine.getNationView(state, id) : fx.nationView(state, id)),
        getRanking: () => (state ? (engine ? engine.getRanking(state) : fx.ranking(state)) : []),
        getSettings: () => settings,
        listConnectionProfiles: () => [{ id: 'p1', name: 'Perfil de teste' }],
        isBusy: () => busy,
    };

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const handlers = {
        onNewCampaign: async () => {
            const res = await ui.showNewCampaignWizard(scn, { defaultLeaderName: 'Helena Duarte' });
            if (!res) return;
            state = engine ? engine.newGame(scn, { ...res, seed: 'preview' }) : fx.buildFixtureState(scn, res);
            ui.refresh();
            await ui.openWarRoom();
        },
        onEndTurn: async () => {
            if (busy || !state) return;
            busy = true;
            ui.setBusy(true, 'O mundo está se movendo…');
            await wait(900);
            let out;
            if (engine) out = engine.endTurn(state);
            else out = fx.simulateTurn(state);
            state = out.state;
            busy = false;
            ui.setBusy(false);
            ui.refresh();
            ui.showTurnReport(out.report);
        },
        onAction: async (actionId, targetId) => {
            if (!state) return;
            let out;
            if (engine) out = engine.executeAction(state, state.player.nationId, actionId, targetId, { source: 'ui' });
            else out = fx.applyAction(state, catalog.find((d) => d.id === actionId), targetId);
            state = out.state;
            ui.showActionResult(out.result);
        },
        onOrder: async (text) => {
            ui.toast(`Ordem recebida pelo gabinete: “${text}”`, 'info');
        },
        onOpenEvent: async () => {
            if (!state || !state.pendingEvent) return;
            const idx = await ui.showEvent(state.pendingEvent, { dismissible: true });
            if (idx == null) return;
            state = { ...state, pendingEvent: null };
            ui.toast(`Decisão registrada (opção ${idx + 1}).`, 'success');
            ui.refresh();
        },
        onSave: () => ui.toast('Campanha salva no chat.', 'success'),
        onResetCampaign: () => {
            state = null;
            ui.refresh();
        },
        onSettingsChange: (patch) => {
            settings = { ...settings, ...patch };
            ui.refresh();
        },
        onImportCharacter: () => ui.toast('Personagem “Conselho de Guerra” importado.', 'success'),
    };

    ui = createUi({ scenario, handlers, query });
    await ui.mount();
    await ui.openWarRoom();

    // Scene setup helpers (also used by the screenshot script through window.__hoi).
    const wr = () => document.querySelector('.hoi-wr');
    const helpers = {
        ui,
        getState: () => state,
        setState: (s) => {
            state = s;
            ui.refresh();
        },
        mode(m) {
            wr().querySelector(`.hoi-map__mode[data-mode="${m}"]`)?.click();
        },
        tab(t) {
            wr().querySelector(`#hoi-wr-tab-${t}`)?.click();
        },
        pane(p) {
            wr().querySelector(`.hoi-wr__mtab[data-pane="${p}"]`)?.click();
        },
        select(id) {
            const path = wr().querySelector(`.hoi-map__c[data-id="${id}"]`);
            if (!path) return false;
            const o = { bubbles: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 };
            path.dispatchEvent(new PointerEvent('pointerdown', o));
            path.dispatchEvent(new PointerEvent('pointerup', o));
            return true;
        },
        expand(actionId) {
            const row = wr().querySelector(`.hoi-act[data-key="${actionId}"] .hoi-act__main`);
            row?.click();
        },
        report() {
            const out = engine ? engine.endTurn(state) : fx.simulateTurn(state);
            state = out.state;
            ui.refresh();
            ui.showTurnReport(out.report);
        },
        engine: () => !!engine,
    };
    window.__hoi = helpers;

    // Wait for the map to load before applying view params.
    for (let i = 0; i < 60 && !wr().querySelector('.hoi-map__c'); i++) await wait(50);
    if (params.has('mode')) helpers.mode(P('mode'));
    if (params.has('tab')) helpers.tab(P('tab'));
    if (params.has('select')) helpers.select(P('select'));
    if (params.has('pane')) helpers.pane(P('pane'));
    if (params.has('expand')) helpers.expand(P('expand'));
    if (P('report', '0') === '1') helpers.report();
    if (P('busy', '0') === '1') ui.setBusy(true, 'Gerando o evento do mês…');
    document.documentElement.dataset.ready = '1';
}

boot().catch((err) => {
    console.error(err);
    document.body.insertAdjacentText('afterbegin', `Falha no preview: ${err && err.message}`);
    document.documentElement.dataset.ready = 'error';
});
