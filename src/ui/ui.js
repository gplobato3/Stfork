/**
 * @file src/ui/ui.js
 * UI factory (Module D) — composes the map, dashboard, nation picker, event
 * modal, settings panel and the main panel/overlay into a single UiAPI object
 * (see interfaces.js). FEAT-006 wires this into the GameController.
 *
 * The factory keeps the current world state and a modal host so update(),
 * renderMap() and renderDashboard() can refresh without the caller re-passing
 * everything. All ST/DOM access is defensive and node-safe.
 *
 * @typedef {import('../contract/interfaces.js').UiAPI} UiAPI
 */

import { getContext, getLibs, isLive } from '../core/stContext.js';
import { t } from '../i18n/i18n.js';

import { createPanel } from './panel.js';
import { renderMap } from './map.js';
import { renderDashboard } from './dashboard.js';
import { showNationPicker } from './nationPicker.js';
import { showEventModal, showEventLoading, showEventError } from './eventModal.js';
import { renderSettings } from './settings.js';
import { el, isElement } from './render.js';

/**
 * Create the HOI UI. Returns a UiAPI plus a few extra helpers the controller
 * uses (settings panel, nation picker, loading/error states for the event
 * modal). The extras are additive and don't violate the interface.
 *
 * @param {Object} [handlers] Controller callbacks.
 * @param {()=>void} [handlers.onNewGame]
 * @param {()=>void} [handlers.onNextTurn]
 * @param {()=>void} [handlers.onSave]
 * @param {(nationId:string)=>void} [handlers.onSelectNation]
 * @param {(nationId:string)=>void} [handlers.onPickNation]
 * @param {(optionId:string)=>void} [handlers.onChooseOption]
 * @param {()=>void} [handlers.onResetCampaign]
 * @returns {UiAPI & {
 *   renderSettingsPanel:(container?:HTMLElement)=>Promise<void>,
 *   showEventLoading:()=>void,
 *   showEventError:(opts?:object)=>void,
 *   getModalHost:()=>HTMLElement|null,
 * }}
 */
