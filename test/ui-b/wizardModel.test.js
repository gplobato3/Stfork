import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DIFFICULTY_META,
    applyBookmark,
    blocsIn,
    cleanLeaderName,
    countryArticle,
    filterNations,
    nationDifficulty,
    nationDiplomacy,
    nationPower,
    normalizeSearch,
    ofCountry,
    playableNations,
    resourceRows,
    sortNations,
    summaryLine,
} from '../../src/ui/dialogs/wizardModel.js';
import * as wizard from '../../src/ui/dialogs/wizard.js';
import { SCENARIO } from '../../dev/ui-b/fixtures.js';

const bm = (id) => SCENARIO.bookmarks.find((b) => b.id === id);
const world2026 = applyBookmark(SCENARIO, bm('b2026'));
const list2026 = playableNations(world2026);
const ids = (arr) => arr.map((n) => n.id);

test('normalizeSearch strips accents, case and extra spaces', () => {
    assert.equal(normalizeSearch('  Rússia  '), 'russia');
    assert.equal(normalizeSearch('São  Tomé e Príncipe'), 'sao tome e principe');
    assert.equal(normalizeSearch('IRÃ'), 'ira');
    assert.equal(normalizeSearch(null), '');
    assert.equal(normalizeSearch(42), '42');
});

test('filterNations: accent-insensitive search over name, id, capital, bloc and traits', () => {
    assert.deepEqual(ids(filterNations(list2026, { query: 'russia' })), ['RUS']);
    assert.deepEqual(ids(filterNations(list2026, { query: 'ira' })), ['IRN']);
    assert.deepEqual(ids(filterNations(list2026, { query: 'BRASILIA' })), ['BRA']);
    assert.deepEqual(ids(filterNations(list2026, { query: 'petroleo' })), ['VEN']);
    assert.deepEqual(ids(filterNations(list2026, { query: 'twn' })), ['TWN']);
    assert.ok(ids(filterNations(list2026, { query: 'potencia nuclear' })).includes('FRA'));
    assert.deepEqual(ids(filterNations(list2026, { query: 'otan alemanha' })), ['DEU'], 'all tokens must match');
    assert.equal(filterNations(list2026, { query: 'zzz' }).length, 0);
    assert.equal(filterNations(list2026, {}).length, list2026.length);
});

test('filterNations: bloc chips and recommended filter', () => {
    const nato = filterNations(list2026, { bloc: 'NATO' });
    assert.ok(nato.length > 0 && nato.every((n) => n.bloc === 'NATO'));
    const rec = filterNations(list2026, { bloc: 'recommended', recommended: ['BRA', 'USA'] });
    assert.deepEqual(ids(rec).sort(), ['BRA', 'USA']);
    assert.deepEqual(ids(filterNations(list2026, { bloc: 'BRICS', query: 'bra' })), ['BRA']);
    assert.deepEqual(blocsIn(list2026), ['NATO', 'CSTO', 'BRICS', 'NON_ALIGNED'], 'BLOCS order, only present ones');
});

test('sortNations: poder desc, nome pt-BR, dificuldade fácil→difícil; never mutates', () => {
    const before = ids(list2026);
    const byPower = sortNations(list2026, 'poder');
    for (let i = 1; i < byPower.length; i += 1) assert.ok(nationPower(byPower[i - 1]) >= nationPower(byPower[i]));
    assert.equal(byPower[0].id, 'USA');
    const byName = ids(sortNations(list2026, 'nome'));
    assert.deepEqual(byName.slice(0, 4), ['DEU', 'ARG', 'BRA', 'CHN'], 'Alemanha, Argentina, Brasil, China');
    assert.ok(byName.indexOf('IND') < byName.indexOf('IRN'), 'Índia sorts with I, before Irã');
    const byDiff = sortNations(list2026, 'dificuldade');
    const order = byDiff.map((n) => ['facil', 'normal', 'dificil'].indexOf(nationDifficulty(n)));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.deepEqual(ids(list2026), before);
    assert.deepEqual(ids(sortNations(list2026, 'bogus')), ids(byPower), 'unknown mode = poder');
});

test('applyBookmark merges nation overrides deeply and never mutates the scenario', () => {
    const snapshot = JSON.stringify(SCENARIO);
    const w = applyBookmark(SCENARIO, bm('b2028'));
    assert.equal(w.nations.TWN.resources.economy, 62);
    assert.equal(w.nations.TWN.resources.tech, 92, 'untouched resource kept');
    assert.equal(w.nations.TWN.name, 'Taiwan');
    assert.equal(w.relations['CHN|TWN'], -90);
    assert.equal(w.relations['BRA|USA'], SCENARIO.relations['BRA|USA']);
    assert.equal(w.wars.length, 1);
    assert.equal(w.wars[0].ceasefire, true);
    assert.ok(w.crises.some((c) => c.id === 'crisis-taiwan'));
    assert.deepEqual(w.pacts, SCENARIO.pacts, 'no pacts override -> base list');
    assert.equal(JSON.stringify(SCENARIO), snapshot);
    assert.notEqual(w.nations.TWN, SCENARIO.nations.TWN);

    const w31 = applyBookmark(SCENARIO, bm('b2031'));
    assert.ok(w31.pacts.some((p) => p.id === 'pact-axis'), 'pacts replaced');
    assert.equal(w31.crises.length, 0, 'empty override list replaces');
    assert.equal(w31.nations.USA.resources.warSupport, 70);

    const none = applyBookmark(SCENARIO, null);
    assert.equal(Object.keys(none.nations).length, Object.keys(SCENARIO.nations).length);
    assert.doesNotThrow(() => applyBookmark(null, null));
});

