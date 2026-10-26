/**
 * @file src/engine/crises.js
 * Crisis lifecycle (start / escalate / deescalate / resolve) and monthly evolution:
 * escalation and expiry, ongoing stability drain, unrest from low stability, border
 * incidents between hostile neighbors and AI coups (DESIGN §3.4 step 7).
 */

import { CRISIS_SEVERITIES } from '../contract/constants.js';
import { clampTension, getRelation } from '../contract/worldState.js';
import { addHeadline } from './collector.js';
import { textFor } from './text.js';
import { canProject, addRelation, addResource, ensureEngine, isActive, isAtWar, isPlayer, nextId, pushLog, warBetween } from './util.js';
import { attackAssessment, declareWar } from './war.js';
import { pactExists } from './diplomacy.js';

const SEV = CRISIS_SEVERITIES;

/** Soft cap on simultaneous crises (new spontaneous crises stop above it). */
export const MAX_CRISES = 14;
/** AI coup: stability at or below this level for COUP_MONTHS consecutive months. */
export const COUP_STABILITY = 3;
export const COUP_MONTHS = 4;

/** Severity index 0..3 (unknown => 0). */
export const sevIndex = (s) => Math.max(0, SEV.indexOf(s));

function bumpTension(state, d) {
    state.globalTension = clampTension(state.globalTension + d);
}

/**
 * Starts a crisis. `spec` = { title, description, severity, involved, category?, region? }.
 * @returns {import('../contract/worldState.js').Crisis}
 */
export function startCrisis(state, spec, tc) {
    const crisis = {
        id: nextId(state, 'crise'),
        title: spec.title,
        description: spec.description || '',
        severity: SEV.includes(spec.severity) ? spec.severity : 'medium',
        involved: spec.involved.slice(),
        turnStarted: state.turn,
    };
    if (spec.category) crisis.category = spec.category;
    if (spec.region) crisis.region = spec.region;
    state.crises.push(crisis);
    if (tc) tc.newCrises.push(crisis.id);
    bumpTension(state, [0, 1, 2, 3][sevIndex(crisis.severity)]);
    addHeadline(tc, `Nova crise: ${crisis.title}`, sevIndex(crisis.severity) >= 2 ? 7 : 5, 'crisis', crisis.involved);
    pushLog(state, 'crisis', `Crise iniciada: ${crisis.title}.`, { crisisId: crisis.id });
    return crisis;
}

/** One severity step up (tension +2). Returns false when already critical. */
export function escalateCrisis(state, crisis, tc) {
    const i = sevIndex(crisis.severity);
    if (i >= SEV.length - 1) return false;
    crisis.severity = SEV[i + 1];
    bumpTension(state, 2);
    if (i + 1 >= 2) addHeadline(tc, `Crise se agrava: ${crisis.title}`, i + 1 === 3 ? 8 : 6, 'crisis', crisis.involved);
    pushLog(state, 'crisis', `Crise agravada: ${crisis.title} (${crisis.severity}).`, { crisisId: crisis.id });
    return true;
}

/** Removes the crisis (tension -2); `quiet` skips the headline. */
export function resolveCrisis(state, crisis, tc, quiet = false) {
    if (!state.crises.includes(crisis)) return false;
    state.crises = state.crises.filter((c) => c !== crisis);
    if (tc) tc.resolvedCrises.push(crisis.title);
    bumpTension(state, -2);
    if (!quiet) addHeadline(tc, `Crise encerrada: ${crisis.title}`, 5, 'crisis', crisis.involved);
    pushLog(state, 'crisis', `Crise encerrada: ${crisis.title}.`, { crisisId: crisis.id });
    return true;
}

/** One step down; a 'low' crisis is resolved. */
export function deescalateCrisis(state, crisis, tc) {
    const i = sevIndex(crisis.severity);
    if (i === 0) return resolveCrisis(state, crisis, tc);
    crisis.severity = SEV[i - 1];
    bumpTension(state, -1);
    addHeadline(tc, `Crise perde força: ${crisis.title}`, 3, 'crisis', crisis.involved);
    pushLog(state, 'crisis', `Crise atenuada: ${crisis.title} (${crisis.severity}).`, { crisisId: crisis.id });
    return true;
}

