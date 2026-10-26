import test from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_CATEGORIES } from '../../src/contract/constants.js';
import { EVENT_CATEGORY_META, EVENT_SOURCE_META, eventCategory, eventSourceMeta } from '../../src/ui/dialogs/eventDialog.js';
import { campaignStats, monthsLabel } from '../../src/ui/dialogs/gameOver.js';
import { hudViewModel } from '../../src/ui/hud/hud.js';
import { wandIconClasses, wandItemId } from '../../src/ui/wand.js';
import { makeState } from './helpers.js';

test('every EVENT_CATEGORIES entry has a pt-BR label and an icon', () => {
    for (const c of EVENT_CATEGORIES) {
        const meta = EVENT_CATEGORY_META[c];
        assert.ok(meta, c);
        assert.ok(meta.label && /\S/.test(meta.label), `${c} label`);
        assert.match(meta.icon, /^fa-solid fa-/);
        assert.match(meta.color, /^#[0-9a-f]{6}$/i);
    }
    assert.equal(EVENT_CATEGORY_META.humanitarian.label, 'Crise Humanitária');
    assert.equal(eventCategory({ category: 'aliens' }), 'politics');
    assert.equal(eventCategory(null), 'politics');
    assert.equal(eventCategory({ category: 'naval' }), 'naval');
});

test('source badges', () => {
    assert.equal(EVENT_SOURCE_META.llm.label, 'Despacho de Inteligência');
    assert.equal(eventSourceMeta({ source: 'engine', category: 'war' }).label, 'Diplomacia');
    assert.equal(eventSourceMeta({ source: 'engine', category: 'diplomacy' }).label, 'Comunicado Oficial');
    assert.equal(eventSourceMeta({ source: 'fallback' }).label, 'Expediente de Governo');
    assert.equal(eventSourceMeta({}).label, 'Despacho de Inteligência');
});

test('campaignStats: months, wars, ranking position', () => {
    const s = makeState();
    s.log = [{ kind: 'war', data: { warId: 'old', attackers: ['BRA'], defenders: ['PRY'] } }, { kind: 'war', data: { warId: 'w1', attackers: ['VEN'], defenders: ['BRA'] } }];
    s.decisions = [{}, {}, {}];
    const ranking = [{ id: 'USA', name: 'EUA', power: 90 }, { id: 'CHN', name: 'China', power: 85 }, { id: 'BRA', name: 'Brasil', power: 55 }];
    assert.deepEqual(campaignStats(s, ranking), { months: 13, wars: 2, rank: 3, rankOf: 3, decisions: 3, tension: 57, allies: 1 });
    assert.deepEqual(campaignStats(null, null), { months: 0, wars: 0, rank: null, rankOf: 0, decisions: 0, tension: 0, allies: 0 });
    assert.equal(monthsLabel(1), '1 mês');
    assert.equal(monthsLabel(14), '14 meses');
});

test('hudViewModel: hidden / start / campaign', () => {
    assert.equal(hudViewModel(makeState(), { settings: { showHud: false } }).mode, 'hidden');
    assert.equal(hudViewModel(makeState(), { settings: { enabled: false } }).mode, 'hidden');
    assert.equal(hudViewModel(null, { settings: { showHud: true } }).mode, 'start');
    assert.equal(hudViewModel({ ...makeState(), phase: 'SETUP' }).mode, 'start');

    const s = makeState();
    s.pendingEvent = { title: 'Tropas na fronteira' };
    s.eventQueue = [{ title: 'Chamado às Armas' }];
    const vm = hudViewModel(s, { busy: false, settings: { showHud: true } });
    assert.equal(vm.mode, 'campaign');
    assert.equal(vm.nationName, 'Brasil');
    assert.equal(vm.leaderLine, 'Presidente Helena Duarte');
    assert.equal(vm.dateText, 'Novembro de 2027');
    assert.equal(vm.dateShort, 'Nov/2027');
    assert.equal(vm.defcon.level, 3);
    assert.equal(vm.tension, 57);
    assert.equal(vm.pc, 12);
    assert.equal(vm.pending, 2);
    assert.equal(vm.pendingTitle, 'Tropas na fronteira');
    assert.equal(vm.wars, 1);
    assert.equal(vm.gameOver, false);
    assert.equal(vm.busy, false);

    const busy = hudViewModel(makeState(), { busy: 'Gerando evento…' });
    assert.equal(busy.busy, true);
    assert.equal(busy.busyLabel, 'Gerando evento…');
    assert.equal(hudViewModel(makeState(), { busy: true }).busyLabel, 'Processando…');
    const over = hudViewModel({ ...makeState(), phase: 'GAME_OVER', outcome: { kind: 'defeat', reason: 'x' } });
    assert.equal(over.gameOver, true);
    assert.equal(over.outcomeKind, 'defeat');
});

test('wand helpers: stable id and icon classes', () => {
    assert.equal(wandItemId('Grande Estratégia'), 'hoi_wand_grande_estrategia');
    assert.equal(wandItemId(''), 'hoi_wand_item');
    assert.deepEqual(wandIconClasses('fa-earth-americas'), ['fa-solid', 'fa-earth-americas', 'extensionsMenuExtensionButton']);
    assert.deepEqual(wandIconClasses('fa-solid fa-map'), ['fa-solid', 'fa-map', 'extensionsMenuExtensionButton']);
});