test('nationDiplomacy lists period-correct wars, pacts and crises', () => {
    const w31 = applyBookmark(SCENARIO, bm('b2031'));
    const twn = nationDiplomacy(w31, 'TWN');
    assert.equal(twn.wars.length, 1);
    assert.equal(twn.wars[0].name, 'Terceira Guerra Mundial');
    assert.equal(twn.wars[0].side, 'defender');
    assert.deepEqual(twn.wars[0].enemies, ['CHN', 'RUS']);
    assert.ok(twn.wars[0].allies.includes('USA'));
    const chn = nationDiplomacy(w31, 'CHN');
    assert.equal(chn.wars[0].side, 'attacker');
    assert.deepEqual(chn.pacts.map((p) => p.name), ['Coalizão Eurasiana']);
    assert.deepEqual(chn.pacts[0].partners, ['RUS', 'IRN']);
    assert.equal(chn.pacts[0].typeLabel, 'Aliança');

    const w28 = applyBookmark(SCENARIO, bm('b2028'));
    assert.ok(nationDiplomacy(w28, 'TWN').crises.some((c) => c.title === 'Quarentena naval de Taiwan'));
    assert.deepEqual(nationDiplomacy(w28, 'ARG').wars, []);
    assert.ok(nationDiplomacy(world2026, 'BRA').pacts.some((p) => p.name === 'Mercosul'));
});

test('playableNations uses the playable flag with a legacy fallback', () => {
    assert.equal(list2026.length, 14);
    const mixed = { nations: { A: { id: 'A', playable: true, resources: {} }, B: { id: 'B', playable: false, resources: {} }, C: { id: 'C', playable: true, status: 'annexed', resources: {} } } };
    assert.deepEqual(ids(playableNations(mixed)), ['A']);
    const legacy = { nations: { A: { id: 'A', resources: {} }, B: { id: 'B' } } };
    assert.deepEqual(ids(playableNations(legacy)), ['A']);
    assert.deepEqual(playableNations(null), []);
});

test('nationPower / nationDifficulty / resourceRows', () => {
    assert.ok(nationPower(SCENARIO.nations.USA) > nationPower(SCENARIO.nations.VEN));
    assert.equal(nationPower({}), 0);
    assert.equal(nationDifficulty(SCENARIO.nations.UKR), 'dificil');
    assert.equal(nationDifficulty({ resources: { economy: 100, military: 100, tech: 100, influence: 100, manpower: 100, stability: 100 } }), 'facil');
    const rows = resourceRows({ resources: { economy: 140, military: -3 } });
    assert.equal(rows.length, 7);
    assert.deepEqual(rows.slice(0, 2), [{ key: 'economy', value: 100 }, { key: 'military', value: 0 }]);
});

test('summary line uses the right pt-BR contraction', () => {
    const date = { year: 2026, month: 10 };
    assert.equal(summaryLine({ leaderTitle: 'Presidente', leaderName: 'Helena Duarte', nationName: 'Brasil', date }),
        'Você será Presidente Helena Duarte do Brasil em Outubro de 2026.');
    assert.equal(ofCountry('Estados Unidos'), 'dos Estados Unidos');
    assert.equal(ofCountry('China'), 'da China');
    assert.equal(ofCountry('Portugal'), 'de Portugal');
    assert.equal(ofCountry('Israel'), 'de Israel');
    assert.equal(ofCountry('Japão'), 'do Japão');
    assert.equal(ofCountry('Irã'), 'do Irã');
    assert.equal(ofCountry('Filipinas'), 'das Filipinas');
    assert.equal(ofCountry('Coreia do Sul'), 'da Coreia do Sul');
    assert.equal(ofCountry('Reino Unido'), 'do Reino Unido');
    assert.equal(ofCountry('Emirados Árabes Unidos'), 'dos Emirados Árabes Unidos');
    assert.equal(ofCountry('Taiwan'), 'de Taiwan');
    assert.equal(countryArticle(''), '');
    assert.equal(summaryLine({ leaderTitle: 'Rei', leaderName: '', nationName: '', date: null }), 'Você será Rei.');
});

test('cleanLeaderName trims, collapses whitespace and caps length', () => {
    assert.equal(cleanLeaderName('  Ana   Souza  '), 'Ana Souza');
    assert.equal(cleanLeaderName(undefined), '');
    assert.equal(cleanLeaderName('x'.repeat(100)).length, 48);
});

test('difficulty texts are pt-BR and cover the three levels', () => {
    assert.deepEqual(Object.keys(DIFFICULTY_META), ['facil', 'normal', 'dificil']);
    assert.equal(DIFFICULTY_META.facil.label, 'Fácil');
    assert.equal(DIFFICULTY_META.dificil.label, 'Difícil');
});

test('wizard.js re-exports the pure helpers and openWizard', () => {
    for (const k of ['openWizard', 'applyBookmark', 'filterNations', 'sortNations', 'normalizeSearch', 'nationDiplomacy', 'summaryLine']) {
        assert.equal(typeof wizard[k], 'function', k);
    }
});
