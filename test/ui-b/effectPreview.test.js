import test from 'node:test';
import assert from 'node:assert/strict';

import { EFFECT_TYPES } from '../../src/contract/constants.js';
import { describeEffect, describeEffects, resolveNationRef, stanceOf } from '../../src/ui/dialogs/effectPreview.js';
import { MINUS, makeState } from './helpers.js';

const S = makeState();
const d = (effect, state = S, ctx) => describeEffect(effect, state, ctx);

test('stanceOf classifies nations from the player perspective', () => {
    assert.equal(stanceOf(S, 'BRA'), 'self');
    assert.equal(stanceOf(S, 'ARG'), 'ally');
    assert.equal(stanceOf(S, 'VEN'), 'enemy');
    assert.equal(stanceOf(S, 'CHN'), 'friend');
    assert.equal(stanceOf(S, 'USA'), 'neutral');
    assert.equal(stanceOf(S, 'RUS'), 'rival');
    assert.equal(stanceOf(S, 'XXX'), 'unknown');
});

test('every effect type yields pt-BR text, a valid tone and a Font Awesome icon', () => {
    const samples = {
        resource: { type: 'resource', target: 'PLAYER', resource: 'economy', delta: 3 },
        relation: { type: 'relation', target: 'CHN', delta: 5 },
        tension: { type: 'tension', delta: 2 },
        pc: { type: 'pc', target: 'PLAYER', delta: 1 },
        modifier: { type: 'modifier', target: 'PLAYER', label: 'Reformas', perTurn: { stability: 1 }, turns: 3 },
        crisis: { type: 'crisis', action: 'start', title: 'Greve geral', severity: 'low', involved: ['ARG'] },
        pact: { type: 'pact', action: 'create', pactType: 'trade', target: 'BRA', targetB: 'CHN' },
        war: { type: 'war', action: 'declare', target: 'RUS', targetB: 'UKR' },
        front: { type: 'front', target: 'BRA', targetB: 'VEN', delta: 4 },
        bloc: { type: 'bloc', target: 'ARG', bloc: 'BRICS' },
        flag: { type: 'flag', key: 'x', value: true },
        news: { type: 'news', text: 'Manchete de teste' },
    };
    for (const type of EFFECT_TYPES) {
        assert.ok(samples[type], `sample for ${type}`);
        const r = d(samples[type]);
        assert.equal(typeof r.text, 'string');
        assert.ok(r.text.length > 0, `${type} text`);
        assert.notEqual(r.text, 'Efeito desconhecido', `${type} is described`);
        assert.ok(['good', 'bad', 'neutral'].includes(r.tone), `${type} tone`);
        assert.match(r.icon, /^fa-solid fa-[a-z0-9-]+$/, `${type} icon`);
    }
});

test('resource: own gains good, losses bad; enemy losses good; ally losses bad; neutral neutral', () => {
    assert.deepEqual(d({ type: 'resource', target: 'PLAYER', resource: 'economy', delta: 3 }), { text: 'Economia +3', tone: 'good', icon: 'fa-solid fa-coins' });
    const loss = d({ type: 'resource', target: 'PLAYER', resource: 'military', delta: -4 });
    assert.equal(loss.text, `Força Militar ${MINUS}4`);
    assert.equal(loss.tone, 'bad');
    const enemy = d({ type: 'resource', target: 'VEN', resource: 'economy', delta: -8 });
    assert.equal(enemy.text, `Venezuela: Economia ${MINUS}8`);
    assert.equal(enemy.tone, 'good');
    assert.equal(d({ type: 'resource', target: 'VEN', resource: 'military', delta: 5 }).tone, 'bad');
    assert.equal(d({ type: 'resource', target: 'ARG', resource: 'stability', delta: -4 }).tone, 'bad');
    assert.equal(d({ type: 'resource', target: 'USA', resource: 'economy', delta: 5 }).tone, 'neutral');
    assert.equal(d({ type: 'resource', target: 'BRA', resource: 'tech', delta: 0 }).tone, 'neutral');
    // Missing target defaults to SELF = player for events.
    assert.equal(d({ type: 'resource', resource: 'influence', delta: 2 }).text, 'Influência +2');
});

