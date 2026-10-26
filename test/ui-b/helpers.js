/**
 * test/ui-b/helpers.js — small WorldState for UI-B unit tests.
 * Player: Brasil (BRICS). Argentina = ally (defense pact), Venezuela = enemy
 * (at war), China = friend (relation 35), EUA = neutral (20), Rússia = rival (-40).
 */

const n = (id, name, bloc, extra = {}) => ({
    id, name, bloc, flag: '', playable: true, major: false, nuclear: 0,
    resources: { economy: 50, military: 50, stability: 50, influence: 50, tech: 50, manpower: 50, warSupport: 50 },
    personality: { aggression: 0.5, diplomacy: 0.5, blocLoyalty: 0.5 }, traits: [], pc: 5, status: 'active', controller: id, overlord: null,
    ...extra,
});

export function makeState() {
    return {
        schemaVersion: 2,
        campaignId: 't',
        seed: 't',
        scenarioId: 't',
        bookmarkId: 'b2026',
        turn: 14,
        date: { year: 2027, month: 11 },
        endDate: { year: 2036, month: 10 },
        phase: 'PLAYER_TURN',
        player: { nationId: 'BRA', leaderName: 'Helena Duarte', title: 'Presidente' },
        nations: {
            BRA: n('BRA', 'Brasil', 'BRICS', { pc: 12 }),
            ARG: n('ARG', 'Argentina', 'NON_ALIGNED'),
            VEN: n('VEN', 'Venezuela', 'NON_ALIGNED'),
            CHN: n('CHN', 'China', 'BRICS'),
            USA: n('USA', 'Estados Unidos', 'NATO'),
            RUS: n('RUS', 'Rússia', 'CSTO'),
            UKR: n('UKR', 'Ucrânia', 'NON_ALIGNED'),
        },
        relations: { 'ARG|BRA': 65, 'BRA|VEN': -40, 'BRA|CHN': 35, 'BRA|USA': 20, 'BRA|RUS': -40 },
        pacts: [{ id: 'p1', type: 'defense', name: 'Pacto do Prata', members: ['BRA', 'ARG'], startedTurn: 1, expiresTurn: null }],
        wars: [{
            id: 'w1', name: 'Guerra de Roraima', attackers: ['VEN'], defenders: ['BRA'], startedTurn: 10,
            fronts: [{ attacker: 'VEN', defender: 'BRA', progress: 5 }], score: 0, exhaustion: {}, ceasefire: false,
        }],
        crises: [{ id: 'c1', title: 'Transição na Venezuela', description: '', severity: 'medium', involved: ['VEN'], turnStarted: 1 }],
        modifiers: [],
        cooldowns: {},
        globalTension: 57,
        pendingEvent: null,
        eventQueue: [],
        recentActions: [],
        decisions: [],
        news: [],
        log: [],
        outcome: null,
        flags: {},
    };
}

export const MINUS = '\u2212';
