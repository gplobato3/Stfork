/**
 * @file src/scenario/build.js
 * Pure assembly of ScenarioData (src/contract/interfaces.js) from the raw JSON assets and MapData.
 * No I/O, no DOM, node-safe. Bad references are dropped with a warning; this module never throws
 * on content problems (only the loader throws, and only for missing files).
 */

import {
    BLOCS,
    BOUNDS,
    CRISIS_SEVERITIES,
    EVENT_CATEGORIES,
    NATION_STATUS,
    PACT_TYPES,
    RESOURCE_KEYS,
} from '../contract/constants.js';
import { clamp, clampProgress, clampRelation, clampResource, clampTension, relationKey } from '../contract/worldState.js';

export const SCENARIO_ID = 'modern-ww3';
export const SCENARIO_NAME = 'Terceira Guerra Mundial — Cenário Moderno';

const DIFFICULTIES = ['facil', 'normal', 'dificil'];
const PERSONALITY_KEYS = ['aggression', 'diplomacy', 'blocLoyalty'];
const DEFAULT_FLAG = '🏳️';
const MAX_TRAITS = 4;

/** Stat templates for generated minor nations, by development tier. */
export const MINOR_TIERS = Object.freeze({
    A: { economy: 58, military: 24, stability: 70, influence: 30, tech: 64, manpower: 16, warSupport: 24 },
    B: { economy: 38, military: 24, stability: 50, influence: 22, tech: 36, manpower: 28, warSupport: 28 },
    C: { economy: 18, military: 16, stability: 30, influence: 12, tech: 16, manpower: 28, warSupport: 28 },
});
/** Manpower adjustment by population class. */
const POP_MANPOWER = Object.freeze({ S: -10, M: 0, L: 20 });
const BLOC_TRAITS = Object.freeze({
    NATO: 'Membro da OTAN',
    EU: 'Membro da UE',
    CSTO: 'Membro da OTSC',
    BRICS: 'Membro do BRICS',
});

/** FNV-1a 32-bit; deterministic jitter for generated minors. */
function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round2 = (v) => Math.round(v * 100) / 100;
const clone = (v) => JSON.parse(JSON.stringify(v));

function normalizeResources(raw, base) {
    const out = {};
    for (const k of RESOURCE_KEYS) {
        const v = isObj(raw) && typeof raw[k] === 'number' ? raw[k] : base ? base[k] : 50;
        out[k] = clampResource(v);
    }
    return out;
}

function normalizePersonality(raw, base) {
    const out = {};
    for (const k of PERSONALITY_KEYS) {
        const v = isObj(raw) && typeof raw[k] === 'number' ? raw[k] : base ? base[k] : 0.5;
        out[k] = round2(clamp(v, 0, 1));
    }
    return out;
}

function normalizeTraits(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map(str).filter(Boolean))].slice(0, MAX_TRAITS);
}

function initialPc(resources) {
    return Math.min(BOUNDS.PC_MAX, 3 + Math.floor(resources.influence / 20));
}

/**
 * Normalize one authored nation. Missing required strings fall back to safe defaults (with a warning).
 * @returns {import('../contract/worldState.js').Nation}
 */
export function normalizeNation(id, raw, warn = () => {}) {
    for (const f of ['name', 'flag', 'bloc', 'capital', 'government', 'leaderTitle']) {
        if (!str(raw[f])) warn(`nation ${id}: missing "${f}"`);
    }
    if (raw.bloc && !BLOCS.includes(raw.bloc)) warn(`nation ${id}: unknown bloc "${raw.bloc}"`);
    const resources = normalizeResources(raw.resources);
    const nation = {
        id,
        name: str(raw.name) || id,
        flag: str(raw.flag) || DEFAULT_FLAG,
        bloc: BLOCS.includes(raw.bloc) ? raw.bloc : 'NON_ALIGNED',
        capital: str(raw.capital),
        government: str(raw.government) || 'República',
        leaderTitle: str(raw.leaderTitle) || 'Presidente',
        playable: raw.playable !== false,
        major: raw.major === true,
        nuclear: [0, 1, 2].includes(raw.nuclear) ? raw.nuclear : 0,
        resources,
        personality: normalizePersonality(raw.personality),
        traits: normalizeTraits(raw.traits),
        difficulty: DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : 'normal',
        pc: typeof raw.pc === 'number' ? Math.round(clamp(raw.pc, 0, BOUNDS.PC_MAX)) : initialPc(resources),
        status: NATION_STATUS.ACTIVE,
        controller: id,
        overlord: null,
    };
    if (str(raw.blurb)) nation.blurb = str(raw.blurb);
    return nation;
}