test('relation: with the player up = good; third parties by alignment', () => {
    const down = d({ type: 'relation', target: 'VEN', delta: -15 });
    assert.equal(down.text, `Relação com Venezuela ${MINUS}15`);
    assert.equal(down.tone, 'bad');
    assert.equal(down.icon, 'fa-solid fa-handshake-slash');
    assert.equal(d({ type: 'relation', target: 'ARG', delta: 10 }).tone, 'good');
    assert.equal(d({ type: 'relation', target: 'PLAYER', targetB: 'CHN', delta: 4 }).text, 'Relação com China +4');
    const third = d({ type: 'relation', target: 'USA', targetB: 'VEN', delta: -5 });
    assert.equal(third.text, `Relação Estados Unidos–Venezuela ${MINUS}5`);
    assert.equal(third.tone, 'good', 'an enemy losing friends is good for us');
    assert.equal(d({ type: 'relation', target: 'ARG', targetB: 'CHN', delta: 6 }).tone, 'good');
    assert.equal(d({ type: 'relation', target: 'VEN', targetB: 'RUS', delta: 6 }).tone, 'bad');
});

test('tension: up is bad, down is good', () => {
    const up = d({ type: 'tension', delta: 4 });
    assert.equal(up.text, 'Tensão global +4');
    assert.equal(up.tone, 'bad');
    const down = d({ type: 'tension', delta: -6 });
    assert.equal(down.text, `Tensão global ${MINUS}6`);
    assert.equal(down.tone, 'good');
});

test('pc: political capital for the player and others', () => {
    assert.deepEqual(d({ type: 'pc', target: 'PLAYER', delta: -4 }), { text: `Capital Político ${MINUS}4`, tone: 'bad', icon: 'fa-solid fa-landmark' });
    assert.equal(d({ type: 'pc', target: 'PLAYER', delta: 2 }).tone, 'good');
    const enemy = d({ type: 'pc', target: 'VEN', delta: 3 });
    assert.equal(enemy.text, 'Venezuela: Capital Político +3');
    assert.equal(enemy.tone, 'bad');
});

test('modifier: lists per-month deltas; mixed = neutral; one month singular', () => {
    const mob = d({ type: 'modifier', target: 'PLAYER', label: 'Mobilização Parcial', perTurn: { military: 2, economy: -1 }, turns: 6 });
    assert.equal(mob.text, `Mobilização Parcial (6 meses): Economia ${MINUS}1/mês, Força Militar +2/mês`);
    assert.equal(mob.tone, 'neutral');
    assert.equal(mob.icon, 'fa-solid fa-hourglass-half');
    assert.equal(d({ type: 'modifier', target: 'PLAYER', label: 'Boom', perTurn: { economy: 2 }, turns: 1 }).text, 'Boom (1 mês): Economia +2/mês');
    assert.equal(d({ type: 'modifier', target: 'PLAYER', label: 'Boom', perTurn: { economy: 2 }, turns: 3 }).tone, 'good');
    const sanctions = d({ type: 'modifier', target: 'VEN', label: 'Sanções', perTurn: { economy: -2 }, turns: 12 });
    assert.equal(sanctions.text, `Venezuela: Sanções (12 meses): Economia ${MINUS}2/mês`);
    assert.equal(sanctions.tone, 'good');
});

test('crisis: start / escalate / deescalate / resolve', () => {
    const start = d({ type: 'crisis', action: 'start', title: 'Êxodo na fronteira', severity: 'high', involved: ['BRA', 'VEN'] });
    assert.equal(start.text, 'Nova crise: Êxodo na fronteira (Alta)');
    assert.equal(start.tone, 'bad');
    assert.equal(d({ type: 'crisis', action: 'start', title: 'Greve', severity: 'low', involved: ['ARG'] }).tone, 'neutral');
    assert.equal(d({ type: 'crisis', action: 'start', title: 'Greve', severity: 'low', involved: ['PLAYER'] }).tone, 'bad');
    const esc = d({ type: 'crisis', action: 'escalate', crisisId: 'c1' });
    assert.equal(esc.text, 'Crise se agrava: Transição na Venezuela');
    assert.equal(esc.tone, 'bad');
    assert.equal(d({ type: 'crisis', action: 'deescalate', crisisId: 'c1' }).tone, 'good');
    const res = d({ type: 'crisis', action: 'resolve', crisisId: 'c1' });
    assert.equal(res.text, 'Crise resolvida: Transição na Venezuela');
    assert.equal(res.tone, 'good');
    assert.equal(d({ type: 'crisis', action: 'escalate', crisisId: 'nope' }).text, 'Crise se agrava');
});

