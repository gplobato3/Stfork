/**
 * Small hand-built WorldState v2 + a mocked EngineAPI subset for ST/LLM tests.
 * Does NOT import src/engine (owned by another agent).
 */

import { EFFECT_TYPES, EVENT_CATEGORIES, OPTION_COUNT, SCHEMA_VERSION } from '../../src/contract/constants.js';

function nation(id, name, extra = {}) {
    return {
        id,
        name,
        flag: '',
        bloc: 'NON_ALIGNED',
        capital: '',
        government: 'República',
        leaderTitle: 'Presidente',
        playable: true,
        major: false,
        nuclear: 0,
        resources: { economy: 50, military: 40, stability: 60, influence: 40, tech: 45, manpower: 50, warSupport: 30 },
        personality: { aggression: 0.3, diplomacy: 0.6, blocLoyalty: 0.5 },
        traits: [],
        pc: 5,
        status: 'active',
        controller: id,
        overlord: null,
        ...extra,
    };
}

export function makeState(overrides = {}) {
    const nations = {
        BRA: nation('BRA', 'Brasil', { bloc: 'BRICS', government: 'República presidencialista', major: true, pc: 7, resources: { economy: 62, military: 45, stability: 70, influence: 55, tech: 48, manpower: 60, warSupport: 30 } }),
        ARG: nation('ARG', 'Argentina'),
        VEN: nation('VEN', 'Venezuela'),
        USA: nation('USA', 'Estados Unidos', { bloc: 'NATO', major: true, nuclear: 2 }),
        CHN: nation('CHN', 'China', { bloc: 'BRICS', major: true, nuclear: 2 }),
        RUS: nation('RUS', 'Rússia', { bloc: 'CSTO', major: true, nuclear: 2 }),
        UKR: nation('UKR', 'Ucrânia'),
        TWN: nation('TWN', 'Taiwan'),
        GUY: nation('GUY', 'Guiana', { playable: false }),
        XAN: nation('XAN', 'Anexolândia', { playable: false, status: 'annexed', controller: 'RUS' }),
    };
    const state = {
        schemaVersion: SCHEMA_VERSION,
        campaignId: 'camp-1',
        seed: 'seed',
        scenarioId: 'modern-ww3',
        bookmarkId: 'b2026',
        turn: 3,
        date: { year: 2026, month: 10 },
        endDate: { year: 2036, month: 1 },
        phase: 'PLAYER_TURN',
        player: { nationId: 'BRA', leaderName: 'Gabriel Lobato', title: 'Presidente' },
        nations,
        relations: { 'ARG|BRA': 64, 'BRA|VEN': -48, 'BRA|USA': 30, 'BRA|CHN': 41, 'RUS|UKR': -95, 'BRA|RUS': -5 },
        pacts: [{ id: 'p1', type: 'trade', name: 'Mercosul', members: ['BRA', 'ARG'], startedTurn: 1, expiresTurn: null }],
        wars: [
            {
                id: 'w1',
                name: 'Guerra Russo-Ucraniana',
                attackers: ['RUS'],
                defenders: ['UKR'],
                startedTurn: 1,
                fronts: [{ attacker: 'RUS', defender: 'UKR', progress: 18 }],
                score: 10,
                exhaustion: { RUS: 30, UKR: 40 },
                ceasefire: false,
            },
        ],
        crises: [
            { id: 'c1', title: 'Bloqueio no Estreito de Taiwan', description: 'Navios chineses cercam a ilha.', severity: 'high', involved: ['CHN', 'TWN', 'USA'], turnStarted: 2, category: 'naval' },
            { id: 'c2', title: 'Disputa do Essequibo', description: 'A Venezuela reivindica território guianense.', severity: 'medium', involved: ['VEN', 'GUY'], turnStarted: 3, category: 'diplomacy' },
        ],
        modifiers: [{ id: 'm1', nationId: 'BRA', label: 'Mobilização parcial', perTurn: { military: 2, economy: -1 }, turnsLeft: 4, source: 'mil_partial_mobilization' }],
        cooldowns: {},
        globalTension: 44,
        pendingEvent: null,
        eventQueue: [],
        recentActions: [
            { turn: 2, actorId: 'BRA', actionId: 'eco_stimulus', targetId: null, success: true, source: 'ui', summary: 'Estímulo econômico aprovado (sucesso).' },
            { turn: 3, actorId: 'BRA', actionId: 'mil_partial_mobilization', targetId: null, success: true, source: 'order', summary: 'Mobilização parcial decretada' },
            { turn: 3, actorId: 'BRA', actionId: 'dip_improve_relations', targetId: 'ARG', success: false, source: 'order', summary: 'Aproximação com a Argentina' },
        ],
        decisions: [{ turn: 2, eventTitle: 'Cúpula do BRICS', optionLabel: 'Defender a desdolarização' }],
        news: [
            { turn: 2, date: { year: 2026, month: 9 }, text: 'Bolsa de São Paulo fecha em alta', kind: 'economy', nations: ['BRA'] },
            { turn: 3, date: { year: 2026, month: 10 }, text: 'Rússia avança no Donbas', kind: 'war', nations: ['RUS', 'UKR'] },
            { turn: 3, date: { year: 2026, month: 10 }, text: 'China realiza exercícios perto de Taiwan', kind: 'crisis', nations: ['CHN', 'TWN'] },
        ],
        log: [],
        outcome: null,
        flags: {},
    };
    return { ...state, ...overrides };
}

