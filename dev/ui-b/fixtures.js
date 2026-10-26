/**
 * dev/ui-b/fixtures.js — sample data for the UI-B preview harness and tests.
 * A small ScenarioData (14 authored nations, 3 bookmarks with overrides), a
 * WorldState and GameEvents that exercise every effect type.
 */

const R = (economy, military, stability, influence, tech, manpower, warSupport) => ({ economy, military, stability, influence, tech, manpower, warSupport });
const P = (aggression, diplomacy, blocLoyalty) => ({ aggression, diplomacy, blocLoyalty });

function nation(id, name, flag, bloc, capital, government, leaderTitle, major, nuclear, resources, personality, traits, blurb, difficulty) {
    return {
        id, name, flag, bloc, capital, government, leaderTitle, playable: true, major, nuclear, resources, personality, traits, blurb, difficulty,
        pc: 6, status: 'active', controller: id, overlord: null,
    };
}

export const NATIONS = {
    USA: nation('USA', 'Estados Unidos', '🇺🇸', 'NATO', 'Washington, D.C.', 'República Federal Presidencialista', 'Presidente', true, 2,
        R(92, 97, 52, 92, 96, 74, 42), P(0.55, 0.5, 0.55), ['Superpotência Global', 'Potência Nuclear', 'Polarização Interna'],
        'Maior economia e maior força militar do planeta, com bases e alianças em todos os continentes.', 'facil'),
    CHN: nation('CHN', 'China', '🇨🇳', 'BRICS', 'Pequim', 'República Socialista de Partido Único', 'Presidente', true, 2,
        R(88, 88, 70, 84, 86, 95, 55), P(0.5, 0.55, 0.6), ['Fábrica do Mundo', 'Potência Nuclear', 'Ambição Naval'],
        'Segunda economia do mundo, aposta na modernização acelerada do Exército de Libertação Popular e na pressão sobre Taiwan.', 'facil'),
    RUS: nation('RUS', 'Rússia', '🇷🇺', 'CSTO', 'Moscou', 'República Federal Semipresidencialista', 'Presidente', true, 2,
        R(50, 78, 55, 66, 66, 64, 58), P(0.75, 0.35, 0.6), ['Maior Arsenal Nuclear', 'Economia de Guerra', 'Sanções Ocidentais'],
        'Quinto ano de guerra na Ucrânia, economia voltada ao front e o maior arsenal nuclear do mundo.', 'normal'),
    UKR: nation('UKR', 'Ucrânia', '🇺🇦', 'NON_ALIGNED', 'Kiev', 'República Semipresidencialista', 'Presidente', false, 0,
        R(30, 60, 48, 52, 52, 40, 70), P(0.4, 0.6, 0.7), ['Nação em Guerra', 'Apoio Ocidental', 'Indústria de Drones'],
        'Resiste à invasão russa com apoio ocidental e uma indústria de drones que se reinventa a cada mês.', 'dificil'),
    BRA: nation('BRA', 'Brasil', '🇧🇷', 'BRICS', 'Brasília', 'República Federal Presidencialista', 'Presidente', true, 0,
        R(62, 48, 55, 62, 50, 70, 30), P(0.2, 0.8, 0.4), ['Potência Agrícola', 'Liderança Regional', 'Amazônia'],
        'Maior economia da América Latina, tradição diplomática de mediação e uma posição de equilíbrio entre Washington e Pequim.', 'normal'),
    ARG: nation('ARG', 'Argentina', '🇦🇷', 'NON_ALIGNED', 'Buenos Aires', 'República Federal Presidencialista', 'Presidente', false, 0,
        R(40, 32, 44, 40, 46, 40, 30), P(0.25, 0.6, 0.4), ['Ajuste Econômico', 'Lítio', 'Reivindicação das Malvinas'],
        'Em meio a um duro programa de ajuste, aposta em lítio, Vaca Muerta e alinhamento com Washington.', 'dificil'),
    VEN: nation('VEN', 'Venezuela', '🇻🇪', 'NON_ALIGNED', 'Caracas', 'República Federal Presidencialista', 'Presidente', false, 0,
        R(20, 34, 26, 24, 22, 34, 40), P(0.5, 0.3, 0.5), ['Maiores Reservas de Petróleo', 'Transição Incerta'],
        'Dona das maiores reservas de petróleo do mundo, vive uma transição política frágil sob forte pressão externa.', 'dificil'),
    DEU: nation('DEU', 'Alemanha', '🇩🇪', 'NATO', 'Berlim', 'República Parlamentarista Federal', 'Chanceler', true, 0,
        R(80, 58, 62, 76, 86, 50, 34), P(0.2, 0.8, 0.75), ['Potência Industrial', 'Rearmamento', 'Dependência Energética'],
        'Motor econômico da Europa, acelera o rearmamento enquanto busca energia fora da Rússia.', 'normal'),
    FRA: nation('FRA', 'França', '🇫🇷', 'NATO', 'Paris', 'República Semipresidencialista', 'Presidente', true, 1,
        R(76, 74, 50, 78, 84, 50, 42), P(0.4, 0.7, 0.65), ['Potência Nuclear', 'Autonomia Estratégica'],
        'Única potência nuclear da União Europeia, defende a autonomia estratégica do continente.', 'normal'),
    GBR: nation('GBR', 'Reino Unido', '🇬🇧', 'NATO', 'Londres', 'Monarquia Constitucional Parlamentarista', 'Primeiro-Ministro', true, 1,
        R(76, 72, 56, 80, 84, 48, 44), P(0.4, 0.65, 0.8), ['Potência Nuclear', 'Centro Financeiro'],
        'Centro financeiro global e aliado mais próximo de Washington.', 'normal'),
    IND: nation('IND', 'Índia', '🇮🇳', 'BRICS', 'Nova Délhi', 'República Parlamentarista Federal', 'Primeiro-Ministro', true, 1,
        R(72, 76, 60, 70, 68, 98, 52), P(0.35, 0.65, 0.35), ['Nação Mais Populosa', 'Potência Nuclear', 'Equilíbrio Estratégico'],
        'Nação mais populosa do planeta, cresce rápido e joga com todos os lados.', 'facil'),
    IRN: nation('IRN', 'Irã', '🇮🇷', 'NON_ALIGNED', 'Teerã', 'República Islâmica', 'Líder Supremo', true, 0,
        R(36, 58, 40, 50, 48, 66, 56), P(0.65, 0.35, 0.5), ['Programa Nuclear', 'Eixo da Resistência', 'Estreito de Ormuz'],
        'Sob sanções e após confrontos diretos com Israel e EUA, segura um armistício frágil em torno de Ormuz.', 'dificil'),
    TWN: nation('TWN', 'Taiwan', '🇹🇼', 'NON_ALIGNED', 'Taipé', 'República Semipresidencialista', 'Presidente', false, 0,
        R(70, 54, 58, 46, 92, 32, 56), P(0.15, 0.6, 0.8), ['Semicondutores', 'Ilha Fortaleza'],
        'Coração da indústria mundial de chips, vive sob a ameaça constante de um bloqueio.', 'dificil'),
    JPN: nation('JPN', 'Japão', '🇯🇵', 'NON_ALIGNED', 'Tóquio', 'Monarquia Constitucional Parlamentarista', 'Primeiro-Ministro', true, 0,
        R(80, 62, 70, 72, 90, 50, 30), P(0.25, 0.7, 0.75), ['Alta Tecnologia', 'Rearmamento', 'Aliança com os EUA'],
        'Terceira economia do mundo, revisa a postura pacifista diante da China e da Coreia do Norte.', 'normal'),
};

