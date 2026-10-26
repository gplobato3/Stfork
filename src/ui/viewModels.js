/**
 * @file src/ui/viewModels.js
 * PURE view-model builders for the HOI UI (Module D).
 *
 * These functions take a WorldState / ScenarioData (the shared contract shapes)
 * and return plain, serializable objects the templates/renderers consume. They
 * contain ALL the non-trivial UI logic (resource gauges, tension level,
 * relation coloring, map coloring, nation-picker list) so it can be unit-tested
 * under node WITHOUT a browser or ST runtime.
 *
 * Rules:
 *   - No DOM, no ST, no i18n side effects: translate labels at render time.
 *   - Never throw on malformed input; degrade to safe empty/neutral output.
 *   - Identifiers/comments English; any literal text returned is a stable KEY
 *     (the renderers run it through t()), not a user-facing sentence.
 */

import {
    RESOURCE_KEYS,
    BLOCS,
    BOUNDS,
    PHASES,
    relationKey,
} from '../contract/worldState.js';

/**
 * Colors per bloc, used by both the map and the diplomacy panel. Scoped names
 * only (CSS supplies the actual palette through these keys as well).
 * @type {Object.<string, string>}
 */
export const BLOC_COLORS = Object.freeze({
    NATO: '#2e6fb0',
    CSTO: '#b03a2e',
    EU: '#2e86b0',
    BRICS: '#b07d2e',
    NON_ALIGNED: '#6b7280',
});

/** Fallback color for unknown blocs / missing data. */
export const DEFAULT_BLOC_COLOR = '#6b7280';

/** Color used to highlight the player's own nation on the map. */
export const PLAYER_COLOR = '#f2c14e';

/**
 * Relation tiers (ordered worst -> best). Each has an inclusive lower bound on
 * the -100..100 relation score, a stable label key, and a color.
 * @type {ReadonlyArray<{key:string,labelKey:string,color:string,min:number}>}
 */
export const RELATION_TIERS = Object.freeze([
    { key: 'hostile', labelKey: 'hoi_rel_hostile', color: '#c0392b', min: -100 },
    { key: 'tense', labelKey: 'hoi_rel_tense', color: '#e07b39', min: -40 },
    { key: 'neutral', labelKey: 'hoi_rel_neutral', color: '#95a5a6', min: -15 },
    { key: 'friendly', labelKey: 'hoi_rel_friendly', color: '#58a65c', min: 15 },
    { key: 'ally', labelKey: 'hoi_rel_ally', color: '#2e8b57', min: 60 },
]);

/**
 * Tension levels (ordered calm -> critical) with inclusive lower bounds on the
 * 0..100 global tension meter.
 * @type {ReadonlyArray<{key:string,labelKey:string,color:string,min:number}>}
 */
export const TENSION_LEVELS = Object.freeze([
    { key: 'calm', labelKey: 'hoi_tension_level_calm', color: '#4a90d9', min: 0 },
    { key: 'uneasy', labelKey: 'hoi_tension_level_uneasy', color: '#e0a93b', min: 34 },
    { key: 'dangerous', labelKey: 'hoi_tension_level_dangerous', color: '#e07b39', min: 60 },
    { key: 'critical', labelKey: 'hoi_tension_level_critical', color: '#c0392b', min: 85 },
]);

/** Translate a resource key to its i18n label key. */
export function resourceLabelKey(resource) {
    return `hoi_res_${resource}`;
}

/** Translate a crisis severity to its i18n label key. */
export function severityLabelKey(severity) {
    return `hoi_sev_${severity}`;
}

/**
 * Classify a relation score (-100..100) into a tier descriptor.
 * @param {number} score
 * @returns {{key:string,labelKey:string,color:string,min:number}}
 */
export function relationTier(score) {
    const n = clampNum(score, BOUNDS.RELATION_MIN, BOUNDS.RELATION_MAX);
    let tier = RELATION_TIERS[0];
    for (const t of RELATION_TIERS) {
        if (n >= t.min) tier = t;
    }
    return tier;
}

