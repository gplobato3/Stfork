/**
 * @file src/engine/state.js
 * newGame (scenario + bookmark overrides -> WorldState v2) and migrate (v2 only).
 */

import {
    BLOCS,
    BOUNDS,
    CRISIS_SEVERITIES,
    EVENT_CATEGORIES,
    NATION_STATUS,
    PACT_TYPES,
    PHASES,
    RESOURCE_KEYS,
    SCHEMA_VERSION,
} from '../contract/constants.js';
import { formatDate } from '../contract/presentation.js';
import { addMonths, clamp, clampProgress, clampRelation, clampResource, clampTension, isWorldState, relationKey } from '../contract/worldState.js';
import { hashString } from './rng.js';
import { textFor } from './text.js';
import { clone, ensureEngine, pushLog, pushNews } from './util.js';
import { addFrontsFor, computeScore } from './war.js';

const DEFAULT_PERSONALITY = Object.freeze({ aggression: 0.3, diplomacy: 0.5, blocLoyalty: 0.5 });
const STATUSES = Object.values(NATION_STATUS);
const DIFFICULTIES = ['facil', 'normal', 'dificil'];
/** Starting PC for the player by difficulty. */
export const PLAYER_START_PC = Object.freeze({ facil: 12, normal: 9, dificil: 6 });

