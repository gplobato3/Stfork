/**
 * @file src/engine/war.js
 * Wars, fronts, exhaustion, capitulation, peace terms and calls to arms (DESIGN §3.5).
 *
 * Front model: `front.attacker` is the nation currently occupying part of
 * `front.defender` (progress 0..100). When the defender pushes the line below 0 and
 * can project force into the attacker (neighbor or major power) the front flips:
 * the former defender now occupies the former attacker. Progress 100 = capitulation.
 * Conventional occupation of nuclear powers is capped (NUCLEAR_FRONT_CAP): nobody
 * conquers a nuclear state without a nuclear war.
 */

import { NATION_STATUS, PEACE_TERMS } from '../contract/constants.js';
import { clamp, clampProgress, clampTension, getRelation } from '../contract/worldState.js';
import { addEvent, addHeadline } from './collector.js';
import { acceptanceChance, breakAllPactsBetween, createTruce, removeFromPacts } from './diplomacy.js';
import { buildCallToArmsEvent, buildPeaceOfferEvent, buildPeaceTermsEvent, buildSurrenderDemandEvent } from './engineEvents.js';
import { deName, textFor, theName } from './text.js';
import {
    addBaseline,
    addRelation,
    addResource,
    alliesOf,
    canProject,
    defendersOf,
    ensureEngine,
    frontCountOf,
    guarantees,
    isActive,
    isAllied,
    isAtWar,
    isNeighbor,
    nationPower,
    nextId,
    otherSide,
    pushLog,
    setRelation,
    sideOf,
    sideScore,
    warBetween,
} from './util.js';

export const TERMS_LABELS = Object.freeze({
    whitePeace: 'paz branca',
    reparations: 'reparações de guerra',
    puppet: 'Estado-fantoche',
    annex: 'anexação',
});

/** Max conventional occupation (%) of a nuclear power, by arsenal level. */
export const NUCLEAR_FRONT_CAP = Object.freeze({ 1: 70, 2: 50 });

/** Months of ceasefire after which the war ends as an armistice (white peace). */
export const CEASEFIRE_TO_PEACE = 12;

/** Defender advantage in the front formula (grows by progress/250 with occupation). */
export const DEFENDER_BONUS = 1.15;

/* ----------------------------------------------------------------- helpers */

function participants(war) {
    return [...war.attackers, ...war.defenders];
}

function hasFrontPair(war, a, b) {
    return war.fronts.some((f) => (f.attacker === a && f.defender === b) || (f.attacker === b && f.defender === a));
}

/** Adds fronts between `id` and every opposite member it (or they) can reach. */
export function addFrontsFor(state, war, id) {
    const side = sideOf(war, id);
    if (!side) return;
    for (const o of war[otherSide(side)]) {
        if (hasFrontPair(war, id, o)) continue;
        const atk = side === 'attackers' ? id : o;
        const def = side === 'attackers' ? o : id;
        if (canProject(state, atk, def)) war.fronts.push({ attacker: atk, defender: def, progress: 0 });
        else if (canProject(state, def, atk)) war.fronts.push({ attacker: def, defender: atk, progress: 0 });
    }
}

/** Records the player's enemies (Hegemonia victory needs all of them capitulated). */
export function trackPlayerEnemies(state, war) {
    const pid = state.player.nationId;
    const s = sideOf(war, pid);
    if (!s) return;
    const e = ensureEngine(state);
    for (const id of war[otherSide(s)]) if (!e.foughtEnemies.includes(id)) e.foughtEnemies.push(id);
}

function bumpTension(state, delta) {
    state.globalTension = clampTension(state.globalTension + delta);
}

function nuclearAcross(state, a, b) {
    return (state.nations[a].nuclear || 0) > 0 && (state.nations[b].nuclear || 0) > 0;
}

/* -------------------------------------------------------- AI war sanity */