/** Internal unrest crises are single-nation crises with category "unrest". */
export const isUnrestCrisis = (c) => c.category === 'unrest' && c.involved.length === 1;

/** The unrest crisis of `id`, or null. */
export function unrestCrisisOf(state, id) {
    return state.crises.find((c) => isUnrestCrisis(c) && c.involved[0] === id) || null;
}

/** Starts (or escalates) an unrest crisis in `id`. */
export function startUnrest(state, id, severity, tc) {
    const existing = unrestCrisisOf(state, id);
    if (existing) {
        escalateCrisis(state, existing, tc);
        return existing;
    }
    const t = textFor(state);
    return startCrisis(
        state,
        {
            title: `Distúrbios ${t.em(id)}`,
            description: `Protestos, greves e confrontos com as forças de segurança se espalham ${t.em(id)}. O governo perde o controle de parte das ruas.`,
            severity,
            involved: [id],
            category: 'unrest',
        },
        tc,
    );
}

function avg(arr, f) {
    if (!arr.length) return 0;
    let s = 0;
    for (const x of arr) s += f(x);
    return s / arr.length;
}

/**
 * Monthly crisis evolution.
 * @param {Object} state working copy
 * @param {ReturnType<import('./rng.js').createRng>} rng
 * @param {ReturnType<import('./collector.js').createCollector>} tc
 */