export function createUi(handlers = {}) {
    // pt-BR strings are loaded by the composition root (index.js bootstrapI18n)
    // when running inside SillyTavern; t() falls back to the key otherwise so
    // the UI never breaks even if a string is missing.
    const panel = createPanel({
        onNewGame: handlers.onNewGame,
        onNextTurn: handlers.onNextTurn,
        onSave: handlers.onSave,
        onSelectNation: handlers.onSelectNation,
    });

    const state = { world: null, modalHost: null, mounted: false, onDismiss: null };

    /** Lazily create the modal host (overlay) attached to the panel root or body. */
    function ensureModalHost() {
        if (state.modalHost && state.modalHost.ownerDocument) return state.modalHost;
        const doc = getDoc();
        if (!doc) return null;
        const host = el(doc, 'div', { className: 'hoi-root hoi-modal-host' });
        host.setAttribute('aria-hidden', 'true');
        const backdrop = el(doc, 'div', { className: 'hoi-modal__backdrop' });
        const body = el(doc, 'div', { className: 'hoi-modal__body' });
        host.append(backdrop, body);
        // A backdrop click dismisses the modal. closeModal() fires the pending
        // dismiss handler (if any) so flows awaiting a decision are never left
        // hanging when the player clicks outside instead of choosing.
        backdrop.addEventListener('click', () => closeModal());
        (doc.body || doc.documentElement).appendChild(host);
        state.modalHost = host;
        return host;
    }

    function openModal() {
        const host = ensureModalHost();
        if (host) host.setAttribute('aria-hidden', 'false');
        return host;
    }
    /**
     * Hide the modal host and clear its body. If a dismiss handler was armed by
     * the flow that opened the modal (e.g. the event decision), invoke it once
     * so dismissal maps onto a decision instead of silently stranding an
     * awaiting promise.
     */
    function closeModal() {
        const dismiss = state.onDismiss;
        state.onDismiss = null;
        if (state.modalHost) {
            state.modalHost.setAttribute('aria-hidden', 'true');
            const body = state.modalHost.querySelector('.hoi-modal__body');
            if (body) body.textContent = '';
        }
        if (typeof dismiss === 'function') {
            try {
                dismiss();
            } catch {
                /* ignore */
            }
        }
    }
    function modalBody() {
        const host = openModal();
        return host ? host.querySelector('.hoi-modal__body') : null;
    }

    /* ---------------------------------------------------------------- UiAPI */

    async function mount(container) {
        await panel.mount(container);
        state.mounted = true;
        if (state.world) panel.update(state.world);
    }

    function update(world) {
        state.world = world || null;
        panel.update(state.world);
    }

    function renderMapApi(world) {
        if (world) state.world = world;
        const root = panel.getRoot();
        const host = root ? root.querySelector('.hoi-panel__view--map') : null;
        if (host && state.world) {
            renderMap(host, state.world, { onSelectNation: fn(handlers.onSelectNation) });
        }
    }

    function renderDashboardApi(world) {
        if (world) state.world = world;
        const root = panel.getRoot();
        const host = root ? root.querySelector('.hoi-panel__view--dashboard') : null;
        if (host && state.world) {
            void renderDashboard(host, state.world, {
                onNextTurn: fn(handlers.onNextTurn),
                onSelectNation: fn(handlers.onSelectNation),
            });
        }
    }

    function showEventModalApi(event, onChoose, onDismiss) {
        const body = modalBody();
        if (!body) {
            // No DOM host available: treat as an immediate dismiss so a caller
            // awaiting a decision is never left hanging.
            if (typeof onDismiss === 'function') onDismiss();
            return;
        }
        let settled = false;
        const choose = (optionId) => {
            if (settled) return;
            settled = true;
            state.onDismiss = null; // a real choice supersedes any dismiss.
            closeModal();
            if (typeof onChoose === 'function') onChoose(optionId);
            else if (typeof handlers.onChooseOption === 'function') handlers.onChooseOption(optionId);
        };
        // Arm the dismiss handler so a backdrop click (closeModal) resolves the
        // decision as a cancel instead of stranding the controller.
        state.onDismiss = () => {
            if (settled) return;
            settled = true;
            if (typeof onDismiss === 'function') onDismiss();
        };
        void showEventModal(body, event, choose);
    }

    function showNationPickerApi(nationIds, onPick) {
        const body = modalBody();
        if (!body) return;
        // Accept either an array of ids or a scenario object.
        let scenario;
        let playableIds;
        if (Array.isArray(nationIds)) {
            playableIds = nationIds;
            scenario = (state.world && { nations: state.world.nations }) || { nations: {} };
        } else if (nationIds && typeof nationIds === 'object') {
            scenario = nationIds;
        } else {
            scenario = { nations: {} };
        }
        const pick = (id) => {
            closeModal();
            if (typeof onPick === 'function') onPick(id);
            else if (typeof handlers.onPickNation === 'function') handlers.onPickNation(id);
        };
        void showNationPicker(body, scenario, pick, { playableIds, onCancel: closeModal });
    }

    function toast(messagePtBr) {
        const msg = String(messagePtBr == null ? '' : messagePtBr);
        if (isLive()) {
            const libs = getLibs();
            const ctx = getContext();
            const toastr = (libs && libs.toastr) || (ctx && ctx.toastr) || (typeof globalThis !== 'undefined' && globalThis.toastr);
            if (toastr && typeof toastr.info === 'function') {
                try { toastr.info(msg, t('hoi_app_title')); return; } catch { /* fall through */ }
            }
        }
        try { if (typeof console !== 'undefined') console.info('[HOI] ' + msg); } catch { /* ignore */ }
    }

    /* ---------------------------------------------------------- extra helpers */

    async function renderSettingsPanel(container) {
        const host = resolveSettingsHost(container);
        if (!host) return;
        await renderSettings(host, {
            onReset: fn(handlers.onResetCampaign),
        });
    }

    function showEventLoadingApi() {
        const body = modalBody();
        if (body) showEventLoading(body);
    }

    function showEventErrorApi(opts) {
        const body = modalBody();
        if (body) showEventError(body, opts || {});
    }

    return {
        // UiAPI
        mount,
        update,
        renderMap: renderMapApi,
        renderDashboard: renderDashboardApi,
        showEventModal: showEventModalApi,
        showNationPicker: showNationPickerApi,
        toast,
        // extras
        renderSettingsPanel,
        showEventLoading: showEventLoadingApi,
        showEventError: showEventErrorApi,
        closeModal,
        getModalHost: () => state.modalHost,
    };
}

/* -------------------------------------------------------------------------- */

/** Resolve the settings container: explicit arg -> #extensions_settings2 -> null. */
function resolveSettingsHost(container) {
    if (isElement(container)) return container;
    const doc = getDoc();
    if (!doc) return null;
    const node = doc.getElementById ? doc.getElementById('extensions_settings2') : null;
    return node || null;
}

function getDoc() {
    return typeof document !== 'undefined' ? document : null;
}

function fn(f) {
    return typeof f === 'function' ? f : () => {};
}

export default createUi;