/**
 * "Never suicidal" check shared by the AI and crisis eruptions. Returns the
 * coalition power ratio attacker/defender, or null when the attack is unthinkable:
 * the target is a strategic nuclear power, a nuclear power facing a non-nuclear
 * attacker, or is protected by a nuclear superpower about as strong as the attacker.
 * @param {{soft?: boolean}} [opts] soft: crisis eruptions (guarantees deter less).
 * @returns {?number}
 */
export function attackAssessment(state, a, b, powerOf, opts = {}) {
    const pw = powerOf || ((x) => nationPower(state.nations[x]));
    const A = state.nations[a];
    const B = state.nations[b];
    if (!isActive(A) || !isActive(B) || a === b) return null;
    if ((B.nuclear || 0) === 2 || ((B.nuclear || 0) > 0 && !(A.nuclear > 0))) return null;
    let mine = pw(a);
    for (const al of alliesOf(state, a)) mine += 0.2 * pw(al);
    let theirs = pw(b);
    const treaty = new Set(alliesOf(state, b));
    for (const d of defendersOf(state, b)) {
        if (d === a) return null;
        const dn = state.nations[d];
        if (!isActive(dn)) continue;
        // soft (crisis eruptions): only formal alliances / defense pacts veto, guarantors may not come
        const veto = !opts.soft || treaty.has(d);
        if (veto && (dn.nuclear || 0) === 2 && pw(d) >= pw(a) * 0.8) return null;
        theirs += pw(d) * ((dn.personality && dn.personality.blocLoyalty) || 0.5) * (opts.soft ? 0.5 : 0.9);
    }
    return mine / Math.max(1, theirs);
}

/* ------------------------------------------------------------- lifecycle */

/** Creates a new war a -> b. Assumes both active and not already fighting each other. */
export function declareWar(state, a, b, label, tc) {
    const t = textFor(state);
    const war = {
        id: nextId(state, 'guerra'),
        name: label || `Guerra ${t.n(a)}–${t.n(b)}`,
        attackers: [a],
        defenders: [b],
        startedTurn: state.turn,
        fronts: [],
        score: 0,
        exhaustion: { [a]: 0, [b]: 0 },
        ceasefire: false,
        ceasefireTurn: null,
        called: [],
    };
    addFrontsFor(state, war, a);
    if (!war.fronts.length) war.fronts.push({ attacker: a, defender: b, progress: 0 });
    breakAllPactsBetween(state, a, b);
    addRelation(state, a, b, -40);
    const majors = state.nations[a].major && state.nations[b].major;
    bumpTension(state, 5 + (nuclearAcross(state, a, b) ? 5 : 0) + (majors ? 3 : 0));
    state.wars.push(war);
    trackPlayerEnemies(state, war);
    addHeadline(tc, `${t.n(a)} ${t.v(a, 'declara', 'declaram')} guerra ${t.a(b)}`, 10, 'war', [a, b]);
    pushLog(state, 'war', `Guerra declarada: ${war.name}.`, { warId: war.id });
    return war;
}

/** `id` joins `side` of an existing war. */
export function joinWar(state, war, id, side, tc) {
    const t = textFor(state);
    if (sideOf(war, id)) return;
    war[side].push(id);
    war.exhaustion[id] = war.exhaustion[id] || 0;
    if (!Array.isArray(war.called)) war.called = [];
    if (!war.called.includes(id)) war.called.push(id);
    const other = war[otherSide(side)];
    for (const o of other) breakAllPactsBetween(state, id, o);
    addFrontsFor(state, war, id);
    if (other[0]) addRelation(state, id, other[0], -30);
    bumpTension(state, 2 + (other.some((o) => nuclearAcross(state, id, o)) ? 3 : 0));
    trackPlayerEnemies(state, war);
    addHeadline(tc, `${t.n(id)} ${t.v(id, 'entra', 'entram')} na guerra ao lado ${t.de(war[side][0])}`, 8, 'war', [id, war[side][0]]);
    pushLog(state, 'war', `${t.n(id)} entrou na ${war.name}.`, { warId: war.id });
}

