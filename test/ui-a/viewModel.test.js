import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RESOURCE_KEYS } from '../../src/contract/constants.js';
import {
    actionItem,
    chanceTone,
    costParts,
    crisesModel,
    dossierModel,
    foldText,
    formatCost,
    formatDelta,
    groupActions,
    monthsText,
    pendingCount,
    rankingModel,
    relationsList,
    resolvePlaceholders,
    resourceDeltas,
    tickerItems,
    topBarModel,
    turnReportModel,
    warsModel,
} from '../../src/ui/warroom/viewModel.js';
import { def, makeWorld } from './fixtures/world.js';

test('formatDelta / resourceDeltas: real minus sign, empty for zero', () => {
    assert.equal(formatDelta(3), '+3');
    assert.equal(formatDelta(-2), '\u22122');
    assert.equal(formatDelta(0), '');
    assert.equal(formatDelta(undefined), '');
    assert.equal(formatDelta(0.4), '');
    const d = resourceDeltas({ economy: 50, military: 40 }, { economy: 47, military: 42 });
    assert.equal(d.economy, 3);
    assert.equal(d.military, -2);
    assert.equal(d.tech, 0);
    assert.deepEqual(Object.keys(resourceDeltas({}, null)), RESOURCE_KEYS);
});

test('topBarModel: identity, date, PC, 7 resources with deltas, DEFCON, pending count', () => {
    const state = makeWorld();
    state.pendingEvent = { id: 'e1' };
    state.eventQueue = [{ id: 'e2' }];
    const m = topBarModel(state, { deltas: { economy: 2, stability: -3 } });
    assert.equal(m.hasCampaign, true);
    assert.equal(m.nationName, 'Albânia do Sul');
    assert.equal(m.leaderLine, 'Presidente Helena Duarte');
    assert.equal(m.dateText, 'Fevereiro de 2027');
    assert.equal(m.pc, 12);
    assert.equal(m.pcMax, 30);
    assert.equal(m.resources.length, 7);
    const eco = m.resources.find((r) => r.key === 'economy');
    assert.deepEqual([eco.label, eco.deltaText, eco.tone], ['Economia', '+2', 'good']);
    const stab = m.resources.find((r) => r.key === 'stability');
    assert.deepEqual([stab.deltaText, stab.tone], ['\u22123', 'bad']);
    assert.match(stab.title, /Estabilidade: 50\/100 \(−3 no último mês\)/);
    assert.equal(m.resources.find((r) => r.key === 'tech').deltaText, '');
    assert.equal(m.defcon.level, 3);
    assert.equal(m.tension, 55);
    assert.equal(m.pendingCount, 2);
    assert.equal(pendingCount(state), 2);
    assert.equal(topBarModel(null).hasCampaign, false);
});

test('costParts / formatCost / chance tone / months', () => {
    assert.deepEqual(costParts({ pc: 3, resources: { economy: 5, tech: 0 } }).map((p) => [p.key, p.value]), [['pc', 3], ['economy', 5]]);
    assert.equal(formatCost({ pc: 3, resources: { economy: 5 } }), '3 PC · 5 Economia');
    assert.equal(formatCost({ pc: 0 }), 'Sem custo');
    assert.deepEqual([chanceTone(80), chanceTone(50), chanceTone(20)], ['good', 'neutral', 'bad']);
    assert.equal(monthsText(1), '1 mês');
    assert.equal(monthsText(3), '3 meses');
});

test('actionItem: chance text, reasons, cooldown text, confirm flag', () => {
    const sure = actionItem({ def: def('a', { chance: null }), available: true, reasons: [], chance: 100, cooldownLeft: 0 });
    assert.equal(sure.chanceText, 'Garantido');
    assert.equal(sure.cooldownText, 'Recarga de 2 meses');
    const cd = actionItem({ def: def('b', { confirm: true }), available: false, reasons: ['Em recarga'], chance: 42, cooldownLeft: 1 });
    assert.equal(cd.chanceText, '42%');
    assert.equal(cd.chanceTone, 'neutral');
    assert.equal(cd.cooldownText, 'Disponível em 1 mês');
    assert.equal(cd.reasonText, 'Em recarga');
    assert.equal(cd.confirm, true);
});