export const RELATIONS = {
    'BRA|USA': 20, 'BRA|CHN': 35, 'ARG|BRA': 30, 'BRA|VEN': -35, 'CHN|USA': -55, 'RUS|USA': -70, 'RUS|UKR': -95,
    'CHN|RUS': 60, 'CHN|TWN': -70, 'TWN|USA': 55, 'IRN|USA': -80, 'DEU|FRA': 70, 'GBR|USA': 80, 'IND|RUS': 30,
    'BRA|RUS': 5, 'BRA|IND': 30, 'BRA|DEU': 25, 'BRA|FRA': 25, 'JPN|USA': 75, 'CHN|JPN': -50,
};

export const PACTS = [
    { id: 'pact-nato', type: 'alliance', name: 'OTAN', members: ['USA', 'DEU', 'FRA', 'GBR'], startedTurn: 0, expiresTurn: null },
    { id: 'pact-brics', type: 'trade', name: 'BRICS', members: ['BRA', 'CHN', 'RUS', 'IND', 'IRN'], startedTurn: 0, expiresTurn: null },
    { id: 'pact-mercosul', type: 'trade', name: 'Mercosul', members: ['BRA', 'ARG'], startedTurn: 0, expiresTurn: null },
    { id: 'pact-usjp', type: 'defense', name: 'Tratado de Segurança EUA-Japão', members: ['USA', 'JPN'], startedTurn: 0, expiresTurn: null },
];

