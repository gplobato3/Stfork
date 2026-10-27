import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTION_CATEGORIES, EFFECT_TYPES, PLACEHOLDERS } from '../../src/contract/constants.js';
import { getRelation } from '../../src/contract/worldState.js';
import { createEngine } from '../../src/engine/index.js';
import { buildScenario } from './fixtures.js';

const engine = createEngine();
const fresh = (nationId = 'BRA', bookmarkId = 'b2026', seed = 'acoes') => engine.newGame(buildScenario(), { bookmarkId, nationId, leaderName: 'Teste', seed });
const find = (list, id) => list.find((a) => a.def.id === id);

const REQUIRED = [
    'dip_improve_relations', 'dip_send_aid', 'dip_trade_agreement', 'dip_propose_alliance', 'dip_defense_pact', 'dip_guarantee',
    'dip_sanctions', 'dip_expel_diplomats', 'dip_ultimatum', 'dip_declare_war', 'dip_propose_ceasefire', 'dip_propose_peace',
    'mil_partial_mobilization', 'mil_total_mobilization', 'mil_demobilize', 'mil_border_exercises', 'mil_modernization',
    'mil_expeditionary', 'mil_limited_strike', 'mil_nuclear_alert', 'mil_nuclear_test', 'mil_nuclear_strike',
    'eco_stimulus', 'eco_austerity', 'eco_industrial_investment', 'eco_research_program', 'eco_energy_deal',
    'int_propaganda', 'int_political_reforms', 'int_crackdown', 'int_early_elections',
    'intel_espionage', 'intel_cyberattack', 'intel_destabilize', 'intel_counterintel',
];

test('catalog: required actions, pt-BR texts, icons, categories, valid effects', () => {
    const cat = engine.getCatalog();
    assert.ok(cat.length >= 28);
    const ids = cat.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length, 'unique ids');
    for (const id of REQUIRED) assert.ok(ids.includes(id), `missing ${id}`);
    const placeholders = new Set(Object.values(PLACEHOLDERS));
    for (const d of cat) {
        assert.match(d.id, /^[a-z]+(_[a-z]+)+$/);
        assert.ok(ACTION_CATEGORIES.includes(d.category), d.id);
        assert.ok(d.name.length > 3 && d.description.length > 15, d.id);
        assert.match(d.icon, /^fa-solid fa-[a-z-]+$/);
        assert.ok(['none', 'nation'].includes(d.target));
        assert.ok(Number.isInteger(d.cost.pc) && d.cost.pc >= 0);
        assert.ok(Number.isInteger(d.cooldown) && d.cooldown >= 0);
        assert.ok(Array.isArray(d.keywords) && d.keywords.length >= 3, d.id);
        for (const e of [...d.onSuccess, ...d.onFailure]) {
            assert.ok(EFFECT_TYPES.includes(e.type), `${d.id}: ${e.type}`);
            for (const f of ['target', 'targetB']) if (e[f]) assert.ok(placeholders.has(e[f]), `${d.id}.${f}`);
        }
        assert.ok(Object.isFrozen(d));
    }
    for (const c of ACTION_CATEGORIES) assert.ok(cat.some((d) => d.category === c), c);
    // accents present in player-facing strings (pt-BR, not ASCII-folded)
    assert.equal(cat.find((d) => d.id === 'mil_partial_mobilization').name, 'Mobilização Parcial');
    assert.equal(cat.find((d) => d.id === 'mil_nuclear_strike').playerOnly, true);
    assert.equal(cat.find((d) => d.id === 'dip_declare_war').confirm, true);
});

