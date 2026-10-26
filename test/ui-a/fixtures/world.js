/**
 * Tiny WorldState fixture for UI-A view-model tests.
 *
 *   AAA  player (NATO)            at war with BBB (BBB occupies 30% of AAA)
 *   BBB  enemy (CSTO, major)      overlord of DDD, annexed EEE
 *   CCC  ally (NATO)              alliance pact with AAA, co-belligerent
 *   DDD  puppet of BBB
 *   EEE  annexed by BBB
 *   FFF  other belligerent        attacks GGG (60%)
 *   GGG  other belligerent
 *   HHH  neutral microstate (NON_ALIGNED)
 */

import { readFileSync } from 'node:fs';

export const MINI_MAP = JSON.parse(readFileSync(new URL('./mini.map.json', import.meta.url), 'utf8'));

const res = (v) => ({ economy: v, military: v, stability: v, influence: v, tech: v, manpower: v, warSupport: v });

function nation(id, name, bloc, extra = {}) {
    return {
        id,
        name,
        flag: '🏳️',
        bloc,
        capital: `Capital de ${name}`,
        government: 'República',
        leaderTitle: 'Presidente',
        playable: true,
        major: false,
        nuclear: 0,
        resources: res(50),
        personality: { aggression: 0.3, diplomacy: 0.5, blocLoyalty: 0.5 },
        traits: [],
        pc: 5,
        status: 'active',
        controller: id,
        overlord: null,
        ...extra,
    };
}

export function makeWorld() {
    return {
        schemaVersion: 2,
        campaignId: 'test',
        seed: 'seed',
        scenarioId: 'modern-ww3',
        bookmarkId: 'b2026',
        turn: 5,
        date: { year: 2027, month: 2 },
        endDate: { year: 2036, month: 10 },
        phase: 'PLAYER_TURN',
        player: { nationId: 'AAA', leaderName: 'Helena Duarte', title: 'Presidente' },
        nations: {
            AAA: nation('AAA', 'Albânia do Sul', 'NATO', { pc: 12 }),
            BBB: nation('BBB', 'Bóreas', 'CSTO', { major: true, nuclear: 2 }),
            CCC: nation('CCC', 'Cária', 'NATO'),
            DDD: nation('DDD', 'Dácia', 'CSTO', { status: 'puppet', overlord: 'BBB' }),
            EEE: nation('EEE', 'Etrúria', 'EU', { status: 'annexed', controller: 'BBB' }),
            FFF: nation('FFF', 'Frígia', 'NON_ALIGNED'),
            GGG: nation('GGG', 'Gália', 'BRICS'),
            HHH: nation('HHH', 'Hespéria', 'NON_ALIGNED'),
        },
        relations: { 'AAA|BBB': -80, 'AAA|CCC': 70, 'AAA|FFF': 30, 'AAA|GGG': -40, 'AAA|HHH': 0, 'AAA|DDD': -10 },
        pacts: [
            { id: 'p1', type: 'alliance', name: 'Aliança do Norte', members: ['AAA', 'CCC'], startedTurn: 0, expiresTurn: null },
            { id: 'p2', type: 'trade', name: 'Acordo Comercial', members: ['AAA', 'HHH'], startedTurn: 0, expiresTurn: null },
        ],
        wars: [
            {
                id: 'w1', name: 'Guerra Boreal', attackers: ['BBB'], defenders: ['AAA', 'CCC'], startedTurn: 2,
                fronts: [{ attacker: 'BBB', defender: 'AAA', progress: 30 }, { attacker: 'BBB', defender: 'CCC', progress: 0 }],
                score: 20, exhaustion: { BBB: 30, AAA: 45, CCC: 10 }, ceasefire: false,
            },
            {
                id: 'w2', name: 'Guerra Frígia', attackers: ['FFF'], defenders: ['GGG'], startedTurn: 4,
                fronts: [{ attacker: 'FFF', defender: 'GGG', progress: 60 }],
                score: 40, exhaustion: { FFF: 20, GGG: 50 }, ceasefire: false,
            },
        ],
        crises: [
            { id: 'c1', title: 'Crise dos Estreitos', description: 'Navios bloqueados.', severity: 'high', involved: ['BBB', 'AAA'], turnStarted: 3 },
            { id: 'c2', title: 'Protestos em Hespéria', description: 'Ruas tomadas.', severity: 'low', involved: ['HHH'], turnStarted: 5 },
            { id: 'c3', title: 'Alerta Nuclear', description: 'Silos abertos.', severity: 'critical', involved: ['BBB'], turnStarted: 4 },
        ],
        modifiers: [],
        cooldowns: {},
        globalTension: 55,
        pendingEvent: null,
        eventQueue: [],
        recentActions: [],
        decisions: [],
        news: [
            { turn: 4, date: { year: 2027, month: 1 }, text: 'Bóreas invade Albânia do Sul', kind: 'war', nations: ['BBB', 'AAA'] },
            { turn: 5, date: { year: 2027, month: 2 }, text: 'Governo decreta mobilização', kind: 'player', nations: ['AAA'] },
        ],
        log: [],
        outcome: null,
        flags: {},
    };
}

/** Minimal ActionDef factory. */
export function def(id, extra = {}) {
    return {
        id,
        category: 'diplomacy',
        name: id,
        description: `Descrição de ${id}`,
        icon: 'fa-solid fa-handshake',
        target: 'none',
        cost: { pc: 1 },
        cooldown: 2,
        chance: { base: 50 },
        onSuccess: [],
        ...extra,
    };
}