export function makeReport(overrides = {}) {
    return {
        turn: 3,
        date: { year: 2026, month: 10 },
        pcGained: 3,
        playerDeltas: { economy: -1, military: 2 },
        tensionBefore: 42,
        tensionAfter: 44,
        aiActions: [{ actorId: 'VEN', actionId: 'mil_border_exercises', targetId: 'BRA', success: true, summary: 'Venezuela realiza exercícios na fronteira com o Brasil' }],
        warUpdates: [{ warId: 'w1', summary: 'Rússia avança 3% na Ucrânia' }],
        capitulations: [],
        newCrises: ['c2'],
        resolvedCrises: [],
        headlines: ['Rússia avança no Donbas', 'Venezuela mobiliza tropas perto da Guiana'],
        engineEvents: [],
        outcome: null,
        ...overrides,
    };
}

export const CATALOG = [
    { id: 'mil_partial_mobilization', category: 'military', name: 'Mobilização Parcial', description: 'Convoca reservistas.', icon: 'fa-solid fa-person-rifle', target: 'none', cost: { pc: 3 }, cooldown: 6, chance: null, onSuccess: [], keywords: ['mobilizar', 'reservas', 'tropas'] },
    { id: 'eco_stimulus', category: 'economy', name: 'Estímulo Econômico', description: 'Injeta recursos na economia.', icon: 'fa-solid fa-coins', target: 'none', cost: { pc: 2 }, cooldown: 4, chance: null, onSuccess: [], keywords: ['estímulo'] },
    { id: 'dip_improve_relations', category: 'diplomacy', name: 'Melhorar Relações', description: 'Missão diplomática.', icon: 'fa-solid fa-handshake', target: 'nation', cost: { pc: 1 }, cooldown: 2, chance: { base: 60 }, onSuccess: [], keywords: ['aproximar', 'relações'] },
    { id: 'war_declare', category: 'military', name: 'Declarar Guerra', description: 'Declara guerra.', icon: 'fa-solid fa-skull', target: 'nation', cost: { pc: 5 }, cooldown: 12, chance: null, onSuccess: [], keywords: ['guerra'], confirm: true },
];

/**
 * Mocked EngineAPI subset used by src/llm and command tests.
 * sanitizeEvent mimics the contract: resolves PLAYER, drops unknown effect
 * types / nation ids, enforces OPTION_COUNT, fills defaults.
 */
export function makeEngine({ sanitizeOverride } = {}) {
    const calls = { sanitizeEvent: [], getAvailableActions: [] };
    const engine = {
        calls,
        getCatalog: () => CATALOG,
        getAvailableActions(state, actorId, targetId = null) {
            calls.getAvailableActions.push({ actorId, targetId });
            return CATALOG.map((def) => {
                const needsTarget = def.target === 'nation' && !targetId;
                const blocked = def.id === 'eco_stimulus';
                const reasons = needsTarget ? ['Selecione um alvo'] : blocked ? ['Em recarga (2 meses)'] : [];
                return { def, available: !reasons.length, reasons, chance: 100, cooldownLeft: blocked ? 2 : 0 };
            });
        },
        sanitizeEvent(event, state) {
            calls.sanitizeEvent.push(event);
            if (sanitizeOverride) return sanitizeOverride(event, state);
            const errors = [];
            if (!event || typeof event !== 'object') return { ok: false, value: null, errors: ['not an object'] };
            if (typeof event.title !== 'string' || !event.title.trim()) errors.push('title missing');
            if (typeof event.narrative !== 'string' || !event.narrative.trim()) errors.push('narrative missing');
            const resolve = (id) => (id === 'PLAYER' ? state.player.nationId : id);
            const options = (Array.isArray(event.options) ? event.options : []).slice(0, OPTION_COUNT.MAX).map((o) => ({
                label: String(o.label || ''),
                rationale: String(o.rationale || ''),
                effects: (Array.isArray(o.effects) ? o.effects : [])
                    .filter((e) => e && EFFECT_TYPES.includes(e.type))
                    .map((e) => ({ ...e, ...(e.target ? { target: resolve(e.target) } : {}), ...(e.targetB ? { targetB: resolve(e.targetB) } : {}) }))
                    .filter((e) => (!e.target || state.nations[e.target]) && (!e.targetB || state.nations[e.targetB]))
                    .slice(0, 6),
            }));
            if (options.length < OPTION_COUNT.MIN) errors.push('not enough options');
            if (errors.length) return { ok: false, value: null, errors };
            return {
                ok: true,
                errors: [],
                value: {
                    id: event.id || `llm-${state.turn}`,
                    source: event.source || 'llm',
                    category: EVENT_CATEGORIES.includes(event.category) ? event.category : 'politics',
                    title: event.title,
                    narrative: event.narrative,
                    headlines: Array.isArray(event.headlines) ? event.headlines.slice(0, 3) : [],
                    involved: (event.involved || []).filter((id) => state.nations[id]),
                    options,
                    turn: state.turn,
                },
            };
        },
    };
    return engine;
}

export function validEventJson() {
    return {
        category: 'diplomacy',
        title: 'Caracas testa a fronteira',
        narrative: 'Tropas venezuelanas se aproximam da fronteira com Roraima enquanto Caracas acusa Brasília de ingerência. O gabinete se divide entre a firmeza e a diplomacia.',
        headlines: ['Venezuela movimenta blindados perto de Roraima'],
        involved: ['VEN'],
        options: [
            { label: 'Reforçar a fronteira', rationale: 'Dissuade, mas custa caro.', effects: [{ type: 'resource', target: 'PLAYER', resource: 'military', delta: 3 }, { type: 'relation', target: 'PLAYER', targetB: 'VEN', delta: -10 }] },
            { label: 'Convocar o embaixador', rationale: 'Diplomacia primeiro.', effects: [{ type: 'tension', delta: -2 }] },
        ],
    };
}

/** Recursively freeze (to prove a function does not mutate its input). */
export function deepFreeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        for (const v of Object.values(obj)) deepFreeze(v);
    }
    return obj;
}