test('groupActions: category order, target filter, available first, then cheaper, then name', () => {
    const avs = [
        { def: def('mil_b', { category: 'military', name: 'Bravo', cost: { pc: 3 } }), available: true, reasons: [], chance: 60, cooldownLeft: 0 },
        { def: def('mil_a', { category: 'military', name: 'Alfa', cost: { pc: 3 } }), available: true, reasons: [], chance: 60, cooldownLeft: 0 },
        { def: def('mil_c', { category: 'military', name: 'Charlie', cost: { pc: 1 } }), available: false, reasons: ['Sem PC'], chance: 60, cooldownLeft: 0 },
        { def: def('mil_d', { category: 'military', name: 'Delta', cost: { pc: 1 } }), available: true, reasons: [], chance: 60, cooldownLeft: 0 },
        { def: def('eco_a', { category: 'economy', name: 'Économie' }), available: true, reasons: [], chance: 60, cooldownLeft: 0 },
        { def: def('dip_t', { category: 'diplomacy', target: 'nation', name: 'Alvo' }), available: false, reasons: ['Selecione um alvo'], chance: 50, cooldownLeft: 0 },
        { def: def('int_x', { category: 'intel', name: 'Espionagem' }), available: true, reasons: [], chance: 30, cooldownLeft: 0 },
    ];
    const groups = groupActions(avs, { target: 'none' });
    assert.deepEqual(groups.map((g) => g.category), ['military', 'economy', 'intel']);
    assert.deepEqual(groups[0].items.map((i) => i.id), ['mil_d', 'mil_a', 'mil_b', 'mil_c']);
    assert.equal(groups[0].label, 'Militar');
    assert.equal(groups[0].availableCount, 3);
    const targeted = groupActions(avs, { target: 'nation' });
    assert.deepEqual(targeted.map((g) => g.category), ['diplomacy']);
    assert.equal(groupActions([], {}).length, 0);
});

test('resolvePlaceholders: SELF/TARGET/PLAYER -> ids for previews (copy, not mutation)', () => {
    const e = { type: 'relation', target: 'SELF', targetB: 'TARGET', delta: 10 };
    const r = resolvePlaceholders(e, { self: 'AAA', target: 'BBB' });
    assert.deepEqual([r.target, r.targetB], ['AAA', 'BBB']);
    assert.equal(e.target, 'SELF');
    assert.deepEqual(resolvePlaceholders({ type: 'crisis', involved: ['PLAYER', 'CCC'] }, { self: 'AAA' }).involved, ['AAA', 'CCC']);
});

test('tickerItems: newest first, icons per kind, short dates', () => {
    const items = tickerItems(makeWorld(), 10);
    assert.equal(items[0].text, 'Governo decreta mobilização');
    assert.equal(items[0].isPlayer, true);
    assert.equal(items[0].dateText, 'Fev/2027');
    assert.equal(items[1].icon, 'fa-solid fa-person-rifle');
    assert.equal(tickerItems(null).length, 0);
});

test('relationsList: excludes player and annexed, sortable, accent-insensitive filter', () => {
    const state = makeWorld();
    const rows = relationsList(state, {});
    assert.ok(!rows.some((r) => r.id === 'AAA' || r.id === 'EEE'));
    assert.equal(rows[0].id, 'CCC', 'best relation first');
    assert.equal(rows[rows.length - 1].id, 'BBB', 'enemies at war sink to the bottom');
    assert.equal(rows[rows.length - 1].tierLabel, 'Em Guerra');
    const byName = relationsList(state, { sort: 'name' }).map((r) => r.name);
    assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    const byPower = relationsList(state, { sort: 'power', power: { HHH: 90, FFF: 10 } });
    assert.equal(byPower[0].id, 'HHH');
    assert.deepEqual(relationsList(state, { filter: 'hesperia' }).map((r) => r.id), ['HHH']);
    assert.equal(foldText('Ação Ímpar'), 'acao impar');
});

test('warsModel: player war first, own-side score, fronts sorted, exhaustion', () => {
    const wars = warsModel(makeWorld());
    assert.equal(wars[0].id, 'w1');
    assert.equal(wars[0].playerSide, 'defenders');
    assert.equal(wars[0].ownScore, -20);
    assert.equal(wars[0].scoreText, '\u221220 para o seu lado');
    assert.equal(wars[0].scoreTone, 'bad');
    assert.deepEqual(wars[0].fronts.map((f) => f.progress), [30, 0]);
    assert.equal(wars[0].fronts[0].playerDefending, true);
    assert.equal(wars[0].exhaustion[0].id, 'AAA', 'player exhaustion listed first');
    assert.equal(wars[0].durationText, 'Há 3 meses');
    assert.equal(wars[1].scoreText, '+40 para os atacantes');
});

