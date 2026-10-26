/**
 * @file src/game/gameLoop.js
 * MODULE E — the end-to-end game loop (composition root's brain).
 *
 * createGameController() wires the four modules (engine A, scenario B, llm C,
 * ui D) into a single GameController with the lifecycle the UI + slash commands
 * drive:
 *
 *   start()         -> load scenario, restore any saved campaign for this chat,
 *                      mount/refresh the UI (or show the nation picker on setup).
 *   openPanel()     -> ensure the UI is mounted and visible.
 *   startNewGame()  -> showNationPicker -> engine.newGame -> saveState -> update.
 *   pickNation(id)  -> finalize a new game for the chosen nation.
 *   nextTurn()      -> engine.advanceTurn -> llm.generateTurnEvent ->
 *                      showEventModal -> engine.applyEvent -> saveState ->
 *                      update -> optional flavor narration -> game-over check.
 *   saveCampaign()  -> persist the current state.
 *   loadCampaign()  -> reload the saved state for this chat.
 *   resetCampaign() -> delete the save and return to setup.
 *   onChatChanged() -> reload/clear the campaign for the newly-active chat.
 *   getState()      -> the current in-memory WorldState (or null).
 *   buildSituationReport() -> pt-BR sitrep for /hoi-status.
 *
 * EVERY externally-triggered step is wrapped so an LLM/UI/engine error surfaces
 * a pt-BR toast and leaves the save intact — a failure here must NEVER crash
 * SillyTavern. The controller holds the only mutable reference to the live
 * WorldState; the engine stays pure.
 *
 * Node-safe: no hard ST imports; all ST access flows through the injected
 * modules (which use stContext) so this file imports and unit-tests under node.
 *
 * Display strings are pt-BR; identifiers and comments are English.
 */

import { t } from '../i18n/i18n.js';

/**
 * Assemble the game controller from the four module APIs.
 *
 * @param {{
 *   engine: import('../contract/interfaces.js').EngineAPI & {newCampaign?:Function, getNationStatus?:Function, hasSave?:Function, deleteSave?:Function},
 *   scenario: import('../contract/interfaces.js').ScenarioAPI,
 *   llm: import('../contract/interfaces.js').LlmAPI & {generateFlavorNarration?:Function},
 *   ui: import('../contract/interfaces.js').UiAPI & {showEventLoading?:Function, showEventError?:Function, closeModal?:Function},
 *   postNarration?: (text: string) => (void|Promise<void>),
 *   log?: (level: 'info'|'warn'|'error', ...args: any[]) => void,
 * }} deps
 * @returns {import('../contract/interfaces.js').GameController & {
 *   openPanel: () => Promise<void>,
 *   pickNation: (id: string) => Promise<void>,
 *   saveCampaign: () => Promise<void>,
 *   loadCampaign: () => Promise<void>,
 *   resetCampaign: () => Promise<void>,
 *   onChatChanged: () => Promise<void>,
 *   getState: () => (import('../contract/worldState.js').WorldState|null),
 *   buildSituationReport: () => string,
 *   isBusy: () => boolean,
 * }}
 */