/** Removes `id` from a war (fronts and exhaustion included). Does not end the war. */
export function removeFromWar(war, id) {
    war.attackers = war.attackers.filter((x) => x !== id);
    war.defenders = war.defenders.filter((x) => x !== id);
    war.fronts = war.fronts.filter((f) => f.attacker !== id && f.defender !== id);
    if (war.exhaustion) delete war.exhaustion[id];
}

/** Removes the war from state.wars. */
export function endWar(state, war, tc, headline) {
    if (!state.wars.includes(war)) return;
    state.wars = state.wars.filter((w) => w !== war);
    const text = headline || `Fim ${deName(war.name)}`;
    addHeadline(tc, text, 9, 'war', participants(war));
    pushLog(state, 'war', `${text}.`, { warId: war.id });
}

/** Ends wars left with an empty side. */
function pruneEmptyWars(state, tc) {
    for (const w of [...state.wars]) if (!w.attackers.length || !w.defenders.length) endWar(state, w, tc);
}

/** Removes `id` from every war and ends wars left with an empty side. */
export function removeFromAllWars(state, id, tc) {
    for (const w of [...state.wars]) if (sideOf(w, id)) removeFromWar(w, id);
    pruneEmptyWars(state, tc);
}

/**
 * War a -> b where a may JOIN instead of opening a new war: b is fighting someone a
 * is bound to (alliance/defense/guarantee), or a was called to arms in that war.
 */
export function findJoinableWar(state, a, b) {
    for (const war of state.wars) {
        const sb = sideOf(war, b);
        if (!sb || sideOf(war, a)) continue;
        const side = otherSide(sb);
        const called = Array.isArray(war.called) && war.called.includes(a);
        if (called || war[side].some((m) => isAllied(state, a, m) || guarantees(state, a, m))) return { war, side };
    }
    return null;
}

/* ------------------------------------------------------------ effect API */

/** `war declare` effect. Joins an ally's war when applicable. */
export function applyDeclare(state, a, b, label, tc) {
    const A = state.nations[a];
    const B = state.nations[b];
    const t = textFor(state);
    if (!isActive(A) || !isActive(B) || a === b) return { ok: false, text: '' };
    if (warBetween(state, a, b)) return { ok: false, text: `Já em guerra ${t.com(b)}` };
    const j = findJoinableWar(state, a, b);
    if (j) {
        joinWar(state, j.war, a, j.side, tc);
        return { ok: true, text: `${t.n(a)} ${t.v(a, 'entra', 'entram')} na ${j.war.name}` };
    }
    const war = declareWar(state, a, b, label, tc);
    return { ok: true, text: `Guerra declarada: ${war.name}` };
}

/** `war ceasefire` effect: freezes every front of the war between a and b. */
export function applyCeasefire(state, a, b, tc) {
    const war = warBetween(state, a, b);
    if (!war || war.ceasefire) return { ok: false, text: '' };
    const t = textFor(state);
    war.ceasefire = true;
    war.ceasefireTurn = state.turn;
    bumpTension(state, -3);
    addHeadline(tc, `Cessar-fogo entre ${t.n(a)} e ${t.n(b)}`, 8, 'war', [a, b]);
    pushLog(state, 'war', `Cessar-fogo: ${war.name}.`, { warId: war.id });
    return { ok: true, text: `Cessar-fogo: ${war.name}` };
}

/** Occupation of `loser` by fronts held by members of `winner`'s side. */
function occupationBySide(war, winner, loser) {
    const side = sideOf(war, winner);
    let occ = 0;
    for (const f of war.fronts) if (f.defender === loser && war[side].includes(f.attacker)) occ = Math.max(occ, f.progress);
    return occ;
}

/** Downgrades terms the military situation does not support. */
export function feasibleTerms(war, winner, loser, terms) {
    const occ = occupationBySide(war, winner, loser);
    const sc = sideScore(war, winner);
    let out = terms;
    if ((out === 'annex' || out === 'puppet') && occ < 75) out = occ >= 40 || sc >= 30 ? 'reparations' : 'whitePeace';
    if (out === 'reparations' && sc < -10 && occ < 20) out = 'whitePeace';
    return out;
}