function isObj(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeNation(raw, id, override) {
    const n = { ...(isObj(raw) ? raw : {}) };
    const ov = isObj(override) ? override : {};
    for (const [k, v] of Object.entries(ov)) {
        if (k === 'resources' || k === 'personality') continue;
        n[k] = v;
    }
    const res = { ...(isObj(raw && raw.resources) ? raw.resources : {}), ...(isObj(ov.resources) ? ov.resources : {}) };
    n.resources = {};
    for (const k of RESOURCE_KEYS) n.resources[k] = clampResource(Number.isFinite(Number(res[k])) ? Number(res[k]) : 40);
    const per = { ...DEFAULT_PERSONALITY, ...(isObj(raw && raw.personality) ? raw.personality : {}), ...(isObj(ov.personality) ? ov.personality : {}) };
    n.personality = {
        aggression: clamp(per.aggression, 0, 1),
        diplomacy: clamp(per.diplomacy, 0, 1),
        blocLoyalty: clamp(per.blocLoyalty, 0, 1),
    };
    n.id = id;
    n.name = typeof n.name === 'string' && n.name ? n.name : id;
    n.flag = typeof n.flag === 'string' ? n.flag : '';
    n.bloc = BLOCS.includes(n.bloc) ? n.bloc : 'NON_ALIGNED';
    n.capital = typeof n.capital === 'string' ? n.capital : '';
    n.government = typeof n.government === 'string' ? n.government : '';
    n.leaderTitle = typeof n.leaderTitle === 'string' && n.leaderTitle ? n.leaderTitle : 'Chefe de Estado';
    n.playable = !!n.playable;
    n.major = !!n.major;
    n.nuclear = [0, 1, 2].includes(n.nuclear) ? n.nuclear : 0;
    n.traits = Array.isArray(n.traits) ? n.traits.filter((x) => typeof x === 'string') : [];
    n.status = STATUSES.includes(ov.status) ? ov.status : NATION_STATUS.ACTIVE;
    n.controller = typeof ov.controller === 'string' ? ov.controller : id;
    n.overlord = typeof ov.overlord === 'string' ? ov.overlord : null;
    for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
    return n;
}

function normalizeRelations(state, ...sources) {
    const out = {};
    for (const src of sources) {
        if (!isObj(src)) continue;
        for (const [key, v] of Object.entries(src)) {
            const [a, b] = String(key).split('|');
            if (!a || !b || a === b || !state.nations[a] || !state.nations[b] || !Number.isFinite(Number(v))) continue;
            out[relationKey(a, b)] = clampRelation(Number(v));
        }
    }
    return out;
}

function normalizePacts(state, list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((p, i) => {
        if (!isObj(p) || !PACT_TYPES.includes(p.type)) return;
        const members = [...new Set((Array.isArray(p.members) ? p.members : []).filter((m) => state.nations[m]))];
        if (members.length < 2) return;
        out.push({
            id: typeof p.id === 'string' && p.id ? p.id : `pacto-${i + 1}`,
            type: p.type,
            name: typeof p.name === 'string' && p.name ? p.name : `Pacto ${i + 1}`,
            members: p.type === 'guarantee' ? members.slice(0, 2) : members,
            startedTurn: Number.isFinite(p.startedTurn) ? p.startedTurn : 0,
            expiresTurn: Number.isFinite(p.expiresTurn) ? p.expiresTurn : null,
        });
    });
    return out;
}

function normalizeWars(state, list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((w, i) => {
        if (!isObj(w)) return;
        const attackers = [...new Set((w.attackers || []).filter((x) => state.nations[x]))];
        const defenders = [...new Set((w.defenders || []).filter((x) => state.nations[x] && !attackers.includes(x)))];
        if (!attackers.length || !defenders.length) return;
        const war = {
            id: typeof w.id === 'string' && w.id ? w.id : `guerra-${i + 1}`,
            name: typeof w.name === 'string' && w.name ? w.name : `Guerra ${i + 1}`,
            attackers,
            defenders,
            startedTurn: Number.isFinite(w.startedTurn) ? w.startedTurn : 0,
            fronts: [],
            score: 0,
            exhaustion: {},
            ceasefire: !!w.ceasefire,
            ceasefireTurn: w.ceasefire ? 1 : null,
            called: [],
        };
        for (const f of Array.isArray(w.fronts) ? w.fronts : []) {
            if (!isObj(f)) continue;
            const okPair = (attackers.includes(f.attacker) && defenders.includes(f.defender)) || (defenders.includes(f.attacker) && attackers.includes(f.defender));
            if (!okPair || war.fronts.some((x) => (x.attacker === f.attacker && x.defender === f.defender) || (x.attacker === f.defender && x.defender === f.attacker))) continue;
            war.fronts.push({ attacker: f.attacker, defender: f.defender, progress: clampProgress(Number(f.progress) || 0) });
        }
        for (const id of [...attackers, ...defenders]) {
            const v = w.exhaustion && Number(w.exhaustion[id]);
            war.exhaustion[id] = Math.round(clamp(Number.isFinite(v) ? v : 10, 0, 100));
        }
        out.push(war);
    });
    return out;
}

function normalizeCrises(state, list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((c, i) => {
        if (!isObj(c) || typeof c.title !== 'string' || !c.title) return;
        const crisis = {
            id: typeof c.id === 'string' && c.id ? c.id : `crise-${i + 1}`,
            title: c.title,
            description: typeof c.description === 'string' ? c.description : '',
            severity: CRISIS_SEVERITIES.includes(c.severity) ? c.severity : 'medium',
            involved: [...new Set((Array.isArray(c.involved) ? c.involved : []).filter((x) => state.nations[x]))],
            turnStarted: Number.isFinite(c.turnStarted) ? c.turnStarted : 0,
        };
        if (EVENT_CATEGORIES.includes(c.category)) crisis.category = c.category;
        if (typeof c.region === 'string' && c.region) crisis.region = c.region;
        out.push(crisis);
    });
    return out;
}

function normalizeNeighbors(state, raw) {
    const out = {};
    for (const id of Object.keys(state.nations)) out[id] = new Set();
    if (isObj(raw)) {
        for (const [a, list] of Object.entries(raw)) {
            if (!out[a] || !Array.isArray(list)) continue;
            for (const b of list) {
                if (b === a || !out[b]) continue;
                out[a].add(b);
                out[b].add(a);
            }
        }
    }
    const res = {};
    for (const id of Object.keys(out).sort()) res[id] = [...out[id]].sort();
    return res;
}

/**
 * Builds a fresh WorldState (DESIGN §3.1). Throws on an unknown nation id.
 * @param {import('../contract/interfaces.js').ScenarioData} scenario
 * @param {{bookmarkId?:string, nationId:string, leaderName?:string, seed?:string, difficulty?:string}} opts
 * @returns {import('../contract/worldState.js').WorldState}
 */
export function buildNewGame(scenario, opts = {}) {
    if (!isObj(scenario) || !isObj(scenario.nations)) throw new Error('newGame: cenário inválido (sem nações).');
    const bookmarks = Array.isArray(scenario.bookmarks) ? scenario.bookmarks : [];
    const bm = bookmarks.find((b) => b && b.id === opts.bookmarkId) || bookmarks[0] || { id: 'custom', date: { year: 2026, month: 1 }, tension: 40, overrides: {} };
    const ov = isObj(bm.overrides) ? bm.overrides : {};
    const nationId = String(opts.nationId || '');
    if (!scenario.nations[nationId]) throw new Error(`newGame: nação desconhecida "${nationId}".`);
    const difficulty = DIFFICULTIES.includes(opts.difficulty) ? opts.difficulty : 'normal';
    const leaderName = (typeof opts.leaderName === 'string' && opts.leaderName.trim().slice(0, 60)) || 'Governante';
    const date = isObj(bm.date) ? { year: Math.round(bm.date.year), month: Math.round(clamp(bm.date.month, 1, 12)) } : { year: 2026, month: 1 };
    const endDate = isObj(bm.endDate) ? { year: Math.round(bm.endDate.year), month: Math.round(clamp(bm.endDate.month, 1, 12)) } : addMonths(date, 120);
    const seed = typeof opts.seed === 'string' && opts.seed ? opts.seed : `${scenario.id || 'cenario'}|${bm.id}|${nationId}|${leaderName}|${difficulty}`;

    const state = {
        schemaVersion: SCHEMA_VERSION,
        campaignId: `hoi-${hashString(`${seed}|${nationId}|${bm.id}`)}`,
        seed,
        scenarioId: typeof scenario.id === 'string' ? scenario.id : 'cenario',
        bookmarkId: bm.id,
        turn: 1,
        date,
        endDate,
        phase: PHASES.PLAYER_TURN,
        player: { nationId, leaderName, title: '', difficulty },
        nations: {},
        relations: {},
        pacts: [],
        wars: [],
        crises: [],
        modifiers: [],
        cooldowns: {},
        globalTension: clampTension(Number.isFinite(Number(bm.tension)) ? Number(bm.tension) : 40),
        pendingEvent: null,
        eventQueue: [],
        recentActions: [],
        decisions: [],
        news: [],
        log: [],
        outcome: null,
        flags: {},
        neighbors: {},
        engine: {},
    };
    const ovNations = isObj(ov.nations) ? ov.nations : {};
    for (const id of Object.keys(scenario.nations).sort()) state.nations[id] = normalizeNation(clone(scenario.nations[id]), id, ovNations[id]);
    for (const n of Object.values(state.nations)) {
        if (!state.nations[n.controller]) n.controller = n.id;
        if (n.overlord && !state.nations[n.overlord]) n.overlord = null;
        n.pc = n.id === nationId ? PLAYER_START_PC[difficulty] : Math.round(clamp(4 + Math.floor(n.resources.influence / 25), 0, BOUNDS.PC_MAX));
    }
    const player = state.nations[nationId];
    state.player.title = player.leaderTitle;
    state.neighbors = normalizeNeighbors(state, scenario.neighbors);
    state.relations = normalizeRelations(state, scenario.relations, ov.relations);
    state.pacts = normalizePacts(state, Array.isArray(ov.pacts) ? ov.pacts : scenario.pacts);
    state.wars = normalizeWars(state, Array.isArray(ov.wars) ? ov.wars : scenario.wars);
    state.crises = normalizeCrises(state, Array.isArray(ov.crises) ? ov.crises : scenario.crises);

    const e = ensureEngine(state);
    e.baseRel = { ...state.relations };
    for (const [id, n] of Object.entries(state.nations)) e.base[id] = { ...n.resources };
    for (const war of state.wars) {
        for (const id of [...war.attackers, ...war.defenders]) addFrontsFor(state, war, id);
        if (!war.fronts.length) war.fronts.push({ attacker: war.attackers[0], defender: war.defenders[0], progress: 0 });
        war.score = computeScore(war);
        // scenario wars: existing pact partners already made their choice
        const called = new Set([...war.attackers, ...war.defenders]);
        for (const p of state.pacts) if ([...war.attackers, ...war.defenders].some((m) => p.members.includes(m))) for (const m of p.members) called.add(m);
        war.called = [...called].sort();
    }

    const t = textFor(state);
    pushLog(state, 'system', `Campanha iniciada em ${formatDate(date)}: ${state.player.title} ${leaderName} governa ${t.the(nationId)}.`, { bookmarkId: bm.id });
    pushNews(state, `${state.player.title} ${leaderName} assume o governo ${t.de(nationId)}`, 'player', [nationId]);
    return state;
}

/** Fills optional fields an otherwise valid v2 save may lack. Mutates. */
export function fillDefaults(s) {
    for (const k of ['pacts', 'modifiers', 'eventQueue', 'recentActions', 'decisions', 'news', 'log']) if (!Array.isArray(s[k])) s[k] = [];
    for (const k of ['relations', 'cooldowns', 'flags', 'neighbors']) if (!isObj(s[k])) s[k] = {};
    if (!Number.isFinite(s.globalTension)) s.globalTension = 40;
    if (s.pendingEvent === undefined) s.pendingEvent = null;
    if (s.outcome === undefined) s.outcome = null;
    if (!isObj(s.endDate)) s.endDate = addMonths(s.date, 120);
    if (typeof s.seed !== 'string') s.seed = s.campaignId;
    if (!DIFFICULTIES.includes(s.player.difficulty)) s.player.difficulty = 'normal';
    if (typeof s.player.leaderName !== 'string') s.player.leaderName = 'Governante';
    if (typeof s.player.title !== 'string') s.player.title = 'Chefe de Estado';
    const e = ensureEngine(s);
    for (const [id, n] of Object.entries(s.nations)) {
        if (!isObj(n)) {
            delete s.nations[id];
            continue;
        }
        if (!isObj(n.resources)) n.resources = {};
        for (const k of RESOURCE_KEYS) n.resources[k] = clampResource(Number.isFinite(n.resources[k]) ? n.resources[k] : 40);
        if (!isObj(n.personality)) n.personality = { ...DEFAULT_PERSONALITY };
        if (!Number.isFinite(n.pc)) n.pc = 0;
        if (!STATUSES.includes(n.status)) n.status = NATION_STATUS.ACTIVE;
        if (typeof n.controller !== 'string') n.controller = id;
        if (n.overlord === undefined) n.overlord = null;
        if (!e.base[id]) e.base[id] = { ...n.resources };
        if (!s.neighbors[id]) s.neighbors[id] = [];
    }
    for (const w of s.wars) {
        if (!Array.isArray(w.fronts)) w.fronts = [];
        if (!isObj(w.exhaustion)) w.exhaustion = {};
        if (!Array.isArray(w.called)) w.called = [];
        if (typeof w.ceasefire !== 'boolean') w.ceasefire = false;
        if (w.ceasefireTurn === undefined) w.ceasefireTurn = w.ceasefire ? s.turn : null;
        if (!Number.isFinite(w.score)) w.score = 0;
    }
    return s;
}

/**
 * Returns a valid v2 state (missing optional arrays filled) or null for anything
 * else, including v1 saves (schemaVersion 1).
 * @param {*} raw
 * @returns {?import('../contract/worldState.js').WorldState}
 */
export function migrateState(raw) {
    try {
        if (!isWorldState(raw)) return null;
        return fillDefaults(clone(raw));
    } catch {
        return null;
    }
}
