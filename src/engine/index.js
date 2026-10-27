/**
 * @file src/engine/index.js
 * ENGINE module entry: createEngine() -> EngineAPI (src/contract/interfaces.js).
 *
 * Pure and deterministic: no SillyTavern, DOM, network, Date.now() or Math.random().
 * Every public function clones its input state (structuredClone) and returns new
 * objects; the private rule modules mutate that working copy only.
 */

import { PHASES } from '../contract/constants.js';
import { executeInPlace, getAvailableActions as listActions } from './actions.js';
import { CATALOG } from './catalog.js';
import { createCollector, enqueueEvents, flushCollector } from './collector.js';
import { applyEffectsInPlace } from './effects.js';
import { checkOutcome } from './outcome.js';
import { createRngFactory } from './rng.js';
import { sanitizeEvent } from './sanitize.js';
import { buildNewGame, fillDefaults, migrateState } from './state.js';
import { runEndTurn } from './turn.js';
import { clone, pushDecision, pushLog } from './util.js';
import { nationView, rankingOf } from './view.js';

/**
 * Creates the engine.
 * @param {{seedrandom?: Function}} [opts] `seedrandom`: optional SillyTavern.libs.seedrandom
 *        (seed => () => float). Defaults to a local PRNG so node runs are reproducible.
 * @returns {import('../contract/interfaces.js').EngineAPI}
 */
export function createEngine(opts = {}) {
    const rngFor = createRngFactory(opts && opts.seedrandom);

    /**
     * New campaign from scenario data + bookmark overrides.
     * Default seed (when opts.seed is absent) derives from scenario/bookmark/nation/leader;
     * callers wanting distinct campaigns should pass their own seed.
     * @throws {Error} unknown nation id or scenario without nations
     */
    function newGame(scenario, options) {
        return buildNewGame(scenario, options || {});
    }

    /** The action catalog (frozen ActionDefs). */
    function getCatalog() {
        return CATALOG.slice();
    }

    /**
     * Availability of every catalog action for `actorId` (targeted ones against `targetId`).
     * Read-only: does not clone or modify the state.
     */
    function getAvailableActions(state, actorId, targetId = null) {
        try {
            const complete = state && state.neighbors && Array.isArray(state.modifiers) && state.cooldowns && Array.isArray(state.pacts);
            return listActions(complete ? state : fillDefaults(clone(state)), actorId, targetId || null);
        } catch {
            return [];
        }
    }

    /**
     * Executes an action (costs, cooldown, dice, effects). When rejected (ok:false)
     * the input state is returned unchanged.
     */
    function executeAction(state, actorId, actionId, targetId = null, options = {}) {
        const s = fillDefaults(clone(state));
        const tc = createCollector();
        const result = executeInPlace(s, actorId, actionId, targetId || null, { source: (options && options.source) || 'ui', rngFor, tc });
        if (!result.ok) return { state, result };
        checkOutcome(s, { tc });
        flushCollector(s, tc);
        return { state: s, result };
    }

    /** Advances one month (see turn.js for the full order). */
    function endTurn(state) {
        return runEndTurn(state, rngFor);
    }

    /**
     * Sets state.pendingEvent (sanitized). When a decision is already pending, the
     * new event is queued. Invalid events leave the state unchanged.
     */
    function setPendingEvent(state, event) {
        const s = fillDefaults(clone(state));
        const { ok, value } = sanitizeEvent(event, s);
        if (!ok || !value) return s;
        if ((s.pendingEvent && s.pendingEvent.id === value.id) || s.eventQueue.some((q) => q.id === value.id)) return s;
        if (!s.pendingEvent) s.pendingEvent = value;
        else enqueueEvents(s, [value]);
        return s;
    }

    /**
     * Applies the chosen option of state.pendingEvent (or of the head of the queue when
     * nothing is pending), records the decision and promotes the next queued event.
     */
    function resolvePendingEvent(state, optionIndex) {
        const s = fillDefaults(clone(state));
        if (s.phase === PHASES.GAME_OVER) return { state, summary: 'A campanha terminou.', details: [] };
        if (!s.pendingEvent && s.eventQueue.length) s.pendingEvent = s.eventQueue.shift();
        const ev = s.pendingEvent;
        if (!ev) return { state, summary: 'Nenhuma decisão pendente.', details: [] };
        const opt = Number.isInteger(optionIndex) && Array.isArray(ev.options) ? ev.options[optionIndex] : null;
        if (!opt) return { state, summary: 'Opção inválida.', details: [] };
        const tc = createCollector();
        const details = applyEffectsInPlace(s, opt.effects, { actorId: s.player.nationId }, tc);
        pushDecision(s, { turn: s.turn, eventTitle: ev.title, optionLabel: opt.label });
        pushLog(s, 'decision', `Decisão: ${ev.title} — ${opt.label}.`, { eventId: ev.id, optionIndex });
        s.pendingEvent = s.eventQueue.shift() || null;
        checkOutcome(s, { tc });
        flushCollector(s, tc);
        return { state: s, summary: `${ev.title}: ${opt.label}.`, details };
    }

    /**
     * Validates + applies effects. SELF/TARGET resolve from ctx (SELF defaults to the
     * player). Invalid effects are skipped; never throws.
     */
    function applyEffects(state, effects, ctx = {}) {
        try {
            const s = fillDefaults(clone(state));
            const tc = createCollector();
            const c = { actorId: (ctx && ctx.actorId) || s.player.nationId, targetId: (ctx && ctx.targetId) || null };
            const details = applyEffectsInPlace(s, effects, c, tc);
            checkOutcome(s, { tc });
            flushCollector(s, tc);
            return { state: s, details };
        } catch {
            return { state, details: [] };
        }
    }

    /** NationView for one nation (null for unknown ids). */
    function getNationView(state, id) {
        try {
            return nationView(state, id);
        } catch {
            return null;
        }
    }

    /** Active nations by power, descending. */
    function getRanking(state) {
        try {
            return rankingOf(state);
        } catch {
            return [];
        }
    }

    return {
        newGame,
        getCatalog,
        getAvailableActions,
        executeAction,
        endTurn,
        setPendingEvent,
        resolvePendingEvent,
        applyEffects,
        getNationView,
        getRanking,
        migrate: migrateState,
        sanitizeEvent,
    };
}

export { CATALOG } from './catalog.js';
