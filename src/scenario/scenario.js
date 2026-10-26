/**
 * @file src/scenario/scenario.js
 * Module B — Scenario loader for the HOI Grande Estrategia extension.
 *
 * Implements the ScenarioAPI documented in src/contract/interfaces.js:
 *   - loadScenario(): Promise<ScenarioData>  ({ nations, relations, geo, crisisSeeds, meta })
 *   - listPlayableNationIds(): string[]
 *
 * The authored assets live under assets/scenario/ as static JSON. This module
 * loads them in BOTH environments:
 *   - Browser (SillyTavern): fetch() relative to the extension folder.
 *   - Node (tests / validation): read from disk via node:fs.
 * It never throws at import time and guards the absence of fetch/fs so it can
 * be imported anywhere. Loaded data is validated against the contract's Nation
 * shape; missing relation pairs are filled with a neutral baseline in code.
 *
 * Display strings in the assets are pt-BR; code/identifiers here are English.
 */

import {
    RESOURCE_KEYS,
    BOUNDS,
    relationKey,
    clampResource,
    clampRelation,
} from '../contract/worldState.js';
import { CRISIS_SEVERITIES, createCrisis } from '../contract/events.js';

/** Neutral relation score applied to any pair the assets do not specify. */
export const NEUTRAL_RELATION = 0;

/** Asset file names under assets/scenario/, relative to this module. */
const ASSET_FILES = Object.freeze({
    nations: 'nations.json',
    relations: 'relations.json',
    crises: 'crises.json',
    geo: 'world.geo.json',
});

/**
 * Required Nation fields (besides `resources`) that the loader enforces.
 * @type {ReadonlyArray<string>}
 */
const REQUIRED_NATION_FIELDS = Object.freeze([
    'id',
    'name',
    'flagEmoji',
    'bloc',
    'capital',
    'government',
    'leaderTitle',
]);

/** Detect a browser-like environment with a usable fetch(). */
function hasFetch() {
    return typeof fetch === 'function';
}

/**
 * Resolve the base URL/path of the assets/scenario/ directory.
 * In the browser, import.meta.url points at .../src/scenario/scenario.js inside
 * the extension folder, so ../../assets/scenario/ is the authored data.
 * @returns {string}
 */
function scenarioBaseUrl() {
    // new URL(relative, base) resolves ../../ against this module's URL.
    return new URL('../../assets/scenario/', import.meta.url).href;
}

/**
 * Load and JSON-parse one asset file, picking fetch (browser) or fs (node).
 * @param {string} fileName
 * @returns {Promise<any>}
 */
async function loadAsset(fileName) {
    const base = scenarioBaseUrl();
    if (hasFetch() && base.startsWith('http')) {
        const res = await fetch(base + fileName);
        if (!res || !res.ok) {
            throw new Error(`scenario: failed to fetch ${fileName} (${res && res.status})`);
        }
        return res.json();
    }
    // Node / file:// fallback — read from disk.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(base + fileName);
    const text = await readFile(path, 'utf8');
    return JSON.parse(text);
}

/**
 * Validate + normalize a single raw nation entry against the contract shape.
 * Resources are clamped to [0..100]; missing resource keys default to 50.
 * Throws if a required field is missing (assets are authored, not user input).
 * @param {string} id
 * @param {any} raw
 * @returns {import('../contract/worldState.js').Nation}
 */
function normalizeNation(id, raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`scenario: nation ${id} is not an object`);
    }
    // The map key is authoritative for the id.
    const nation = { ...raw, id };
    for (const field of REQUIRED_NATION_FIELDS) {
        if (field === 'id') continue;
        if (typeof nation[field] !== 'string' || nation[field].length === 0) {
            throw new Error(`scenario: nation ${id} missing required field "${field}"`);
        }
    }
    if (!/^[A-Z]{3}$/.test(nation.id)) {
        throw new Error(`scenario: nation id "${nation.id}" is not ISO-3166 alpha-3`);
    }

    const rawResources = raw.resources && typeof raw.resources === 'object' ? raw.resources : {};
    /** @type {import('../contract/worldState.js').Resources} */
    const resources = /** @type {any} */ ({});
    for (const key of RESOURCE_KEYS) {
        const value = typeof rawResources[key] === 'number' ? rawResources[key] : 50;
        resources[key] = clampResource(value);
    }
    nation.resources = resources;

    nation.traits = Array.isArray(raw.traits) ? raw.traits.map(String) : [];
    nation.major = raw.major === true;
    // isPlayer is assigned by the engine at newGame; default false in scenario data.
    nation.isPlayer = raw.isPlayer === true;
    return nation;
}

/**
 * Build the normalized nations map from the raw asset.
 * @param {any} rawNations
 * @returns {Object.<string, import('../contract/worldState.js').Nation>}
 */
function buildNations(rawNations) {
    if (!rawNations || typeof rawNations !== 'object' || Array.isArray(rawNations)) {
        throw new Error('scenario: nations.json must be an object map of id -> Nation');
    }
    /** @type {Object.<string, import('../contract/worldState.js').Nation>} */
    const nations = {};
    for (const [id, raw] of Object.entries(rawNations)) {
        nations[id] = normalizeNation(id, raw);
    }
    if (Object.keys(nations).length === 0) {
        throw new Error('scenario: nations.json is empty');
    }
    return nations;
}

