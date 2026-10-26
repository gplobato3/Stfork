/**
 * @file test/engine/fixtures.js
 * Hand-written ScenarioData for engine tests (independent of the scenario module):
 * 15 nations incl. nuclear majors, an OTAN-like alliance, the ongoing Russia-Ukraine
 * war, crises and three bookmarks. buildLargeScenario() pads it with generated minors
 * to ~180 nations for performance tests.
 */

const P = (aggression, diplomacy, blocLoyalty) => ({ aggression, diplomacy, blocLoyalty });
const R = (economy, military, stability, influence, tech, manpower, warSupport) => ({ economy, military, stability, influence, tech, manpower, warSupport });

function nation(id, name, flag, bloc, capital, government, leaderTitle, { major = false, playable = true, nuclear = 0, resources, personality, traits = [], difficulty = 'normal' }) {
    return {
        id,
        name,
        flag,
        bloc,
        capital,
        government,
        leaderTitle,
        playable,
        major,
        nuclear,
        resources,
        personality,
        traits,
        blurb: `${name} em um mundo à beira da guerra.`,
        difficulty,
        pc: 0,
        status: 'active',
        controller: id,
        overlord: null,
    };
}

export function buildScenario() {
    const nations = {
        USA: nation('USA', 'Estados Unidos', '🇺🇸', 'NATO', 'Washington', 'República Federal Presidencialista', 'Presidente', {
            major: true, nuclear: 2, resources: R(88, 92, 62, 90, 92, 70, 45), personality: P(0.45, 0.65, 0.8), traits: ['Superpotência', 'Potência Nuclear'], difficulty: 'facil',
        }),
        RUS: nation('RUS', 'Rússia', '🇷🇺', 'CSTO', 'Moscou', 'República Federal Semipresidencialista', 'Presidente', {
            major: true, nuclear: 2, resources: R(50, 82, 55, 62, 64, 75, 62), personality: P(0.8, 0.3, 0.6), traits: ['Potência Nuclear', 'Exportador de Energia'],
        }),
        CHN: nation('CHN', 'China', '🇨🇳', 'BRICS', 'Pequim', 'Estado Socialista de Partido Único', 'Presidente', {
            major: true, nuclear: 2, resources: R(84, 84, 70, 78, 80, 92, 55), personality: P(0.5, 0.55, 0.5), traits: ['Superpotência', 'Fábrica do Mundo'],
        }),
        FRA: nation('FRA', 'França', '🇫🇷', 'NATO', 'Paris', 'República Semipresidencialista', 'Presidente', {
            major: true, nuclear: 1, resources: R(72, 66, 55, 70, 76, 50, 40), personality: P(0.35, 0.7, 0.75), traits: ['Potência Nuclear'],
        }),
        DEU: nation('DEU', 'Alemanha', '🇩🇪', 'NATO', 'Berlim', 'República Federal Parlamentarista', 'Chanceler', {
            major: true, resources: R(80, 52, 64, 72, 80, 50, 30), personality: P(0.2, 0.8, 0.8), traits: ['Motor da Europa'],
        }),
        POL: nation('POL', 'Polônia', '🇵🇱', 'NATO', 'Varsóvia', 'República Parlamentarista', 'Presidente', {
            resources: R(58, 56, 62, 45, 55, 52, 58), personality: P(0.4, 0.55, 0.85), traits: ['Flanco Leste da OTAN'],
        }),
        UKR: nation('UKR', 'Ucrânia', '🇺🇦', 'NON_ALIGNED', 'Kiev', 'República Semipresidencialista', 'Presidente', {
            resources: R(28, 58, 42, 45, 45, 55, 85), personality: P(0.45, 0.6, 0.6), traits: ['Nação em Guerra'], difficulty: 'dificil',
        }),
        BLR: nation('BLR', 'Belarus', '🇧🇾', 'CSTO', 'Minsk', 'República Presidencialista Autoritária', 'Presidente', {
            playable: false, resources: R(30, 35, 50, 20, 35, 30, 35), personality: P(0.3, 0.3, 0.9),
        }),
        TWN: nation('TWN', 'Taiwan', '🇹🇼', 'NON_ALIGNED', 'Taipé', 'República Semipresidencialista', 'Presidente', {
            resources: R(70, 50, 66, 40, 85, 35, 55), personality: P(0.2, 0.6, 0.6), traits: ['Semicondutores'],
        }),
        JPN: nation('JPN', 'Japão', '🇯🇵', 'NON_ALIGNED', 'Tóquio', 'Monarquia Constitucional Parlamentarista', 'Primeiro-Ministro', {
            major: true, resources: R(78, 55, 70, 65, 86, 45, 30), personality: P(0.25, 0.7, 0.75), traits: ['Potência Tecnológica'],
        }),
        IND: nation('IND', 'Índia', '🇮🇳', 'BRICS', 'Nova Délhi', 'República Federal Parlamentarista', 'Primeiro-Ministro', {
            major: true, nuclear: 1, resources: R(66, 70, 58, 62, 60, 95, 55), personality: P(0.45, 0.6, 0.4), traits: ['Potência Nuclear'],
        }),
        PAK: nation('PAK', 'Paquistão', '🇵🇰', 'NON_ALIGNED', 'Islamabad', 'República Parlamentarista', 'Primeiro-Ministro', {
            nuclear: 1, resources: R(30, 58, 38, 30, 38, 70, 60), personality: P(0.6, 0.4, 0.5), traits: ['Potência Nuclear'],
        }),
        IRN: nation('IRN', 'Irã', '🇮🇷', 'BRICS', 'Teerã', 'República Teocrática', 'Líder Supremo', {
            major: true, resources: R(38, 55, 45, 45, 48, 65, 60), personality: P(0.65, 0.35, 0.5), traits: ['Exportador de Petróleo'],
        }),
        ISR: nation('ISR', 'Israel', '🇮🇱', 'NON_ALIGNED', 'Jerusalém', 'República Parlamentarista', 'Primeiro-Ministro', {
            major: true, nuclear: 1, resources: R(66, 72, 52, 50, 84, 35, 70), personality: P(0.6, 0.45, 0.6), traits: ['Potência Nuclear'],
        }),
        BRA: nation('BRA', 'Brasil', '🇧🇷', 'BRICS', 'Brasília', 'República Federal Presidencialista', 'Presidente', {
            major: true, resources: R(58, 48, 52, 55, 48, 68, 25), personality: P(0.2, 0.75, 0.4), traits: ['Potência Agrícola'],
        }),
    };
    const relations = {
        'RUS|USA': -60, 'CHN|USA': -35, 'FRA|USA': 70, 'DEU|USA': 70, 'POL|USA': 75, 'UKR|USA': 65, 'JPN|USA': 80, 'TWN|USA': 60,
        'IND|USA': 35, 'PAK|USA': 0, 'IRN|USA': -75, 'ISR|USA': 80, 'BRA|USA': 25, 'BLR|USA': -50,
        'CHN|RUS': 55, 'RUS|UKR': -90, 'BLR|RUS': 80, 'POL|RUS': -70, 'FRA|RUS': -50, 'DEU|RUS': -45, 'JPN|RUS': -40, 'IND|RUS': 40,
        'IRN|RUS': 50, 'BRA|RUS': 20, 'ISR|RUS': -10, 'PAK|RUS': 10, 'RUS|TWN': -20,
        'CHN|TWN': -65, 'CHN|JPN': -45, 'CHN|IND': -40, 'CHN|PAK': 70, 'CHN|IRN': 40, 'BRA|CHN': 45, 'CHN|FRA': -10, 'CHN|DEU': 10,
        'CHN|POL': -10, 'CHN|UKR': 0, 'CHN|ISR': 0, 'BLR|CHN': 40,
        'IND|PAK': -70, 'IRN|ISR': -90, 'POL|UKR': 70, 'BLR|POL': -55, 'BLR|UKR': -60, 'DEU|FRA': 80, 'DEU|POL': 65, 'FRA|POL': 60,
        'FRA|UKR': 55, 'DEU|UKR': 55, 'JPN|TWN': 50, 'IRN|PAK': 10, 'BRA|IND': 40, 'BRA|FRA': 35, 'BRA|DEU': 35, 'IND|ISR': 40, 'ISR|PAK': -40,
    };
    const pacts = [
        { id: 'otan', type: 'alliance', name: 'OTAN', members: ['USA', 'FRA', 'DEU', 'POL'], startedTurn: 0, expiresTurn: null },
        { id: 'otsc', type: 'alliance', name: 'OTSC', members: ['RUS', 'BLR'], startedTurn: 0, expiresTurn: null },
        { id: 'usa-jpn', type: 'defense', name: 'Tratado de Segurança EUA–Japão', members: ['USA', 'JPN'], startedTurn: 0, expiresTurn: null },
        { id: 'usa-twn', type: 'guarantee', name: 'Lei de Relações com Taiwan', members: ['USA', 'TWN'], startedTurn: 0, expiresTurn: null },
        { id: 'chn-pak', type: 'trade', name: 'Corredor Econômico China–Paquistão', members: ['CHN', 'PAK'], startedTurn: 0, expiresTurn: null },
        { id: 'bra-chn', type: 'trade', name: 'Acordo Comercial Brasil–China', members: ['BRA', 'CHN'], startedTurn: 0, expiresTurn: null },
    ];
    const wars = [
        {
            id: 'guerra-rus-ukr',
            name: 'Guerra Russo-Ucraniana',
            attackers: ['RUS'],
            defenders: ['UKR'],
            startedTurn: -48,
            fronts: [{ attacker: 'RUS', defender: 'UKR', progress: 18 }],
            score: 18,
            exhaustion: { RUS: 35, UKR: 45 },
            ceasefire: false,
        },
    ];
    const crises = [
        { id: 'crise-taiwan', title: 'Tensão no Estreito de Taiwan', description: 'Exercícios militares chineses cercam a ilha.', severity: 'medium', involved: ['CHN', 'TWN', 'USA'], turnStarted: 0, category: 'naval' },
        { id: 'crise-ira', title: 'Programa Nuclear Iraniano', description: 'O Irã acelera o enriquecimento de urânio.', severity: 'high', involved: ['IRN', 'ISR', 'USA'], turnStarted: 0, category: 'nuclear' },
        { id: 'crise-caxemira', title: 'Disputa na Caxemira', description: 'Escaramuças na linha de controle.', severity: 'low', involved: ['IND', 'PAK'], turnStarted: 0, category: 'military' },
    ];
    const bookmarks = [
        {
            id: 'b2026',
            name: 'O Mundo Hoje',
            date: { year: 2026, month: 1 },
            endDate: { year: 2036, month: 1 },
            description: 'O mundo em 2026.',
            art: 'bookmark-b2026',
            tension: 42,
            recommended: ['BRA', 'USA', 'UKR'],
            overrides: {},
        },
        {
            id: 'b2028',
            name: 'À Beira do Abismo',
            date: { year: 2028, month: 6 },
            endDate: { year: 2038, month: 6 },
            description: 'Bloqueio de Taiwan e incidentes no Báltico.',
            art: 'bookmark-b2028',
            tension: 62,
            recommended: ['TWN', 'POL'],
            overrides: {
                relations: { 'CHN|TWN': -85, 'POL|RUS': -85, 'CHN|USA': -55 },
                crises: [
                    { id: 'crise-bloqueio', title: 'Bloqueio Naval de Taiwan', description: 'A Marinha chinesa intercepta navios.', severity: 'high', involved: ['CHN', 'TWN', 'USA', 'JPN'], turnStarted: 0, category: 'naval' },
                    { id: 'crise-baltico', title: 'Incidentes no Báltico', description: 'Caças russos violam o espaço aéreo polonês.', severity: 'high', involved: ['RUS', 'POL', 'DEU'], turnStarted: 0, category: 'military' },
                    { id: 'crise-ira', title: 'Programa Nuclear Iraniano', description: 'O Irã anuncia urânio a 90%.', severity: 'critical', involved: ['IRN', 'ISR', 'USA'], turnStarted: 0, category: 'nuclear' },
                ],
                nations: { CHN: { resources: { warSupport: 65 } }, TWN: { resources: { stability: 55 } } },
            },
        },
        {
            id: 'b2031',
            name: 'A Terceira Guerra Mundial',
            date: { year: 2031, month: 3 },
            endDate: { year: 2041, month: 3 },
            description: 'A guerra mundial já começou.',
            art: 'bookmark-b2031',
            tension: 84,
            recommended: ['USA', 'CHN', 'RUS'],
            overrides: {
                nations: {
                    RUS: { resources: { warSupport: 75, economy: 40 } },
                    CHN: { resources: { warSupport: 70 } },
                    USA: { resources: { warSupport: 65 } },
                    TWN: { resources: { stability: 40 } },
                },
                relations: { 'CHN|USA': -85, 'CHN|JPN': -80, 'CHN|TWN': -95, 'RUS|USA': -90 },
                wars: [
                    {
                        id: 'ww3-europa',
                        name: 'Terceira Guerra Mundial — Frente Europeia',
                        attackers: ['RUS', 'BLR'],
                        defenders: ['UKR', 'POL', 'DEU', 'FRA', 'USA'],
                        startedTurn: -6,
                        fronts: [
                            { attacker: 'RUS', defender: 'UKR', progress: 40 },
                            { attacker: 'RUS', defender: 'POL', progress: 12 },
                            { attacker: 'BLR', defender: 'POL', progress: 5 },
                        ],
                        exhaustion: { RUS: 40, BLR: 30, UKR: 55, POL: 20, DEU: 10, FRA: 10, USA: 10 },
                    },
                    {
                        id: 'ww3-pacifico',
                        name: 'Terceira Guerra Mundial — Frente do Pacífico',
                        attackers: ['CHN'],
                        defenders: ['TWN', 'USA', 'JPN'],
                        startedTurn: -3,
                        fronts: [{ attacker: 'CHN', defender: 'TWN', progress: 30 }],
                        exhaustion: { CHN: 20, TWN: 30, USA: 10, JPN: 10 },
                    },
                ],
                crises: [
                    { id: 'crise-nuclear-europa', title: 'Ameaça Nuclear na Europa', description: 'Moscou ameaça usar armas táticas.', severity: 'critical', involved: ['RUS', 'USA', 'FRA'], turnStarted: 0, category: 'nuclear' },
                    { id: 'crise-bloqueio', title: 'Bloqueio Naval de Taiwan', description: 'A ilha está cercada.', severity: 'high', involved: ['CHN', 'TWN', 'USA', 'JPN'], turnStarted: 0, category: 'naval' },
                ],
            },
        },
    ];
    const neighbors = {
        USA: [],
        RUS: ['UKR', 'BLR', 'POL', 'CHN', 'JPN'],
        CHN: ['RUS', 'IND', 'PAK', 'TWN', 'JPN'],
        FRA: ['DEU'],
        DEU: ['FRA', 'POL'],
        POL: ['DEU', 'UKR', 'BLR', 'RUS'],
        UKR: ['RUS', 'BLR', 'POL'],
        BLR: ['RUS', 'UKR', 'POL'],
        TWN: ['CHN', 'JPN'],
        JPN: ['CHN', 'RUS', 'TWN'],
        IND: ['CHN', 'PAK'],
        PAK: ['IND', 'CHN', 'IRN'],
        IRN: ['PAK'],
        ISR: [],
        BRA: [],
    };
    return { id: 'teste-ww3', name: 'Cenário de Teste', nations, relations, pacts, wars, crises, bookmarks, neighbors };
}

