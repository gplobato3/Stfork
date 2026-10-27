/**
 * @file src/engine/diplomacy.js
 * Pacts (create / break / cleanup) and AI acceptance of diplomatic proposals.
 */

import { clamp, getRelation } from '../contract/worldState.js';
import { textFor } from './text.js';
import {
    enemiesOf,
    guarantees,
    hasPact,
    hostileBlocs,
    isAtWar,
    nationPower,
    nextId,
    sideScore,
    warBetween,
} from './util.js';

export const PACT_LABELS = Object.freeze({
    alliance: 'Aliança',
    defense: 'Pacto de Defesa',
    trade: 'Acordo Comercial',
    nonAggression: 'Pacto de Não Agressão',
    guarantee: 'Garantia de Independência',
});

/** Indefinite form used in requirement reasons ("Já existe um acordo comercial com..."). */
export const PACT_INDEFINITE = Object.freeze({
    alliance: 'uma aliança',
    defense: 'um pacto de defesa',
    trade: 'um acordo comercial',
    nonAggression: 'um pacto de não agressão',
    guarantee: 'uma garantia de independência',
});

/** Default pt-BR pact name ("Acordo Comercial Brasil–China"). */
export function pactName(state, type, a, b, label) {
    if (label) return label;
    const t = textFor(state);
    if (type === 'guarantee') return `Garantia de Independência ${t.de(b)}`;
    return `${PACT_LABELS[type] || 'Pacto'} ${t.n(a)}–${t.n(b)}`;
}

/** True when a pact of `type` already binds a and b (guarantee: a guarantees b). */
export function pactExists(state, type, a, b) {
    if (type === 'guarantee') return guarantees(state, a, b);
    return hasPact(state, a, b, [type]);
}

/** Months a trade agreement lasts before expiring (keeps the pact list bounded). */
export const TRADE_PACT_TURNS = 60;

/**
 * Creates a bilateral pact. Returns the pact, or null when it already exists.
 * Trade agreements expire after TRADE_PACT_TURNS; other pacts are permanent.
 * @returns {?import('../contract/worldState.js').Pact}
 */
export function createPact(state, type, a, b, label, expiresTurn) {
    if (a === b || pactExists(state, type, a, b)) return null;
    const pact = {
        id: nextId(state, 'pacto'),
        type,
        name: pactName(state, type, a, b, label),
        members: [a, b],
        startedTurn: state.turn,
        expiresTurn: Number.isFinite(expiresTurn) ? expiresTurn : type === 'trade' ? state.turn + TRADE_PACT_TURNS : null,
    };
    state.pacts.push(pact);
    return pact;
}

/** Months a post-war truce (non-aggression pact) lasts. */
export const TRUCE_TURNS = 36;

/** Peace treaty: a temporary non-aggression pact that blocks a new war between a and b. */
export function createTruce(state, a, b) {
    if (!state.nations[a] || !state.nations[b] || a === b) return null;
    breakPacts(state, 'nonAggression', a, b);
    const t = textFor(state);
    return createPact(state, 'nonAggression', a, b, `Tratado de Paz ${t.n(a)}–${t.n(b)}`, state.turn + TRUCE_TURNS);
}

/**
 * Breaks pacts of `type` binding a and b. Bilateral pacts are removed; in a
 * multi-member pact (OTAN) `a` leaves. Returns the affected pact names.
 */
export function breakPacts(state, type, a, b) {
    const names = [];
    const keep = [];
    for (const p of state.pacts) {
        const binds =
            p.type === type &&
            (type === 'guarantee'
                ? (p.members[0] === a && p.members[1] === b) || (p.members[0] === b && p.members[1] === a)
                : p.members.includes(a) && p.members.includes(b));
        if (!binds) {
            keep.push(p);
            continue;
        }
        names.push(p.name);
        if (p.members.length > 2) {
            p.members = p.members.filter((m) => m !== a);
            if (p.members.length >= 2) keep.push(p);
        }
    }
    state.pacts = keep;
    return names;
}