test('availability: target selection, self target, nuclear, PC and relation reasons', () => {
    const s = fresh();
    const none = engine.getAvailableActions(s, 'BRA', null);
    assert.equal(none.length, engine.getCatalog().length);
    const imp = find(none, 'dip_improve_relations');
    assert.equal(imp.available, false);
    assert.equal(imp.reasons[0], 'Selecione um alvo');
    assert.equal(find(none, 'eco_stimulus').available, true);
    assert.deepEqual(find(none, 'mil_nuclear_alert').reasons, ['Requer arsenal nuclear']);

    const self = engine.getAvailableActions(s, 'BRA', 'BRA');
    assert.equal(find(self, 'dip_send_aid').reasons[0], 'Escolha outra nação como alvo');

    const chn = engine.getAvailableActions(s, 'BRA', 'CHN');
    const war = find(chn, 'dip_declare_war');
    assert.equal(war.available, false);
    assert.ok(war.reasons.includes(`Relação com a China precisa ser de no máximo \u221220 (atual ${getRelation(s, 'BRA', 'CHN')})`), war.reasons.join(' | '));
    assert.ok(find(chn, 'dip_trade_agreement').reasons.includes('Já existe um acordo comercial com a China'));

    const broke = structuredClone(s);
    broke.nations.BRA.pc = 0;
    const r = find(engine.getAvailableActions(broke, 'BRA', 'IND'), 'dip_send_aid');
    assert.ok(r.reasons.includes('Capital Político insuficiente (0/2)'));

    const pol = fresh('POL');
    const ex = find(engine.getAvailableActions(pol, 'POL', 'BRA'), 'mil_border_exercises');
    assert.ok(ex.reasons.includes('Sem fronteira com o Brasil e sem capacidade de projeção (apenas grandes potências)'), ex.reasons.join(' | '));

    const ukr = fresh('UKR');
    const peace = find(engine.getAvailableActions(ukr, 'UKR', 'RUS'), 'dip_propose_peace');
    assert.equal(peace.available, true);
    assert.ok(peace.chance >= 5 && peace.chance <= 95);
    const peaceBra = find(engine.getAvailableActions(ukr, 'UKR', 'BRA'), 'dip_propose_peace');
    assert.ok(peaceBra.reasons.includes('Não há guerra com o Brasil'));
    const exp = find(engine.getAvailableActions(ukr, 'UKR', 'POL'), 'mil_expeditionary');
    assert.ok(exp.reasons.includes('Polônia não está em guerra'), exp.reasons.join(' | '));
    const strikeUsa = find(engine.getAvailableActions(fresh('USA'), 'USA', 'BRA'), 'mil_nuclear_strike');
    assert.ok(strikeUsa.reasons.includes('Não há guerra com o Brasil'));
    const aiStrike = find(engine.getAvailableActions(ukr, 'RUS', 'UKR'), 'mil_nuclear_strike');
    assert.ok(aiStrike.reasons.includes('Ação exclusiva do jogador'));
});

test('availability: puppet / annexed targets and inactive actors', () => {
    const s = fresh();
    s.nations.PAK.status = 'puppet';
    s.nations.PAK.overlord = 'CHN';
    s.nations.IRN.status = 'annexed';
    const a = find(engine.getAvailableActions(s, 'BRA', 'PAK'), 'dip_send_aid');
    assert.ok(a.reasons.includes('Alvo indisponível: Estado-fantoche da China'));
    const b = find(engine.getAvailableActions(s, 'BRA', 'IRN'), 'dip_send_aid');
    assert.ok(b.reasons.includes('Alvo indisponível: território anexado'));
    const c = find(engine.getAvailableActions(s, 'PAK', null), 'eco_stimulus');
    assert.ok(c.reasons.includes('Sua nação não pode agir neste momento'));
});