test('pact: create / break / guarantee', () => {
    const ally = d({ type: 'pact', action: 'create', pactType: 'alliance', target: 'PLAYER', targetB: 'ARG', label: 'Pacto do Sul' });
    assert.equal(ally.text, 'Aliança com Argentina (Pacto do Sul)');
    assert.equal(ally.tone, 'good');
    assert.equal(d({ type: 'pact', action: 'create', pactType: 'alliance', target: 'VEN', targetB: 'RUS' }).tone, 'bad');
    assert.equal(d({ type: 'pact', action: 'create', pactType: 'trade', target: 'VEN', targetB: 'RUS' }).text, 'Acordo Comercial: Venezuela e Rússia');
    const brk = d({ type: 'pact', action: 'break', pactType: 'defense', target: 'BRA', targetB: 'ARG' });
    assert.equal(brk.text, 'Ruptura: Pacto de Defesa com Argentina');
    assert.equal(brk.tone, 'bad');
    assert.equal(d({ type: 'pact', action: 'break', pactType: 'alliance', target: 'VEN', targetB: 'RUS' }).tone, 'good');
    assert.equal(d({ type: 'pact', action: 'create', pactType: 'guarantee', target: 'PLAYER', targetB: 'ARG' }).text, 'Garantir a independência de Argentina');
    const guaranteed = d({ type: 'pact', action: 'create', pactType: 'guarantee', target: 'CHN', targetB: 'PLAYER' });
    assert.equal(guaranteed.text, 'China garante nossa independência');
    assert.equal(guaranteed.tone, 'good');
});

test('war: declare / ceasefire / peace terms', () => {
    const declare = d({ type: 'war', action: 'declare', target: 'PLAYER', targetB: 'VEN' });
    assert.equal(declare.text, 'Declarar guerra a Venezuela');
    assert.equal(declare.tone, 'bad');
    const attacked = d({ type: 'war', action: 'declare', target: 'RUS', targetB: 'BRA' });
    assert.equal(attacked.text, 'Rússia declara guerra contra nós');
    assert.equal(attacked.tone, 'bad');
    assert.equal(d({ type: 'war', action: 'declare', target: 'VEN', targetB: 'ARG' }).tone, 'bad', 'ally attacked');
    assert.equal(d({ type: 'war', action: 'declare', target: 'RUS', targetB: 'UKR' }).text, 'Guerra: Rússia ataca Ucrânia');
    assert.equal(d({ type: 'war', action: 'ceasefire', target: 'BRA', targetB: 'VEN' }).text, 'Cessar-fogo com Venezuela');
    assert.equal(d({ type: 'war', action: 'ceasefire', target: 'BRA', targetB: 'VEN' }).tone, 'good');
    const annex = d({ type: 'war', action: 'peace', target: 'BRA', targetB: 'VEN', terms: 'annex' });
    assert.equal(annex.text, 'Anexar Venezuela');
    assert.equal(annex.tone, 'good');
    const annexed = d({ type: 'war', action: 'peace', target: 'VEN', targetB: 'BRA', terms: 'annex' });
    assert.equal(annexed.text, 'Anexação por Venezuela');
    assert.equal(annexed.tone, 'bad');
    assert.equal(d({ type: 'war', action: 'peace', target: 'VEN', targetB: 'BRA', terms: 'whitePeace' }).text, 'Paz branca com Venezuela');
    assert.equal(d({ type: 'war', action: 'peace', target: 'VEN', targetB: 'BRA', terms: 'reparations' }).text, 'Paz com Venezuela: pagamos reparações');
    assert.equal(d({ type: 'war', action: 'peace', target: 'BRA', targetB: 'VEN', terms: 'puppet' }).text, 'Tornar Venezuela um Estado-fantoche');
    const third = d({ type: 'war', action: 'peace', target: 'VEN', targetB: 'ARG', terms: 'annex' });
    assert.equal(third.text, 'Venezuela anexa Argentina');
    assert.equal(third.tone, 'bad');
});

test('front: our advance good, enemy advance on us bad', () => {
    const ours = d({ type: 'front', target: 'BRA', targetB: 'VEN', delta: 8 });
    assert.equal(ours.text, 'Avanço sobre Venezuela +8%');
    assert.equal(ours.tone, 'good');
    const theirs = d({ type: 'front', target: 'VEN', targetB: 'BRA', delta: 6 });
    assert.equal(theirs.text, 'Avanço de Venezuela em nosso território +6%');
    assert.equal(theirs.tone, 'bad');
    assert.equal(d({ type: 'front', target: 'VEN', targetB: 'BRA', delta: -5 }).tone, 'good');
    assert.equal(d({ type: 'front', target: 'BRA', targetB: 'VEN', delta: -3 }).text, `Recuo em Venezuela ${MINUS}3%`);
    assert.equal(d({ type: 'front', target: 'RUS', targetB: 'UKR', delta: 5 }).text, 'Frente: Rússia avança sobre Ucrânia +5%');
    assert.equal(d({ type: 'front', target: 'RUS', targetB: 'UKR', delta: 5 }).tone, 'bad', 'rival advancing');
});