/**
 * Generate a non-playable minor nation from its curated table row (minors.json) and pt-BR name.
 * Stats come from the tier template + deterministic ±3 jitter, then explicit overrides.
 */
export function generateMinor(id, name, row = {}) {
    const tier = MINOR_TIERS[row.tier] ? row.tier : 'C';
    const template = MINOR_TIERS[tier];
    const popAdj = POP_MANPOWER[row.pop] ?? 0;
    const resources = {};
    for (const k of RESOURCE_KEYS) {
        const jitter = (hash(`${id}:${k}`) % 7) - 3;
        const base = template[k] + jitter + (k === 'manpower' ? popAdj : 0);
        const override = isObj(row.resources) && typeof row.resources[k] === 'number' ? row.resources[k] : null;
        resources[k] = clampResource(override ?? base);
    }
    const bloc = BLOCS.includes(row.bloc) ? row.bloc : 'NON_ALIGNED';
    const h = hash(id);
    const personality = normalizePersonality(row.personality, {
        aggression: 0.08 + (h % 10) / 100,
        diplomacy: 0.45 + ((h >>> 4) % 15) / 100,
        blocLoyalty: ['NATO', 'EU', 'CSTO'].includes(bloc) ? 0.6 : 0.35,
    });
    const tierTrait = tier === 'A' ? 'Economia Desenvolvida'
        : tier === 'B' ? 'Economia Emergente'
            : resources.stability < 25 ? 'Estado Frágil' : 'Economia em Desenvolvimento';
    const traits = normalizeTraits([...(row.traits || []), BLOC_TRAITS[bloc], tierTrait, 'Nação Menor'].filter(Boolean));
    const nation = {
        id,
        name,
        flag: str(row.flag) || DEFAULT_FLAG,
        bloc,
        capital: str(row.capital),
        government: str(row.government) || 'República',
        leaderTitle: str(row.leaderTitle) || 'Presidente',
        playable: false,
        major: false,
        nuclear: 0,
        resources,
        personality,
        traits,
        difficulty: 'normal',
        pc: Math.min(BOUNDS.PC_MAX, 2 + Math.floor(resources.influence / 25)),
        status: NATION_STATUS.ACTIVE,
        controller: id,
        overlord: null,
    };
    if (str(row.blurb)) nation.blurb = str(row.blurb);
    return nation;
}

/** Normalize a relation table: order-independent keys, known ids only, clamped values. */
export function normalizeRelations(raw, ids, warn = () => {}, label = 'relations') {
    const out = {};
    if (!isObj(raw)) return out;
    for (const [key, value] of Object.entries(raw)) {
        const parts = key.split('|');
        if (parts.length !== 2 || parts[0] === parts[1]) {
            warn(`${label}: bad key "${key}"`);
            continue;
        }
        const [a, b] = parts;
        if (!ids.has(a) || !ids.has(b)) {
            warn(`${label}: unknown nation in "${key}"`);
            continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            warn(`${label}: non-numeric value for "${key}"`);
            continue;
        }
        const k = relationKey(a, b);
        if (k in out) warn(`${label}: duplicate pair "${k}"`);
        out[k] = clampRelation(value);
    }
    return out;
}

function filterIds(list, ids, warn, what) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const id of list) {
        if (!ids.has(id)) warn(`${what}: unknown nation "${id}"`);
        else if (!out.includes(id)) out.push(id);
    }
    return out;
}

