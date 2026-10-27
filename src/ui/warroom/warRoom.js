/**
 * @file src/ui/warroom/warRoom.js
 * The full-screen "Sala de Guerra": composes the top bar, the left tabbed
 * panel, the map, the dossier, the bottom ticker/order box and the slide-in
 * turn report. Built lazily on first open; refreshes are incremental.
 */

import { resourceDeltaLine } from '../../contract/presentation.js';
import { playerNation } from '../../contract/worldState.js';
import { createMapView } from '../map/mapView.js';
import { buildWorldIndex } from '../map/mapModel.js';
import { createBottomBar } from './bottomBar.js';
import { createDossier } from './dossier.js';
import { h, icon, isTypingTarget, setText, toggleClass } from './dom.js';
import { openGameMenu } from './gameMenu.js';
import { createLeftPanel } from './leftPanel.js';
import { createTopBar } from './topBar.js';
import { createTurnReportPanel } from './turnReport.js';
import { resourceDeltas, topBarModel, turnReportModel } from './viewModel.js';

export const MOBILE_PANES = Object.freeze([
    { id: 'map', label: 'Mapa', icon: 'fa-solid fa-map' },
    { id: 'gov', label: 'Governo', icon: 'fa-solid fa-landmark' },
    { id: 'dossier', label: 'Dossiê', icon: 'fa-solid fa-folder-open' },
    { id: 'news', label: 'Notícias', icon: 'fa-solid fa-newspaper' },
]);

const MOBILE_QUERY = '(max-width: 800px)';

/**
 * @param {Object} deps
 * @param {{assetUrl:(p:string)=>string, loadMap:()=>Promise<Object>}} deps.scenario
 * @param {Object} deps.handlers UiHandlers
 * @param {Object} deps.query UiQuery
 * @param {(opts:Object)=>Promise<boolean>} deps.openConfirm
 * @param {(opts:Object)=>{close:Function}} deps.openModal
 * @param {(effect:Object, state:Object)=>{text:string,tone:string,icon:string}} deps.describeEffect
 */
