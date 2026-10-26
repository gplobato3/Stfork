/**
 * @file src/contract/worldState.js
 * WorldState v2 shapes (JSDoc) + tiny pure helpers. Node-safe, no side effects.
 *
 * The WorldState is a plain JSON-serializable object persisted in
 * ctx.chatMetadata[MODULE_KEY]. The engine is the ONLY writer; it always
 * returns new objects (never mutates its input).
 */

import { BOUNDS, PHASES, SCHEMA_VERSION } from './constants.js';

/**
 * @typedef {'economy'|'military'|'stability'|'influence'|'tech'|'manpower'|'warSupport'} ResourceKey
 * @typedef {Record<ResourceKey, number>} Resources  All integers in [0..100].
 */

/**
 * AI behaviour knobs, all in [0..1].
 * @typedef {Object} Personality
 * @property {number} aggression   Willingness to threaten / attack.
 * @property {number} diplomacy    Preference for deals, aid, pacts.
 * @property {number} blocLoyalty  Likelihood of honoring alliance calls.
 */

/**
 * @typedef {Object} Nation
 * @property {string} id            ISO-3166 alpha-3 (custom 3-letter ids for disputed areas, e.g. 'KOS').
 * @property {string} name          pt-BR display name ('Brasil').
 * @property {string} flag          Flag emoji (fallback only; UI prefers assets/flags/<id>.svg).
 * @property {string} bloc          One of BLOCS.
 * @property {string} capital       pt-BR capital name.
 * @property {string} government    pt-BR government type.
 * @property {string} leaderTitle   pt-BR head-of-state title ('Presidente', 'Rei', 'Primeiro-Ministro'...).
 * @property {boolean} playable     Authored nation the player may pick.
 * @property {boolean} major        Great/regional power (AI acts every turn; labels always shown).
 * @property {0|1|2} nuclear        0 none, 1 limited arsenal, 2 strategic arsenal.
 * @property {Resources} resources
 * @property {Personality} personality
 * @property {string[]} traits      pt-BR tags ('Potência Nuclear', 'Exportador de Petróleo').
 * @property {string} [blurb]       pt-BR 1-3 sentence description (picker / dossier).
 * @property {'facil'|'normal'|'dificil'} [difficulty]
 * @property {number} pc            Political capital in [0..BOUNDS.PC_MAX].
 * @property {string} status        One of NATION_STATUS values.
 * @property {?string} controller   Who controls the territory on the map (self id unless annexed).
 * @property {?string} overlord     Puppet master id, else null.
 */

/**
 * Multi-member pact. Alliances/defense pacts drive calls to arms.
 * @typedef {Object} Pact
 * @property {string} id
 * @property {'alliance'|'defense'|'trade'|'nonAggression'|'guarantee'} type
 * @property {string} name          pt-BR ('OTAN', 'Acordo Comercial Brasil-China').
 * @property {string[]} members     Nation ids. 'guarantee': members[0] guarantees members[1].
 * @property {number} startedTurn
 * @property {?number} expiresTurn  null = permanent.
 */

/**
 * One front = one attacker pushing into one defender's territory.
 * @typedef {Object} Front
 * @property {string} attacker
 * @property {string} defender
 * @property {number} progress      0..100 = share of defender territory occupied by attacker.
 */

/**
 * @typedef {Object} War
 * @property {string} id
 * @property {string} name          pt-BR ('Guerra Russo-Ucraniana').
 * @property {string[]} attackers
 * @property {string[]} defenders
 * @property {number} startedTurn
 * @property {Front[]} fronts
 * @property {number} score         -100..100, positive = attackers winning.
 * @property {Record<string, number>} exhaustion  nationId -> 0..100.
 * @property {boolean} ceasefire    Fronts frozen while true.
 */

/**
 * @typedef {Object} Crisis
 * @property {string} id
 * @property {string} title         pt-BR
 * @property {string} description   pt-BR
 * @property {'low'|'medium'|'high'|'critical'} severity
 * @property {string[]} involved    Nation ids.
 * @property {number} turnStarted
 * @property {string} [category]    One of EVENT_CATEGORIES (art / icon).
 * @property {string} [region]      pt-BR region label.
 */

/**
 * Timed per-turn modifier ("Mobilização parcial: militar +2/mês, economia -1/mês, 6 meses").
 * @typedef {Object} Modifier
 * @property {string} id
 * @property {string} nationId
 * @property {string} label         pt-BR
 * @property {Partial<Resources>} perTurn  Applied at each endTurn.
 * @property {number} turnsLeft
 * @property {string} [source]      Action id / event id that created it.
 */

/**
 * @typedef {Object} NewsItem
 * @property {number} turn
 * @property {{year:number, month:number}} date
 * @property {string} text          pt-BR headline.
 * @property {'world'|'player'|'war'|'crisis'|'diplomacy'|'economy'} kind
 * @property {string[]} nations
 */