test('crisesModel: severity order and pt-BR labels', () => {
    const rows = crisesModel(makeWorld());
    assert.deepEqual(rows.map((r) => r.id), ['c3', 'c1', 'c2']);
    assert.equal(rows[0].severityLabel, 'Crítica');
    assert.equal(rows[1].involvesPlayer, true);
    assert.equal(rows[2].durationText, 'Novo');
});

test('rankingModel: appends the player when outside the top N', () => {
    const state = makeWorld();
    const ranking = ['BBB', 'CCC', 'FFF', 'GGG', 'AAA'].map((id, i) => ({ id, name: id, power: 90 - i * 10 }));
    const top = rankingModel(ranking, state, 3);
    assert.deepEqual(top.map((r) => r.id), ['BBB', 'CCC', 'FFF', 'AAA']);
    assert.equal(top[3].pos, 5);
    assert.equal(top[3].isPlayer, true);
});

test('dossierModel: status chips, relation, pacts, wars, occupation', () => {
    const state = makeWorld();
    const view = {
        nation: state.nations.DDD,
        power: 40,
        relationToPlayer: -10,
        relationTier: 'neutro',
        atWarWith: [],
        allies: ['BBB'],
        pacts: [{ id: 'p9', type: 'defense', name: 'Pacto Boreal', members: ['DDD', 'BBB'] }],
        controller: 'DDD',
        occupation: 0,
        occupier: null,
        crises: [],
    };
    const m = dossierModel(view, state, { rank: 7 });
    assert.ok(m.statusChips.some((c) => c.text === 'Fantoche de Bóreas'));
    assert.equal(m.relation.tierLabel, 'Neutro');
    assert.equal(m.relation.scoreText, '\u221210');
    assert.equal(m.pacts[0].typeLabel, 'Pacto de Defesa');
    assert.deepEqual(m.pacts[0].members.map((x) => x.name), ['Bóreas']);
    assert.equal(m.rank, 7);
    assert.equal(m.blocLabel, 'OTSC');

    const me = dossierModel({ ...view, nation: state.nations.AAA, occupation: 30, occupier: 'BBB', atWarWith: ['BBB'] }, state);
    assert.equal(me.isPlayer, true);
    assert.equal(me.relation, null);
    assert.deepEqual(me.occupation, { pct: 30, occupier: 'BBB', occupierName: 'Bóreas' });
    assert.equal(dossierModel(null, state), null);
});

test('turnReportModel: player deltas, headlines, fronts, AI moves involving the player', () => {
    const state = makeWorld();
    const report = {
        turn: 6,
        date: { year: 2027, month: 3 },
        pcGained: 4,
        playerDeltas: { economy: -2, military: 3, tech: 0 },
        tensionBefore: 50,
        tensionAfter: 55,
        aiActions: [
            { actorId: 'BBB', actionId: 'x', targetId: 'AAA', success: true, summary: 'Bóreas sanciona Albânia do Sul.' },
            { actorId: 'FFF', actionId: 'y', targetId: 'GGG', success: true, summary: 'Frígia ameaça Gália.' },
        ],
        warUpdates: [{ warId: 'w1', summary: 'Bóreas avança 4%.' }],
        capitulations: ['GGG'],
        newCrises: ['c2'],
        resolvedCrises: ['Velha crise'],
        headlines: ['Manchete 1', 'Manchete 2'],
        engineEvents: [{ id: 'e' }],
        outcome: null,
    };
    const m = turnReportModel(report, state);
    assert.equal(m.title, 'Relatório de Março de 2027');
    const ids = m.sections.map((s) => s.id);
    assert.deepEqual(ids, ['player', 'headlines', 'wars', 'ai', 'crises']);
    const player = m.sections[0].rows.map((r) => r.text);
    assert.deepEqual(player, ['Capital Político +4', 'Economia \u22122', 'Força Militar +3', 'Tensão global de 50 para 55']);
    assert.deepEqual(m.sections[3].rows.map((r) => r.text), ['Bóreas sanciona Albânia do Sul.']);
    const crisis = m.sections[4].rows.map((r) => r.text);
    assert.deepEqual(crisis, ['Nova crise: Protestos em Hespéria', 'Crise encerrada: Velha crise', 'Gália capitulou']);
    assert.equal(m.decisions, 1);
    assert.equal(m.decisionsText, '1 decisão aguarda o seu despacho.');
    assert.equal(turnReportModel(null, state), null);
    const quiet = turnReportModel({ turn: 2, date: { year: 2027, month: 1 } }, state);
    assert.equal(quiet.empty, true);
});