export function createWarRoom(deps) {
    const { scenario, handlers, query } = deps;
    const assetUrl = (p) => scenario.assetUrl(p);

    let root = null;
    let built = false;
    let isOpen = false;
    let busy = false;
    let busyLabel = '';
    let selectedId = null;
    let mapMode = 'political';
    let mapState = 'idle'; // idle | loading | ready | error
    let lastReport = null;
    let lastReportCampaign = null;
    let reportShownTurn = null;
    let restoreFocus = null;
    let rankingCache = null;
    let refreshQueued = false;
    let track = { key: null, turn: null, last: null, deltas: null };

    let topBar;
    let left;
    let dossier;
    let bottom;
    let report;
    let mapView;
    let busyEl;
    let busyText;
    let emptyCard;
    let selChip;
    let selChipName;
    const mobileBtns = new Map();

    /* ----------------------------------------------------------- context */

    const ctx = {
        assetUrl,
        handlers,
        query,
        getState: () => safe(() => query.getState(), null),
        getRanking: () => {
            if (!rankingCache) rankingCache = safe(() => query.getRanking(), []) || [];
            return rankingCache;
        },
        getSelected: () => selectedId,
        isBusy: () => busy || !!safe(() => query.isBusy(), false),
        selectNation: (id, opts) => selectNation(id, opts),
        openTab: (tab) => {
            left.setTab(tab);
            setPane('gov');
        },
        openMenu: () => openGameMenu({ handlers, query, openModal: deps.openModal, confirm: deps.openConfirm, hasCampaign: !!ctx.getState() }),
        close: () => close(),
        describe: (effect, state, dctx) => describe(effect, state, dctx),
        runAction: (item, targetId) => runAction(item, targetId),
    };

    function describe(effect, state, dctx) {
        try {
            const d = deps.describeEffect(effect, state, dctx);
            if (d && d.text) return d;
        } catch (err) {
            console.warn('[HOI] describeEffect failed', err);
        }
        if (effect && effect.type === 'resource') {
            return { text: resourceDeltaLine(effect.resource, effect.delta), tone: effect.delta >= 0 ? 'good' : 'bad', icon: '' };
        }
        return { text: effect && (effect.note || effect.label || effect.type) ? String(effect.note || effect.label || effect.type) : '', tone: 'neutral', icon: '' };
    }

    async function runAction(item, targetId) {
        if (!item || !item.available || ctx.isBusy()) return;
        if (item.confirm) {
            const state = ctx.getState();
            const target = targetId && state && state.nations[targetId] ? ` contra ${state.nations[targetId].name}` : '';
            const chance = item.chanceText === 'Garantido' ? 'Sucesso garantido' : `Chance de sucesso: ${item.chanceText}`;
            let ok = false;
            try {
                ok = await deps.openConfirm({
                    title: `${item.name}${target}`,
                    text: `${item.description} Custo: ${item.costText}. ${chance}. Esta decisão pode ter consequências graves e irreversíveis.`,
                    okLabel: 'Executar',
                    cancelLabel: 'Cancelar',
                    danger: true,
                });
            } catch (err) {
                console.error('[HOI] confirm failed', err);
                ok = false;
            }
            if (!ok || ctx.isBusy()) return;
        }
        handlers.onAction(item.id, targetId || null);
    }

    /* ------------------------------------------------------------- build */

    function ensureRoot() {
        if (root) return root;
        root = h('div', {
            class: 'hoi-root hoi-overlay hoi-wr',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Sala de Guerra',
            tabindex: '-1',
            hidden: true,
            dataset: { pane: 'map' },
        });
        document.body.appendChild(root);
        return root;
    }

    function build() {
        if (built) return;
        ensureRoot();
        built = true;
        topBar = createTopBar(ctx);
        left = createLeftPanel(ctx);
        dossier = createDossier(ctx);
        bottom = createBottomBar(ctx);
        report = createTurnReportPanel(ctx);
        mapView = createMapView({
            assetUrl,
            initialMode: mapMode,
            onSelect: (id) => selectNation(id, { focus: false, fromMap: true }),
            onModeChange: (m) => {
                mapMode = m;
            },
        });

        busyText = h('span', { class: 'hoi-wr__busytext' });
        busyEl = h('div', { class: 'hoi-wr__busy', role: 'status', 'aria-live': 'polite', hidden: true },
            h('div', { class: 'hoi-wr__busycard' }, h('span', { class: 'hoi-spinner' }), busyText));

        const startBtn = h('button', { type: 'button', class: 'hoi-btn hoi-btn--primary hoi-btn--lg' }, icon('fa-solid fa-flag'), h('span', { text: 'Iniciar campanha' }));
        startBtn.addEventListener('click', () => handlers.onNewCampaign());
        emptyCard = h('div', { class: 'hoi-wr__emptycard', hidden: true },
            h('div', { class: 'hoi-wr__emptyart' }),
            h('div', { class: 'hoi-wr__emptybody' },
                h('h2', { class: 'hoi-title', text: 'Nenhuma campanha neste chat' }),
                h('p', { text: 'Escolha um período, uma nação e assuma o governo. O motor do jogo decide os números; o chat narra a sua história.' }),
                startBtn));
        const art = emptyCard.querySelector('.hoi-wr__emptyart');
        const img = h('img', { alt: '', src: assetUrl('art/title.webp'), decoding: 'async' });
        img.addEventListener('error', () => art.remove(), { once: true });
        art.appendChild(img);

        selChipName = h('span', { class: 'hoi-wr__selname' });
        const selOpen = h('button', { type: 'button', class: 'hoi-btn hoi-btn--primary' }, h('span', { text: 'Dossiê' }), icon('fa-solid fa-chevron-right'));
        selOpen.addEventListener('click', () => setPane('dossier'));
        selChip = h('div', { class: 'hoi-wr__selchip', hidden: true }, selChipName, selOpen);

        const center = h('main', { class: 'hoi-wr__center hoi-wr__pane', dataset: { paneId: 'map' } }, mapView.el, selChip, emptyCard, busyEl);
        const leftEl = h('aside', { class: 'hoi-wr__left hoi-wr__pane', dataset: { paneId: 'gov' }, 'aria-label': 'Governo' }, left.el);
        const rightEl = h('aside', { class: 'hoi-wr__right hoi-wr__pane', dataset: { paneId: 'dossier' }, 'aria-label': 'Dossiê' }, dossier.el);
        const bodyEl = h('div', { class: 'hoi-wr__body' }, leftEl, center, rightEl, report.el);

        const mtabs = h('nav', { class: 'hoi-wr__mtabs', 'aria-label': 'Seções da Sala de Guerra' });
        for (const p of MOBILE_PANES) {
            const b = h('button', { type: 'button', class: 'hoi-wr__mtab', dataset: { pane: p.id }, 'aria-pressed': 'false' }, icon(p.icon), h('span', { text: p.label }));
            b.addEventListener('click', () => setPane(p.id));
            mobileBtns.set(p.id, b);
            mtabs.appendChild(b);
        }

        const frame = h('div', { class: 'hoi-wr__frame' }, topBar.el, bodyEl, bottom.el, mtabs);
        root.appendChild(frame);
        root.addEventListener('keydown', onKeyDown);
        setPane('map');
    }

    function loadMap() {
        if (mapState === 'loading' || mapState === 'ready') return;
        mapState = 'loading';
        mapView.showMessage('Carregando mapa…');
        Promise.resolve()
            .then(() => scenario.loadMap())
            .then((data) => {
                mapState = 'ready';
                mapView.setData(data);
                if (isOpen) refreshNow();
            })
            .catch((err) => {
                mapState = 'error';
                console.error('[HOI] map failed to load', err);
                mapView.showMessage('Não foi possível carregar o mapa. Reabra a Sala de Guerra para tentar de novo.');
            });
    }

    /* ---------------------------------------------------------- open/close */

    async function open() {
        build();
        if (mapState === 'error') mapState = 'idle';
        loadMap();
        const st = ctx.getState();
        if (!selectedId || !st || !st.nations[selectedId]) selectedId = st && st.player ? st.player.nationId : null;
        if (!isOpen) {
            restoreFocus = document.activeElement;
            root.hidden = false;
            isOpen = true;
            requestAnimationFrame(() => root.classList.add('is-open'));
        }
        refreshNow();
        if (reportFor(st) && reportShownTurn !== lastReport.turn) {
            reportShownTurn = lastReport.turn;
            report.show(turnReportModel(lastReport, st));
        }
        try {
            root.focus({ preventScroll: true });
        } catch { /* ignore */ }
    }

    function close() {
        if (!root || !isOpen) return;
        isOpen = false;
        root.classList.remove('is-open');
        root.hidden = true;
        if (restoreFocus && typeof restoreFocus.focus === 'function' && restoreFocus.isConnected) {
            try {
                restoreFocus.focus({ preventScroll: true });
            } catch { /* ignore */ }
        }
        restoreFocus = null;
    }

    function destroy() {
        close();
        if (mapView) mapView.destroy();
        if (root) root.remove();
        root = null;
        built = false;
        mapState = 'idle';
    }

    /* ------------------------------------------------------------ refresh */

    /** Track the player's resources so the top bar can show last-month deltas. */
    function trackState(state) {
        const n = playerNation(state);
        if (!n) return;
        const key = `${state.campaignId}:${state.player.nationId}`;
        if (track.key !== key) {
            track = { key, turn: state.turn, last: { ...n.resources }, deltas: null };
            return;
        }
        if (state.turn !== track.turn) {
            track.deltas = state.turn > track.turn ? resourceDeltas(n.resources, track.last) : null;
            track.turn = state.turn;
        }
        track.last = { ...n.resources };
    }

    function currentDeltas(state) {
        if (!state) return null;
        if (reportFor(state) && lastReport.playerDeltas) return lastReport.playerDeltas;
        return track.turn === state.turn ? track.deltas : null;
    }

    /** The last report belongs to this campaign and month (reports survive chat switches). */
    function reportFor(state) {
        return !!(lastReport && state && lastReportCampaign === state.campaignId && lastReport.turn === state.turn);
    }

    function refresh() {
        const state = ctx.getState();
        trackState(state);
        if (!isOpen || refreshQueued) return;
        refreshQueued = true;
        queueMicrotask(() => {
            refreshQueued = false;
            if (isOpen) refreshNow();
        });
    }

    function refreshNow() {
        if (!built) return;
        rankingCache = null;
        const state = ctx.getState();
        trackState(state);
        const hasCampaign = !!(state && state.player && state.nations && state.nations[state.player.nationId]);
        if (selectedId && (!state || !state.nations[selectedId])) selectedId = null;
        if (!selectedId && hasCampaign) selectedId = state.player.nationId;

        toggleClass(root, 'is-nocampaign', !hasCampaign);
        emptyCard.hidden = hasCampaign;
        toggleClass(root, 'is-busy', busy);
        busyEl.hidden = !busy;
        setText(busyText, busyLabel);
        guard('top bar', () => topBar.update(topBarModel(state, { deltas: currentDeltas(state) }), { busy: ctx.isBusy(), busyLabel }));
        if (hasCampaign) {
            guard('left panel', () => left.render());
            guard('dossier', () => dossier.update(selectedId));
        }
        guard('map', () => mapView.render({ state: hasCampaign ? state : null, selectedId, index: buildWorldIndex(hasCampaign ? state : null) }));
        guard('bottom bar', () => bottom.update({ busy: ctx.isBusy(), mobileNews: root.dataset.pane === 'news' }));
        updateSelChip(state);
        report.setBusy(ctx.isBusy());
    }

    function guard(label, fn) {
        try {
            fn();
        } catch (err) {
            console.error(`[HOI] War Room ${label} render failed`, err);
        }
    }

    /* ---------------------------------------------------------- selection */

    function selectNation(id, opts = {}) {
        const state = ctx.getState();
        if (!state || !state.nations[id]) return;
        selectedId = id;
        rankingCache = null;
        mapView.select(id);
        if (opts.focus) mapView.focusNation(id);
        guard('dossier', () => dossier.update(id));
        guard('left panel', () => left.render());
        updateSelChip(state);
        if (opts.pane && isMobile()) setPane(opts.pane);
    }

    function updateSelChip(state) {
        const n = state && selectedId ? state.nations[selectedId] : null;
        selChip.hidden = !n;
        if (n) setText(selChipName, n.name);
    }

    /* ------------------------------------------------------------- panes */

    function isMobile() {
        return typeof matchMedia === 'function' && matchMedia(MOBILE_QUERY).matches;
    }

    function setPane(id) {
        if (!root) return;
        root.dataset.pane = id;
        for (const [k, b] of mobileBtns) {
            b.setAttribute('aria-pressed', k === id ? 'true' : 'false');
            toggleClass(b, 'is-active', k === id);
        }
        if (built && id === 'news') bottom.update({ busy: ctx.isBusy(), mobileNews: true });
    }

    /* ----------------------------------------------------------- keyboard */

    function modalOpen() {
        for (const el of document.querySelectorAll('[aria-modal="true"]')) {
            if (el !== root && !root.contains(el) && !el.hidden && el.isConnected) return true;
        }
        return !!document.querySelector('dialog[open]');
    }

    function onKeyDown(e) {
        if (e.defaultPrevented || !isOpen || modalOpen()) return;
        const typing = isTypingTarget(e.target);
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (typing) {
                e.target.blur();
                root.focus({ preventScroll: true });
            } else if (bottom.isLogOpen()) bottom.setLogOpen(false);
            else if (report.isOpen()) report.hide();
            else close();
            return;
        }
        if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
        let handled = true;
        switch (e.key) {
            case 'm':
            case 'M':
                mapView.cycleMode(e.shiftKey ? -1 : 1);
                break;
            case '+':
            case '=':
                mapView.zoomBy(1.6);
                break;
            case '-':
            case '_':
                mapView.zoomBy(1 / 1.6);
                break;
            case '0':
                mapView.resetView(true);
                break;
            default:
                handled = false;
        }
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    /* -------------------------------------------------------------- busy */

    function setBusy(b, label = '') {
        busy = !!b;
        busyLabel = busy ? (label || 'O gabinete está trabalhando…') : '';
        if (built && isOpen) refreshNow(); // refreshNow applies the overlay + disabled states
    }

    /* ------------------------------------------------------------ report */

    function showTurnReport(rep) {
        if (!rep) return;
        lastReport = rep;
        const state = ctx.getState();
        lastReportCampaign = state ? state.campaignId : null;
        trackState(state);
        if (!isOpen || !built) return;
        reportShownTurn = rep.turn;
        refreshNow();
        report.show(turnReportModel(rep, state));
    }

    return {
        ensureRoot,
        open,
        close,
        destroy,
        refresh,
        setBusy,
        showTurnReport,
        isOpen: () => isOpen,
        trackState,
        selectNation: (id) => selectNation(id, { focus: true }),
    };
}

function safe(fn, fallback) {
    try {
        return fn();
    } catch (err) {
        console.error('[HOI] UI query failed', err);
        return fallback;
    }
}
