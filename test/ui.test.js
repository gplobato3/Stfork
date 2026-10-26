/**
 * @file test/ui.test.js
 * node:test unit tests for the PURE UI view-model builders (FEAT-005).
 *
 * These exercise src/ui/viewModels.js against sample world-states and scenario
 * data WITHOUT a browser/DOM (jsdom is intentionally NOT a dependency). They
 * assert the view-models reflect resource values, tension level, player
 * highlight and relation coloring. Tests must fail if the logic is reverted.
 *
 * Run: node --test test/ui.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createEmptyWorldState,
    relationKey,
    RESOURCE_KEYS,
} from '../src/contract/worldState.js';

import {
    buildDashboardViewModel,
    buildMapColorMap,
    buildNationPickerList,
    buildEventViewModel,
    relationTier,
    tensionLevel,
    tensionViewModel,
    blocColor,
    PLAYER_COLOR,
    RELATION_TIERS,
    TENSION_LEVELS,
} from '../src/ui/viewModels.js';

/* --------------------------------------------------------- fixtures */

function nation(id, overrides = {}) {
    return {
        id,
        name: overrides.name || id,
        flagEmoji: overrides.flagEmoji || '',
        bloc: overrides.bloc || 'NON_ALIGNED',
        isPlayer: !!overrides.isPlayer,
        capital: overrides.capital || `Cap-${id}`,
        government: overrides.government || 'República',
        leaderTitle: overrides.leaderTitle || 'Presidente',
        traits: overrides.traits || ['Traço A', 'Traço B'],
        resources: {
            economy: 50, military: 50, stability: 50, influence: 50,
            tech: 50, manpower: 50, warSupport: 50,
            ...(overrides.resources || {}),
        },
    };
}

/** A small but complete world: player BRA + three others with relations. */
function sampleWorld() {
    const s = createEmptyWorldState({ campaignId: 'c1', seed: 's1' });
    s.turn = 3;
    s.date = { year: 2027, month: 4 };
    s.phase = 'PLAYER_TURN';
    s.playerNationId = 'BRA';
    s.globalTension = 72;
    s.nations = {
        BRA: nation('BRA', { name: 'Brasil', flagEmoji: '🇧🇷', bloc: 'BRICS', isPlayer: true, leaderTitle: 'Presidente',
            resources: { economy: 61, military: 44, stability: 70, influence: 55, tech: 48, manpower: 66, warSupport: 30 } }),
        USA: nation('USA', { name: 'Estados Unidos', bloc: 'NATO' }),
        RUS: nation('RUS', { name: 'Rússia', bloc: 'CSTO' }),
        CHN: nation('CHN', { name: 'China', bloc: 'BRICS' }),
    };
    s.relations = {
        [relationKey('BRA', 'USA')]: -55, // hostile
        [relationKey('BRA', 'CHN')]: 70,   // ally
        [relationKey('BRA', 'RUS')]: 5,    // neutral
    };
    s.activeCrises = [
        { id: 'cr1', title: 'Tensão no Pacífico', description: 'Manobras navais.', severity: 'high', involvedNationIds: ['USA', 'CHN'], turnStarted: 2 },
        { id: 'cr2', title: 'Greve geral', description: 'Paralisação nacional.', severity: 'low', involvedNationIds: ['BRA'], turnStarted: 3 },
    ];
    return s;
}

function sampleScenario() {
    return {
        nations: {
            BRA: nation('BRA', { name: 'Brasil', bloc: 'BRICS', resources: { economy: 60, military: 40 } }),
            USA: nation('USA', { name: 'Estados Unidos', bloc: 'NATO', resources: { economy: 90, military: 95 } }),
            AGO: nation('AGO', { name: 'Angola', bloc: 'NON_ALIGNED', resources: { economy: 30 } }),
        },
        relations: {},
        geo: { type: 'FeatureCollection', features: [] },
        crisisSeeds: [],
    };
}

/* --------------------------------------------------------- dashboard */

test('buildDashboardViewModel reflects the 7 resources in stable order', () => {
    const vm = buildDashboardViewModel(sampleWorld());
    assert.equal(vm.hasNation, true);
    assert.equal(vm.resources.length, 7);
    assert.deepEqual(vm.resources.map((r) => r.key), [...RESOURCE_KEYS]);
    const econ = vm.resources.find((r) => r.key === 'economy');
    assert.equal(econ.value, 61);
    assert.equal(econ.pct, 61);
    assert.equal(econ.labelKey, 'hoi_res_economy');
    const ws = vm.resources.find((r) => r.key === 'warSupport');
    assert.equal(ws.value, 30);
});

