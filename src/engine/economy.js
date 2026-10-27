/**
 * @file src/engine/economy.js
 * endTurn steps 1-3: timed modifiers, upkeep (war costs, occupation, recession,
 * mean reversion toward each nation's baseline) and political-capital income.
 */

import { BOUNDS, NATION_STATUS, RESOURCE_KEYS } from '../contract/constants.js';
import { clamp, clampRelation, relationKey } from '../contract/worldState.js';
import { addResource, ensureEngine, frontCountOf, occupationOf } from './util.js';

/** Monthly share of the gap to the baseline that resources recover. */
export const MEAN_REVERSION = 0.05;

/** PC income bonus for the player by difficulty (DESIGN §3.2). */
export const DIFFICULTY_PC = Object.freeze({ facil: 1, normal: 0, dificil: -1 });

/** Step 1: apply and tick timed modifiers. */
export function tickModifiers(state) {
    const keep = [];
    for (const m of state.modifiers) {
        const n = state.nations[m.nationId];
        if (!n || n.status === NATION_STATUS.ANNEXED) continue;
        for (const [k, v] of Object.entries(m.perTurn || {})) if (RESOURCE_KEYS.includes(k)) addResource(n, k, v);
        m.turnsLeft = (Number(m.turnsLeft) || 0) - 1;
        if (m.turnsLeft > 0) keep.push(m);
    }
    state.modifiers = keep;
}

/**
 * Step 2: upkeep. Wars cost economy, stability, war support and manpower; deep
 * exhaustion drains stability; occupation hurts the economy; economy < 20 hurts
 * stability; everything drifts back toward the nation's baseline.
 * @param {Object} state working copy
 * @param {ReturnType<import('./rng.js').createRng>} rng
 */
export function upkeep(state, rng) {
    const e = ensureEngine(state);
    const ids = Object.keys(state.nations).sort();
    const exhaustionOf = new Map();
    const fighting = new Set();
    for (const w of state.wars) {
        for (const id of [...w.attackers, ...w.defenders]) {
            exhaustionOf.set(id, Math.max(exhaustionOf.get(id) || 0, (w.exhaustion && w.exhaustion[id]) || 0));
            if (!w.ceasefire) fighting.add(id);
        }
    }
    for (const id of ids) {
        const n = state.nations[id];
        if (!n || n.status === NATION_STATUS.ANNEXED) continue;
        const r = n.resources;
        if (fighting.has(id)) {
            const exh = exhaustionOf.get(id) || 0;
            const fronts = frontCountOf(state, id);
            addResource(n, 'economy', -1 - (exh >= 40 && rng.chance(0.5) ? 1 : 0));
            addResource(n, 'warSupport', -(rng.chance(0.5) ? 1 : 0) - (exh >= 60 ? 1 : 0));
            addResource(n, 'stability', -(exh >= 50 ? 1 : 0) - (exh >= 80 ? 1 : 0));
            addResource(n, 'manpower', -Math.min(2, fronts));
            if (fronts && rng.chance(0.5)) addResource(n, 'military', -1);
        }
        const { occupation } = occupationOf(state, id);
        if (occupation > 0) {
            addResource(n, 'economy', -Math.floor(occupation / 30));
            if (occupation >= 50) addResource(n, 'stability', -1);
        }
        if (r.economy < 20) addResource(n, 'stability', -1);
        const base = e.base[id];
        if (base) {
            for (const k of RESOURCE_KEYS) {
                const gap = (base[k] ?? r[k]) - r[k];
                if (gap) addResource(n, k, rng.round(Math.abs(gap) * MEAN_REVERSION) * Math.sign(gap));
            }
        }
    }
}

/** Monthly share of the gap to the baseline relation that relations recover. */
export const RELATION_REVERSION = 0.03;

/**
 * Relations slowly return to their historical baseline (engine.baseRel, captured at
 * newGame). Pairs at war are frozen. Keeps diplomacy from saturating at +-100.
 * @param {Object} state working copy
 * @param {ReturnType<import('./rng.js').createRng>} rng
 */
export function relationDrift(state, rng) {
    const e = ensureEngine(state);
    const base = e.baseRel || {};
    const warring = new Set();
    for (const w of state.wars) for (const a of w.attackers) for (const d of w.defenders) warring.add(relationKey(a, d));
    const keys = [...new Set([...Object.keys(state.relations), ...Object.keys(base)])].sort();
    for (const k of keys) {
        if (warring.has(k)) continue;
        const cur = state.relations[k] ?? 0;
        const gap = (base[k] ?? 0) - cur;
        if (!gap) continue;
        const step = rng.round(Math.abs(gap) * RELATION_REVERSION) * Math.sign(gap);
        if (!step) continue;
        const next = clampRelation(cur + step);
        if (next === 0 && !(k in base)) delete state.relations[k];
        else state.relations[k] = next;
    }
}

/** PC income formula (DESIGN §3.2). */
export function pcIncome(state, id) {
    const n = state.nations[id];
    if (!n) return 0;
    let inc = 2 + Math.floor(n.resources.influence / 25) + Math.floor(n.resources.stability / 40);
    if (id === state.player.nationId) inc += DIFFICULTY_PC[state.player.difficulty] || 0;
    return Math.max(0, inc);
}

/**
 * Step 3: PC income for every non-annexed nation. Returns the player's gain.
 */
export function grantPc(state) {
    let playerGain = 0;
    for (const id of Object.keys(state.nations)) {
        const n = state.nations[id];
        if (!n || n.status === NATION_STATUS.ANNEXED || n.status === NATION_STATUS.CAPITULATED) continue;
        const before = n.pc || 0;
        n.pc = Math.round(clamp(before + pcIncome(state, id), 0, BOUNDS.PC_MAX));
        if (id === state.player.nationId) playerGain = n.pc - before;
    }
    return playerGain;
}