/**
 * Applies peace terms: `winner` dictates to `loser`. Handles capitulated nations
 * (no war needed) and the post-war state of both nations. Returns applied terms.
 */
export function applyTerms(state, winner, loser, terms, tc) {
    const t = textFor(state);
    const W = state.nations[winner];
    const L = state.nations[loser];
    switch (terms) {
        case 'annex': {
            L.status = NATION_STATUS.ANNEXED;
            L.controller = winner;
            L.overlord = null;
            L.pc = 0;
            for (const id in state.nations) {
                const n = state.nations[id];
                if (id !== loser && n.controller === loser) n.controller = winner;
                if (n.overlord === loser) n.overlord = winner;
            }
            removeFromAllWars(state, loser, tc);
            removeFromPacts(state, loser);
            for (const c of [...state.crises]) {
                c.involved = c.involved.filter((x) => x !== loser);
                if (!c.involved.length) state.crises = state.crises.filter((x) => x !== c);
            }
            state.modifiers = state.modifiers.filter((m) => m.nationId !== loser);
            const eco = Math.round(L.resources.economy * 0.12);
            const man = Math.round(L.resources.manpower * 0.12);
            addResource(W, 'economy', eco);
            addResource(W, 'manpower', man);
            addResource(W, 'influence', 3);
            addBaseline(state, winner, 'economy', eco);
            addBaseline(state, winner, 'manpower', man);
            bumpTension(state, 4);
            addHeadline(tc, `${t.n(winner)} ${t.v(winner, 'anexa', 'anexam')} ${t.the(loser)}`, 10, 'war', [winner, loser]);
            break;
        }
        case 'puppet': {
            L.status = NATION_STATUS.PUPPET;
            L.overlord = winner;
            L.bloc = W.bloc;
            removeFromAllWars(state, loser, tc);
            removeFromPacts(state, loser, ['alliance', 'defense', 'guarantee']);
            setRelation(state, winner, loser, Math.max(getRelation(state, winner, loser), 50));
            addResource(W, 'influence', 3);
            addResource(W, 'economy', 2);
            bumpTension(state, 2);
            addHeadline(tc, `${t.n(loser)} ${t.v(loser, 'torna-se', 'tornam-se')} Estado-fantoche ${t.de(winner)}`, 10, 'war', [winner, loser]);
            break;
        }
        case 'reparations': {
            if (L.status === NATION_STATUS.CAPITULATED) L.status = NATION_STATUS.ACTIVE;
            createTruce(state, winner, loser);
            addResource(L, 'economy', -8);
            addResource(L, 'influence', -4);
            addResource(L, 'stability', -3);
            addResource(W, 'economy', 5);
            addRelation(state, winner, loser, 5);
            bumpTension(state, -2);
            addHeadline(tc, `${t.n(loser)} ${t.v(loser, 'aceita', 'aceitam')} pagar reparações de guerra ${t.a(winner)}`, 9, 'war', [winner, loser]);
            break;
        }
        default: {
            if (L.status === NATION_STATUS.CAPITULATED) L.status = NATION_STATUS.ACTIVE;
            createTruce(state, winner, loser);
            addRelation(state, winner, loser, 10);
            bumpTension(state, -3);
            addHeadline(tc, `${t.n(winner)} e ${t.n(loser)} assinam a paz`, 9, 'war', [winner, loser]);
            break;
        }
    }
    pushLog(state, 'war', `Termos de paz (${TERMS_LABELS[terms] || terms}): ${t.n(winner)} → ${t.n(loser)}.`);
    return terms;
}

/**
 * `war peace` effect: `a` (beneficiary) and `b` (loser for reparations/puppet/annex).
 * Leaders on both sides => the whole war ends; otherwise the non-leader makes a
 * separate peace and leaves the war.
 */