/** @returns {?import('../contract/worldState.js').Pact} */
export function normalizePact(raw, ids, warn = () => {}) {
    const id = str(raw && raw.id);
    if (!id) { warn('pact without id dropped'); return null; }
    if (!PACT_TYPES.includes(raw.type)) { warn(`pact ${id}: unknown type "${raw.type}"`); return null; }
    const members = filterIds(raw.members, ids, warn, `pact ${id}`);
    if (members.length < 2 || (raw.type === 'guarantee' && members.length !== 2)) {
        warn(`pact ${id}: not enough valid members`);
        return null;
    }
    return {
        id,
        type: raw.type,
        name: str(raw.name) || id,
        members,
        startedTurn: num(raw.startedTurn, 0),
        expiresTurn: typeof raw.expiresTurn === 'number' ? raw.expiresTurn : null,
    };
}

/** @returns {?import('../contract/worldState.js').War} */
export function normalizeWar(raw, ids, warn = () => {}) {
    const id = str(raw && raw.id);
    if (!id) { warn('war without id dropped'); return null; }
    const attackers = filterIds(raw.attackers, ids, warn, `war ${id}`);
    const defenders = filterIds(raw.defenders, ids, warn, `war ${id}`).filter((d) => !attackers.includes(d));
    if (!attackers.length || !defenders.length) { warn(`war ${id}: needs attackers and defenders`); return null; }
    const fronts = [];
    for (const f of Array.isArray(raw.fronts) ? raw.fronts : []) {
        if (!f || !attackers.includes(f.attacker) || !defenders.includes(f.defender)) {
            warn(`war ${id}: front ${f && f.attacker}->${f && f.defender} dropped`);
            continue;
        }
        if (fronts.some((x) => x.attacker === f.attacker && x.defender === f.defender)) continue;
        fronts.push({ attacker: f.attacker, defender: f.defender, progress: clampProgress(num(f.progress, 0)) });
    }
    const exhaustion = {};
    for (const n of [...attackers, ...defenders]) {
        const v = isObj(raw.exhaustion) ? raw.exhaustion[n] : undefined;
        exhaustion[n] = Math.round(clamp(num(v, 0), 0, 100));
    }
    if (isObj(raw.exhaustion)) {
        for (const n of Object.keys(raw.exhaustion)) if (!(n in exhaustion)) warn(`war ${id}: exhaustion for non-participant ${n}`);
    }
    const war = {
        id,
        name: str(raw.name) || id,
        attackers,
        defenders,
        startedTurn: num(raw.startedTurn, 0),
        fronts,
        score: Math.round(clamp(num(raw.score, 0), -100, 100)),
        exhaustion,
        ceasefire: raw.ceasefire === true,
    };
    if (isObj(raw.startedDate) && typeof raw.startedDate.year === 'number' && typeof raw.startedDate.month === 'number') {
        war.startedDate = { year: raw.startedDate.year, month: raw.startedDate.month };
    }
    return war;
}

/** @returns {?import('../contract/worldState.js').Crisis} */
export function normalizeCrisis(raw, ids, warn = () => {}) {
    const id = str(raw && raw.id);
    if (!id || !str(raw.title)) { warn('crisis without id/title dropped'); return null; }
    if (!CRISIS_SEVERITIES.includes(raw.severity)) warn(`crisis ${id}: bad severity "${raw.severity}"`);
    const crisis = {
        id,
        title: str(raw.title),
        description: str(raw.description),
        severity: CRISIS_SEVERITIES.includes(raw.severity) ? raw.severity : 'medium',
        involved: filterIds(raw.involved, ids, warn, `crisis ${id}`),
        turnStarted: num(raw.turnStarted, 0),
    };
    if (EVENT_CATEGORIES.includes(raw.category)) crisis.category = raw.category;
    else if (raw.category !== undefined) warn(`crisis ${id}: unknown category "${raw.category}"`);
    if (str(raw.region)) crisis.region = str(raw.region);
    return crisis;
}

function normalizeList(list, fn, ids, warn, what) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        const v = fn(raw, ids, warn);
        if (!v) continue;
        if (seen.has(v.id)) { warn(`${what}: duplicate id "${v.id}"`); continue; }
        seen.add(v.id);
        out.push(v);
    }
    return out;
}