export const WARS = [
    {
        id: 'war-rus-ukr', name: 'Guerra Russo-Ucraniana', attackers: ['RUS'], defenders: ['UKR'], startedTurn: 0,
        fronts: [{ attacker: 'RUS', defender: 'UKR', progress: 20 }], score: 12, exhaustion: { RUS: 48, UKR: 62 }, ceasefire: false,
    },
];

export const CRISES = [
    { id: 'crisis-hormuz', title: 'Armistício de Ormuz', description: 'Trégua frágil entre Irã, Israel e EUA.', severity: 'high', involved: ['IRN', 'USA'], turnStarted: 0, category: 'naval' },
    { id: 'crisis-ven', title: 'Transição na Venezuela', description: 'Disputa de poder em Caracas.', severity: 'medium', involved: ['VEN', 'BRA', 'USA'], turnStarted: 0, category: 'politics' },
];

export const BOOKMARKS = [
    {
        id: 'b2026', name: 'O Mundo Hoje', date: { year: 2026, month: 10 }, endDate: { year: 2036, month: 10 },
        description: 'A guerra na Ucrânia entra no quinto ano, um armistício frágil segura Ormuz e a Venezuela vive uma transição incerta. Nenhuma grande potência está em guerra com outra, por enquanto.',
        art: 'bookmark-b2026', tension: 42, recommended: ['BRA', 'USA', 'CHN', 'RUS', 'UKR', 'IND'], overrides: {},
    },
    {
        id: 'b2028', name: 'À Beira do Abismo', date: { year: 2028, month: 3 }, endDate: { year: 2038, month: 3 },
        description: 'Um cessar-fogo armado congelou a Ucrânia, mas a Rússia testa a OTAN no Báltico. Pequim impôs uma quarentena naval a Taiwan e comboios escoltados desafiam o cerco.',
        art: 'bookmark-b2028', tension: 62, recommended: ['BRA', 'USA', 'CHN', 'TWN', 'JPN'],
        overrides: {
            nations: {
                TWN: { resources: { economy: 62, military: 60, stability: 50, warSupport: 66 } },
                CHN: { resources: { military: 90, warSupport: 64 } },
                RUS: { resources: { economy: 44, military: 74 } },
            },
            relations: { 'CHN|TWN': -90, 'CHN|USA': -75 },
            wars: [{ ...WARS[0], ceasefire: true }],
            crises: [
                ...CRISES,
                { id: 'crisis-taiwan', title: 'Quarentena naval de Taiwan', description: 'Marinha chinesa inspeciona navios rumo a Taiwan.', severity: 'critical', involved: ['CHN', 'TWN', 'USA', 'JPN'], turnStarted: 0, category: 'naval' },
            ],
        },
    },
    {
        id: 'b2031', name: 'A Terceira Guerra Mundial', date: { year: 2031, month: 6 }, endDate: { year: 2041, month: 6 },
        description: 'O bloqueio de Taiwan virou guerra aberta. OTAN e aliados enfrentam a coalizão sino-russa em múltiplas frentes, e cada mês traz um novo patamar de escalada.',
        art: 'bookmark-b2031', tension: 84, recommended: ['USA', 'CHN', 'RUS', 'TWN', 'DEU', 'BRA'],
        overrides: {
            nations: {
                USA: { resources: { economy: 78, warSupport: 70 } },
                CHN: { resources: { economy: 70, warSupport: 74 } },
                TWN: { resources: { economy: 40, stability: 38 } },
            },
            pacts: [
                { id: 'pact-nato', type: 'alliance', name: 'OTAN', members: ['USA', 'DEU', 'FRA', 'GBR', 'JPN'], startedTurn: 0, expiresTurn: null },
                { id: 'pact-axis', type: 'alliance', name: 'Coalizão Eurasiana', members: ['CHN', 'RUS', 'IRN'], startedTurn: 0, expiresTurn: null },
            ],
            wars: [
                {
                    id: 'war-ww3', name: 'Terceira Guerra Mundial', attackers: ['CHN', 'RUS'], defenders: ['TWN', 'USA', 'JPN', 'UKR'], startedTurn: 0,
                    fronts: [
                        { attacker: 'CHN', defender: 'TWN', progress: 34 },
                        { attacker: 'RUS', defender: 'UKR', progress: 41 },
                    ],
                    score: 8, exhaustion: { CHN: 30, RUS: 60, TWN: 55, USA: 25, JPN: 22, UKR: 70 }, ceasefire: false,
                },
            ],
            crises: [],
        },
    },
];

