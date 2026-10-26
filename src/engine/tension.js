/**
 * @file src/engine/tension.js
 * endTurn step 8: global tension drifts toward an equilibrium computed from the
 * world (wars, nuclear confrontations, crises, hostility between majors). Action
 * and event effects push it away from that level; the drift pulls it back.
 */

import { CRISIS_SEVERITIES } from '../contract/constants.js';
import { clamp, clampTension, getRelation } from '../contract/worldState.js';

/** Monthly fraction of the gap to the equilibrium closed by the drift. */
export const TENSION_DRIFT = 0.12;
/** Max drift per month. */
export const TENSION_MAX_STEP = 4;
/** The equilibrium never reaches the brink by itself. */
export const TENSION_EQ_MAX = 94;
/** World mechanics (AI, crises, drift) never push tension past this; only player choices reach 100... */
export const WORLD_TENSION_CAP = 99;
/** ...except a monthly "nuclear incident" risk of (tension - 95) * this, at tension >= 96. */
export const INCIDENT_RISK_PER_POINT = 0.012;

/** Saturation caps: many small wars / crises never add up to a nuclear crisis by themselves. */
export const WAR_TENSION_CAP = 50;
export const CRISIS_TENSION_CAP = 28;

const saturate = (sum, cap) => cap * (1 - Math.exp(-sum / cap));

/** Weight of one crisis: severity x scope (great powers involved, internal unrest, regional). */
function crisisWeight(state, c) {
    const sev = [1, 2.5, 5, 8][Math.max(0, CRISIS_SEVERITIES.indexOf(c.severity))];
    const majors = c.involved.some((id) => state.nations[id] && state.nations[id].major && state.nations[id].status === 'active');
    if (c.category === 'unrest' && c.involved.length === 1) return sev * (majors ? 0.7 : 0.4);
    return sev * (majors ? 1 : 0.35);
}

/**
 * Tension level the world "deserves" right now:
 * 15 + saturate(wars, 50) + saturate(crises, 28) + hostility between majors (max 8), capped at 94.
 * A war weighs more with great powers, nuclear powers on both sides (+6), nuclear
 * superpowers on both sides (+15) and nuclear powers being invaded (+4/+6).
 * @param {Object} state
 */
export function tensionEquilibrium(state) {
    let wars = 0;
    for (const w of state.wars) {
        const members = [...w.attackers, ...w.defenders];
        let majors = 0;
        for (const id of members) if (state.nations[id] && state.nations[id].major) majors++;
        let v = 3 + 2 * Math.min(4, majors);
        const nuc = (ids, lvl) => ids.some((id) => (state.nations[id].nuclear || 0) >= lvl);
        if (nuc(w.attackers, 1) && nuc(w.defenders, 1)) v += 6;
        if (nuc(w.attackers, 2) && nuc(w.defenders, 2)) v += 15;
        let invaded = 0;
        for (const f of w.fronts) {
            const n = state.nations[f.defender].nuclear || 0;
            if (n > 0 && f.progress >= 40) invaded = Math.max(invaded, n === 2 ? 6 : 4);
        }
        v += invaded;
        wars += w.ceasefire ? v * 0.35 : v;
    }
    let crises = 0;
    for (const c of state.crises) crises += crisisWeight(state, c);
    const majors = Object.keys(state.nations).filter((id) => state.nations[id].major && state.nations[id].status === 'active');
    let hostile = 0;
    for (let i = 0; i < majors.length; i++) {
        for (let j = i + 1; j < majors.length; j++) if (getRelation(state, majors[i], majors[j]) <= -60) hostile++;
    }
    const eq = 15 + saturate(wars, WAR_TENSION_CAP) + saturate(crises, CRISIS_TENSION_CAP) + Math.min(8, hostile * 0.5);
    return clamp(eq, 5, TENSION_EQ_MAX);
}

/**
 * Moves state.globalTension toward the equilibrium (plus small noise).
 * @param {Object} state working copy
 * @param {ReturnType<import('./rng.js').createRng>} rng
 * @param {number} [eq] equilibrium (defaults to tensionEquilibrium(state); injectable for tests)
 * @returns {number} equilibrium used
 */
export function updateTension(state, rng, eq = tensionEquilibrium(state)) {
    const t = Math.min(state.globalTension, WORLD_TENSION_CAP);
    const drift = clamp((eq - t) * TENSION_DRIFT + rng.noise(1.2), -TENSION_MAX_STEP, TENSION_MAX_STEP);
    state.globalTension = clampTension(Math.min(WORLD_TENSION_CAP, t + rng.round(drift)));
    return eq;
}

/**
 * Brinkmanship: at tension >= 96 a false alarm or rogue commander may start the
 * exchange. Returns true when global nuclear war broke out (tension set to 100).
 */
export function nuclearIncident(state, rng) {
    const t = state.globalTension;
    if (t < 96) return false;
    if (!rng.chance((t - 95) * INCIDENT_RISK_PER_POINT)) return false;
    state.globalTension = 100;
    return true;
}
