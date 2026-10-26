/**
 * @file src/engine/engine.js
 * Module A — the deterministic game-state engine for HOI Grande Estratégia.
 *
 * Pure, ST-independent game logic: world-state lifecycle, turn processing,
 * deterministic effect application, crisis/tension evolution, derived metrics,
 * and save/load bound to a chat via chatMetadata.
 *
 * Design rules:
 *  - State transitions are pure: every mutator clones the input (lodash
 *    cloneDeep from SillyTavern.libs when available, else structuredClone) and
 *    returns a NEW WorldState, so changes are testable and undo-friendly.
 *  - All randomness flows through getSeedRandom() seeded from
 *    `state.seed + ':' + state.turn`, so replays are byte-identical.
 *  - applyEffect handles EVERY EFFECT_TYPE from the contract and never throws
 *    on an unknown type (it logs and returns the state unchanged).
 *  - Persistence goes through the stContext wrapper so it works live and under
 *    node (mock chatMetadata + saveMetadata).
 *
 * Display strings are pt-BR; identifiers and comments are English.
 */

import { MODULE_NAME } from '../contract/interfaces.js';
import {
    SCHEMA_VERSION,
    PHASES,
    RESOURCE_KEYS,
    BOUNDS,
    relationKey,
    createResources,
    createEmptyWorldState,
    clampResource,
    clampRelation,
    clampTension,
    isWorldStateShape,
} from '../contract/worldState.js';
import {
    EFFECT_DELTA_BOUNDS,
    CRISIS_SEVERITIES,
    createCrisis,
    isEffectType,
    isResourceKey,
} from '../contract/events.js';
import { getContext, getLibs, getSeedRandom } from '../core/stContext.js';

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Deep clone a value. Prefers lodash.cloneDeep from SillyTavern.libs (so we
 * match ST behavior in the browser), falls back to structuredClone, then to a
 * JSON round-trip as a last resort. World state is plain JSON data, so all
 * three are equivalent for our shapes.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepClone(value) {
    const libs = getLibs();
    if (libs && typeof libs.cloneDeep === 'function') {
        return libs.cloneDeep(value);
    }
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

/**
 * Clamp a delta into the documented soft bounds for a given effect kind.
 * @param {number} delta
 * @param {'resource'|'relation'|'tension'} kind
 * @returns {number}
 */
function clampDelta(delta, kind) {
    const b = EFFECT_DELTA_BOUNDS[kind];
    const n = Math.round(Number(delta) || 0);
    if (!b) return n;
    return Math.min(b.max, Math.max(b.min, n));
}

/**
 * Append a log entry to the (already-cloned) state. Mutates in place; callers
 * own the clone.
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {string} kind  'event' | 'decision' | 'effect' | 'system' | 'crisis'
 * @param {string} text  pt-BR summary line
 * @param {Object} [data]
 */
function pushLog(state, kind, text, data) {
    /** @type {import('../contract/worldState.js').TurnLogEntry} */
    const entry = {
        turn: state.turn,
        date: { year: state.date.year, month: state.date.month },
        kind,
        text,
    };
    if (data !== undefined) entry.data = data;
    state.log.push(entry);
}

/**
 * Pick a human title (pt-BR) for the head of state based on a government type.
 * Monarchies get "Rei", theocracies "Líder Supremo", most others "Presidente".
 * @param {string} government pt-BR government description
 * @returns {string}
 */
function leaderTitleForGovernment(government) {
    const g = String(government || '').toLowerCase();
    if (/(monarqu|reino|realeza|imp[ée]rio|imperial)/.test(g)) return 'Rei';
    if (/(teocr|religios)/.test(g)) return 'Líder Supremo';
    if (/(chanceler|parlament)/.test(g)) return 'Chanceler';
    if (/(ditad|junta|autorit|partido [úu]nico|regime)/.test(g)) return 'Líder Supremo';
    return 'Presidente';
}

/**
 * Resolve a nation object in state by id, or undefined.
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {string} id
 * @returns {import('../contract/worldState.js').Nation|undefined}
 */
function getNation(state, id) {
    return state && state.nations ? state.nations[id] : undefined;
}

/**
 * Safe getter for a relation score (0 when unset).
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function getRelation(state, a, b) {
    const key = relationKey(a, b);
    const v = state.relations[key];
    return typeof v === 'number' ? v : 0;
}

/**
 * Set a relation score (clamped) through the normalized key.
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {string} a
 * @param {string} b
 * @param {number} value
 */
function setRelation(state, a, b, value) {
    state.relations[relationKey(a, b)] = clampRelation(value);
}

/* -------------------------------------------------------------------------- */
/* Effect application                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Apply a single, already-validated effect to a MUTABLE state (the public
 * applyEffect clones first). Exhaustive over EFFECT_TYPES. Unknown types are
 * logged and ignored — never throw.
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {import('../contract/events.js').Effect} effect
 */
function applyEffectInPlace(state, effect) {
    if (!effect || typeof effect !== 'object' || !isEffectType(effect.type)) {
        pushLog(state, 'system', `Efeito desconhecido ignorado: ${effect && effect.type}`, {
            effect,
        });
        return;
    }

    switch (effect.type) {
        case 'resource': {
            const nation = getNation(state, effect.target);
            if (!nation || !isResourceKey(effect.resource)) break;
            const delta = clampDelta(effect.delta, 'resource');
            nation.resources[effect.resource] = clampResource(
                nation.resources[effect.resource] + delta,
            );
            break;
        }

        case 'resourceSet': {
            const nation = getNation(state, effect.target);
            if (!nation || !isResourceKey(effect.resource)) break;
            nation.resources[effect.resource] = clampResource(effect.value);
            break;
        }

        case 'relation': {
            if (!effect.target || !effect.targetB) break;
            const delta = clampDelta(effect.delta, 'relation');
            setRelation(state, effect.target, effect.targetB, getRelation(state, effect.target, effect.targetB) + delta);
            break;
        }

        case 'tension': {
            const delta = clampDelta(effect.delta, 'tension');
            state.globalTension = clampTension(state.globalTension + delta);
            break;
        }

        case 'flag': {
            if (!effect.target) break;
            state.flags[effect.target] = effect.value === undefined ? true : effect.value;
            break;
        }

        case 'bloc': {
            const nation = getNation(state, effect.target);
            if (!nation || typeof effect.bloc !== 'string' || !effect.bloc) break;
            nation.bloc = effect.bloc;
            break;
        }

        case 'war': {
            applyWarEffect(state, effect);
            break;
        }

        case 'crisis': {
            applyCrisisEffect(state, effect);
            break;
        }

        default: {
            // Should be unreachable because of the isEffectType guard above,
            // but keep it defensive: log, never throw.
            pushLog(state, 'system', `Tipo de efeito não tratado: ${effect.type}`, { effect });
            break;
        }
    }

    if (effect.note) {
        pushLog(state, 'effect', String(effect.note), { type: effect.type });
    }
}

/**
 * Handle a 'war' effect: flip war state between two nations and apply the
 * documented relation/tension side effects.
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {import('../contract/events.js').Effect} effect
 */
function applyWarEffect(state, effect) {
    if (!effect.target || !effect.targetB) return;
    const a = effect.target;
    const b = effect.targetB;
    const key = relationKey(a, b);
    if (!state.flags.__wars || typeof state.flags.__wars !== 'object') {
        state.flags.__wars = {};
    }
    const wars = state.flags.__wars;

    switch (effect.action) {
        case 'declare': {
            wars[key] = true;
            // Declaring war craters the relation and spikes global tension.
            setRelation(state, a, b, getRelation(state, a, b) - 60);
            state.globalTension = clampTension(state.globalTension + 15);
            break;
        }
        case 'ceasefire': {
            // Fighting pauses; relation nudges up a little, tension eases.
            if (wars[key]) wars[key] = 'ceasefire';
            setRelation(state, a, b, getRelation(state, a, b) + 10);
            state.globalTension = clampTension(state.globalTension - 5);
            break;
        }
        case 'peace': {
            delete wars[key];
            setRelation(state, a, b, getRelation(state, a, b) + 25);
            state.globalTension = clampTension(state.globalTension - 10);
            break;
        }
        default:
            break;
    }
}

/**
 * Handle a 'crisis' effect: start / escalate / deescalate / resolve.
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {import('../contract/events.js').Effect} effect
 */
function applyCrisisEffect(state, effect) {
    switch (effect.action) {
        case 'start': {
            const payload = effect.crisis || {};
            const crisis = createCrisis({
                ...payload,
                turnStarted: typeof payload.turnStarted === 'number' ? payload.turnStarted : state.turn,
            });
            state.activeCrises.push(crisis);
            pushLog(state, 'crisis', `Crise iniciada: ${crisis.title || crisis.id}`, {
                crisisId: crisis.id,
                severity: crisis.severity,
            });
            break;
        }
        case 'escalate': {
            const crisis = findCrisis(state, effect.crisisId);
            if (crisis) {
                crisis.severity = bumpSeverity(crisis.severity, 1);
                state.globalTension = clampTension(state.globalTension + 5);
                pushLog(state, 'crisis', `Crise agravada: ${crisis.title || crisis.id}`, {
                    crisisId: crisis.id,
                    severity: crisis.severity,
                });
            }
            break;
        }
        case 'deescalate': {
            const crisis = findCrisis(state, effect.crisisId);
            if (crisis) {
                crisis.severity = bumpSeverity(crisis.severity, -1);
                state.globalTension = clampTension(state.globalTension - 3);
                pushLog(state, 'crisis', `Crise atenuada: ${crisis.title || crisis.id}`, {
                    crisisId: crisis.id,
                    severity: crisis.severity,
                });
            }
            break;
        }
        case 'resolve': {
            const idx = state.activeCrises.findIndex((c) => c.id === effect.crisisId);
            if (idx >= 0) {
                const [removed] = state.activeCrises.splice(idx, 1);
                state.globalTension = clampTension(state.globalTension - 4);
                pushLog(state, 'crisis', `Crise resolvida: ${removed.title || removed.id}`, {
                    crisisId: removed.id,
                });
            }
            break;
        }
        default:
            break;
    }
}

/**
 * Find an active crisis by id.
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {string|undefined} id
 * @returns {import('../contract/events.js').Crisis|undefined}
 */
function findCrisis(state, id) {
    if (!id) return undefined;
    return state.activeCrises.find((c) => c.id === id);
}

/**
 * Move a severity up or down the CRISIS_SEVERITIES ladder (clamped).
 * @param {string} severity
 * @param {number} step signed step
 * @returns {string}
 */
function bumpSeverity(severity, step) {
    const idx = CRISIS_SEVERITIES.indexOf(severity);
    const base = idx < 0 ? 1 : idx; // default to 'medium' index if unknown
    const next = Math.min(CRISIS_SEVERITIES.length - 1, Math.max(0, base + step));
    return CRISIS_SEVERITIES[next];
}

/* -------------------------------------------------------------------------- */
/* Public engine factory                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Create the engine. Stateless aside from the ST context accessors it closes
 * over; all game state lives in the WorldState objects passed to each method.
 * @returns {import('../contract/interfaces.js').EngineAPI & {
 *   newCampaign: Function,
 *   getNationStatus: Function,
 *   hasSave: Function,
 *   deleteSave: Function,
 * }}
 */
export function createEngine() {
    /* --------------------------- lifecycle -------------------------------- */

    /**
     * Build a fresh WorldState from scenario data with the chosen player nation.
     * @param {import('../contract/interfaces.js').ScenarioData} scenario
     * @param {string} playerNationId ISO alpha-3
     * @param {{seed?: string, campaignId?: string}} [opts]
     * @returns {import('../contract/worldState.js').WorldState}
     */
    function newGame(scenario, playerNationId, opts = {}) {
        const base = createEmptyWorldState({
            campaignId: opts.campaignId,
            seed: opts.seed,
        });

        // Deep-copy scenario nations so later mutation never touches the source.
        const nations = {};
        const srcNations = (scenario && scenario.nations) || {};
        for (const id of Object.keys(srcNations)) {
            const n = deepClone(srcNations[id]);
            n.id = id;
            n.isPlayer = false;
            n.resources = createResources(n.resources || {});
            if (!Array.isArray(n.traits)) n.traits = [];
            nations[id] = n;
        }

        // Normalize relation keys through relationKey() so lookups are stable.
        const relations = {};
        const srcRelations = (scenario && scenario.relations) || {};
        for (const rawKey of Object.keys(srcRelations)) {
            const parts = String(rawKey).split('|');
            if (parts.length === 2) {
                relations[relationKey(parts[0], parts[1])] = clampRelation(srcRelations[rawKey]);
            }
        }

        const crisisSeeds = Array.isArray(scenario && scenario.crisisSeeds)
            ? scenario.crisisSeeds.map((c) => createCrisis({ ...c, turnStarted: 0 }))
            : [];

        base.nations = nations;
        base.relations = relations;
        base.activeCrises = crisisSeeds;
        if (scenario && scenario.meta && typeof scenario.meta === 'object') {
            base.flags.__scenarioMeta = deepClone(scenario.meta);
        }

        // Record the chosen nation and move into the first player turn.
        const withNation = selectNation(base, playerNationId);
        if (withNation.playerNationId) {
            withNation.phase = PHASES.PLAYER_TURN;
            withNation.turn = 1;
            pushLog(
                withNation,
                'system',
                `Campanha iniciada como ${withNation.nations[withNation.playerNationId].name}.`,
                { playerNationId: withNation.playerNationId },
            );
        }
        return withNation;
    }

    /**
     * Mark `nationId` as the player's nation. Clears any previous player flag,
     * sets isPlayer + a government-appropriate leaderTitle. Returns a NEW state.
     * @param {import('../contract/worldState.js').WorldState} state
     * @param {string} nationId
     * @returns {import('../contract/worldState.js').WorldState}
     */
    function selectNation(state, nationId) {
        const next = deepClone(state);
        if (!getNation(next, nationId)) {
            // Unknown nation: leave the state effectively unchanged but logged.
            pushLog(next, 'system', `Nação inválida ignorada na seleção: ${nationId}`, { nationId });
            return next;
        }
        for (const id of Object.keys(next.nations)) {
            next.nations[id].isPlayer = id === nationId;
        }
        const player = next.nations[nationId];
        player.leaderTitle = leaderTitleForGovernment(player.government);
        next.playerNationId = nationId;
        return next;
    }

    /* ----------------------------- effects -------------------------------- */

    /**
     * Apply ONE validated effect to a fresh clone of the state and return it.
     * @param {import('../contract/worldState.js').WorldState} state
     * @param {import('../contract/events.js').Effect} effect
     * @returns {import('../contract/worldState.js').WorldState}
     */
    function applyEffect(state, effect) {
        const next = deepClone(state);
        applyEffectInPlace(next, effect);
        return next;
    }

    /**
     * Apply the chosen option's effects (plus event.tensionDelta) to the state,
     * append a decision log entry, and return a NEW state. Unknown option ids
     * are rejected gracefully (logged, state otherwise unchanged).
     * @param {import('../contract/worldState.js').WorldState} state
     * @param {import('../contract/events.js').GameEvent} event
     * @param {string} optionId
     * @returns {import('../contract/worldState.js').WorldState}
     */
    function applyEvent(state, event, optionId) {
        const next = deepClone(state);
        if (!event || !Array.isArray(event.options)) {
            pushLog(next, 'system', 'Evento inválido ignorado.', { event });
            return next;
        }

        const option = event.options.find((o) => o && o.id === optionId);
        if (!option) {
            pushLog(next, 'system', `Opção desconhecida rejeitada: ${optionId}`, {
                eventId: event.id,
                optionId,
            });
            return next;
        }

        // Baseline tension change applies regardless of the chosen option.
        if (typeof event.tensionDelta === 'number') {
            next.globalTension = clampTension(next.globalTension + clampDelta(event.tensionDelta, 'tension'));
        }

        const before = snapshotMetrics(next);
        const effects = Array.isArray(option.effects) ? option.effects : [];
        for (const effect of effects) {
            applyEffectInPlace(next, effect);
        }
        const after = snapshotMetrics(next);

        pushLog(next, 'decision', `${event.title || 'Evento'} — ${option.label || optionId}`, {
            eventId: event.id,
            optionId,
            optionLabel: option.label,
            deltas: diffMetrics(before, after),
        });
        return next;
    }

    /* ---------------------------- turn loop ------------------------------- */

    /**
     * Advance turn + date by one month and run deterministic per-turn upkeep.
     * Randomness is seeded from `state.seed + ':' + state.turn` so the same
     * input state always yields byte-identical output.
     * @param {import('../contract/worldState.js').WorldState} state
     * @returns {import('../contract/worldState.js').WorldState}
     */
    function advanceTurn(state) {
        const next = deepClone(state);
        const seedRandom = getSeedRandom();
        const rng = seedRandom(`${next.seed}:${next.turn}`);

        // 1. Advance the calendar by one month (with year rollover).
        next.turn += 1;
        let month = next.date.month + 1;
        let year = next.date.year;
        if (month > 12) {
            month = 1;
            year += 1;
        }
        next.date = { year, month };

        // 2. Passive economy / stability drift for every nation (small, seeded).
        for (const id of Object.keys(next.nations)) {
            const nation = next.nations[id];
            const econDrift = seededDrift(rng, 2); // -2..+2
            const stabDrift = seededDrift(rng, 2);
            nation.resources.economy = clampResource(nation.resources.economy + econDrift);
            nation.resources.stability = clampResource(nation.resources.stability + stabDrift);
        }

        // 3. Tension evolution: crises and non-aligned fragmentation push it up,
        //    otherwise it decays slowly toward calm.
        const activeCount = next.activeCrises.length;
        const severityPressure = next.activeCrises.reduce(
            (sum, c) => sum + (CRISIS_SEVERITIES.indexOf(c.severity) + 1),
            0,
        );
        let tensionChange;
        if (activeCount > 0) {
            // Crises grow tension; the jitter keeps replays interesting but seeded.
            tensionChange = Math.round(severityPressure * 0.8) + seededDrift(rng, 1);
        } else {
            // Calm: decay toward 0, with a tiny seeded jitter.
            tensionChange = -2 + seededDrift(rng, 1);
        }
        next.globalTension = clampTension(next.globalTension + tensionChange);

        // 4. Auto-resolve crises that have outlived their natural lifespan.
        //    A crisis expires after a severity-scaled number of turns.
        const expired = [];
        next.activeCrises = next.activeCrises.filter((crisis) => {
            const lifespan = 2 + CRISIS_SEVERITIES.indexOf(crisis.severity); // 2..5 turns
            const age = next.turn - (crisis.turnStarted || 0);
            if (age >= lifespan) {
                expired.push(crisis);
                return false;
            }
            return true;
        });
        for (const crisis of expired) {
            next.globalTension = clampTension(next.globalTension - 3);
            pushLog(next, 'crisis', `Crise expirou: ${crisis.title || crisis.id}`, {
                crisisId: crisis.id,
            });
        }

        // 5. Phase: terminal if a game-over condition is met, else player's turn.
        const overReason = checkGameOver(next);
        next.phase = overReason ? PHASES.GAME_OVER : PHASES.PLAYER_TURN;

        // 6. Compact, deterministic turn summary stored on the log + returned.
        /** @type {Object} */
        const summary = {
            turn: next.turn,
            date: { year: next.date.year, month: next.date.month },
            tension: next.globalTension,
            tensionChange,
            activeCrises: next.activeCrises.length,
            expiredCrises: expired.map((c) => c.id),
            gameOver: overReason,
        };
        pushLog(next, 'system', `Turno ${next.turn} — ${next.date.month}/${next.date.year}.`, summary);
        next.flags.__lastTurnSummary = summary;

        return next;
    }

    /* --------------------------- game over -------------------------------- */

    /**
     * Return a pt-BR game-over reason if a terminal condition is met, else null.
     * @param {import('../contract/worldState.js').WorldState} state
     * @returns {string|null}
     */
    function checkGameOver(state) {
        if (state.globalTension >= BOUNDS.TENSION_MAX) {
            return 'A escalada chegou ao limite: a guerra nuclear global eclodiu.';
        }
        const player = state.playerNationId ? getNation(state, state.playerNationId) : undefined;
        if (player && player.resources.stability <= BOUNDS.RESOURCE_MIN) {
            return 'Seu governo entrou em colapso. A nação mergulhou no caos.';
        }
        return null;
    }

    /* ------------------------- derived metrics ---------------------------- */

    /**
     * Compute UI indicators for a nation WITHOUT storing them in state.
     * @param {import('../contract/worldState.js').WorldState} state
     * @param {string} nationId
     * @returns {{
     *   id: string,
     *   found: boolean,
     *   powerScore: number,
     *   atWar: boolean,
     *   warWith: string[],
     *   bloc: string,
     *   relations: Array<{id: string, score: number}>,
     *   allies: string[],
     *   rivals: string[],
     * }}
     */
    function getNationStatus(state, nationId) {
        const nation = getNation(state, nationId);
        if (!nation) {
            return {
                id: nationId,
                found: false,
                powerScore: 0,
                atWar: false,
                warWith: [],
                bloc: '',
                relations: [],
                allies: [],
                rivals: [],
            };
        }

        // Overall power = weighted blend of the resources (military/economy heavy).
        const r = nation.resources;
        const powerScore = Math.round(
            r.economy * 0.2 +
                r.military * 0.25 +
                r.stability * 0.15 +
                r.influence * 0.15 +
                r.tech * 0.1 +
                r.manpower * 0.1 +
                r.warSupport * 0.05,
        );

        // War state from the __wars flag registry.
        const warWith = [];
        const wars = (state.flags && state.flags.__wars) || {};
        for (const key of Object.keys(wars)) {
            if (wars[key] !== true) continue; // ceasefire/other states are not "at war"
            const [a, b] = key.split('|');
            if (a === nationId) warWith.push(b);
            else if (b === nationId) warWith.push(a);
        }

        // Relation summary against every other known nation.
        const relations = [];
        const allies = [];
        const rivals = [];
        for (const otherId of Object.keys(state.nations)) {
            if (otherId === nationId) continue;
            const score = getRelation(state, nationId, otherId);
            relations.push({ id: otherId, score });
            if (score >= 50) allies.push(otherId);
            else if (score <= -50) rivals.push(otherId);
        }
        relations.sort((x, y) => y.score - x.score);

        return {
            id: nationId,
            found: true,
            powerScore,
            atWar: warWith.length > 0,
            warWith,
            bloc: nation.bloc,
            relations,
            allies,
            rivals,
        };
    }

    /* ---------------------------- save / load ----------------------------- */

    /**
     * Persist the world state into ST chatMetadata under MODULE_NAME and call
     * saveMetadata(). Each chat holds exactly one campaign. Guarded so a
     * missing/odd context never throws.
     * @param {import('../contract/worldState.js').WorldState} state
     * @returns {Promise<void>}
     */
    async function saveState(state) {
        const ctx = getContext();
        if (!ctx || typeof ctx !== 'object') return;
        if (!ctx.chatMetadata || typeof ctx.chatMetadata !== 'object') {
            ctx.chatMetadata = {};
        }
        // Store a deep clone so later in-memory mutation cannot corrupt the save.
        ctx.chatMetadata[MODULE_NAME] = deepClone(state);
        if (typeof ctx.saveMetadata === 'function') {
            await ctx.saveMetadata();
        }
    }

    /**
     * Load the world state for the current chat, or null if none/invalid.
     * Applies a schemaVersion migration guard before returning.
     * @returns {Promise<import('../contract/worldState.js').WorldState|null>}
     */
    async function loadState() {
        const ctx = getContext();
        if (!ctx || !ctx.chatMetadata || typeof ctx.chatMetadata !== 'object') return null;
        const raw = ctx.chatMetadata[MODULE_NAME];
        if (!raw || typeof raw !== 'object') return null;
        const migrated = migrateState(deepClone(raw));
        return isWorldStateShape(migrated) ? migrated : null;
    }

    /**
     * True when the current chat has a saved campaign.
     * @returns {boolean}
     */
    function hasSave() {
        const ctx = getContext();
        return !!(
            ctx &&
            ctx.chatMetadata &&
            typeof ctx.chatMetadata === 'object' &&
            ctx.chatMetadata[MODULE_NAME] &&
            typeof ctx.chatMetadata[MODULE_NAME] === 'object'
        );
    }

    /**
     * Delete the current chat's saved campaign and persist the removal.
     * @returns {Promise<void>}
     */
    async function deleteSave() {
        const ctx = getContext();
        if (!ctx || !ctx.chatMetadata || typeof ctx.chatMetadata !== 'object') return;
        if (MODULE_NAME in ctx.chatMetadata) {
            delete ctx.chatMetadata[MODULE_NAME];
            if (typeof ctx.saveMetadata === 'function') {
                await ctx.saveMetadata();
            }
        }
    }

    return {
        // Contract EngineAPI
        newGame,
        selectNation,
        applyEffect,
        applyEvent,
        advanceTurn,
        saveState,
        loadState,
        checkGameOver,
        // Aliases / extras documented in FEAT-002
        newCampaign: newGame,
        getNationStatus,
        hasSave,
        deleteSave,
    };
}

/* -------------------------------------------------------------------------- */
/* Migration + small pure utilities (exported for tests/tools)               */
/* -------------------------------------------------------------------------- */

/**
 * Schema migration guard: if a loaded state is from an older/mismatched schema,
 * safely default-fill any missing top-level fields and stamp the current
 * SCHEMA_VERSION. Never throws; best-effort repair.
 * @param {any} state
 * @returns {import('../contract/worldState.js').WorldState}
 */
export function migrateState(state) {
    if (!state || typeof state !== 'object') {
        return createEmptyWorldState();
    }
    if (state.schemaVersion === SCHEMA_VERSION && isWorldStateShape(state)) {
        return state;
    }

    // Default-fill against a fresh empty state so new fields never read undefined.
    const template = createEmptyWorldState({
        campaignId: typeof state.campaignId === 'string' ? state.campaignId : undefined,
        seed: typeof state.seed === 'string' ? state.seed : undefined,
    });
    const merged = { ...template, ...state };

    // Repair nested required shapes.
    merged.schemaVersion = SCHEMA_VERSION;
    merged.date =
        state.date && typeof state.date.year === 'number' && typeof state.date.month === 'number'
            ? { year: state.date.year, month: state.date.month }
            : { ...template.date };
    merged.nations = state.nations && typeof state.nations === 'object' ? state.nations : {};
    merged.relations = state.relations && typeof state.relations === 'object' ? state.relations : {};
    merged.activeCrises = Array.isArray(state.activeCrises) ? state.activeCrises : [];
    merged.log = Array.isArray(state.log) ? state.log : [];
    merged.flags = state.flags && typeof state.flags === 'object' ? state.flags : {};
    merged.globalTension = clampTension(
        typeof state.globalTension === 'number' ? state.globalTension : template.globalTension,
    );

    // Ensure every nation carries all 7 resource keys.
    for (const id of Object.keys(merged.nations)) {
        const n = merged.nations[id];
        if (n && typeof n === 'object') {
            n.resources = createResources(n.resources || {});
        }
    }
    return merged;
}

/**
 * Deterministic integer drift in [-span..+span] from a seeded rng in [0,1).
 * @param {() => number} rng
 * @param {number} span
 * @returns {number}
 */
function seededDrift(rng, span) {
    const r = typeof rng === 'function' ? rng() : 0.5;
    return Math.round((r * 2 - 1) * span);
}

/**
 * Snapshot the metrics we diff for decision logs: global tension + every
 * nation's resource totals.
 * @param {import('../contract/worldState.js').WorldState} state
 * @returns {{tension: number, nations: Object.<string, number>}}
 */
function snapshotMetrics(state) {
    const nations = {};
    for (const id of Object.keys(state.nations)) {
        const r = state.nations[id].resources;
        nations[id] = RESOURCE_KEYS.reduce((sum, k) => sum + (r[k] || 0), 0);
    }
    return { tension: state.globalTension, nations };
}

/**
 * Diff two metric snapshots into a compact delta object (only non-zero entries).
 * @param {{tension: number, nations: Object.<string, number>}} before
 * @param {{tension: number, nations: Object.<string, number>}} after
 * @returns {{tension: number, nations: Object.<string, number>}}
 */
function diffMetrics(before, after) {
    const nations = {};
    for (const id of Object.keys(after.nations)) {
        const d = after.nations[id] - (before.nations[id] || 0);
        if (d !== 0) nations[id] = d;
    }
    return { tension: after.tension - before.tension, nations };
}

export default createEngine;