test('bloc: joining our bloc good, leaving it bad, own change neutral', () => {
    const join = d({ type: 'bloc', target: 'ARG', bloc: 'BRICS' });
    assert.equal(join.text, 'Argentina adere ao bloco BRICS');
    assert.equal(join.tone, 'good');
    const leave = d({ type: 'bloc', target: 'CHN', bloc: 'NON_ALIGNED' });
    assert.equal(leave.text, 'China adota o não alinhamento');
    assert.equal(leave.tone, 'bad');
    const own = d({ type: 'bloc', target: 'PLAYER', bloc: 'NATO' });
    assert.equal(own.text, 'Alinhar ao bloco OTAN');
    assert.equal(own.tone, 'neutral');
});

test('flag, news, unknown and malformed effects never throw', () => {
    assert.deepEqual(d({ type: 'flag', key: 'k', value: 1 }), { text: 'Marco da campanha', tone: 'neutral', icon: 'fa-solid fa-bookmark' });
    const news = d({ type: 'news', text: 'Brasil anuncia sanções' });
    assert.equal(news.text, 'Manchete: “Brasil anuncia sanções”');
    assert.equal(news.tone, 'neutral');
    assert.ok(d({ type: 'news', text: 'x'.repeat(300) }).text.length < 130, 'long headlines are truncated');
    assert.equal(d({ type: 'teleport' }).text, 'Efeito desconhecido');
    assert.equal(d(null).tone, 'neutral');
    assert.equal(d(undefined, undefined).text, 'Efeito desconhecido');
    assert.doesNotThrow(() => d({ type: 'war' }, null));
    assert.doesNotThrow(() => d({ type: 'pact', target: {}, targetB: [] }, {}));
    assert.doesNotThrow(() => d({ type: 'modifier', perTurn: 'x' }, { nations: null }));
});

test('placeholders: SELF/TARGET from ctx, PLAYER from state, sentinels without ctx', () => {
    assert.equal(resolveNationRef('PLAYER', S), 'BRA');
    assert.equal(resolveNationRef('SELF', S), 'BRA');
    assert.equal(resolveNationRef('SELF', S, { actorId: 'CHN' }), 'CHN');
    assert.equal(resolveNationRef('TARGET', S, { targetId: 'VEN' }), 'VEN');
    assert.equal(resolveNationRef('TARGET', S), 'TARGET');

    const ctx = { actorId: 'BRA', targetId: 'VEN' };
    const sanction = d({ type: 'resource', target: 'TARGET', resource: 'economy', delta: -5 }, S, ctx);
    assert.equal(sanction.text, `Venezuela: Economia ${MINUS}5`);
    assert.equal(sanction.tone, 'good');
    assert.equal(d({ type: 'relation', target: 'SELF', targetB: 'TARGET', delta: -10 }, S, ctx).text, `Relação com Venezuela ${MINUS}10`);
    assert.equal(d({ type: 'war', action: 'declare', target: 'SELF', targetB: 'TARGET' }, S, ctx).text, 'Declarar guerra a Venezuela');

    const unresolved = d({ type: 'resource', target: 'TARGET', resource: 'economy', delta: -5 });
    assert.equal(unresolved.text, `O alvo: Economia ${MINUS}5`);
    assert.equal(unresolved.tone, 'neutral');
    assert.equal(d({ type: 'relation', target: 'TARGET', delta: 5 }).text, 'Relação com o alvo +5');

    // AI actor as SELF: China (friend) gaining is good for us.
    assert.equal(d({ type: 'resource', target: 'SELF', resource: 'economy', delta: 3 }, S, { actorId: 'CHN' }).text, 'China: Economia +3');
    // No state at all: SELF / PLAYER mean "us".
    assert.deepEqual(d({ type: 'resource', target: 'SELF', resource: 'economy', delta: 2 }, null), { text: 'Economia +2', tone: 'good', icon: 'fa-solid fa-coins' });
    assert.equal(d({ type: 'pc', target: 'PLAYER', delta: -1 }, null).tone, 'bad');
});

test('describeEffects maps lists and skips junk; inputs are not mutated', () => {
    const effects = [{ type: 'tension', delta: 1 }, null, 'x', { type: 'pc', target: 'PLAYER', delta: 1 }];
    const copy = JSON.stringify(effects);
    const state = makeState();
    const before = JSON.stringify(state);
    const list = describeEffects(effects, state);
    assert.equal(list.length, 2);
    assert.equal(JSON.stringify(effects), copy);
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(describeEffects(undefined, state), []);
});