/**
 * Normalize relations: re-key via relationKey(), clamp scores, drop self-pairs
 * and pairs referencing unknown nations, then fill every missing pair among
 * known nations with the neutral baseline.
 * @param {any} rawRelations
 * @param {string[]} nationIds
 * @returns {Object.<string, number>}
 */
function buildRelations(rawRelations, nationIds) {
    /** @type {Object.<string, number>} */
    const relations = {};
    const known = new Set(nationIds);

    if (rawRelations && typeof rawRelations === 'object' && !Array.isArray(rawRelations)) {
        for (const [key, value] of Object.entries(rawRelations)) {
            const parts = String(key).split('|');
            if (parts.length !== 2) continue;
            const [a, b] = parts;
            if (a === b || !known.has(a) || !known.has(b)) continue;
            relations[relationKey(a, b)] = clampRelation(value);
        }
    }

    // Fill every unspecified pair with the neutral baseline.
    for (let i = 0; i < nationIds.length; i++) {
        for (let j = i + 1; j < nationIds.length; j++) {
            const key = relationKey(nationIds[i], nationIds[j]);
            if (!(key in relations)) relations[key] = NEUTRAL_RELATION;
        }
    }
    return relations;
}

/**
 * Normalize crisis seeds into the contract Crisis shape. Each seed keeps its
 * `startingTension` contribution (read by the engine when seeding globalTension)
 * and drops involvedNationIds that reference unknown nations.
 * @param {any} rawCrises
 * @param {string[]} nationIds
 * @returns {import('../contract/events.js').Crisis[]}
 */
function buildCrisisSeeds(rawCrises, nationIds) {
    if (!Array.isArray(rawCrises)) return [];
    const known = new Set(nationIds);
    return rawCrises.map((raw) => {
        const involved = Array.isArray(raw.involvedNationIds)
            ? raw.involvedNationIds.filter((n) => known.has(n))
            : [];
        const crisis = createCrisis({
            id: raw.id,
            title: raw.title,
            description: raw.description,
            severity: CRISIS_SEVERITIES.includes(raw.severity) ? raw.severity : 'medium',
            involvedNationIds: involved,
            turnStarted: typeof raw.turnStarted === 'number' ? raw.turnStarted : 0,
            data: raw.data,
        });
        const startingTension =
            typeof raw.startingTension === 'number' ? raw.startingTension : 0;
        return { ...crisis, startingTension };
    });
}

/** Cache so repeated loadScenario() calls don't re-read the assets. */
let _cache = null;

/**
 * Factory returning the ScenarioAPI. FEAT-006 wires this into the controller.
 * @returns {import('../contract/interfaces.js').ScenarioAPI}
 */
export function createScenario() {
    /**
     * Load + assemble the scenario from the authored JSON assets.
     * @returns {Promise<import('../contract/interfaces.js').ScenarioData>}
     */
    async function loadScenario() {
        if (_cache) return _cache;

        const [rawNations, rawRelations, rawCrises, rawGeo] = await Promise.all([
            loadAsset(ASSET_FILES.nations),
            loadAsset(ASSET_FILES.relations),
            loadAsset(ASSET_FILES.crises),
            loadAsset(ASSET_FILES.geo),
        ]);

        const nations = buildNations(rawNations);
        const nationIds = Object.keys(nations);
        const relations = buildRelations(rawRelations, nationIds);
        const crisisSeeds = buildCrisisSeeds(rawCrises, nationIds);
        const geo = rawGeo && typeof rawGeo === 'object' ? rawGeo : { type: 'FeatureCollection', features: [] };

        _cache = {
            nations,
            relations,
            geo,
            crisisSeeds,
            meta: {
                name: 'Mundo 2027 — À Beira da Terceira Guerra',
                startDate: { year: 2027, month: 1 },
                description:
                    'Cenário moderno/quase-futuro: o jogador assume a chefia de Estado de uma nação e navega um arco de escalada rumo a um conflito global.',
                nationCount: nationIds.length,
                bounds: { ...BOUNDS },
            },
        };
        return _cache;
    }

    /**
     * Ids the player may choose, in display order: `major` powers first (in
     * asset order), then the remaining nations (in asset order). Any nation is
     * playable.
     * @returns {string[]}
     */
    function listPlayableNationIds() {
        if (!_cache) {
            // Not yet loaded: callers should await loadScenario() first. Return
            // an empty list rather than throwing so the UI degrades gracefully.
            return [];
        }
        const entries = Object.values(_cache.nations);
        const majors = entries.filter((n) => n.major).map((n) => n.id);
        const rest = entries.filter((n) => !n.major).map((n) => n.id);
        return [...majors, ...rest];
    }

    return { loadScenario, listPlayableNationIds };
}

/** Reset the module cache (used by tests). */
export function __resetScenarioCache() {
    _cache = null;
}

export default createScenario;