export function applyPeace(state, a, b, terms, tc) {
    const A = state.nations[a];
    const B = state.nations[b];
    const t = textFor(state);
    if (!A || !B || a === b) return { ok: false, text: '' };
    let wanted = PEACE_TERMS.includes(terms) ? terms : 'whitePeace';
    if (B.status === NATION_STATUS.CAPITULATED) {
        if (!isActive(A)) return { ok: false, text: '' };
        removeFromAllWars(state, b, tc);
        const applied = applyTerms(state, a, b, wanted, tc);
        return { ok: true, text: `Paz ${t.com(b)}: ${TERMS_LABELS[applied]}` };
    }
    const war = warBetween(state, a, b);
    if (!war) return { ok: false, text: '' };
    wanted = feasibleTerms(war, a, b, wanted);
    const sa = sideOf(war, a);
    const sb = sideOf(war, b);
    const leaders = war[sa][0] === a && war[sb][0] === b;
    let applied = wanted;
    if (leaders) {
        endWar(state, war, tc);
        applied = applyTerms(state, a, b, wanted, tc);
    } else {
        const exiting = war[sb][0] !== b ? b : a;
        removeFromWar(war, exiting);
        applied = exiting === b ? applyTerms(state, a, b, wanted, tc) : applyTerms(state, a, b, 'whitePeace', tc);
        pruneEmptyWars(state, tc);
    }
    bumpTension(state, -1);
    return { ok: true, text: `Paz ${t.com(b)} (${TERMS_LABELS[applied]}): ${war.name}` };
}

/** Moves a front by `delta` from its attacker's point of view (flips when pushed below 0). */
export function moveFront(state, f, delta) {
    let p = f.progress + delta;
    if (p < 0) {
        if (canProject(state, f.defender, f.attacker)) {
            const a = f.attacker;
            f.attacker = f.defender;
            f.defender = a;
            p = Math.min(-p, 12);
        } else {
            p = 0;
        }
    }
    f.progress = clampProgress(p);
}

/**
 * Conventional push (monthly resolution, expeditionary forces, limited strikes):
 * like moveFront but respecting NUCLEAR_FRONT_CAP. Explicit `front` effects
 * (nuclear strikes, decisions) bypass the cap.
 */
export function pushFront(state, f, delta) {
    const before = f.progress;
    const attacker = f.attacker;
    moveFront(state, f, delta);
    capForNuclear(state, f, f.attacker === attacker ? before : 0);
}

/** `front` effect: a pushes into b by delta (or pushes b back when b holds the front). */
export function applyFrontDelta(state, a, b, delta, tc) {
    const war = warBetween(state, a, b);
    if (!war) return { ok: false, text: '' };
    const t = textFor(state);
    let f = war.fronts.find((x) => x.attacker === a && x.defender === b);
    if (f) moveFront(state, f, delta);
    else {
        f = war.fronts.find((x) => x.attacker === b && x.defender === a);
        if (!f) {
            if (delta <= 0) return { ok: false, text: '' };
            f = { attacker: a, defender: b, progress: 0 };
            war.fronts.push(f);
            moveFront(state, f, delta);
        } else moveFront(state, f, -delta);
    }
    war.score = computeScore(war);
    return { ok: true, text: `Frente ${t.n(f.attacker)} → ${t.n(f.defender)}: ocupação ${f.progress}%` };
}

/* ---------------------------------------------------------- resolution */

export function computeScore(war) {
    if (!war.fronts.length) return 0;
    let sum = 0;
    for (const f of war.fronts) sum += war.attackers.includes(f.attacker) ? f.progress : -f.progress;
    return Math.round(clamp(sum / war.fronts.length, -100, 100));
}

/** Raw military weight of a nation (0..100) reduced by exhaustion. */
function warStrength(nation, exhaustion) {
    const r = nation.resources;
    const base = 0.4 * r.military + 0.2 * r.tech + 0.15 * r.economy + 0.15 * r.manpower + 0.1 * r.warSupport;
    return base * (1 - (exhaustion || 0) / 250);
}

