import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BLOC_COLORS, RELATION_TIERS, SEVERITY_COLORS, WAR_TIER } from '../../src/contract/presentation.js';
import { MAP_MODES } from '../../src/contract/constants.js';
import {
    LABEL_RULES,
    MAP_COLORS,
    buildWorldIndex,
    capitalMarkers,
    computeMapPaint,
    crisisMarkers,
    diplomaticColor,
    frontMarkers,
    isLabelVisible,
    joinNames,
    labelItems,
    legendEntries,
    militaryCategory,
    nationBaseColor,
    nextMapMode,
    playerTerritories,
    politicalColor,
    progressLevel,
    tooltipModel,
    visibleLabels,
} from '../../src/ui/map/mapModel.js';
import { hexToRgb, mix } from '../../src/ui/map/color.js';
import { MINI_MAP, makeWorld } from './fixtures/world.js';

const IDS = Object.keys(MINI_MAP.countries);

function setup() {
    const state = makeWorld();
    return { state, index: buildWorldIndex(state) };
}

test('world index: enemies, co-belligerents, occupation, owner of annexed land', () => {
    const { index } = setup();
    assert.ok(index.enemies.get('AAA').has('BBB'));
    assert.ok(index.coBelligerents.get('AAA').has('CCC'));
    assert.deepEqual(index.occupation.get('AAA'), { progress: 30, occupier: 'BBB' });
    assert.equal(index.occupation.has('CCC'), false, '0% fronts do not count as occupation');
    assert.equal(index.ownerOf('EEE'), 'BBB');
    assert.equal(index.ownerOf('AAA'), 'AAA');
    assert.equal(index.crisisByNation.get('BBB').severity, 'critical');
});

test('political mode: bloc hue, annexed takes controller color, puppet tinted toward overlord', () => {
    const { state, index } = setup();
    const bbb = politicalColor(state, 'BBB', index);
    assert.equal(politicalColor(state, 'EEE', index), bbb, 'annexed territory is painted as its controller');
    const ddd = politicalColor(state, 'DDD', index);
    const expected = mix(nationBaseColor(state, 'DDD'), nationBaseColor(state, 'BBB'), 0.6);
    assert.equal(ddd, expected, 'puppet mixes 60% toward the overlord');
    // Bloc hue survives the per-nation jitter (NATO blue dominates).
    const aaa = hexToRgb(politicalColor(state, 'AAA', index));
    assert.ok(aaa.b > aaa.r, 'NATO nation stays bluish');
    assert.notEqual(politicalColor(state, 'AAA', index), politicalColor(state, 'CCC', index), 'same-bloc neighbours differ slightly');
    void BLOC_COLORS;
});

test('military mode: player / enemy / ally / other belligerent / neutral', () => {
    const { state, index } = setup();
    assert.equal(militaryCategory(state, 'AAA', index), 'player');
    assert.equal(militaryCategory(state, 'BBB', index), 'enemy');
    assert.equal(militaryCategory(state, 'CCC', index), 'ally');
    assert.equal(militaryCategory(state, 'FFF', index), 'belligerent');
    assert.equal(militaryCategory(state, 'GGG', index), 'belligerent');
    assert.equal(militaryCategory(state, 'HHH', index), 'neutral');
    const paint = computeMapPaint(state, 'military', IDS, index);
    assert.equal(paint.get('BBB').fill, MAP_COLORS.military.enemy);
    assert.equal(paint.get('EEE').fill, MAP_COLORS.military.enemy, 'annexed by the enemy = enemy territory');
    assert.equal(paint.get('CCC').fill, MAP_COLORS.military.ally);
    assert.equal(paint.get('HHH').fill, MAP_COLORS.military.neutral);
});

test('occupation hatch: occupier color, density by progress, political+military only', () => {
    const { state, index } = setup();
    const mil = computeMapPaint(state, 'military', IDS, index);
    assert.deepEqual(
        { color: mil.get('AAA').hatch.color, level: mil.get('AAA').hatch.level, occupier: mil.get('AAA').hatch.occupier },
        { color: MAP_COLORS.military.enemy, level: 2, occupier: 'BBB' },
    );
    assert.equal(mil.get('GGG').hatch.level, 3, '60% -> level 3');
    assert.equal(mil.get('GGG').hatch.color, MAP_COLORS.military.belligerent);
    assert.equal(mil.get('CCC').hatch, null);
    const pol = computeMapPaint(state, 'political', IDS, index);
    assert.equal(pol.get('AAA').hatch.color, politicalColor(state, 'BBB', index));
    assert.match(pol.get('AAA').hatch.key, /^[0-9a-f]{6}-2$/);
    assert.equal(computeMapPaint(state, 'diplomatic', IDS, index).get('AAA').hatch, null);
    assert.equal(computeMapPaint(state, 'crisis', IDS, index).get('AAA').hatch, null);
    assert.deepEqual([0, 1, 25, 26, 50, 51, 99, 100].map(progressLevel), [0, 1, 1, 2, 2, 3, 4, 4]);
});