test('executeAction: deterministic, pays PC and resources, records the player action', () => {
    const s = fresh();
    const a = engine.executeAction(s, 'BRA', 'dip_send_aid', 'IND', { source: 'order' });
    const b = engine.executeAction(s, 'BRA', 'dip_send_aid', 'IND', { source: 'order' });
    assert.deepEqual(a, b);
    assert.equal(a.result.ok, true);
    assert.equal(a.result.success, true);
    assert.equal(a.state.nations.BRA.pc, s.nations.BRA.pc - 2);
    assert.equal(a.state.nations.BRA.resources.economy, s.nations.BRA.resources.economy - 3);
    assert.ok(a.result.details.includes('Capital Político −2'));
    assert.ok(a.result.details.includes('Relação com a Índia +12'));
    const rec = a.state.recentActions.at(-1);
    assert.deepEqual(
        { actorId: rec.actorId, actionId: rec.actionId, targetId: rec.targetId, success: rec.success, source: rec.source, turn: rec.turn },
        { actorId: 'BRA', actionId: 'dip_send_aid', targetId: 'IND', success: true, source: 'order', turn: 1 },
    );
    assert.equal(a.result.summary, 'Enviar Ajuda — Índia: executada.');
    assert.equal(a.state.news.at(-1).text, 'Brasil envia ajuda à Índia');
    // chance-based actions are deterministic too and report the odds
    const c1 = engine.executeAction(s, 'BRA', 'intel_espionage', 'CHN');
    const c2 = engine.executeAction(s, 'BRA', 'intel_espionage', 'CHN');
    assert.deepEqual(c1, c2);
    assert.match(c1.result.summary, /^Espionagem — China: (sucesso|fracasso) \(chance \d+%\)\.$/);
});

test('executeAction: never mutates input; rejected actions return the same state', () => {
    const s = fresh();
    const snap = structuredClone(s);
    engine.executeAction(s, 'BRA', 'eco_stimulus');
    assert.deepEqual(s, snap);
    const bad = engine.executeAction(s, 'BRA', 'nao_existe');
    assert.equal(bad.result.ok, false);
    assert.equal(bad.state, s);
    const noTarget = engine.executeAction(s, 'BRA', 'dip_send_aid', null);
    assert.equal(noTarget.result.ok, false);
    assert.deepEqual(noTarget.result.reasons, ['Selecione um alvo']);
    assert.equal(noTarget.state, s);
});

test('cooldowns: block repeats with a pt-BR reason and expire with turns', () => {
    let s = fresh();
    s = engine.executeAction(s, 'BRA', 'eco_stimulus').state;
    const av = find(engine.getAvailableActions(s, 'BRA'), 'eco_stimulus');
    assert.equal(av.available, false);
    assert.equal(av.cooldownLeft, 6);
    assert.ok(av.reasons.includes('Em recarga: 6 meses restantes'));
    const again = engine.executeAction(s, 'BRA', 'eco_stimulus');
    assert.equal(again.result.ok, false);
    for (let i = 0; i < 5; i++) s = engine.endTurn(s).state;
    assert.equal(find(engine.getAvailableActions(s, 'BRA'), 'eco_stimulus').cooldownLeft, 1);
    assert.ok(find(engine.getAvailableActions(s, 'BRA'), 'eco_stimulus').reasons.includes('Em recarga: 1 mês restante'));
    s = engine.endTurn(s).state;
    assert.equal(find(engine.getAvailableActions(s, 'BRA'), 'eco_stimulus').cooldownLeft, 0);
});

test('chance formula: ChanceSpec, relation weight, counter-intelligence penalty', () => {
    const s = fresh();
    const esp = find(engine.getAvailableActions(s, 'BRA', 'CHN'), 'intel_espionage');
    const expected = Math.round(Math.min(95, Math.max(5, 55 + s.nations.BRA.resources.tech * 0.25 - s.nations.CHN.resources.tech * 0.25)));
    assert.equal(esp.chance, expected);
    const shielded = engine.executeAction(s, 'CHN', 'intel_counterintel').state;
    const esp2 = find(engine.getAvailableActions(shielded, 'BRA', 'CHN'), 'intel_espionage');
    assert.equal(esp2.chance, Math.max(5, expected - 20));
    assert.equal(find(engine.getAvailableActions(s, 'BRA'), 'eco_austerity').chance, 100);
});