export function createGameController(deps) {
    const { engine, scenario, llm, ui } = deps;
    const postNarration = typeof deps.postNarration === 'function' ? deps.postNarration : null;
    const log =
        typeof deps.log === 'function'
            ? deps.log
            : (level, ...args) => {
                  try {
                      // eslint-disable-next-line no-console
                      (console[level] || console.log)('[HOI]', ...args);
                  } catch {
                      /* ignore */
                  }
              };

    /** @type {import('../contract/worldState.js').WorldState|null} */
    let world = null;
    /** Scenario data, loaded once and reused across campaigns. */
    let scenarioData = null;
    /** True while a turn/new-game flow is running, so we don't overlap. */
    let busy = false;
    /** True once the UI panel has been mounted. */
    let mounted = false;

    /* ----------------------------- helpers ------------------------------- */

    /** Surface a pt-BR message through the UI toast (never throws). */
    function toast(msg) {
        try {
            ui.toast(msg);
        } catch (e) {
            log('warn', 'toast failed:', e);
        }
    }

    /** Refresh every panel from the current world state (never throws). */
    function refreshUi() {
        try {
            ui.update(world);
        } catch (e) {
            log('warn', 'ui.update failed:', e);
        }
    }

    /** Ensure the scenario data is loaded exactly once. */
    async function ensureScenario() {
        if (scenarioData) return scenarioData;
        scenarioData = await scenario.loadScenario();
        return scenarioData;
    }

    /** Ensure the UI panel is mounted (idempotent). */
    async function ensureMounted() {
        if (mounted) return;
        await ui.mount();
        mounted = true;
    }

    /* ----------------------------- lifecycle ----------------------------- */

    /**
     * Boot the controller: load the scenario, restore a saved campaign for the
     * current chat (if any), mount the UI and render. On a fresh chat with no
     * save, the panel shows the setup/empty state (the player starts a game via
     * the Novo Jogo button or /hoi-newgame).
     * @returns {Promise<void>}
     */
    async function start() {
        try {
            await ensureScenario();
        } catch (e) {
            log('error', 'scenario load failed:', e);
            toast(t('hoi_err_generic'));
        }
        try {
            const saved = await engine.loadState();
            world = saved || null;
        } catch (e) {
            log('warn', 'loadState failed:', e);
            world = null;
        }
        try {
            await ensureMounted();
        } catch (e) {
            log('warn', 'ui.mount failed:', e);
        }
        refreshUi();
    }

    /**
     * Ensure the panel is mounted and visible (used by /hoi and the toolbar).
     * @returns {Promise<void>}
     */
    async function openPanel() {
        try {
            await ensureScenario();
        } catch (e) {
            log('warn', 'scenario load failed (openPanel):', e);
        }
        if (!world) {
            try {
                world = (await engine.loadState()) || null;
            } catch (e) {
                log('warn', 'loadState failed (openPanel):', e);
            }
        }
        try {
            await ensureMounted();
        } catch (e) {
            log('warn', 'ui.mount failed (openPanel):', e);
        }
        refreshUi();
    }

    /* ------------------------------ new game ----------------------------- */

    /**
     * Begin a new game: show the nation picker. The actual campaign is created
     * in pickNation() once the player chooses. Guarded end-to-end.
     * @returns {Promise<void>}
     */
    async function startNewGame() {
        if (busy) return;
        try {
            await ensureScenario();
            await ensureMounted();
            const ids = scenario.listPlayableNationIds();
            // Pass the scenario object so the picker can render full stats; the
            // playable-id ordering is carried alongside by the UI adapter.
            ui.showNationPicker(scenarioData || { nations: {} }, (nationId) => {
                void pickNation(nationId);
            });
            void ids; // ids are derived inside the UI from the scenario too.
        } catch (e) {
            log('error', 'startNewGame failed:', e);
            toast(t('hoi_err_generic'));
        }
    }

    /**
     * Finalize a new campaign for the chosen nation: build the world state,
     * persist it, and render. Never throws.
     * @param {string} nationId ISO alpha-3
     * @returns {Promise<void>}
     */
    async function pickNation(nationId) {
        if (busy) return;
        busy = true;
        try {
            const data = await ensureScenario();
            const next = engine.newGame(data, nationId);
            world = next;
            await safeSave();
            refreshUi();
            const nation = world && world.nations ? world.nations[nationId] : null;
            toast(t('hoi_toast_new_game', { nation: (nation && nation.name) || nationId }));
        } catch (e) {
            log('error', 'pickNation failed:', e);
            toast(t('hoi_err_generic'));
        } finally {
            busy = false;
        }
    }

    /* ------------------------------ next turn ---------------------------- */

    /**
     * Advance one full turn end-to-end. Each sub-step is guarded so a failure
     * leaves the previously-saved state intact and shows a pt-BR toast.
     * @returns {Promise<void>}
     */
    async function nextTurn() {
        if (busy) return;
        if (!world || !world.playerNationId) {
            toast(t('hoi_err_no_campaign'));
            return;
        }
        busy = true;
        try {
            // 1. Deterministic upkeep (pure engine step).
            const advanced = engine.advanceTurn(world);

            // 2. If upkeep alone ended the game, surface it and stop.
            const overAfterUpkeep = engine.checkGameOver(advanced);
            if (overAfterUpkeep) {
                world = advanced;
                await safeSave();
                refreshUi();
                surfaceGameOver(overAfterUpkeep);
                return;
            }

            // 3. Ask the LLM for this turn's event (never throws; falls back).
            showEventLoading();
            const event = await llm.generateTurnEvent(advanced, { toast: (m) => toast(m) });

            // 4. Present the decision and wait for the player's choice. A null
            //    result means the player dismissed the modal without choosing.
            const optionId = await presentEvent(event);

            if (optionId == null) {
                // 4a. Player dismissed the event without deciding. Keep the
                //     already-advanced (upkeep-applied) turn so progress is not
                //     lost, persist it, and leave the loop playable. No event
                //     effects or narration are applied for a skipped decision.
                world = advanced;
                await safeSave();
                refreshUi();
                toast(
                    t('hoi_toast_turn_advanced', {
                        turn: world.turn,
                        month: world.date.month,
                        year: world.date.year,
                    }),
                );
                const overSkipped = engine.checkGameOver(world);
                if (overSkipped) surfaceGameOver(overSkipped);
                return;
            }

            // 5. Apply the chosen option to the advanced state.
            const resolved = engine.applyEvent(advanced, event, optionId);
            world = resolved;

            // 6. Persist immediately so the decision is never lost.
            await safeSave();
            refreshUi();
            toast(
                t('hoi_toast_turn_advanced', {
                    turn: world.turn,
                    month: world.date.month,
                    year: world.date.year,
                }),
            );

            // 7. Optional immersive narration into the chat (best-effort).
            await narrate(event, optionId);

            // 8. Terminal check after the decision resolved.
            const over = engine.checkGameOver(world);
            if (over) surfaceGameOver(over);
        } catch (e) {
            log('error', 'nextTurn failed:', e);
            closeModalSafe();
            toast(t('hoi_err_generic'));
        } finally {
            busy = false;
        }
    }

    /**
     * Show the event modal and resolve with the chosen option id, or with
     * `null` when the player dismisses the modal without choosing (e.g. a
     * backdrop click). Resolving on dismissal guarantees the awaiting turn
     * never hangs, so `busy` always clears and the controller cannot latch.
     * A safety fallback picks the first option if the UI cannot present the
     * modal at all (a synchronous throw from showEventModal).
     * @param {import('../contract/events.js').GameEvent} event
     * @returns {Promise<string|null>}
     */
    function presentEvent(event) {
        return new Promise((resolve) => {
            const options = (event && Array.isArray(event.options) && event.options) || [];
            const fallbackId = (options[0] && options[0].id) || null;
            let settled = false;
            const settle = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            try {
                ui.showEventModal(
                    event,
                    (optionId) => settle(optionId || fallbackId),
                    () => settle(null),
                );
            } catch (e) {
                log('warn', 'showEventModal failed, auto-choosing first option:', e);
                settle(fallbackId);
            }
        });
    }

    /** Show the event-loading state if the UI supports it (never throws). */
    function showEventLoading() {
        try {
            if (typeof ui.showEventLoading === 'function') ui.showEventLoading();
        } catch (e) {
            log('warn', 'showEventLoading failed:', e);
        }
    }

    /** Close any open modal if the UI supports it (never throws). */
    function closeModalSafe() {
        try {
            if (typeof ui.closeModal === 'function') ui.closeModal();
        } catch {
            /* ignore */
        }
    }

    /**
     * Best-effort immersive narration posted into the chat. Failures are
     * swallowed (narration is a nicety, not part of the save).
     * @param {import('../contract/events.js').GameEvent} event
     * @param {string} optionId
     * @returns {Promise<void>}
     */
    async function narrate(event, optionId) {
        if (typeof llm.generateFlavorNarration !== 'function') return;
        try {
            const text = await llm.generateFlavorNarration(world, { event, optionId });
            if (text && text.trim() && postNarration) {
                await postNarration(text.trim());
            }
        } catch (e) {
            log('warn', 'narration failed (non-fatal):', e);
        }
    }

    /**
     * Render the game-over state and toast the reason. The save already holds
     * the terminal state (phase GAME_OVER) from the engine.
     * @param {string} reason pt-BR
     */
    function surfaceGameOver(reason) {
        refreshUi();
        toast(reason || t('hoi_phase_game_over'));
    }

    /* ---------------------------- persistence ---------------------------- */

    /** Persist the current world state; surfaces a toast on failure. */
    async function safeSave() {
        if (!world) return;
        try {
            await engine.saveState(world);
        } catch (e) {
            log('error', 'saveState failed:', e);
            toast(t('hoi_err_save'));
        }
    }

    /** Public save command (/hoi-save + toolbar). */
    async function saveCampaign() {
        if (!world || !world.playerNationId) {
            toast(t('hoi_err_no_campaign'));
            return;
        }
        await safeSave();
        toast(t('hoi_toast_saved'));
    }

    /** Public load command (/hoi-load): reload the save for this chat. */
    async function loadCampaign() {
        try {
            const saved = await engine.loadState();
            if (!saved) {
                toast(t('hoi_err_no_campaign'));
                return;
            }
            world = saved;
            await ensureMounted();
            refreshUi();
            toast(t('hoi_toast_loaded'));
        } catch (e) {
            log('error', 'loadCampaign failed:', e);
            toast(t('hoi_err_load'));
        }
    }

    /**
     * Delete the current chat's campaign and return to the empty/setup state.
     * @returns {Promise<void>}
     */
    async function resetCampaign() {
        try {
            if (typeof engine.deleteSave === 'function') {
                await engine.deleteSave();
            }
            world = null;
            refreshUi();
        } catch (e) {
            log('error', 'resetCampaign failed:', e);
            toast(t('hoi_err_generic'));
        }
    }

    /**
     * React to ST's CHAT_CHANGED: each chat owns one campaign, so reload the
     * save for the newly-active chat (or clear the in-memory state if none).
     * @returns {Promise<void>}
     */
    async function onChatChanged() {
        try {
            const saved = await engine.loadState();
            world = saved || null;
        } catch (e) {
            log('warn', 'onChatChanged loadState failed:', e);
            world = null;
        }
        refreshUi();
    }

    /* ------------------------------ queries ------------------------------ */

    /** @returns {import('../contract/worldState.js').WorldState|null} */
    function getState() {
        return world;
    }

    /** @returns {boolean} */
    function isBusy() {
        return busy;
    }

    /**
     * Build the pt-BR situation report for the current campaign (/hoi-status),
     * or an empty string when there is no active campaign.
     * @returns {string}
     */
    function buildSituationReport() {
        if (!world || !world.playerNationId) return '';
        try {
            return llm.buildSituationReport(world) || '';
        } catch (e) {
            log('warn', 'buildSituationReport failed:', e);
            return '';
        }
    }

    return {
        // GameController (contract)
        engine,
        scenario,
        llm,
        ui,
        start,
        startNewGame,
        nextTurn,
        // extras
        openPanel,
        pickNation,
        saveCampaign,
        loadCampaign,
        resetCampaign,
        onChatChanged,
        getState,
        buildSituationReport,
        isBusy,
    };
}

export default createGameController;
