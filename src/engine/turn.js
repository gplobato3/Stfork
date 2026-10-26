/**
 * @file src/engine/turn.js
 * endTurn (DESIGN §3.4): (0) expire stale engine decisions, (1) modifiers,
 * (2) upkeep, (3) PC income, (4) AI actions, (5) war resolution + capitulations +
 * peace terms, (6) calls to arms, (7) crisis evolution, (8) tension, (9) date++ and
 * cooldowns / pact expiry, (10) outcome. Produces a deterministic pt-BR TurnReport.
 */

import { PHASES, RESOURCE_KEYS } from '../contract/constants.js';
import { addMonths } from '../contract/worldState.js';
import { runAi } from './ai.js';
import { addHeadline, createCollector, enqueueEvents, topHeadlines } from './collector.js';
import { evolveCrises } from './crises.js';
import { grantPc, relationDrift, tickModifiers, upkeep } from './economy.js';
import { applyEffectsInPlace } from './effects.js';
import { checkOutcome } from './outcome.js';
import { fillDefaults } from './state.js';
import { nuclearIncident, updateTension } from './tension.js';
import { clone, pushLog, pushNews } from './util.js';
import { callsToArms, resolveWars } from './war.js';
import { formatDate } from '../contract/presentation.js';

/** Engine decisions unanswered for this many turns are resolved with their default option. */
export const EVENT_EXPIRY_TURNS = 6;

function emptyReport(state) {
    return {
        turn: state.turn,
        date: { ...state.date },
        pcGained: 0,
        playerDeltas: {},
        tensionBefore: state.globalTension,
        tensionAfter: state.globalTension,
        aiActions: [],
        warUpdates: [],
        capitulations: [],
        newCrises: [],
        resolvedCrises: [],
        headlines: [],
        engineEvents: [],
        outcome: state.outcome ? { kind: state.outcome.kind, reason: state.outcome.reason } : null,
    };
}

/** Applies the default option of an expired engine event (player perspective). */
export function expireEvent(state, ev, tc) {
    const idx = Number.isInteger(ev.defaultOption) ? ev.defaultOption : -1;
    const opt = idx >= 0 ? ev.options[idx] : null;
    if (opt) applyEffectsInPlace(state, opt.effects, { actorId: state.player.nationId }, tc);
    pushLog(state, 'decision', `Prazo esgotado: ${ev.title}${opt ? ` (aplicada a opção "${opt.label}")` : ''}.`, { eventId: ev.id });
}

function expireStaleEvents(state, tc) {
    // an event generated for turn T may be answered during turns T .. T+EXPIRY-1
    const limit = state.turn - EVENT_EXPIRY_TURNS + 1;
    const stale = (ev) => ev && ev.source === 'engine' && Number.isFinite(ev.turn) && ev.turn <= limit;
    const keep = [];
    for (const ev of state.eventQueue) {
        if (stale(ev)) expireEvent(state, ev, tc);
        else keep.push(ev);
    }
    state.eventQueue = keep;
    if (stale(state.pendingEvent)) {
        expireEvent(state, state.pendingEvent, tc);
        state.pendingEvent = state.eventQueue.shift() || null;
    }
}

/**
 * Advances one month. Pure: clones the input.
 * @param {import('../contract/worldState.js').WorldState} input
 * @param {Function} rngFor rng factory (state, salt) => rng
 * @returns {{state: import('../contract/worldState.js').WorldState, report: import('../contract/events.js').TurnReport}}
 */
export function runEndTurn(input, rngFor) {
    const state = fillDefaults(clone(input));
    if (state.phase === PHASES.GAME_OVER || state.outcome) return { state, report: emptyReport(state) };

    const tc = createCollector();
    const pid = state.player.nationId;
    const before = { ...state.nations[pid].resources };
    const tensionBefore = state.globalTension;

    expireStaleEvents(state, tc); // (0)
    tickModifiers(state); // (1)
    upkeep(state, rngFor(state, 'upkeep')); // (2)
    relationDrift(state, rngFor(state, 'relations'));
    const pcGained = grantPc(state); // (3)
    runAi(state, rngFor, tc); // (4)
    resolveWars(state, rngFor(state, 'war'), tc); // (5)
    callsToArms(state, rngFor(state, 'calls'), tc); // (6)
    evolveCrises(state, rngFor(state, 'crisis'), tc); // (7)
    const trng = rngFor(state, 'tension');
    updateTension(state, trng); // (8) world mechanics stop at 99...
    if (nuclearIncident(state, trng)) addHeadline(tc, 'Alarme nuclear: um incidente sai do controle e os mísseis são lançados', 10, 'war', []);
    else if (state.globalTension >= 95) addHeadline(tc, `Mundo à beira da guerra nuclear: tensão global em ${state.globalTension}`, 9, 'world', []);

    // (9) date++, cooldowns, pact expiry
    state.turn += 1;
    state.date = addMonths(state.date, 1);
    for (const [nid, cds] of Object.entries(state.cooldowns)) {
        for (const [aid, until] of Object.entries(cds)) if (!(until > state.turn)) delete cds[aid];
        if (!Object.keys(cds).length) delete state.cooldowns[nid];
    }
    const expired = state.pacts.filter((p) => p.expiresTurn !== null && p.expiresTurn <= state.turn);
    if (expired.length) {
        state.pacts = state.pacts.filter((p) => !expired.includes(p));
        for (const p of expired) pushLog(state, 'system', `Pacto expirado: ${p.name}.`);
    }

    // (10) outcome
    const outcome = checkOutcome(state, { endOfTurn: true, tc });

    // report
    const headlines = topHeadlines(tc);
    for (const h of headlines) pushNews(state, h.text, h.kind, h.nations);
    for (const ev of tc.events) ev.turn = state.turn;
    const queued = outcome ? [] : enqueueEvents(state, tc.events);
    const after = state.nations[pid].resources;
    const playerDeltas = {};
    for (const k of RESOURCE_KEYS) if (after[k] !== before[k]) playerDeltas[k] = after[k] - before[k];
    pushLog(state, 'system', `Mês encerrado; começa ${formatDate(state.date)}.`, { turn: state.turn });

    const report = {
        turn: state.turn,
        date: { ...state.date },
        pcGained,
        playerDeltas,
        tensionBefore,
        tensionAfter: state.globalTension,
        aiActions: tc.aiActions,
        warUpdates: tc.warUpdates,
        capitulations: tc.capitulations,
        newCrises: tc.newCrises,
        resolvedCrises: tc.resolvedCrises,
        headlines: headlines.map((h) => h.text),
        engineEvents: clone(queued),
        outcome: outcome ? { kind: outcome.kind, reason: outcome.reason } : null,
    };
    return { state, report };
}