/** @type {import('../../src/contract/interfaces.js').ScenarioData} */
export const SCENARIO = {
    id: 'modern-ww3-preview',
    name: 'Grande Estratégia — prévia',
    nations: NATIONS,
    relations: RELATIONS,
    pacts: PACTS,
    wars: WARS,
    crises: CRISES,
    bookmarks: BOOKMARKS,
    neighbors: { BRA: ['ARG', 'VEN'], ARG: ['BRA'], VEN: ['BRA'], RUS: ['UKR', 'CHN'], UKR: ['RUS'] },
};

/** Sample GameEvent: every effect type appears in some option. */
export const EVENT_ALL_EFFECTS = {
    id: 'evt-preview-1',
    source: 'llm',
    category: 'military',
    turn: 14,
    title: 'Tropas Venezuelanas na Fronteira de Roraima',
    narrative: 'Imagens de satélite confirmam a chegada de duas brigadas blindadas venezuelanas a menos de 30 quilômetros de Pacaraima. Caracas fala em "exercícios de rotina", mas o Itamaraty recebeu relatos de incursões de drones sobre território brasileiro durante a madrugada.\n\nNo Palácio do Planalto, o Ministro da Defesa defende uma resposta imediata, enquanto o chanceler insiste que uma mediação regional ainda é possível. Em Buenos Aires, a Casa Rosada oferece apoio diplomático. Os mercados reagem com nervosismo e o real recua frente ao dólar.',
    headlines: [
        'Caracas nega incursões e acusa Brasília de "histeria midiática"',
        'Petróleo sobe 4% com temor de conflito no norte da América do Sul',
        'Argentina oferece sediar conversas de paz em Buenos Aires',
    ],
    involved: ['BRA', 'VEN', 'ARG', 'USA'],
    options: [
        {
            label: 'Mobilizar as Forças Armadas na fronteira',
            rationale: 'Mostra força e protege Roraima, mas pesa no orçamento e eleva a tensão.',
            effects: [
                { type: 'resource', target: 'PLAYER', resource: 'military', delta: 6 },
                { type: 'resource', target: 'PLAYER', resource: 'economy', delta: -3 },
                { type: 'modifier', target: 'PLAYER', label: 'Mobilização Parcial', perTurn: { military: 2, economy: -1 }, turns: 6 },
                { type: 'tension', delta: 4 },
                { type: 'front', target: 'BRA', targetB: 'VEN', delta: 8 },
                { type: 'relation', target: 'VEN', delta: -15 },
            ],
        },
        {
            label: 'Propor mediação regional com a Argentina',
            rationale: 'Ganha prestígio e esfria a crise, ao custo de capital político.',
            effects: [
                { type: 'relation', target: 'ARG', delta: 10 },
                { type: 'pact', action: 'create', pactType: 'nonAggression', target: 'BRA', targetB: 'VEN', label: 'Acordo de Pacaraima' },
                { type: 'war', action: 'ceasefire', target: 'BRA', targetB: 'VEN' },
                { type: 'pc', target: 'PLAYER', delta: -4 },
                { type: 'tension', delta: -6 },
                { type: 'crisis', action: 'deescalate', crisisId: 'crisis-ven' },
            ],
        },
        {
            label: 'Sancionar o regime de Caracas',
            rationale: 'Asfixia a economia venezuelana, mas pode empurrá-la para os BRICS.',
            effects: [
                { type: 'resource', target: 'VEN', resource: 'economy', delta: -8 },
                { type: 'bloc', target: 'VEN', bloc: 'BRICS' },
                { type: 'crisis', action: 'start', title: 'Êxodo na fronteira norte', description: 'Refugiados cruzam para Roraima.', severity: 'high', involved: ['BRA', 'VEN'] },
                { type: 'news', text: 'Brasil anuncia sanções contra a cúpula do governo venezuelano' },
                { type: 'flag', key: 'sanctionedVenezuela', value: true },
                { type: 'relation', target: 'USA', targetB: 'VEN', delta: -5 },
            ],
        },
        {
            label: 'Exigir a rendição e anexar a região de fronteira',
            rationale: 'Opção extrema: rompe tratados e pode atrair potências externas.',
            effects: [
                { type: 'war', action: 'peace', target: 'BRA', targetB: 'VEN', terms: 'annex' },
                { type: 'war', action: 'declare', target: 'USA', targetB: 'VEN', label: 'Intervenção no Caribe' },
                { type: 'pact', action: 'break', pactType: 'trade', target: 'BRA', targetB: 'ARG' },
                { type: 'crisis', action: 'escalate', crisisId: 'crisis-hormuz' },
                { type: 'resource', target: 'ARG', resource: 'stability', delta: -4 },
            ],
        },
    ],
};

