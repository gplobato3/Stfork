/**
 * @file src/engine/view.js
 * Read-only projections for UI / sitrep: NationView and the power ranking.
 */

import { relationTier } from '../contract/presentation.js';
import { getRelation } from '../contract/worldState.js';
import { alliesOf, enemiesOf, isActive, nationPower, occupationOf, pactsOf, warBetween } from './util.js';

/**
 * Active nations by power (desc, ties by id).
 * @returns {Array<{id:string, name:string, power:number}>}
 */
export function rankingOf(state) {
    const out = [];
    for (const id of Object.keys(state.nations)) {
        const n = state.nations[id];
        if (isActive(n)) out.push({ id, name: n.name, power: nationPower(n) });
    }
    out.sort((a, b) => b.power - a.power || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
}

/**
 * NationView typedef (interfaces.js). Returns null for unknown ids.
 * @returns {?import('../contract/interfaces.js').NationView}
 */
export function nationView(state, id) {
    const n = state && state.nations ? state.nations[id] : null;
    if (!n) return null;
    const pid = state.player ? state.player.nationId : null;
    const rel = pid ? getRelation(state, pid, id) : 0;
    const atWarWithPlayer = !!(pid && id !== pid && warBetween(state, pid, id));
    const { occupation, occupier } = occupationOf(state, id);
    return {
        nation: structuredClone(n),
        power: nationPower(n),
        relationToPlayer: rel,
        relationTier: relationTier(rel, atWarWithPlayer).id,
        atWarWith: enemiesOf(state, id).sort(),
        allies: alliesOf(state, id),
        pacts: structuredClone(pactsOf(state, id)),
        controller: n.controller || id,
        occupation,
        occupier,
        crises: structuredClone(state.crises.filter((c) => c.involved.includes(id))),
    };
}