/**
 * The base scenario padded with generated minors (deterministic) up to `total` nations.
 * Minors sit on a ring of neighbors and touch a few authored nations.
 */
export function buildLargeScenario(total = 180) {
    const sc = buildScenario();
    const authored = Object.keys(sc.nations);
    const minors = [];
    for (let i = 1; sc.nations && authored.length + minors.length < total; i++) {
        const id = `M${String(i).padStart(2, '0')}`;
        minors.push(id);
        const k = (i * 37) % 100;
        sc.nations[id] = nation(id, `Minoria ${i}`, '🏳️', ['NON_ALIGNED', 'BRICS', 'EU', 'NATO'][i % 4], `Capital ${i}`, 'República Presidencialista', 'Presidente', {
            playable: false,
            resources: R(20 + (k % 30), 15 + ((k * 3) % 30), 35 + ((k * 7) % 40), 10 + (k % 20), 15 + ((k * 5) % 30), 15 + ((k * 11) % 35), 30 + (k % 25)),
            personality: P(0.15 + (k % 30) / 100, 0.5, 0.4),
        });
        sc.neighbors[id] = [];
    }
    minors.forEach((id, i) => {
        const next = minors[(i + 1) % minors.length];
        sc.neighbors[id].push(next);
        if (i % 9 === 0) {
            const a = authored[i % authored.length];
            sc.neighbors[id].push(a);
        }
        const rival = minors[(i + 5) % minors.length];
        if (i % 4 === 0) sc.relations[[id, rival].sort().join('|')] = -55;
    });
    return sc;
}
