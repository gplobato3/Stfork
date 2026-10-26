/**
 * @file src/ui/index.js
 * UI facade: createUi({ scenario, handlers, query }) -> UiAPI (see
 * src/contract/interfaces.js). Composes UI-B's dialogs/HUD/settings/wand
 * modules with the War Room. Nothing touches the DOM at import time.
 */

import { formatDate } from '../contract/presentation.js';
import { openConfirm } from './dialogs/confirm.js';
import { describeEffect } from './dialogs/effectPreview.js';
import { openEventDialog } from './dialogs/eventDialog.js';
import { openGameOver } from './dialogs/gameOver.js';
import { openModal } from './dialogs/modalHost.js';
import { openWizard } from './dialogs/wizard.js';
import { createHud } from './hud/hud.js';
import { mountSettingsPanel } from './settings/settingsPanel.js';
import { addWandMenuItem } from './wand.js';
import { createToaster } from './warroom/toasts.js';
import { createWarRoom } from './warroom/warRoom.js';

export const WAND_LABEL = 'Grande Estratégia';
export const WAND_ICON = 'fa-earth-americas';

/**
 * @param {{scenario: import('../contract/interfaces.js').ScenarioAPI,
 *          handlers: import('../contract/interfaces.js').UiHandlers,
 *          query: import('../contract/interfaces.js').UiQuery}} deps
 * @returns {import('../contract/interfaces.js').UiAPI}
 */
export function createUi({ scenario, handlers, query }) {
    if (!scenario || !handlers || !query) throw new Error('createUi: scenario, handlers and query are required');

    const assetUrl = (p) => scenario.assetUrl(p);
    let mounted = false;
    let removeWand = null;
    let hud = null;
    let settingsPanel = null;
    let busy = false;
    let busyLabel = '';
    let warRoom = null;
    let toaster = null;

    const getToaster = () => (toaster ||= createToaster());

    function getWarRoom() {
        if (!warRoom) {
            warRoom = createWarRoom({
                scenario,
                handlers,
                query,
                openConfirm,
                openModal,
                describeEffect,
            });
        }
        return warRoom;
    }

    function settings() {
        return safe(() => query.getSettings(), {}) || {};
    }

    function updateHud() {
        if (!hud) return;
        safe(() => hud.update(safe(() => query.getState(), null), { busy: busy || !!safe(() => query.isBusy(), false), settings: settings() }));
    }

    const api = {
        async mount() {
            if (mounted) return;
            mounted = true;
            getWarRoom().ensureRoot();
            if (!removeWand) {
                removeWand = safe(() => addWandMenuItem({ label: WAND_LABEL, icon: WAND_ICON, onClick: () => { api.openWarRoom(); } }), null);
            }
            if (!hud) {
                hud = safe(() => createHud({
                    onOpenWarRoom: () => { api.openWarRoom(); },
                    onEndTurn: () => handlers.onEndTurn(),
                    onOpenEvent: () => handlers.onOpenEvent(),
                    assetUrl,
                }), null);
                if (hud) safe(() => hud.mount());
            }
            if (!settingsPanel) {
                settingsPanel = safe(() => mountSettingsPanel({
                    getSettings: () => query.getSettings(),
                    onChange: (patch) => handlers.onSettingsChange(patch),
                    onOpenWarRoom: () => { api.openWarRoom(); },
                    onNewCampaign: () => handlers.onNewCampaign(),
                    onImportCharacter: () => handlers.onImportCharacter(),
                    onResetCampaign: () => handlers.onResetCampaign(),
                    listConnectionProfiles: () => query.listConnectionProfiles(),
                }), null);
            }
            updateHud();
        },

        unmount() {
            if (removeWand) safe(() => removeWand());
            removeWand = null;
            if (hud) safe(() => hud.unmount());
            hud = null;
            if (settingsPanel) safe(() => settingsPanel.unmount());
            settingsPanel = null;
            if (warRoom) warRoom.destroy();
            warRoom = null;
            if (toaster) toaster.destroy();
            toaster = null;
            mounted = false;
        },

        async openWarRoom() {
            await getWarRoom().open();
        },

        closeWarRoom() {
            if (warRoom) warRoom.close();
        },

        refresh() {
            if (warRoom) warRoom.refresh();
            updateHud();
            if (settingsPanel) safe(() => settingsPanel.refresh());
        },

        async showNewCampaignWizard(scenarioData, opts = {}) {
            const result = await openWizard({
                scenario: scenarioData,
                assetUrl,
                defaultLeaderName: opts.defaultLeaderName || '',
                defaultDifficulty: settings().difficulty || 'normal',
            });
            return result || null;
        },

        async showEvent(event, opts = {}) {
            const choice = await openEventDialog({
                event,
                state: safe(() => query.getState(), null),
                assetUrl,
                showArt: settings().showArt !== false,
                dismissible: opts.dismissible !== false,
            });
            return typeof choice === 'number' ? choice : null;
        },

        showTurnReport(report) {
            if (!report) return;
            const wr = getWarRoom();
            wr.showTurnReport(report);
            updateHud();
            if (!wr.isOpen()) {
                const n = Array.isArray(report.headlines) ? report.headlines.length : 0;
                const decisions = Array.isArray(report.engineEvents) ? report.engineEvents.length : 0;
                const parts = [`${n} ${n === 1 ? 'manchete' : 'manchetes'}`];
                if (decisions) parts.push(`${decisions} ${decisions === 1 ? 'decisão pendente' : 'decisões pendentes'}`);
                getToaster().toast(`${parts.join(' · ')}. Abra a Sala de Guerra para o relatório completo.`, 'info', { title: `Relatório de ${formatDate(report.date)}` });
            }
        },

        showActionResult(result) {
            if (!result) return;
            const t = getToaster();
            if (!result.ok) {
                t.toast(result.summary || 'Ação indisponível.', 'warning', { title: 'Ação não executada', details: result.reasons || [] });
            } else {
                t.toast(result.summary || (result.success ? 'Ação executada.' : 'A ação fracassou.'), result.success ? 'success' : 'error', {
                    title: result.success ? 'Sucesso' : 'Fracasso',
                    details: result.details || [],
                });
            }
            api.refresh();
        },

        async showGameOver(outcome) {
            const choice = await openGameOver({
                outcome,
                state: safe(() => query.getState(), null),
                ranking: safe(() => query.getRanking(), []) || [],
                assetUrl,
            });
            if (choice === 'new') handlers.onNewCampaign();
        },

        setBusy(b, label) {
            busy = !!b;
            busyLabel = busy ? (label || '') : '';
            getWarRoom().setBusy(busy, busyLabel);
            updateHud();
        },

        toast(msg, kind = 'info') {
            getToaster().toast(msg, kind);
        },

        confirm({ title, text, okLabel } = {}) {
            return openConfirm({ title, text, okLabel: okLabel || 'Confirmar', cancelLabel: 'Cancelar', danger: false });
        },
    };

    return api;
}

function safe(fn, fallback) {
    try {
        return fn();
    } catch (err) {
        console.error('[HOI] UI error', err);
        return fallback;
    }
}