/**
 * Classify the global tension meter (0..100) into a level descriptor.
 * @param {number} tension
 * @returns {{key:string,labelKey:string,color:string,min:number}}
 */
export function tensionLevel(tension) {
    const n = clampNum(tension, BOUNDS.TENSION_MIN, BOUNDS.TENSION_MAX);
    let level = TENSION_LEVELS[0];
    for (const l of TENSION_LEVELS) {
        if (n >= l.min) level = l;
    }
    return level;
}

/**
 * Resolve the color for a bloc string (falls back when unknown).
 * @param {string} bloc
 * @returns {string}
 */
export function blocColor(bloc) {
    return (bloc && BLOC_COLORS[bloc]) || DEFAULT_BLOC_COLOR;
}

/**
 * Build the per-nation color map used to paint the world map.
 *
 * Each entry is keyed by nation id and carries:
 *   - color:       fill color (player highlighted; others by relation-to-player
 *                  when a player exists, else by bloc)
 *   - bloc:        the nation's bloc
 *   - isPlayer:    true for the player's nation
 *   - relation:    relation score to the player (0 for the player itself / no player)
 *   - relationTier: tier key for the relation ('ally'..'hostile') or 'self'
 *
 * Safe on malformed input: returns {} when there are no nations.
 *
 * @param {import('../contract/worldState.js').WorldState} world
 * @returns {Object.<string, {color:string,bloc:string,isPlayer:boolean,relation:number,relationTier:string,name:string}>}
 */
export function buildMapColorMap(world) {
    /** @type {Object.<string, any>} */
    const out = {};
    if (!world || typeof world !== 'object' || !world.nations) return out;

    const playerId = world.playerNationId || null;
    const relations = world.relations || {};

    for (const [id, nation] of Object.entries(world.nations)) {
        if (!nation || typeof nation !== 'object') continue;
        const bloc = nation.bloc || 'NON_ALIGNED';
        const isPlayer = !!playerId && id === playerId;

        let relation = 0;
        let tierKey = 'self';
        let color;

        if (isPlayer) {
            color = PLAYER_COLOR;
        } else if (playerId) {
            relation = Number(relations[relationKey(playerId, id)] || 0);
            const tier = relationTier(relation);
            tierKey = tier.key;
            color = tier.color;
        } else {
            color = blocColor(bloc);
        }

        out[id] = {
            color,
            bloc,
            isPlayer,
            relation,
            relationTier: tierKey,
            name: nation.name || id,
        };
    }
    return out;
}

/**
 * Build the dashboard view-model for the player's nation.
 *
 * @param {import('../contract/worldState.js').WorldState} world
 * @param {Object} [opts]
 * @param {string[]} [opts.majorPowerIds] Ids to always show in the diplomacy
 *        panel (besides any other majors present). Defaults to a sensible set.
 * @returns {{
 *   hasNation: boolean,
 *   nation: ?object,
 *   turn: number,
 *   date: {year:number, month:number},
 *   phase: string,
 *   resources: Array<{key:string,labelKey:string,value:number,pct:number}>,
 *   tension: {value:number, pct:number, levelKey:string, labelKey:string, color:string},
 *   crises: Array<{id:string,title:string,description:string,severity:string,severityLabelKey:string,severityRank:number,involvedNationIds:string[]}>,
 *   relations: Array<{id:string,name:string,flagEmoji:string,bloc:string,blocColor:string,score:number,tierKey:string,tierLabelKey:string,color:string}>,
 * }}
 */