test('diplomatic mode: relation tier colors, war overrides score, player brass', () => {
    const { state, index } = setup();
    assert.equal(diplomaticColor(state, 'AAA', index), MAP_COLORS.playerDiplo);
    assert.equal(diplomaticColor(state, 'BBB', index), WAR_TIER.color);
    assert.equal(diplomaticColor(state, 'CCC', index), RELATION_TIERS.find((t) => t.id === 'aliado').color);
    assert.equal(diplomaticColor(state, 'FFF', index), RELATION_TIERS.find((t) => t.id === 'amistoso').color);
    assert.equal(diplomaticColor(state, 'GGG', index), RELATION_TIERS.find((t) => t.id === 'tenso').color);
    assert.equal(diplomaticColor(state, 'HHH', index), RELATION_TIERS.find((t) => t.id === 'neutro').color);
    assert.equal(diplomaticColor(state, 'EEE', index), WAR_TIER.color, 'annexed land shows its controller');
});

test('crisis mode: severity heat; no-crisis nations dim', () => {
    const { state, index } = setup();
    const paint = computeMapPaint(state, 'crisis', IDS, index);
    assert.equal(paint.get('CCC').fill, MAP_COLORS.landDim);
    const bbb = hexToRgb(paint.get('BBB').fill);
    const crit = hexToRgb(SEVERITY_COLORS.critical);
    assert.ok(Math.abs(bbb.r - crit.r) < 60, 'critical crisis keeps the critical hue');
    assert.notEqual(paint.get('HHH').fill, MAP_COLORS.landDim);
});

test('no campaign: every territory neutral', () => {
    const paint = computeMapPaint(null, 'political', IDS, buildWorldIndex(null));
    for (const id of IDS) assert.equal(paint.get(id).fill, MAP_COLORS.landNeutral);
});

