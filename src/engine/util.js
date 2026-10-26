/**
 * @file src/engine/util.js
 * Shared helpers for the engine: cloning, bookkeeping (ids, log, news), nation /
 * war / pact queries and resource math. Every mutating helper works on the
 * engine's private working copy (public entry points clone first).
 */

import { BLOCS, CAPS, NATION_STATUS, RESOURCE_KEYS } from '../contract/constants.js';
import { clamp, clampRelation, clampResource, getRelation, relationKey } from '../contract/worldState.js';

/** Deep clone of plain JSON data. */
export function clone(value) {
    return structuredClone(value);
}

/**
 * Engine-private bookkeeping stored in `state.engine` (see docs/contract-requests/engine.md).
 * @param {Object} state
 */
export function ensureEngine(state) {
    if (!state.engine || typeof state.engine !== 'object' || Array.isArray(state.engine)) state.engine = {};
    const e = state.engine;
    if (!Number.isFinite(e.seq)) e.seq = 0;
    if (!e.base || typeof e.base !== 'object') e.base = {};
    if (!Number.isFinite(e.zeroStability)) e.zeroStability = 0;
    if (!Array.isArray(e.foughtEnemies)) e.foughtEnemies = [];
    if (!e.lowStability || typeof e.lowStability !== 'object') e.lowStability = {};
    if (!e.baseRel || typeof e.baseRel !== 'object') e.baseRel = { ...(state.relations || {}) };
    return e;
}

/** Monotonic sequence number persisted in the state (deterministic ids / rng salts). */
export function nextSeq(state) {
    const e = ensureEngine(state);
    e.seq += 1;
    return e.seq;
}

/** Deterministic id: `${prefix}-${turn}-${seq}`. */
export function nextId(state, prefix) {
    return `${prefix}-${state.turn}-${nextSeq(state)}`;
}

function dateCopy(state) {
    return { year: state.date.year, month: state.date.month };
}

function trimTo(arr, cap) {
    if (arr.length > cap) arr.splice(0, arr.length - cap);
}

/** Appends a LogEntry (trims to CAPS.LOG). */
export function pushLog(state, kind, text, data) {
    if (!Array.isArray(state.log)) state.log = [];
    const entry = { turn: state.turn, date: dateCopy(state), kind, text: String(text) };
    if (data !== undefined) entry.data = data;
    state.log.push(entry);
    trimTo(state.log, CAPS.LOG);
}

/** Appends a NewsItem (trims to CAPS.NEWS). */
export function pushNews(state, text, kind = 'world', nations = []) {
    if (!Array.isArray(state.news)) state.news = [];
    state.news.push({ turn: state.turn, date: dateCopy(state), text: String(text), kind, nations: nations.filter(Boolean) });
    trimTo(state.news, CAPS.NEWS);
}

/** Appends a player ActionRecord (trims to CAPS.RECENT_ACTIONS). */
export function pushRecentAction(state, record) {
    if (!Array.isArray(state.recentActions)) state.recentActions = [];
    state.recentActions.push(record);
    trimTo(state.recentActions, CAPS.RECENT_ACTIONS);
}

/** Appends a DecisionRecord (trims to CAPS.DECISIONS). */
export function pushDecision(state, record) {
    if (!Array.isArray(state.decisions)) state.decisions = [];
    state.decisions.push(record);
    trimTo(state.decisions, CAPS.DECISIONS);
}

/* ------------------------------------------------------------------ nations */

export const isActive = (n) => !!n && n.status === NATION_STATUS.ACTIVE;
/** Major (great/regional) power. */
export const isMajor = (state, id) => !!(state.nations[id] && state.nations[id].major);
/** The player nation. */
export const isPlayer = (state, id) => !!state.player && state.player.nationId === id;

/** Sorted ids of every nation whose status is 'active'. */
export function activeIds(state) {
    return Object.keys(state.nations).filter((id) => isActive(state.nations[id])).sort();
}

/**
 * Composite power 0..100 (ranking, AI power ratios, outcome score).
 * @param {import('../contract/worldState.js').Nation} n
 */
export function nationPower(n) {
    if (!n || !n.resources) return 0;
    const r = n.resources;
    const raw = 0.3 * r.military + 0.25 * r.economy + 0.15 * r.tech + 0.1 * r.manpower + 0.12 * r.influence + 0.08 * r.stability;
    const nuke = n.nuclear === 2 ? 8 : n.nuclear === 1 ? 4 : 0;
    return Math.round(clamp(raw + nuke, 0, 100));
}

/** Adds `delta` to a resource (clamped 0..100). Returns the change actually applied. */
export function addResource(nation, key, delta) {
    if (!nation || !nation.resources || !RESOURCE_KEYS.includes(key)) return 0;
    const before = nation.resources[key];
    nation.resources[key] = clampResource(before + delta);
    return nation.resources[key] - before;
}

/** Adds to the engine baseline (mean-reversion target), e.g. after annexing territory. */
export function addBaseline(state, id, key, delta) {
    const e = ensureEngine(state);
    if (!e.base[id]) return;
    e.base[id][key] = clampResource((e.base[id][key] ?? 50) + delta);
}

/* ---------------------------------------------------------------- relations */

export { getRelation };

/** Sets the a<->b relation (clamped, no-op when a === b). */
export function setRelation(state, a, b, value) {
    if (a === b) return;
    state.relations[relationKey(a, b)] = clampRelation(value);
}