/** Strength one nation brings to one front (front split + projection + co-belligerents). */
function frontStrength(state, war, id, opponent, cache) {
    const key = `${war.id}|${id}`;
    let entry = cache.get(key);
    if (!entry) {
        const raw = warStrength(state.nations[id], war.exhaustion[id]);
        const fronts = frontCountOf(state, id);
        const side = sideOf(war, id);
        let contrib = 0;
        for (const m of war[side]) if (m !== id) contrib += 0.12 * warStrength(state.nations[m], war.exhaustion[m]);
        entry = { raw, divisor: Math.min(3, 1 + 0.3 * Math.max(0, fronts - 1)), contrib };
        cache.set(key, entry);
    }
    let s = entry.raw / entry.divisor;
    if (!isNeighbor(state, id, opponent)) s *= 0.75;
    return s + Math.min(entry.contrib, 0.4 * s);
}

function capForNuclear(state, f, before) {
    const cap = NUCLEAR_FRONT_CAP[state.nations[f.defender].nuclear || 0];
    if (!cap || f.progress <= cap) return;
    f.progress = before >= cap ? Math.min(f.progress, Math.max(before, cap)) : cap;
}

function warUpdateText(state, war, move) {
    const t = textFor(state);
    const f = move.front;
    if (move.flipped) return `${war.name}: ${t.n(f.attacker)} ${t.v(f.attacker, 'invade', 'invadem')} ${t.the(f.defender)} (ocupação ${f.progress}%)`;
    if (move.change > 0) return `${war.name}: ${t.n(f.attacker)} ${t.v(f.attacker, 'avança', 'avançam')} ${t.em(f.defender)} (ocupação ${f.progress}%)`;
    if (move.change < 0) return `${war.name}: ${t.n(f.defender)} ${t.v(f.defender, 'contra-ataca', 'contra-atacam')} e a ocupação cai para ${f.progress}%`;
    return `${war.name}: frentes estáveis`;
}

/**
 * Monthly war resolution: fronts, exhaustion, score, capitulations, AI peace-seeking.
 * @param {Object} state working copy
 * @param {ReturnType<import('./rng.js').createRng>} rng
 * @param {ReturnType<import('./collector.js').createCollector>} tc
 */
export function resolveWars(state, rng, tc) {
    const cache = new Map();
    for (const war of [...state.wars]) {
        if (!state.wars.includes(war)) continue;
        trackPlayerEnemies(state, war);
        if (war.ceasefire) {
            for (const id of participants(war)) war.exhaustion[id] = Math.max(0, (war.exhaustion[id] || 0) - 2);
            if (state.turn + 1 - (war.ceasefireTurn ?? state.turn) >= CEASEFIRE_TO_PEACE) {
                endWar(state, war, tc, `Armistício encerra ${theName(war.name)}`);
                if (war.attackers[0] && war.defenders[0]) createTruce(state, war.attackers[0], war.defenders[0]);
                tc.warUpdates.push({ warId: war.id, summary: `${war.name}: o cessar-fogo vira armistício e a guerra termina.` });
            }
            continue;
        }
        const moves = [];
        for (const f of war.fronts) {
            const before = f.progress;
            const origAttacker = f.attacker;
            const atk = frontStrength(state, war, f.attacker, f.defender, cache);
            const def = frontStrength(state, war, f.defender, f.attacker, cache);
            // resistance hardens as more of the homeland is occupied
            const bonus = DEFENDER_BONUS + f.progress / 250;
            const delta = Math.round(clamp((atk - def * bonus) / 6 + rng.noise(3), -8, 12));
            pushFront(state, f, delta);
            const flipped = f.attacker !== origAttacker;
            moves.push({ front: f, flipped, change: flipped ? f.progress + before : f.progress - before, before });
        }
        // exhaustion
        for (const id of participants(war)) {
            let nf = 0;
            let occ = 0;
            let lost = false;
            for (const m of moves) {
                const f = m.front;
                if (f.attacker === id || f.defender === id) nf++;
                if (f.defender === id) {
                    occ = Math.max(occ, f.progress);
                    if (m.flipped || m.change > 0) lost = true;
                }
            }
            const inc = nf ? 0.5 + 0.2 * nf + occ / 60 + (lost ? 0.3 : 0) : 0.3;
            war.exhaustion[id] = Math.round(clamp((war.exhaustion[id] || 0) + rng.round(inc), 0, 100));
        }
        war.score = computeScore(war);
        // report
        if (moves.length) {
            const main = moves.reduce((best, m) => (Math.abs(m.change) > Math.abs(best.change) || (m.flipped && !best.flipped) ? m : best), moves[0]);
            const summary = warUpdateText(state, war, main);
            tc.warUpdates.push({ warId: war.id, summary });
            const crossed = main.before < 50 && main.front.progress >= 50;
            if (main.flipped || Math.abs(main.change) >= 6 || crossed) addHeadline(tc, summary, 6, 'war', [main.front.attacker, main.front.defender]);
        }
        // capitulations
        for (const f of [...war.fronts]) {
            if (f.progress >= 100 && state.wars.includes(war) && sideOf(war, f.defender) && sideOf(war, f.attacker)) {
                capitulate(state, war, f.defender, f.attacker, tc);
            }
        }
        if (state.wars.includes(war)) warDiplomacy(state, war, rng, tc);
    }
}

