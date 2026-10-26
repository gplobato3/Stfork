import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSitrep, estimateTokens, CHARS_PER_TOKEN } from '../../src/llm/sitrep.js';
import { createLlm } from '../../src/llm/index.js';
import { makeState, makeEngine, deepFreeze } from '../st/worldFixture.js';

function bigState() {
    const s = makeState({ pendingEvent: { id: 'e1', title: 'Caracas testa a fronteira', options: [] }, eventQueue: [{ id: 'e2' }] });
    s.wars = [
        {
            id: 'w2', name: 'Guerra do Essequibo', attackers: ['VEN'], defenders: ['BRA', 'GUY'], startedTurn: 2,
            fronts: [{ attacker: 'VEN', defender: 'GUY', progress: 35 }, { attacker: 'VEN', defender: 'BRA', progress: 6 }, { attacker: 'BRA', defender: 'VEN', progress: 12 }],
            score: -20, exhaustion: { BRA: 15, VEN: 40, GUY: 60 }, ceasefire: false,
        },
        ...s.wars,
    ];
    for (let i = 0; i < 12; i++) {
        s.news.push({ turn: 3, date: s.date, text: `Manchete número ${i} com bastante texto para ocupar espaço no relatório`, kind: 'world', nations: [] });
        s.crises.push({ id: `cx${i}`, title: `Crise secundária ${i}`, description: 'Descrição longa da crise secundária para ocupar espaço.', severity: 'low', involved: ['ARG', 'USA'], turnStarted: 1 });
        s.recentActions.push({ turn: 3, actorId: 'BRA', actionId: `a${i}`, targetId: null, success: i % 2 === 0, source: 'ui', summary: `Ação ${i} do governo` });
    }
    return s;
}

test('wrapped in [SITUAÇÃO — <date>] … [/SITUAÇÃO] with the instruction line', () => {
    const text = buildSitrep(makeState());
    const lines = text.split('\n');
    assert.equal(lines[0], '[SITUAÇÃO — Outubro de 2026]');
    assert.equal(lines.at(-1), '[/SITUAÇÃO]');
    const instruction = lines.at(-2);
    assert.match(instruction, /^Instrução:/);
    assert.match(instruction, /sem inventar números/);
    assert.match(instruction, /não|sem contradizê-los/);
    assert.match(instruction, /chefe de Estado \(Brasil\)/);
});

test('content: ruler, resources, PC, DEFCON, wars, crises, actions, headlines, allies/rivals', () => {
    const text = buildSitrep(makeState({ pendingEvent: { title: 'Cúpula de emergência' } }), { detail: 'full', budgetTokens: 2000 });
    assert.match(text, /Governante: Presidente Gabriel Lobato, chefe de Estado\. Nação: Brasil \(República presidencialista; bloco BRICS\)/);
    assert.match(text, /Mês 3 da campanha, que termina em Janeiro de 2036/);
    assert.match(text, /Recursos \(0-100\): Economia 62, Força Militar 45, Estabilidade 70, Influência 55, Tecnologia 48, Efetivo 60, Apoio à Guerra 30\./);
    assert.match(text, /Capital Político: 7\/30\. Tensão mundial: 44\/100 \(DEFCON 3 — Alerta\)/);
    assert.match(text, /Decisão pendente do governo: "Cúpula de emergência"/);
    assert.match(text, /Ações do governo neste mês:\n- Mobilização parcial decretada \(sucesso\) \[ordem no chat\]\n- Aproximação com a Argentina \(falhou\) \[ordem no chat\]/);
    assert.ok(!text.includes('Estímulo econômico aprovado'), 'previous turn actions excluded');
    assert.match(text, /Crises:\n- \[Alta\] Bloqueio no Estreito de Taiwan — China, Taiwan, Estados Unidos: Navios chineses/);
    assert.match(text, /Manchetes recentes:\n- China realiza exercícios perto de Taiwan\n- Rússia avança no Donbas/);
    assert.match(text, /Aliados: Argentina \(\+64\)\./);
    assert.match(text, /Rivais: Venezuela \(−48\)\./);
    assert.match(text, /Pactos: Mercosul \(comércio\)\./);
    assert.match(text, /Medidas em vigor:\n- Mobilização parcial \(força militar \+2\/mês, economia −1\/mês; 4 meses\)/);
    assert.match(text, /Outras guerras no mundo:\n- Guerra Russo-Ucraniana: Rússia × Ucrânia; Rússia→Ucrânia 18% ocupado/);
    assert.match(text, /Última decisão do governo: "Cúpula do BRICS" → Defender a desdolarização\./);
});