export function buildDashboardViewModel(world, opts = {}) {
    const empty = {
        hasNation: false,
        nation: null,
        turn: world && typeof world.turn === 'number' ? world.turn : 0,
        date: (world && world.date) || { year: 0, month: 0 },
        phase: (world && world.phase) || PHASES.SETUP,
        resources: [],
        tension: tensionViewModel(world ? world.globalTension : 0),
        crises: [],
        relations: [],
    };
    if (!world || typeof world !== 'object' || !world.nations) return empty;

    const playerId = world.playerNationId || null;
    const player = playerId ? world.nations[playerId] : null;
    if (!player) return empty;

    // 7 resources in the stable contract order.
    const res = player.resources || {};
    const resources = RESOURCE_KEYS.map((key) => {
        const value = clampNum(res[key], BOUNDS.RESOURCE_MIN, BOUNDS.RESOURCE_MAX);
        return {
            key,
            labelKey: resourceLabelKey(key),
            value,
            pct: value, // resources are already 0..100
        };
    });

    // Diplomacy: relation of the player to each other nation of interest.
    const majorPowerIds = Array.isArray(opts.majorPowerIds)
        ? opts.majorPowerIds
        : ['USA', 'CHN', 'RUS', 'DEU', 'GBR', 'FRA', 'IND', 'BRA'];
    const relationIds = new Set();
    for (const mid of majorPowerIds) {
        if (mid !== playerId && world.nations[mid]) relationIds.add(mid);
    }
    // Also surface any nation the player already has a non-zero relation with.
    for (const relKey of Object.keys(world.relations || {})) {
        const [a, b] = relKey.split('|');
        const other = a === playerId ? b : b === playerId ? a : null;
        if (other && other !== playerId && world.nations[other]) relationIds.add(other);
    }

    const relations = [...relationIds]
        .map((id) => {
            const n = world.nations[id];
            const score = Number((world.relations || {})[relationKey(playerId, id)] || 0);
            const tier = relationTier(score);
            return {
                id,
                name: (n && n.name) || id,
                flagEmoji: (n && n.flagEmoji) || '',
                bloc: (n && n.bloc) || 'NON_ALIGNED',
                blocColor: blocColor((n && n.bloc) || 'NON_ALIGNED'),
                score,
                tierKey: tier.key,
                tierLabelKey: tier.labelKey,
                color: tier.color,
            };
        })
        .sort((x, y) => y.score - x.score);

    const severityRankMap = { low: 0, medium: 1, high: 2, critical: 3 };
    const crises = (Array.isArray(world.activeCrises) ? world.activeCrises : [])
        .map((c) => ({
            id: c.id || '',
            title: c.title || '',
            description: c.description || '',
            severity: c.severity || 'medium',
            severityLabelKey: severityLabelKey(c.severity || 'medium'),
            severityRank: severityRankMap[c.severity] ?? 1,
            involvedNationIds: Array.isArray(c.involvedNationIds) ? c.involvedNationIds.slice() : [],
        }))
        .sort((a, b) => b.severityRank - a.severityRank);

    return {
        hasNation: true,
        nation: {
            id: player.id,
            name: player.name || player.id,
            flagEmoji: player.flagEmoji || '',
            bloc: player.bloc || 'NON_ALIGNED',
            blocColor: blocColor(player.bloc || 'NON_ALIGNED'),
            capital: player.capital || '',
            government: player.government || '',
            leaderTitle: player.leaderTitle || '',
            traits: Array.isArray(player.traits) ? player.traits.slice() : [],
        },
        turn: world.turn || 0,
        date: world.date || { year: 0, month: 0 },
        phase: world.phase || PHASES.SETUP,
        resources,
        tension: tensionViewModel(world.globalTension),
        crises,
        relations,
    };
}

/**
 * Build the tension meter sub-view-model.
 * @param {number} value
 * @returns {{value:number, pct:number, levelKey:string, labelKey:string, color:string}}
 */
export function tensionViewModel(value) {
    const v = clampNum(value, BOUNDS.TENSION_MIN, BOUNDS.TENSION_MAX);
    const level = tensionLevel(v);
    return {
        value: v,
        pct: v,
        levelKey: level.key,
        labelKey: level.labelKey,
        color: level.color,
    };
}

