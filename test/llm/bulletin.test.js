import test from 'node:test';
import assert from 'node:assert/strict';

import { createLlm, cleanBulletin } from '../../src/llm/index.js';
import { buildBulletinPrompt } from '../../src/llm/prompts.js';
import { NARRATOR_NAME } from '../../src/contract/constants.js';
import { makeState, makeReport, makeEngine } from '../st/worldFixture.js';

const TEXT = 'A Rússia avançou no Donbas neste mês, enquanto exercícios militares chineses perto de Taiwan elevaram a tensão no Pacífico. Em Brasília, o governo optou por defender a desdolarização na cúpula do BRICS, irritando Washington.';

function makeSt(quiet) {
    const prompts = [];
    return {
        prompts,
        getSettings: () => ({ llmEvents: true }),
        async generateStructured() {
            return { ok: false };
        },
        async generateQuiet(p) {
            prompts.push(p);
            return quiet(p);
        },
        recentChatText: () => '',
    };
}

test('writeBulletin uses st.generateQuiet with headlines and the decision', async () => {
    const st = makeSt(async () => TEXT);
    const out = await createLlm({ st, engine: makeEngine() }).writeBulletin(makeState(), {
        report: makeReport(),
        decision: { eventTitle: 'Cúpula do BRICS', optionLabel: 'Defender a desdolarização' },
    });
    assert.equal(out, TEXT);
    const p = st.prompts[0];
    assert.match(p, new RegExp(NARRATOR_NAME));
    assert.match(p, /Brazilian Portuguese \(pt-BR\), 80-150 words/);
    assert.match(p, /journalistic/);
    assert.match(p, /- Rússia avança no Donbas/);
    assert.match(p, /- Rússia avança 3% na Ucrânia/);
    assert.match(p, /"Cúpula do BRICS" → "Defender a desdolarização"/);
    assert.match(p, /Outubro de 2026/);
});

test('writeBulletin returns "" on failure or empty output', async () => {
    const failing = makeSt(async () => {
        throw new Error('offline');
    });
    assert.equal(await createLlm({ st: failing, engine: makeEngine() }).writeBulletin(makeState(), { report: makeReport() }), '');
    const empty = makeSt(async () => '   ');
    assert.equal(await createLlm({ st: empty, engine: makeEngine() }).writeBulletin(makeState(), { report: makeReport() }), '');
    assert.equal(await createLlm({ st: empty, engine: makeEngine() }).writeBulletin(null, {}), '');
});

test('cleanBulletin strips reasoning, labels, fences and quotes; caps the length', () => {
    assert.equal(cleanBulletin(`<think>planejando</think>**Boletim Internacional:** ${TEXT}`), TEXT);
    assert.equal(cleanBulletin(`"${TEXT}"`), TEXT);
    assert.equal(cleanBulletin('```\n' + TEXT + '\n```'), TEXT);
    assert.equal(cleanBulletin('curto'), '');
    const long = cleanBulletin(`${TEXT} `.repeat(10));
    assert.ok(long.length <= 1200);
    assert.ok(long.endsWith('.'));
});

test('bulletin prompt without a decision forbids inventing one; quiet month has a filler fact', () => {
    const p = buildBulletinPrompt(makeState(), { report: makeReport({ headlines: [], warUpdates: [] }) });
    assert.match(p, /Do not invent decisions/);
    assert.match(p, /Um mês sem grandes manchetes/);
});