test('player wars list fronts, balance and exhaustion', () => {
    const text = buildSitrep(bigState(), { detail: 'full', budgetTokens: 5000 });
    assert.match(text, /Guerras do país:\n- Guerra do Essequibo \(Venezuela × Brasil, Guiana\); frentes: Brasil→Venezuela 12% ocupado; Venezuela→Brasil 6% ocupado; Venezuela→Guiana 35% ocupado; situação defensores em vantagem; cansaço: Brasil 15, Guiana 60, Venezuela 40/);
});

test('compact is shorter than full and both are deterministic', () => {
    const s = bigState();
    const compact = buildSitrep(s, { detail: 'compact', budgetTokens: 5000 });
    const full = buildSitrep(s, { detail: 'full', budgetTokens: 5000 });
    assert.ok(compact.length < full.length);
    assert.equal(buildSitrep(s, { detail: 'full', budgetTokens: 5000 }), full);
    assert.ok(!compact.includes('Medidas em vigor'), 'modifiers only in full');
});

test('budget trimming: fits the budget and drops lowest-priority sections first', () => {
    const s = bigState();
    const untrimmed = buildSitrep(s, { detail: 'full', budgetTokens: 100000 });
    assert.ok(estimateTokens(untrimmed) > 500);
    const text = buildSitrep(s, { detail: 'full', budgetTokens: 450 });
    assert.ok(estimateTokens(text) <= 450, `${estimateTokens(text)} tokens`);
    // highest priority kept
    assert.match(text, /Decisão pendente do governo/);
    assert.match(text, /Guerras do país:/);
    assert.match(text, /Ações do governo neste mês:/);
    // lowest priority gone
    assert.ok(!text.includes('Medidas em vigor'));
    assert.ok(!text.includes('Aliados:'));
    assert.ok(!text.includes('Manchetes recentes'));
    // per-line decay: filler crises go before the first line of "other wars"
    assert.match(text, /Outras guerras no mundo:\n- Guerra Russo-Ucraniana/);
    const crisisLines = text.split('Crises:\n')[1].split('\n').filter((l) => l.startsWith('- '));
    assert.ok(crisisLines.length <= 3, `${crisisLines.length} crisis lines`);
    assert.match(crisisLines[0], /\[Alta\] Bloqueio no Estreito de Taiwan/);
    // mandatory lines always present
    for (const re of [/^\[SITUAÇÃO — /, /Recursos \(0-100\)/, /Capital Político/, /Instrução:/, /\[\/SITUAÇÃO\]$/]) assert.match(text, re);
});

test('tiny budget keeps only the mandatory skeleton', () => {
    const text = buildSitrep(bigState(), { budgetTokens: 10 });
    assert.ok(!text.includes('Guerras do país'));
    assert.ok(!text.includes('Crises:'));
    assert.match(text, /^\[SITUAÇÃO — Outubro de 2026\]/);
    assert.match(text, /Instrução:/);
    assert.match(text, /\[\/SITUAÇÃO\]$/);
});

test('token estimate is chars / 3.5', () => {
    assert.equal(CHARS_PER_TOKEN, 3.5);
    assert.equal(estimateTokens('x'.repeat(35)), 10);
    assert.equal(estimateTokens('x'.repeat(36)), 11);
});

test('default compact budget ≈ 250-400 tokens for a busy state', () => {
    const t = estimateTokens(buildSitrep(bigState()));
    assert.ok(t <= 400 && t >= 200, `${t}`);
});

test('no campaign -> ""; input never mutated; macro braces neutralized', () => {
    assert.equal(buildSitrep(null), '');
    const s = deepFreeze(makeState({ player: { nationId: 'BRA', leaderName: '{{char}} Lobato', title: 'Presidente' } }));
    const text = buildSitrep(s);
    assert.ok(!text.includes('{{'));
    assert.match(text, /Presidente char Lobato/);
});

test('status lines: puppet and game over', () => {
    const s = makeState({ outcome: { kind: 'defeat', reason: 'Golpe de Estado', turn: 3 } });
    s.nations = { ...s.nations, BRA: { ...s.nations.BRA, status: 'puppet', overlord: 'USA' } };
    const text = buildSitrep(s);
    assert.match(text, /Status: Estado-fantoche de Estados Unidos\./);
    assert.match(text, /Campanha encerrada: DERROTA — Golpe de Estado\./);
});

test('LlmAPI.buildSitrep delegates to the pure builder', () => {
    const llm = createLlm({ st: { getSettings: () => ({}) }, engine: makeEngine() });
    assert.equal(llm.buildSitrep(makeState(), { budgetTokens: 300 }), buildSitrep(makeState(), { budgetTokens: 300 }));
    assert.equal(llm.buildSitrep(null), '');
});