test('buildDashboardViewModel reports turn, date and player identity', () => {
    const vm = buildDashboardViewModel(sampleWorld());
    assert.equal(vm.turn, 3);
    assert.deepEqual(vm.date, { year: 2027, month: 4 });
    assert.equal(vm.nation.id, 'BRA');
    assert.equal(vm.nation.name, 'Brasil');
    assert.equal(vm.nation.leaderTitle, 'Presidente');
    assert.equal(vm.nation.bloc, 'BRICS');
});

test('buildDashboardViewModel computes tension level + color', () => {
    const vm = buildDashboardViewModel(sampleWorld());
    assert.equal(vm.tension.value, 72);
    assert.equal(vm.tension.pct, 72);
    // 72 -> "dangerous" (>=60, <85)
    assert.equal(vm.tension.levelKey, 'dangerous');
    assert.equal(vm.tension.labelKey, 'hoi_tension_level_dangerous');
    assert.equal(typeof vm.tension.color, 'string');
});

test('buildDashboardViewModel color-codes relations by tier and sorts desc', () => {
    const vm = buildDashboardViewModel(sampleWorld());
    const byId = Object.fromEntries(vm.relations.map((r) => [r.id, r]));
    assert.equal(byId.CHN.tierKey, 'ally');
    assert.equal(byId.CHN.tierLabelKey, 'hoi_rel_ally');
    assert.equal(byId.USA.tierKey, 'hostile');
    assert.equal(byId.RUS.tierKey, 'neutral');
    // sorted by score descending: CHN(70) > RUS(5) > USA(-55)
    const order = vm.relations.map((r) => r.id);
    assert.deepEqual(order, ['CHN', 'RUS', 'USA']);
    // distinct colors for distinct tiers
    assert.notEqual(byId.CHN.color, byId.USA.color);
});

test('buildDashboardViewModel sorts crises by severity (critical first)', () => {
    const vm = buildDashboardViewModel(sampleWorld());
    assert.equal(vm.crises.length, 2);
    assert.equal(vm.crises[0].id, 'cr1'); // high before low
    assert.equal(vm.crises[0].severityLabelKey, 'hoi_sev_high');
    assert.equal(vm.crises[1].severity, 'low');
});

test('buildDashboardViewModel degrades gracefully with no player / bad input', () => {
    const empty = buildDashboardViewModel(createEmptyWorldState());
    assert.equal(empty.hasNation, false);
    assert.deepEqual(empty.resources, []);
    assert.deepEqual(empty.relations, []);
    // never throws on junk
    assert.equal(buildDashboardViewModel(null).hasNation, false);
    assert.equal(buildDashboardViewModel({}).hasNation, false);
});

/* --------------------------------------------------------- map coloring */

test('buildMapColorMap highlights the player and colors others by relation', () => {
    const map = buildMapColorMap(sampleWorld());
    assert.equal(map.BRA.isPlayer, true);
    assert.equal(map.BRA.color, PLAYER_COLOR);
    assert.equal(map.BRA.relationTier, 'self');

    // Non-player nations get relation-tier colors + scores.
    assert.equal(map.CHN.isPlayer, false);
    assert.equal(map.CHN.relation, 70);
    assert.equal(map.CHN.relationTier, 'ally');
    assert.equal(map.USA.relation, -55);
    assert.equal(map.USA.relationTier, 'hostile');
    assert.equal(map.RUS.relationTier, 'neutral');
    // relation colors differ from player highlight
    assert.notEqual(map.CHN.color, PLAYER_COLOR);
    assert.notEqual(map.USA.color, map.CHN.color);
});

test('buildMapColorMap falls back to bloc colors when no player is set', () => {
    const s = sampleWorld();
    s.playerNationId = null;
    const map = buildMapColorMap(s);
    assert.equal(map.USA.color, blocColor('NATO'));
    assert.equal(map.CHN.color, blocColor('BRICS'));
    assert.equal(map.USA.isPlayer, false);
});