/** AI personality picks peace terms for a capitulated enemy. */
export function aiChooseTerms(state, winner, loser) {
    const W = state.nations[winner];
    const L = state.nations[loser];
    const a = (W.personality && W.personality.aggression) || 0.3;
    const ratio = nationPower(W) / Math.max(1, nationPower(L));
    if (a >= 0.65 && !L.major && isNeighbor(state, winner, loser) && ratio >= 1.8) return 'annex';
    if (a >= 0.45 && !L.major) return 'puppet';
    if (a >= 0.3 || L.major) return 'reparations';
    return 'whitePeace';
}

/** `loser` surrendered to `winner` (front at 100%). */
export function capitulate(state, war, loser, winner, tc) {
    const t = textFor(state);
    const L = state.nations[loser];
    const side = sideOf(war, loser);
    const wasLeader = side && war[side][0] === loser;
    L.status = NATION_STATUS.CAPITULATED;
    tc.capitulations.push(loser);
    addHeadline(tc, `${t.n(loser)} ${t.v(loser, 'capitula', 'capitulam')} diante ${t.de(winner)}`, 10, 'war', [loser, winner]);
    pushLog(state, 'war', `${t.n(loser)} capitulou (${war.name}).`, { warId: war.id });
    removeFromAllWars(state, loser, tc);
    if (wasLeader && state.wars.includes(war)) {
        for (const m of [...war[side]]) removeFromWar(war, m);
        endWar(state, war, tc);
    }
    const pid = state.player.nationId;
    if (loser === pid) return; // defeat, see outcome.js
    if (winner === pid) {
        addEvent(tc, buildPeaceTermsEvent(state, loser, war.name));
        return;
    }
    applyTerms(state, winner, loser, aiChooseTerms(state, winner, loser), tc);
}

/** Exhausted AI leaders sue for peace; deep fronts against the player trigger surrender demands. */
function warDiplomacy(state, war, rng, tc) {
    const pid = state.player.nationId;
    // surrender demand to the player
    if (sideOf(war, pid)) {
        let deep = null;
        for (const f of war.fronts) if (f.defender === pid && f.progress >= 70 && (!deep || f.progress > deep.progress)) deep = f;
        if (deep && state.turn - (war.lastSurrenderTurn ?? -99) >= 8) {
            war.lastSurrenderTurn = state.turn;
            const enemyLeader = war[otherSide(sideOf(war, pid))][0] || deep.attacker;
            addEvent(tc, buildSurrenderDemandEvent(state, enemyLeader, war, deep.progress));
        }
    }
    for (const side of ['attackers', 'defenders']) {
        const L = war[side][0];
        const O = war[otherSide(side)][0];
        if (!L || !O || L === pid) continue;
        const exh = war.exhaustion[L] || 0;
        const sc = sideScore(war, L);
        const months = state.turn - war.startedTurn;
        const wants = exh >= 75 || (exh >= 50 && sc <= -25) || (months >= 30 && Math.abs(war.score) < 12 && exh >= 45);
        if (!wants) continue;
        if (O === pid) {
            if (state.turn - (war.lastOfferTurn ?? -99) >= 6) {
                war.lastOfferTurn = state.turn;
                addEvent(tc, buildPeaceOfferEvent(state, L, war, sc <= -25 ? 'reparations' : 'whitePeace'));
            }
            continue;
        }
        // AI-AI talks: odds below the player-facing acceptance (wars should not end on a 5% fluke)
        const odds = (pct) => (pct / 100) ** 1.3;
        if (rng.chance(odds(acceptanceChance(state, L, O, 'peace')))) {
            const terms = sideScore(war, O) >= 30 ? 'reparations' : 'whitePeace';
            applyPeace(state, O, L, terms, tc);
            return;
        }
        if (rng.chance(odds(acceptanceChance(state, L, O, 'ceasefire')))) {
            applyCeasefire(state, L, O, tc);
            return;
        }
    }
}