export function evolveCrises(state, rng, tc) {
    const t = textFor(state);
    const tension = state.globalTension;
    for (const crisis of [...state.crises]) {
        if (!state.crises.includes(crisis)) continue;
        const nations = crisis.involved.map((id) => state.nations[id]).filter(isActive);
        if (!nations.length) {
            resolveCrisis(state, crisis, tc, true);
            continue;
        }
        const i = sevIndex(crisis.severity);
        const age = state.turn - (crisis.turnStarted || 0);
        const agg = avg(nations, (n) => (n.personality ? n.personality.aggression : 0.3));
        const dip = avg(nations, (n) => (n.personality ? n.personality.diplomacy : 0.5));
        let pEsc = [0.05, 0.06, 0.06, 0][i] + tension / 1500 + agg * 0.04;
        let pDe = 0.06 + dip * 0.08 + (age > 12 ? 0.06 : 0) + (tension < 40 ? 0.03 : 0) + (i === 3 ? 0.04 : 0);
        if (isUnrestCrisis(crisis)) {
            const stab = nations[0].resources.stability;
            if (stab >= 45) pDe += 0.25;
            else if (stab < 20) pEsc += 0.1;
        }
        const r = rng.next();
        if (r < pEsc) escalateCrisis(state, crisis, tc);
        else if (r < pEsc + pDe) deescalateCrisis(state, crisis, tc);
        if (!state.crises.includes(crisis)) continue;
        // ongoing drain
        const sev = sevIndex(crisis.severity);
        if (sev >= 2) {
            for (const n of nations) if (sev === 3 || rng.chance(0.4)) addResource(n, 'stability', -1);
        }
    }

    // critical crises between hostile neighbors (or a regional power) may erupt into war
    for (const crisis of [...state.crises]) {
        if (!state.crises.includes(crisis) || crisis.severity !== 'critical' || crisis.involved.length < 2) continue;
        if (state.globalTension >= 85) break;
        let best = null;
        for (const a of crisis.involved) {
            const na = state.nations[a];
            if (!isActive(na) || isPlayer(state, a) || isAtWar(state, a)) continue;
            const agg = na.personality ? na.personality.aggression : 0.3;
            if (agg < 0.35) continue;
            for (const b of crisis.involved) {
                if (a === b || !isActive(state.nations[b]) || warBetween(state, a, b)) continue;
                if (getRelation(state, a, b) > -40 || !canProject(state, a, b) || pactExists(state, 'nonAggression', a, b)) continue;
                const ratio = attackAssessment(state, a, b, null, { soft: true });
                if (ratio === null || ratio < 1.1) continue;
                const score = agg * Math.min(ratio, 2);
                if (!best || score > best.score) best = { a, b, agg, score };
            }
        }
        if (!best || !rng.chance(0.08 + best.agg * 0.12)) continue;
        resolveCrisis(state, crisis, tc, true);
        addHeadline(tc, `A crise "${crisis.title}" degenera em guerra`, 9, 'war', [best.a, best.b]);
        declareWar(state, best.a, best.b, null, tc);
    }

    // unrest from low stability
    let spawned = 0;
    const pid = state.player.nationId;
    for (const id of Object.keys(state.nations).sort()) {
        if (spawned >= 2 || state.crises.length >= MAX_CRISES) break;
        const n = state.nations[id];
        if (!isActive(n)) continue;
        const stab = n.resources.stability;
        if (stab >= 25 || unrestCrisisOf(state, id)) continue;
        const eligible = n.major || n.playable || id === pid || stab < 10;
        if (!eligible) continue;
        let p = (25 - stab) / 50;
        if (!n.major && !n.playable && id !== pid) p *= 0.5;
        if (rng.chance(p)) {
            startUnrest(state, id, stab < 10 ? 'high' : 'medium', tc);
            spawned++;
        }
    }

    // border incidents between hostile neighbors
    if (state.crises.length < MAX_CRISES && rng.chance(0.05 + tension / 800)) {
        const pairs = [];
        for (const a of Object.keys(state.neighbors || {}).sort()) {
            const na = state.nations[a];
            if (!isActive(na)) continue;
            for (const b of state.neighbors[a]) {
                if (b <= a) continue;
                const nb = state.nations[b];
                if (!isActive(nb) || !(na.major || nb.major || na.playable || nb.playable)) continue;
                if (getRelation(state, a, b) > -40 || warBetween(state, a, b)) continue;
                if (state.crises.some((c) => c.involved.includes(a) && c.involved.includes(b))) continue;
                pairs.push([a, b]);
            }
        }
        const pick = rng.pick(pairs);
        if (pick) {
            const [a, b] = pick;
            startCrisis(
                state,
                {
                    title: `Incidente de fronteira entre ${t.n(a)} e ${t.n(b)}`,
                    description: `Tropas ${t.de(a)} e ${t.de(b)} trocam disparos na fronteira. Cada lado acusa o outro de provocação e reforça suas posições.`,
                    severity: 'medium',
                    involved: [a, b],
                    category: 'military',
                },
                tc,
            );
            addRelation(state, a, b, -5);
        }
    }

    // AI coups after four months of near-total collapse (one per month worldwide)
    const e = ensureEngine(state);
    let coups = 0;
    for (const id of Object.keys(state.nations).sort()) {
        const n = state.nations[id];
        if (!isActive(n) || isPlayer(state, id)) continue;
        if (n.resources.stability <= COUP_STABILITY) e.lowStability[id] = (e.lowStability[id] || 0) + 1;
        else if (e.lowStability[id]) delete e.lowStability[id];
        if ((e.lowStability[id] || 0) < COUP_MONTHS || coups >= 1) continue;
        coups++;
        delete e.lowStability[id];
        n.resources.stability = 30;
        addResource(n, 'influence', -6);
        n.pc = 0;
        // the new regime consolidates: its long-run stability baseline improves a little
        if (e.base[id]) e.base[id].stability = Math.min(100, (e.base[id].stability || 0) + 8);
        const u = unrestCrisisOf(state, id);
        if (u) resolveCrisis(state, u, tc, true);
        addHeadline(tc, `Golpe de Estado ${t.em(id)}: militares assumem o poder`, 8, 'crisis', [id]);
        pushLog(state, 'crisis', `Golpe de Estado ${t.em(id)}.`);
    }
}