/**
 * Build the nation-picker list from scenario data (or a world state's nations).
 *
 * Returns featured majors (in a stable, meaningful order) plus the full roster,
 * each entry carrying the starting stats + traits + leaderTitle the picker
 * displays. Safe on malformed input: returns empty lists.
 *
 * @param {import('../contract/interfaces.js').ScenarioData|{nations:object}} scenario
 * @param {Object} [opts]
 * @param {string[]} [opts.playableIds] Restrict to these ids (ScenarioAPI.listPlayableNationIds()).
 * @param {string[]} [opts.featuredIds] Ids to feature at the top.
 * @returns {{featured:Array<object>, all:Array<object>, count:number}}
 */
export function buildNationPickerList(scenario, opts = {}) {
    const nations = (scenario && scenario.nations) || {};
    const playable = Array.isArray(opts.playableIds) && opts.playableIds.length
        ? opts.playableIds.filter((id) => nations[id])
        : Object.keys(nations);

    const entries = playable
        .map((id) => toPickerEntry(id, nations[id]))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    const featuredIds = Array.isArray(opts.featuredIds) && opts.featuredIds.length
        ? opts.featuredIds
        : ['USA', 'CHN', 'RUS', 'DEU', 'GBR', 'FRA', 'IND', 'BRA', 'JPN'];

    const featured = featuredIds
        .filter((id) => nations[id] && playable.includes(id))
        .map((id) => toPickerEntry(id, nations[id]))
        .filter(Boolean);

    return { featured, all: entries, count: entries.length };
}

/**
 * Normalize a Nation into a picker entry with a derived power rating.
 * @param {string} id
 * @param {import('../contract/worldState.js').Nation} nation
 * @returns {?object}
 */
function toPickerEntry(id, nation) {
    if (!nation || typeof nation !== 'object') return null;
    const res = nation.resources || {};
    const resources = RESOURCE_KEYS.map((key) => ({
        key,
        labelKey: resourceLabelKey(key),
        value: clampNum(res[key], BOUNDS.RESOURCE_MIN, BOUNDS.RESOURCE_MAX),
    }));
    const power = Math.round(
        resources.reduce((sum, r) => sum + r.value, 0) / (resources.length || 1),
    );
    return {
        id,
        name: nation.name || id,
        flagEmoji: nation.flagEmoji || '',
        bloc: nation.bloc || 'NON_ALIGNED',
        blocColor: blocColor(nation.bloc || 'NON_ALIGNED'),
        capital: nation.capital || '',
        government: nation.government || '',
        leaderTitle: nation.leaderTitle || '',
        traits: Array.isArray(nation.traits) ? nation.traits.slice() : [],
        resources,
        power,
    };
}

/**
 * Build the event-modal view-model from a (validated) GameEvent.
 * @param {import('../contract/events.js').GameEvent} event
 * @returns {{id:string,title:string,narrative:string,context:string,hasContext:boolean,options:Array<{id:string,label:string,rationale:string,hasRationale:boolean,index:number}>,tensionDelta:number}}
 */
export function buildEventViewModel(event) {
    const ev = event && typeof event === 'object' ? event : {};
    const options = (Array.isArray(ev.options) ? ev.options : []).map((o, i) => ({
        id: o && o.id ? o.id : `opt_${i}`,
        label: (o && o.label) || '',
        rationale: (o && o.rationale) || '',
        hasRationale: !!(o && o.rationale),
        index: i,
    }));
    return {
        id: ev.id || '',
        title: ev.title || '',
        narrative: ev.narrative || '',
        context: ev.context || '',
        hasContext: !!ev.context,
        options,
        tensionDelta: Number(ev.tensionDelta || 0),
    };
}

/** Internal numeric clamp that never returns NaN. */
function clampNum(n, min, max) {
    const v = Number(n);
    if (Number.isNaN(v)) return min;
    return Math.min(max, Math.max(min, Math.round(v)));
}

/** Re-export contract constants handy for renderers/tests. */
export { RESOURCE_KEYS, BLOCS };
