/**
 * @file src/ui/panel.js
 * Main HOI panel / drawer + full-screen overlay (Module D).
 *
 * mount(container?) builds the top-level UI shell: a header with the campaign
 * controls (Novo Jogo, Avancar Turno, Mapa, Painel, Salvar), a body that hosts
 * the map and dashboard views, and a full-screen overlay toggle. update(world)
 * re-renders the active view after each turn.
 *
 * The shell is view-model driven: the controller (FEAT-006) supplies callbacks
 * (onNewGame, onNextTurn, onSave) and the world state; this module owns only the
 * presentation + which sub-view is visible. Efficient updates use morphdom when
 * SillyTavern.libs exposes it (through render.patchHtml), else innerHTML.
 *
 * Node-safe: all DOM access is guarded; importing this file has no side effects.
 */

import { t } from '../i18n/i18n.js';
import { el, isElement } from './render.js';
import { renderMap } from './map.js';
import { renderDashboard } from './dashboard.js';

/** Which sub-view the panel body is showing. */
const VIEW = Object.freeze({ MAP: 'map', DASHBOARD: 'dashboard' });

/**
 * Create a panel controller bound to a host element.
 *
 * @param {Object} [handlers]
 * @param {()=>void} [handlers.onNewGame]
 * @param {()=>void} [handlers.onNextTurn]
 * @param {()=>void} [handlers.onSave]
 * @param {(nationId:string)=>void} [handlers.onSelectNation]
 * @returns {{
 *   mount:(container?:HTMLElement)=>Promise<HTMLElement|null>,
 *   update:(world:object)=>void,
 *   showView:(view:string)=>void,
 *   getRoot:()=>HTMLElement|null,
 * }}
 */
export function createPanel(handlers = {}) {
    const state = {
        root: null,
        mapHost: null,
        dashHost: null,
        overlay: null,
        view: VIEW.DASHBOARD,
        world: null,
        fullscreen: false,
    };

    const h = {
        onNewGame: fn(handlers.onNewGame),
        onNextTurn: fn(handlers.onNextTurn),
        onSave: fn(handlers.onSave),
        onSelectNation: typeof handlers.onSelectNation === 'function' ? handlers.onSelectNation : () => {},
    };

    function mount(container) {
        const host = isElement(container)
            ? container
            : typeof document !== 'undefined'
            ? document.body
            : null;
        if (!host) return Promise.resolve(null);
        if (state.root && host.contains(state.root)) return Promise.resolve(state.root);

        const doc = host.ownerDocument;
        const root = el(doc, 'div', { className: 'hoi-root hoi-panel' });

        // --- Header controls ---------------------------------------------
        const header = el(doc, 'header', { className: 'hoi-panel__header' });
        const brand = el(doc, 'div', { className: 'hoi-panel__brand' });
        brand.appendChild(el(doc, 'span', { className: 'hoi-panel__title', text: t('hoi_app_title') }));
        brand.appendChild(el(doc, 'span', { className: 'hoi-panel__subtitle', text: t('hoi_app_subtitle') }));
        header.appendChild(brand);

        const controls = el(doc, 'div', { className: 'hoi-panel__controls' });
        const btnNew = ctrlBtn(doc, 'hoi_btn_new_game', 'new-game');
        const btnTurn = ctrlBtn(doc, 'hoi_btn_next_turn', 'next-turn');
        const btnMap = ctrlBtn(doc, 'hoi_btn_map', 'show-map');
        const btnDash = ctrlBtn(doc, 'hoi_btn_dashboard', 'show-dashboard');
        const btnSave = ctrlBtn(doc, 'hoi_btn_save', 'save');
        const btnFull = ctrlBtn(doc, 'hoi_overlay_open', 'toggle-fullscreen');
        controls.append(btnNew, btnTurn, btnMap, btnDash, btnSave, btnFull);
        header.appendChild(controls);
        root.appendChild(header);

        // --- Body: map + dashboard hosts ---------------------------------
        const body = el(doc, 'div', { className: 'hoi-panel__body' });
        const mapHost = el(doc, 'div', { className: 'hoi-panel__view hoi-panel__view--map' });
        const dashHost = el(doc, 'div', { className: 'hoi-panel__view hoi-panel__view--dashboard' });
        body.append(mapHost, dashHost);
        root.appendChild(body);

        host.appendChild(root);

        state.root = root;
        state.mapHost = mapHost;
        state.dashHost = dashHost;
        state.btnFull = btnFull;

        // Wire controls.
        btnNew.addEventListener('click', h.onNewGame);
        btnTurn.addEventListener('click', h.onNextTurn);
        btnSave.addEventListener('click', h.onSave);
        btnMap.addEventListener('click', () => showView(VIEW.MAP));
        btnDash.addEventListener('click', () => showView(VIEW.DASHBOARD));
        btnFull.addEventListener('click', toggleFullscreen);

        showView(state.view);
        return Promise.resolve(root);
    }

    function showView(view) {
        state.view = view === VIEW.MAP ? VIEW.MAP : VIEW.DASHBOARD;
        if (!state.root) return;
        state.root.setAttribute('data-view', state.view);
        if (state.mapHost) state.mapHost.classList.toggle('is-active', state.view === VIEW.MAP);
        if (state.dashHost) state.dashHost.classList.toggle('is-active', state.view === VIEW.DASHBOARD);
        renderActive();
    }

    function toggleFullscreen() {
        state.fullscreen = !state.fullscreen;
        if (state.root) state.root.classList.toggle('is-fullscreen', state.fullscreen);
        if (state.btnFull) {
            state.btnFull.textContent = t(state.fullscreen ? 'hoi_overlay_close' : 'hoi_overlay_open');
        }
    }

    function renderActive() {
        if (!state.root || !state.world) return;
        if (state.view === VIEW.MAP && state.mapHost) {
            renderMap(state.mapHost, state.world, { onSelectNation: h.onSelectNation });
        } else if (state.dashHost) {
            // Dashboard render is async (template); fire and forget, it is idempotent.
            void renderDashboard(state.dashHost, state.world, {
                onNextTurn: h.onNextTurn,
                onSelectNation: h.onSelectNation,
            });
        }
    }

    function update(world) {
        state.world = world || null;
        renderActive();
    }

    return { mount, update, showView, getRoot: () => state.root };
}

/* -------------------------------------------------------------------------- */

function ctrlBtn(doc, labelKey, action) {
    const b = el(doc, 'button', {
        className: 'hoi-btn hoi-panel__ctrl',
        attrs: { type: 'button', 'data-action': action },
        text: t(labelKey),
    });
    return b;
}

function fn(f) {
    return typeof f === 'function' ? f : () => {};
}