const NATION_OVERRIDE_KEYS = ['name', 'flag', 'bloc', 'capital', 'government', 'leaderTitle', 'major', 'nuclear',
    'resources', 'personality', 'traits', 'blurb', 'pc', 'status', 'controller', 'overlord'];

/**
 * Resolve one bookmark nation override into a validated Partial<Nation>. `resources` and
 * `personality` are expanded to complete objects (merged with the base nation) so consumers can
 * shallow-merge safely.
 */
function normalizeNationOverride(id, raw, base, ids, warn) {
    const out = {};
    for (const [k, v] of Object.entries(raw || {})) {
        if (!NATION_OVERRIDE_KEYS.includes(k)) { warn(`override ${id}: unsupported field "${k}"`); continue; }
        if (k === 'resources') out.resources = normalizeResources(v, base.resources);
        else if (k === 'personality') out.personality = normalizePersonality(v, base.personality);
        else if (k === 'traits') out.traits = normalizeTraits(v);
        else if (k === 'bloc') { if (BLOCS.includes(v)) out.bloc = v; else warn(`override ${id}: bad bloc "${v}"`); }
        else if (k === 'nuclear') { if ([0, 1, 2].includes(v)) out.nuclear = v; else warn(`override ${id}: bad nuclear`); }
        else if (k === 'status') { if (Object.values(NATION_STATUS).includes(v)) out.status = v; else warn(`override ${id}: bad status`); }
        else if (k === 'controller' || k === 'overlord') {
            if (v === null || ids.has(v)) out[k] = v;
            else warn(`override ${id}: unknown ${k} "${v}"`);
        } else if (k === 'major') out.major = v === true;
        else if (k === 'pc') out.pc = Math.round(clamp(num(v, base.pc), 0, BOUNDS.PC_MAX));
        else if (str(v)) out[k] = str(v);
    }
    return out;
}

function normalizeDate(d, fallback) {
    if (isObj(d) && Number.isInteger(d.year) && Number.isInteger(d.month) && d.month >= 1 && d.month <= 12) {
        return { year: d.year, month: d.month };
    }
    return fallback;
}

/**
 * Resolve a raw bookmark into the contract Bookmark. Authoring shorthands `pactsAdd` / `pactsRemove`
 * are expanded into a complete `pacts` list (pacts/wars/crises REPLACE the base lists when present).
 */
export function normalizeBookmark(raw, base, warn = () => {}) {
    const { nations, ids } = base;
    const id = str(raw && raw.id);
    if (!id) { warn('bookmark without id dropped'); return null; }
    const date = normalizeDate(raw.date, null);
    if (!date) { warn(`bookmark ${id}: bad date`); return null; }
    const endDate = normalizeDate(raw.endDate, { year: date.year + 10, month: date.month });
    const recommended = filterIds(raw.recommended, ids, warn, `bookmark ${id} recommended`)
        .filter((n) => nations[n].playable || (warn(`bookmark ${id}: recommended ${n} is not playable`), false));
    const src = isObj(raw.overrides) ? raw.overrides : {};
    const overrides = {};
    if (isObj(src.nations)) {
        overrides.nations = {};
        for (const [nid, patch] of Object.entries(src.nations)) {
            if (!ids.has(nid)) { warn(`bookmark ${id}: override for unknown nation "${nid}"`); continue; }
            overrides.nations[nid] = normalizeNationOverride(nid, patch, nations[nid], ids, warn);
        }
    }
    if (isObj(src.relations)) overrides.relations = normalizeRelations(src.relations, ids, warn, `bookmark ${id} relations`);
    const pw = (m) => (msg) => warn(`bookmark ${id} ${m}: ${msg}`);
    if (Array.isArray(src.pacts)) {
        overrides.pacts = normalizeList(src.pacts, normalizePact, ids, pw('pacts'), 'pacts');
    } else if (Array.isArray(src.pactsAdd) || Array.isArray(src.pactsRemove)) {
        const remove = new Set(Array.isArray(src.pactsRemove) ? src.pactsRemove : []);
        for (const r of remove) if (!base.pacts.some((p) => p.id === r)) warn(`bookmark ${id}: pactsRemove unknown "${r}"`);
        const added = normalizeList(src.pactsAdd, normalizePact, ids, pw('pactsAdd'), 'pacts');
        const addedIds = new Set(added.map((p) => p.id));
        overrides.pacts = [...base.pacts.filter((p) => !remove.has(p.id) && !addedIds.has(p.id)).map(clone), ...added];
    }
    if (Array.isArray(src.wars)) overrides.wars = normalizeList(src.wars, normalizeWar, ids, pw('wars'), 'wars');
    if (Array.isArray(src.crises)) overrides.crises = normalizeList(src.crises, normalizeCrisis, ids, pw('crises'), 'crises');
    return {
        id,
        name: str(raw.name) || id,
        date,
        endDate,
        description: str(raw.description),
        art: str(raw.art) || `bookmark-${id}`,
        tension: clampTension(num(raw.tension, 40)),
        recommended,
        overrides,
    };
}