/* ---------------------------------------------------------- calls to arms */

/**
 * Partners of the war leaders are called once per war: the original defender calls
 * alliance, defense-pact and guarantee partners; the original attacker calls alliance
 * partners only (lower odds). Pacts signed after the war started do not count.
 * The PLAYER receives a "Chamado às Armas" engine event instead.
 */
export function callsToArms(state, rng, tc) {
    const pid = state.player.nationId;
    const t = textFor(state);
    for (const war of [...state.wars]) {
        if (!state.wars.includes(war) || war.ceasefire) continue;
        if (!Array.isArray(war.called)) war.called = [];
        for (const side of ['defenders', 'attackers']) {
            const other = otherSide(side);
            const cands = new Map();
            // Only the original leaders call their partners, and only through pacts that
            // predate the war (joining a war voluntarily does not trigger Article 5).
            const leader = war[side][0];
            for (const m of leader ? [leader] : []) {
                for (const p of state.pacts) {
                    if (!p.members.includes(m) || (p.startedTurn ?? 0) > war.startedTurn) continue;
                    if (p.type === 'alliance' || (side === 'defenders' && p.type === 'defense')) {
                        for (const c of p.members) if (c !== m && !cands.has(c)) cands.set(c, { requester: m, pact: p, guarantee: false });
                    } else if (side === 'defenders' && p.type === 'guarantee' && p.members[1] === m) {
                        const c = p.members[0];
                        if (!cands.has(c)) cands.set(c, { requester: m, pact: p, guarantee: true });
                    }
                }
            }
            for (const c of [...cands.keys()].sort()) {
                if (war.called.includes(c) || sideOf(war, c)) continue;
                const cn = state.nations[c];
                if (!isActive(cn)) continue;
                const info = cands.get(c);
                war.called.push(c);
                if (war[other].some((o) => isAllied(state, c, o) || guarantees(state, c, o))) continue; // conflicted loyalties
                if (c === pid) {
                    addEvent(tc, buildCallToArmsEvent(state, war, info.requester, war[other][0], info.pact));
                    continue;
                }
                const pers = cn.personality || { blocLoyalty: 0.5 };
                let p = pers.blocLoyalty * (side === 'defenders' ? 0.85 : 0.3) + getRelation(state, c, info.requester) / 300;
                if (info.guarantee) p *= 0.85;
                if (isAtWar(state, c)) p *= 0.5;
                if (!cn.nuclear && !cn.major && war[other].some((o) => state.nations[o].nuclear === 2)) p *= 0.6;
                if (rng.chance(clamp(p, 0, 0.95))) {
                    joinWar(state, war, c, side, tc);
                } else {
                    addRelation(state, c, info.requester, -10);
                    if (cn.major) addHeadline(tc, `${t.n(c)} ${t.v(c, 'ignora', 'ignoram')} o chamado às armas ${t.de(info.requester)}`, 6, 'diplomacy', [c, info.requester]);
                }
            }
        }
    }
}