/** Adds to the a<->b relation (clamped, no-op when a === b). */
export function addRelation(state, a, b, delta) {
    if (a === b) return;
    setRelation(state, a, b, getRelation(state, a, b) + delta);
}

/* ---------------------------------------------------------------- neighbors */

export function isNeighbor(state, a, b) {
    const list = state.neighbors && state.neighbors[a];
    return Array.isArray(list) && list.includes(b);
}

/** a can project force into b: neighbors, or a is a major power. */
export function canProject(state, a, b) {
    return isNeighbor(state, a, b) || isMajor(state, a);
}

/* --------------------------------------------------------------------- wars */

export function sideOf(war, id) {
    if (war.attackers.includes(id)) return 'attackers';
    if (war.defenders.includes(id)) return 'defenders';
    return null;
}

/** The opposite war side key. */
export const otherSide = (side) => (side === 'attackers' ? 'defenders' : 'attackers');

/** Wars `id` takes part in (ceasefires included). */
export function warsOf(state, id) {
    return state.wars.filter((w) => sideOf(w, id));
}

/** True when `id` is in any war (ceasefires included). */
export function isAtWar(state, id) {
    return state.wars.some((w) => sideOf(w, id));
}

/** War where a and b are on opposite sides, or null. */
export function warBetween(state, a, b) {
    for (const w of state.wars) {
        const sa = sideOf(w, a);
        if (!sa) continue;
        const sb = sideOf(w, b);
        if (sb && sb !== sa) return w;
    }
    return null;
}

/** Ids at war with `id` (any war, ceasefire included). */
export function enemiesOf(state, id) {
    const out = new Set();
    for (const w of state.wars) {
        const s = sideOf(w, id);
        if (!s) continue;
        for (const e of w[otherSide(s)]) out.add(e);
    }
    return [...out];
}

/** Max occupation of `id` by any front and who holds it. */
export function occupationOf(state, id) {
    let best = 0;
    let occupier = null;
    for (const w of state.wars) {
        for (const f of w.fronts) {
            if (f.defender === id && f.progress > best) {
                best = f.progress;
                occupier = f.attacker;
            }
        }
    }
    return { occupation: best, occupier };
}

/** Number of fronts `id` fights on across every non-ceasefire war. */
export function frontCountOf(state, id) {
    let n = 0;
    for (const w of state.wars) {
        if (w.ceasefire) continue;
        for (const f of w.fronts) if (f.attacker === id || f.defender === id) n++;
    }
    return n;
}

/** Score from the point of view of `id`'s side (positive = winning). */
export function sideScore(war, id) {
    const s = sideOf(war, id);
    if (!s) return 0;
    return s === 'attackers' ? war.score : -war.score;
}

/* -------------------------------------------------------------------- pacts */

export const DEFENSIVE_PACTS = Object.freeze(['alliance', 'defense']);

/** Pacts `id` belongs to. */
export function pactsOf(state, id) {
    return state.pacts.filter((p) => p.members.includes(id));
}

/** True when a pact of one of `types` contains both a and b. */
export function hasPact(state, a, b, types) {
    return state.pacts.some((p) => types.includes(p.type) && p.members.includes(a) && p.members.includes(b));
}

/** Alliance or defense pact between a and b. */
export function isAllied(state, a, b) {
    return a !== b && hasPact(state, a, b, DEFENSIVE_PACTS);
}

/** a guarantees b's independence. */
export function guarantees(state, a, b) {
    return state.pacts.some((p) => p.type === 'guarantee' && p.members[0] === a && p.members[1] === b);
}

/** Alliance/defense partners (NationView.allies). */
export function alliesOf(state, id) {
    const out = new Set();
    for (const p of state.pacts) {
        if (!DEFENSIVE_PACTS.includes(p.type) || !p.members.includes(id)) continue;
        for (const m of p.members) if (m !== id) out.add(m);
    }
    return [...out].sort();
}

/** Nations obliged to defend `id`: alliance/defense partners + guarantors. */
export function defendersOf(state, id) {
    const out = new Set(alliesOf(state, id));
    for (const p of state.pacts) if (p.type === 'guarantee' && p.members[1] === id) out.add(p.members[0]);
    out.delete(id);
    return [...out].sort();
}

const WEST = ['NATO', 'EU'];
/** Rough bloc antagonism used by AI / acceptance: West vs CSTO. */
export function hostileBlocs(a, b) {
    if (!a || !b || a === b) return false;
    return (WEST.includes(a) && b === 'CSTO') || (WEST.includes(b) && a === 'CSTO');
}

/** True for one of BLOCS. */
export function isValidBloc(b) {
    return BLOCS.includes(b);
}

/* ------------------------------------------------------------------ crises */

export function crisesOf(state, id) {
    return state.crises.filter((c) => c.involved.includes(id));
}

/** Highest severity index (0..3) of a crisis involving both a and b, -1 if none. */
export function sharedCrisisLevel(state, a, b, severities) {
    let best = -1;
    for (const c of state.crises) {
        if (c.involved.includes(a) && c.involved.includes(b)) best = Math.max(best, severities.indexOf(c.severity));
    }
    return best;
}

/** Sorted unique list. */
export function uniq(arr) {
    return [...new Set(arr)];
}