/**
 * @typedef {Object} LogEntry
 * @property {number} turn
 * @property {{year:number, month:number}} date
 * @property {'system'|'action'|'event'|'decision'|'war'|'crisis'|'ai'} kind
 * @property {string} text          pt-BR
 * @property {Object} [data]
 */

/**
 * Compact record of a resolved action, used by the sitrep / narration so the
 * chat LLM can describe what actually happened mechanically.
 * @typedef {Object} ActionRecord
 * @property {number} turn
 * @property {string} actorId
 * @property {string} actionId
 * @property {?string} targetId
 * @property {boolean} success
 * @property {'ui'|'order'|'ai'|'command'} source
 * @property {string} summary       pt-BR one-liner ("Mobilização parcial decretada (sucesso).")
 */

/**
 * @typedef {Object} DecisionRecord
 * @property {number} turn
 * @property {string} eventTitle
 * @property {string} optionLabel
 */

/**
 * @typedef {Object} WorldState
 * @property {number} schemaVersion     === SCHEMA_VERSION
 * @property {string} campaignId
 * @property {string} seed              Base seed; engine derives per-turn RNG from seed + turn + salt.
 * @property {string} scenarioId
 * @property {string} bookmarkId
 * @property {number} turn              1 = first playable month.
 * @property {{year:number, month:number}} date   month 1..12
 * @property {{year:number, month:number}} endDate Campaign end (victory by survival).
 * @property {string} phase             PHASES
 * @property {{nationId:string, leaderName:string, title:string}} player
 * @property {Record<string, Nation>} nations
 * @property {Record<string, number>} relations   relationKey(a,b) -> -100..100 (missing = 0)
 * @property {Pact[]} pacts
 * @property {War[]} wars               Active wars only (ended wars move to log/news).
 * @property {Crisis[]} crises
 * @property {Modifier[]} modifiers
 * @property {Record<string, Record<string, number>>} cooldowns  nationId -> actionId -> first turn available again
 * @property {number} globalTension     0..100; 100 = nuclear exchange (game over)
 * @property {?import('./events.js').GameEvent} pendingEvent  Unresolved decision (survives reloads).
 * @property {import('./events.js').GameEvent[]} eventQueue  Engine-generated decisions waiting after pendingEvent.
 * @property {ActionRecord[]} recentActions  Last CAPS.RECENT_ACTIONS player actions (sitrep).
 * @property {DecisionRecord[]} decisions
 * @property {NewsItem[]} news
 * @property {LogEntry[]} log
 * @property {?{kind:'victory'|'defeat', reason:string, turn:number}} outcome
 * @property {Record<string, any>} flags
 */

/** Order-independent relation key: relationKey('USA','RUS') === 'RUS|USA'. */
export function relationKey(a, b) {
    const x = String(a);
    const y = String(b);
    return x <= y ? `${x}|${y}` : `${y}|${x}`;
}

/** Relation between a and b (0 when unset; 100 for a===b). */
export function getRelation(state, a, b) {
    if (a === b) return 100;
    const v = state && state.relations ? state.relations[relationKey(a, b)] : undefined;
    return typeof v === 'number' ? v : 0;
}

export function clamp(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.min(max, Math.max(min, v));
}

export const clampResource = (n) => Math.round(clamp(n, BOUNDS.RESOURCE_MIN, BOUNDS.RESOURCE_MAX));
export const clampRelation = (n) => Math.round(clamp(n, BOUNDS.RELATION_MIN, BOUNDS.RELATION_MAX));
export const clampTension = (n) => Math.round(clamp(n, BOUNDS.TENSION_MIN, BOUNDS.TENSION_MAX));
export const clampProgress = (n) => Math.round(clamp(n, BOUNDS.PROGRESS_MIN, BOUNDS.PROGRESS_MAX));

/** Add `months` to a {year, month} date. */
export function addMonths(date, months) {
    const total = date.year * 12 + (date.month - 1) + months;
    return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Months from a to b (b - a). */
export function monthsBetween(a, b) {
    return (b.year * 12 + b.month) - (a.year * 12 + a.month);
}

/** Cheap structural check used by persistence before trusting a save. */
export function isWorldState(obj) {
    return (
        !!obj &&
        typeof obj === 'object' &&
        obj.schemaVersion === SCHEMA_VERSION &&
        typeof obj.campaignId === 'string' &&
        typeof obj.turn === 'number' &&
        !!obj.date &&
        !!obj.player &&
        typeof obj.player.nationId === 'string' &&
        !!obj.nations &&
        typeof obj.nations === 'object' &&
        Array.isArray(obj.wars) &&
        Array.isArray(obj.crises) &&
        typeof obj.phase === 'string' &&
        Object.values(PHASES).includes(obj.phase)
    );
}

/** The player's Nation object (or null). */
export function playerNation(state) {
    if (!state || !state.player || !state.nations) return null;
    return state.nations[state.player.nationId] || null;
}