test('legend entries exist for every mode, in pt-BR', () => {
    for (const mode of MAP_MODES) {
        const entries = legendEntries(mode);
        assert.ok(entries.length >= 4, mode);
        for (const e of entries) assert.ok(e.label && /^#[0-9a-f]{6}$/i.test(e.color), `${mode}: ${e.label}`);
    }
    assert.ok(legendEntries('political').some((e) => e.label === 'OTAN'));
    assert.ok(legendEntries('military').some((e) => e.kind === 'hatch' && e.label === 'Território ocupado'));
    assert.ok(legendEntries('diplomatic').some((e) => e.label === 'Em Guerra'));
    assert.ok(legendEntries('crisis').some((e) => e.label === 'Crise crítica'));
    assert.equal(nextMapMode('crisis'), 'political');
    assert.equal(nextMapMode('political', -1), 'crisis');
});

test('label visibility: majors always; minors need on-screen area and room for the name', () => {
    const big = { area: 10000, bbox: [0, 0, 100, 100], major: false, nameLength: 6 };
    assert.equal(isLabelVisible(big, 1), true);
    const tiny = { area: 16, bbox: [0, 0, 4, 4], major: false, nameLength: 8 };
    assert.equal(isLabelVisible(tiny, 1), false);
    assert.equal(isLabelVisible({ ...tiny, major: true }, 1), true, 'majors always');
    // Threshold: screen area = area * scale²
    const s = Math.sqrt(LABEL_RULES.minScreenArea / 16);
    assert.equal(isLabelVisible({ ...tiny, nameLength: 1 }, s * 0.99), false);
    assert.equal(isLabelVisible({ ...tiny, nameLength: 1 }, s * 1.01 * 10), true);
    // Long names need a wider country.
    const narrow = { area: 4000, bbox: [0, 0, 40, 100], major: false, nameLength: 30 };
    assert.equal(isLabelVisible(narrow, 1), false);
    assert.equal(isLabelVisible(narrow, 6), true);
});

test('visibleLabels: zooming in reveals more; overlapping majors yield to bigger ones; player always', () => {
    const state = makeWorld();
    const items = labelItems(state, MINI_MAP);
    assert.ok(!items.some((i) => i.id === 'EEE'), 'annexed nations have no label');
    const far = visibleLabels(items, 0.6, 'AAA');
    const near = visibleLabels(items, 4, 'AAA');
    assert.ok(far.has('AAA') && far.has('BBB'));
    assert.ok(!far.has('HHH'));
    assert.ok(near.size >= far.size);
    assert.ok(!near.has('HHH'), 'a 4×4 microstate only shows when zoomed a lot');
    assert.ok(visibleLabels(items, 40, 'AAA').has('HHH'));

    const crowd = [
        { id: 'P1', text: 'PEQUENO', x: 100, y: 100, major: true, area: 50, bbox: [95, 95, 105, 105] },
        { id: 'P2', text: 'GRANDE', x: 110, y: 100, major: true, area: 900, bbox: [80, 80, 120, 120] },
    ];
    const v = visibleLabels(crowd, 1, null);
    assert.ok(v.has('P2') && !v.has('P1'), 'colliding major hidden in favour of the larger one');
    assert.ok(visibleLabels(crowd, 30, null).has('P1'), 'reappears when zoomed in');
    assert.ok(visibleLabels(crowd, 1, 'P1').has('P1'), 'player label never hidden');
});

test('tooltip: name, controller, puppet, relation tier, wars, occupation, crisis', () => {
    const { state, index } = setup();
    const aaa = tooltipModel(state, 'AAA', index);
    assert.equal(aaa.title, 'Albânia do Sul');
    const t = aaa.lines.map((l) => l.text);
    assert.ok(t.includes('Sua nação'));
    assert.ok(t.includes('Em guerra com Bóreas'));
    assert.ok(t.includes('Ocupação: 30% (Bóreas)'));
    assert.ok(t.includes('Crise: Crise dos Estreitos (Alta)'));

    const bbb = tooltipModel(state, 'BBB', index).lines.map((l) => l.text);
    assert.ok(bbb.includes('Em Guerra com você'));
    assert.ok(bbb.some((x) => x.startsWith('Em guerra com Albânia do Sul e Cária')));
    assert.ok(bbb.includes('Crise: Alerta Nuclear (Crítica) +1'));

    const eee = tooltipModel(state, 'EEE', index).lines.map((l) => l.text);
    assert.deepEqual(eee, ['Controlado por Bóreas']);

    const ddd = tooltipModel(state, 'DDD', index).lines.map((l) => l.text);
    assert.ok(ddd.includes('Fantoche de Bóreas'));
    assert.ok(ddd.includes('Relação: Neutro (−10)'));

    const ccc = tooltipModel(state, 'CCC', index).lines;
    assert.equal(ccc.find((l) => l.text.startsWith('Relação')).text, 'Relação: Aliado (+70)');
    assert.equal(tooltipModel(state, 'ZZZ', index).title, 'ZZZ');
});

test('front markers: one per defender; distant 0% fronts skipped; land 0% fronts kept', () => {
    const { state, index } = setup();
    // Add a distant 0% front (no shared border) that must not be drawn.
    state.wars[1].fronts.push({ attacker: 'FFF', defender: 'HHH', progress: 0 });
    state.wars[1].defenders.push('HHH');
    const idx = buildWorldIndex(state);
    const ms = frontMarkers(state, MINI_MAP, idx);
    const keys = ms.map((m) => m.defender).sort();
    assert.deepEqual(keys, ['AAA', 'CCC', 'GGG']);
    const aaa = ms.find((m) => m.defender === 'AAA');
    assert.equal(aaa.involvesPlayer, true);
    assert.equal(aaa.progress, 30);
    assert.match(aaa.tip, /Frente em Albânia do Sul: 30% ocupado por Bóreas/);
    // Marker lies between the two label points, on the defender's side.
    assert.ok(aaa.x > 200 && aaa.x < 300, `x=${aaa.x}`);
    const ggg = ms.find((m) => m.defender === 'GGG');
    assert.equal(ggg.involvesPlayer, false);
    void index;
});

test('crisis markers: one per crisis at its epicenter, stacked slots, pulse for high+', () => {
    const { state, index } = setup();
    const ms = crisisMarkers(state, MINI_MAP, index);
    assert.equal(ms.length, 3);
    const onB = ms.filter((m) => m.id === 'BBB').map((m) => m.slot).sort();
    assert.deepEqual(onB, [0, 1]);
    assert.equal(ms.find((m) => m.crisisId === 'c2').pulse, false);
    assert.equal(ms.find((m) => m.crisisId === 'c3').pulse, true);
    assert.equal(ms[ms.length - 1].severity, 'critical', 'most severe drawn last (on top)');
});

test('capital markers for majors and the player; player territories include annexed land', () => {
    const { state, index } = setup();
    const caps = capitalMarkers(state, MINI_MAP).map((m) => m.id).sort();
    assert.deepEqual(caps, ['AAA', 'BBB']);
    state.nations.EEE.controller = 'AAA';
    const idx = buildWorldIndex(state);
    assert.deepEqual(playerTerritories(state, IDS, idx).sort(), ['AAA', 'EEE']);
    void index;
});

test('joinNames pt-BR list', () => {
    assert.equal(joinNames(['A']), 'A');
    assert.equal(joinNames(['A', 'B']), 'A e B');
    assert.equal(joinNames(['A', 'B', 'C']), 'A, B e C');
    assert.equal(joinNames(['A', 'B', 'C', 'D', 'E'], 3), 'A, B, C e mais 2');
});