/**
 * Build ScenarioData from raw assets + MapData. Every map country becomes a nation: authored
 * entries from nations.json, the rest generated from minors.json + names.json.
 * @param {{nations:Object, minors:Object, names:Object, relations:Object, pacts:Array, wars:Array, crises:Array, bookmarks:Array}} raw
 * @param {import('../contract/interfaces.js').MapData} map
 * @param {{warn?: (msg:string) => void}} [opts]
 * @returns {import('../contract/interfaces.js').ScenarioData}
 */
export function buildScenario(raw, map, opts = {}) {
    const warn = opts.warn || (() => {});
    const mapIds = Object.keys((map && map.countries) || {}).sort();
    const mapSet = new Set(mapIds);
    const authored = isObj(raw.nations) ? raw.nations : {};
    const minors = isObj(raw.minors) ? raw.minors : {};
    const names = isObj(raw.names) ? raw.names : {};

    for (const id of Object.keys(authored)) {
        if (!mapSet.has(id)) warn(`nation ${id} has no map geometry; dropped`);
    }
    for (const id of Object.keys(minors)) {
        if (!mapSet.has(id)) warn(`minor ${id} has no map geometry; ignored`);
        else if (authored[id]) warn(`minor ${id} is also authored; minor row ignored`);
    }

    const nations = {};
    for (const id of mapIds) {
        if (isObj(authored[id])) {
            nations[id] = normalizeNation(id, { ...authored[id], id }, warn);
            if (names[id] && names[id] !== nations[id].name) warn(`nation ${id}: name differs from names.json`);
        } else {
            if (!str(names[id])) warn(`map country ${id} has no pt-BR name`);
            if (!isObj(minors[id])) warn(`map country ${id} has no minors.json row`);
            nations[id] = generateMinor(id, str(names[id]) || id, isObj(minors[id]) ? minors[id] : {});
        }
    }
    const ids = new Set(mapIds);

    const neighbors = {};
    for (const id of mapIds) {
        const list = Array.isArray(map.countries[id].neighbors) ? map.countries[id].neighbors : [];
        neighbors[id] = [...new Set(list.filter((n) => ids.has(n) && n !== id))].sort();
    }
    // Enforce symmetry (map build already does; this guards hand-edited maps).
    for (const [a, list] of Object.entries(neighbors)) {
        for (const b of list) if (!neighbors[b].includes(a)) { neighbors[b].push(a); neighbors[b].sort(); }
    }

    const relations = normalizeRelations(raw.relations, ids, warn);
    const pacts = normalizeList(raw.pacts, normalizePact, ids, warn, 'pacts');
    const wars = normalizeList(raw.wars, normalizeWar, ids, warn, 'wars');
    const crises = normalizeList(raw.crises, normalizeCrisis, ids, warn, 'crises');
    const base = { nations, ids, pacts };
    const bookmarks = normalizeList(raw.bookmarks, (b) => normalizeBookmark(b, base, warn), ids, warn, 'bookmarks');

    return { id: SCENARIO_ID, name: SCENARIO_NAME, nations, relations, pacts, wars, crises, bookmarks, neighbors };
}