test('diplomatic proposals: AI acceptance for player proposals, engine event for AI proposals', () => {
    const s = fresh();
    const av = find(engine.getAvailableActions(s, 'BRA', 'JPN'), 'dip_trade_agreement');
    assert.equal(av.available, true);
    const r = engine.executeAction(s, 'BRA', 'dip_trade_agreement', 'JPN');
    assert.match(r.result.summary, /proposta (aceita|recusada) \(chance \d+%\)/);
    assert.equal(r.state.pacts.some((p) => p.type === 'trade' && p.members.includes('JPN') && p.members.includes('BRA')), r.result.success);
    // acceptance responds to relation
    const friendly = structuredClone(s);
    friendly.relations['BRA|JPN'] = 90;
    const hostile = structuredClone(s);
    hostile.relations['BRA|JPN'] = -10;
    assert.ok(find(engine.getAvailableActions(friendly, 'BRA', 'JPN'), 'dip_trade_agreement').chance > find(engine.getAvailableActions(hostile, 'BRA', 'JPN'), 'dip_trade_agreement').chance);

    const ai = engine.executeAction(s, 'IND', 'dip_trade_agreement', 'BRA', { source: 'ai' });
    assert.equal(ai.result.ok, true);
    assert.match(ai.result.summary, /proposta enviada/);
    const ev = ai.state.eventQueue.at(-1);
    assert.equal(ev.source, 'engine');
    assert.equal(ev.title, 'Proposta de Acordo Comercial');
    assert.deepEqual(ev.options[0].effects[0], { type: 'pact', action: 'create', pactType: 'trade', target: 'IND', targetB: 'PLAYER' });
    assert.equal(ai.state.recentActions.length, s.recentActions.length, 'AI actions are not player records');
    const done = engine.resolvePendingEvent(ai.state, 0);
    assert.ok(done.state.pacts.some((p) => p.type === 'trade' && p.members.includes('IND') && p.members.includes('BRA')));
});

test('mobilization requirements and demobilization specials', () => {
    let s = fresh();
    s = engine.executeAction(s, 'BRA', 'mil_partial_mobilization').state;
    assert.ok(s.modifiers.some((m) => m.nationId === 'BRA' && m.source === 'mil_partial_mobilization'));
    const again = find(engine.getAvailableActions(s, 'BRA'), 'mil_partial_mobilization');
    assert.ok(again.reasons.includes('Já existe uma mobilização em curso'));
    const demob = engine.executeAction(s, 'BRA', 'mil_demobilize');
    assert.equal(demob.result.ok, true);
    assert.equal(demob.state.modifiers.some((m) => m.nationId === 'BRA' && m.source === 'mil_partial_mobilization'), false);
    assert.ok(demob.result.details.includes('Mobilizações encerradas'));
    const fresh2 = fresh();
    assert.ok(find(engine.getAvailableActions(fresh2, 'BRA'), 'mil_demobilize').reasons.includes('Nenhuma mobilização em curso'));
    const warUkr = fresh('UKR');
    assert.ok(find(engine.getAvailableActions(warUkr, 'UKR'), 'mil_demobilize').reasons.includes('Indisponível durante uma guerra'));
});

test('nuclear strike: player-only, devastating, pushes tension toward the brink', () => {
    const s = fresh('RUS');
    const r = engine.executeAction(s, 'RUS', 'mil_nuclear_strike', 'UKR');
    assert.equal(r.result.ok, true);
    assert.ok(r.state.nations.UKR.resources.economy <= s.nations.UKR.resources.economy - 25);
    assert.ok(r.state.globalTension >= Math.min(100, s.globalTension + 35));
    assert.ok(r.state.news.some((n) => n.text.startsWith('ATAQUE NUCLEAR: Rússia atinge a Ucrânia')));
});