test('buildMapColorMap returns {} for empty/invalid worlds', () => {
    assert.deepEqual(buildMapColorMap(null), {});
    assert.deepEqual(buildMapColorMap({}), {});
    assert.deepEqual(buildMapColorMap(createEmptyWorldState()), {});
});

/* --------------------------------------------------------- nation picker */

test('buildNationPickerList returns featured majors + full roster with stats', () => {
    const list = buildNationPickerList(sampleScenario());
    assert.equal(list.count, 3);
    // all entries carry the 7 resources + traits + leaderTitle + power
    const bra = list.all.find((n) => n.id === 'BRA');
    assert.equal(bra.resources.length, 7);
    assert.equal(bra.leaderTitle, 'Presidente');
    assert.ok(Array.isArray(bra.traits));
    assert.equal(typeof bra.power, 'number');
    // USA + BRA are featured majors; AGO is not
    const featuredIds = list.featured.map((n) => n.id);
    assert.ok(featuredIds.includes('USA'));
    assert.ok(featuredIds.includes('BRA'));
    assert.ok(!featuredIds.includes('AGO'));
});

test('buildNationPickerList derives a power rating from average resources', () => {
    const list = buildNationPickerList(sampleScenario());
    const usa = list.all.find((n) => n.id === 'USA');
    const bra = list.all.find((n) => n.id === 'BRA');
    // USA has much stronger economy/military -> higher power than BRA
    assert.ok(usa.power > bra.power);
});

test('buildNationPickerList honors playableIds restriction', () => {
    const list = buildNationPickerList(sampleScenario(), { playableIds: ['BRA', 'AGO'] });
    const ids = list.all.map((n) => n.id).sort();
    assert.deepEqual(ids, ['AGO', 'BRA']);
});

test('buildNationPickerList is safe on empty/invalid scenario', () => {
    assert.deepEqual(buildNationPickerList(null), { featured: [], all: [], count: 0 });
    assert.deepEqual(buildNationPickerList({}), { featured: [], all: [], count: 0 });
});

/* --------------------------------------------------------- event modal */

test('buildEventViewModel normalizes options and fills ids', () => {
    const vm = buildEventViewModel({
        title: 'Crise',
        narrative: 'Algo acontece.',
        tensionDelta: 5,
        options: [
            { label: 'A', rationale: 'porque sim', effects: [] },
            { label: 'B', effects: [] },
        ],
    });
    assert.equal(vm.title, 'Crise');
    assert.equal(vm.options.length, 2);
    assert.equal(vm.options[0].id, 'opt_0');
    assert.equal(vm.options[0].hasRationale, true);
    assert.equal(vm.options[1].id, 'opt_1');
    assert.equal(vm.options[1].hasRationale, false);
    assert.equal(vm.tensionDelta, 5);
});

test('buildEventViewModel is safe on empty input', () => {
    const vm = buildEventViewModel(null);
    assert.equal(vm.title, '');
    assert.deepEqual(vm.options, []);
    assert.equal(vm.hasContext, false);
});

/* --------------------------------------------------------- classifiers */

test('relationTier classifies the full -100..100 range', () => {
    assert.equal(relationTier(-100).key, 'hostile');
    assert.equal(relationTier(-40).key, 'tense');
    assert.equal(relationTier(0).key, 'neutral');
    assert.equal(relationTier(30).key, 'friendly');
    assert.equal(relationTier(80).key, 'ally');
    // clamps out-of-range
    assert.equal(relationTier(999).key, 'ally');
    assert.equal(relationTier(-999).key, 'hostile');
});

test('tensionLevel + tensionViewModel classify the 0..100 meter', () => {
    assert.equal(tensionLevel(0).key, 'calm');
    assert.equal(tensionLevel(40).key, 'uneasy');
    assert.equal(tensionLevel(70).key, 'dangerous');
    assert.equal(tensionLevel(90).key, 'critical');
    const vm = tensionViewModel(90);
    assert.equal(vm.value, 90);
    assert.equal(vm.levelKey, 'critical');
    // clamps
    assert.equal(tensionViewModel(150).value, 100);
    assert.equal(tensionViewModel(-10).value, 0);
});

test('tiers and levels are ordered and complete', () => {
    assert.equal(RELATION_TIERS.length, 5);
    assert.equal(TENSION_LEVELS.length, 4);
    // each tier color is a non-empty string
    for (const tier of RELATION_TIERS) assert.ok(tier.color && typeof tier.color === 'string');
});