/** Breaks every pact between a and b (used when they go to war). */
export function breakAllPactsBetween(state, a, b) {
    const names = [];
    for (const type of ['alliance', 'defense', 'trade', 'nonAggression', 'guarantee']) names.push(...breakPacts(state, type, a, b));
    return names;
}

/** Removes `id` from every pact (optionally only some types); drops pacts left with < 2 members. */
export function removeFromPacts(state, id, types) {
    const keep = [];
    for (const p of state.pacts) {
        if (!p.members.includes(id) || (types && !types.includes(p.type))) {
            keep.push(p);
            continue;
        }
        if (p.type === 'guarantee') continue;
        p.members = p.members.filter((m) => m !== id);
        if (p.members.length >= 2) keep.push(p);
    }
    state.pacts = keep;
}

/** a and b share an enemy at war, or both are hostile (<= -50) to the same major. */
export function sharedEnemy(state, a, b) {
    const ea = enemiesOf(state, a);
    if (ea.length) {
        const eb = new Set(enemiesOf(state, b));
        if (ea.some((x) => eb.has(x))) return true;
    }
    for (const id in state.nations) {
        if (id === a || id === b) continue;
        const n = state.nations[id];
        if (!n.major || n.status !== 'active') continue;
        if (getRelation(state, a, id) <= -50 && getRelation(state, b, id) <= -50) return true;
    }
    return false;
}

/**
 * Probability (5..95) that `targetId` accepts a proposal of `kind` from `actorId`.
 * Depends on relation, the target's personality and the power ratio (DESIGN §3.3).
 * @param {'trade'|'energy'|'alliance'|'defense'|'ceasefire'|'peace'} kind
 */
export function acceptanceChance(state, actorId, targetId, kind) {
    const A = state.nations[actorId];
    const T = state.nations[targetId];
    if (!A || !T || actorId === targetId) return 0;
    const p = T.personality || { aggression: 0.3, diplomacy: 0.5, blocLoyalty: 0.5 };
    const rel = getRelation(state, actorId, targetId);
    const ratio = nationPower(A) / Math.max(1, nationPower(T));
    const sameBloc = A.bloc === T.bloc && A.bloc !== 'NON_ALIGNED';
    const hostile = hostileBlocs(A.bloc, T.bloc);
    let v = 0;
    switch (kind) {
        case 'trade':
            v = 30 + rel * 0.4 + p.diplomacy * 30 - (hostile ? 20 : 0) + (T.resources.economy < 50 ? 5 : 0);
            break;
        case 'energy':
            v = 28 + rel * 0.4 + p.diplomacy * 25 - (hostile ? 20 : 0) + (T.resources.economy < 50 ? 8 : 0);
            break;
        case 'alliance':
        case 'defense': {
            const shared = sharedEnemy(state, actorId, targetId);
            v =
                (kind === 'alliance' ? -15 : -5) +
                rel * 0.6 +
                p.diplomacy * 12 +
                (sameBloc ? 20 * p.blocLoyalty : 0) -
                (hostile ? 40 : 0) +
                (ratio > 1.2 ? 10 : ratio < 0.5 ? -10 : 0) -
                (isAtWar(state, actorId) ? (kind === 'alliance' ? 20 : 25) : 0) +
                (shared ? 15 : 0) -
                p.aggression * 5;
            break;
        }
        case 'ceasefire':
        case 'peace': {
            const war = warBetween(state, actorId, targetId);
            if (!war) return 0;
            const exh = (war.exhaustion && war.exhaustion[targetId]) || 0;
            const sc = sideScore(war, targetId);
            const months = state.turn - war.startedTurn;
            if (kind === 'ceasefire') {
                v = 10 + exh * 0.5 + (sc < -15 ? 20 : sc > 15 ? -20 : 0) + p.diplomacy * 15 - p.aggression * 15 + rel * 0.1;
            } else {
                v = -5 + exh * 0.6 + (sc < -15 ? 25 : sc > 15 ? -30 : 0) + p.diplomacy * 20 - p.aggression * 20 + rel * 0.1 + (months > 36 ? 10 : 0);
            }
            break;
        }
        default:
            v = 50;
    }
    return Math.round(clamp(v, 5, 95));
}