export const EVENT_ENGINE = {
    id: 'evt-preview-2',
    source: 'engine',
    category: 'war',
    turn: 14,
    title: 'Chamado às Armas',
    narrative: 'A Argentina invoca o tratado de defesa mútua e pede que o Brasil entre na guerra contra a Venezuela. Recusar custará relações e influência regional.',
    headlines: [],
    involved: ['ARG', 'VEN'],
    options: [
        { label: 'Honrar a aliança e entrar na guerra', rationale: 'Mantém a palavra do Brasil.', effects: [{ type: 'war', action: 'declare', target: 'PLAYER', targetB: 'VEN' }, { type: 'relation', target: 'ARG', delta: 15 }] },
        { label: 'Recusar o chamado', rationale: 'Evita a guerra, mas enfraquece a aliança.', effects: [{ type: 'relation', target: 'ARG', delta: -20 }, { type: 'resource', target: 'PLAYER', resource: 'influence', delta: -5 }] },
    ],
};

/** A WorldState (player = Brasil, at war with Venezuela, allied with Argentina). */
export function makeState(overrides = {}) {
    const nations = {};
    for (const [id, n] of Object.entries(NATIONS)) nations[id] = { ...n, resources: { ...n.resources } };
    nations.BRA.pc = 12;
    return {
        schemaVersion: 2,
        campaignId: 'preview',
        seed: 'preview',
        scenarioId: SCENARIO.id,
        bookmarkId: 'b2026',
        turn: 14,
        date: { year: 2027, month: 11 },
        endDate: { year: 2036, month: 10 },
        phase: 'PLAYER_TURN',
        player: { nationId: 'BRA', leaderName: 'Helena Duarte', title: 'Presidente' },
        nations,
        relations: { ...RELATIONS, 'ARG|BRA': 65 },
        pacts: [...PACTS, { id: 'pact-bra-arg', type: 'defense', name: 'Pacto do Prata', members: ['BRA', 'ARG'], startedTurn: 3, expiresTurn: null }],
        wars: [
            ...WARS,
            {
                id: 'war-bra-ven', name: 'Guerra de Roraima', attackers: ['VEN'], defenders: ['BRA'], startedTurn: 11,
                fronts: [{ attacker: 'VEN', defender: 'BRA', progress: 6 }, { attacker: 'BRA', defender: 'VEN', progress: 3 }],
                score: -4, exhaustion: { VEN: 30, BRA: 12 }, ceasefire: false,
            },
        ],
        crises: CRISES,
        modifiers: [],
        cooldowns: {},
        globalTension: 57,
        pendingEvent: EVENT_ALL_EFFECTS,
        eventQueue: [EVENT_ENGINE],
        recentActions: [],
        decisions: Array.from({ length: 11 }, (_, i) => ({ turn: i + 1, eventTitle: `Evento ${i + 1}`, optionLabel: 'Opção' })),
        news: [],
        log: [],
        outcome: null,
        flags: {},
        ...overrides,
    };
}

export const RANKING = [
    ['USA', 'Estados Unidos', 91], ['CHN', 'China', 86], ['IND', 'Índia', 72], ['RUS', 'Rússia', 66], ['DEU', 'Alemanha', 65],
    ['GBR', 'Reino Unido', 65], ['FRA', 'França', 64], ['JPN', 'Japão', 63], ['BRA', 'Brasil', 56], ['TWN', 'Taiwan', 55],
    ['IRN', 'Irã', 49], ['UKR', 'Ucrânia', 46], ['ARG', 'Argentina', 38], ['VEN', 'Venezuela', 26],
].map(([id, name, power]) => ({ id, name, power }));
