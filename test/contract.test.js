/**
 * @file test/contract.test.js
 * node:test unit tests for the SHARED CONTRACT (FEAT-001).
 * Run: node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createEmptyWorldState,
    isWorldStateShape,
    SCHEMA_VERSION,
    RESOURCE_KEYS,
    relationKey,
    createResources,
    clampResource,
    clampRelation,
    clampTension,
    START_DATE,
    PHASES,
} from '../src/contract/worldState.js';

import {
    validateEvent,
    validateEffect,
    EVENT_SCHEMA,
    EFFECT_SCHEMA,
} from '../src/contract/schemas.js';

import { EFFECT_TYPES, createCrisis, isEffectType } from '../src/contract/events.js';
import { t, loadLocale, hasKey } from '../src/i18n/i18n.js';
import { getContext, getSeedRandom, isLive } from '../src/core/stContext.js';

test('createEmptyWorldState returns the documented shape', () => {
    const s = createEmptyWorldState({ campaignId: 'camp-1', seed: 'seed-1' });
    assert.ok(isWorldStateShape(s), 'should pass isWorldStateShape');
    assert.equal(s.schemaVersion, SCHEMA_VERSION);
    assert.equal(s.campaignId, 'camp-1');
    assert.equal(s.seed, 'seed-1');
    assert.equal(s.turn, 0);
    assert.equal(s.phase, PHASES.SETUP);
    assert.equal(s.playerNationId, null);
    assert.deepEqual(s.date, { year: START_DATE.year, month: START_DATE.month });
    assert.equal(s.date.year, 2027);
    assert.ok(s.globalTension >= 0 && s.globalTension <= 100);
    assert.deepEqual(s.nations, {});
    assert.deepEqual(s.relations, {});
    assert.deepEqual(s.activeCrises, []);
    assert.deepEqual(s.log, []);
    assert.equal(typeof s.flags, 'object');
});

test('createEmptyWorldState generates ids when none supplied', () => {
    const a = createEmptyWorldState();
    const b = createEmptyWorldState();
    assert.equal(typeof a.campaignId, 'string');
    assert.ok(a.campaignId.length > 0);
    assert.equal(a.seed, a.campaignId, 'seed defaults to campaignId');
    assert.notEqual(a.campaignId, b.campaignId, 'ids should differ');
});

test('RESOURCE_KEYS has the 7 documented resources', () => {
    assert.deepEqual(
        [...RESOURCE_KEYS].sort(),
        ['economy', 'influence', 'manpower', 'military', 'stability', 'tech', 'warSupport'].sort(),
    );
    assert.equal(RESOURCE_KEYS.length, 7);
});

test('relationKey is order-independent and normalized', () => {
    assert.equal(relationKey('USA', 'RUS'), relationKey('RUS', 'USA'));
    assert.equal(relationKey('RUS', 'USA'), 'RUS|USA');
    assert.equal(relationKey('BRA', 'ARG'), 'ARG|BRA');
});

test('createResources clamps and fills all keys', () => {
    const r = createResources({ economy: 999, military: -50, tech: 42 });
    for (const k of RESOURCE_KEYS) assert.equal(typeof r[k], 'number');
    assert.equal(r.economy, 100);
    assert.equal(r.military, 0);
    assert.equal(r.tech, 42);
});

test('clamp helpers respect bounds', () => {
    assert.equal(clampResource(150), 100);
    assert.equal(clampResource(-5), 0);
    assert.equal(clampRelation(-200), -100);
    assert.equal(clampRelation(200), 100);
    assert.equal(clampTension(-1), 0);
    assert.equal(clampTension(101), 100);
});

test('validateEvent accepts a valid GameEvent and normalizes it', () => {
    const good = {
        title: 'Crise Energética na Europa',
        narrative: 'O fornecimento de gás é cortado abruptamente.',
        tensionDelta: 4,
        options: [
            { label: 'Liberar reservas estratégicas', rationale: 'Acalmar o mercado.', effects: [{ type: 'resource', target: 'DEU', resource: 'economy', delta: -3 }] },
            { label: 'Culpar o rival', rationale: 'Ganhar apoio interno.', effects: [{ type: 'relation', target: 'DEU', targetB: 'RUS', delta: -10 }, { type: 'tension', delta: 6 }] },
            { label: 'Não fazer nada', rationale: 'Esperar.', effects: [] },
        ],
    };
    const res = validateEvent(good);
    assert.ok(res.ok, 'should be ok: ' + res.errors.join('; '));
    assert.equal(res.errors.length, 0);
    assert.equal(res.value.title, good.title);
    assert.equal(res.value.options.length, 3);
    // normalized option ids
    assert.equal(res.value.options[0].id, 'opt_0');
    // delta clamped to resource bounds (-50..50) remains -3
    assert.equal(res.value.options[0].effects[0].delta, -3);
});

test('validateEvent rejects an invalid GameEvent', () => {
    const bad = { title: '', options: [] };
    const res = validateEvent(bad);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
    assert.equal(res.value, null);
});

test('validateEvent rejects wrong option count', () => {
    const one = {
        title: 'T',
        narrative: 'N',
        options: [{ label: 'só uma', effects: [] }],
    };
    assert.equal(validateEvent(one).ok, false);
});

test('validateEvent parses a JSON string input', () => {
    const str = JSON.stringify({
        title: 'A',
        narrative: 'B',
        options: [
            { label: 'x', effects: [] },
            { label: 'y', effects: [] },
        ],
    });
    assert.equal(validateEvent(str).ok, true);
    assert.equal(validateEvent('not json {').ok, false);
});

test('validateEffect enforces per-type payloads', () => {
    assert.equal(validateEffect({ type: 'tension', delta: 5 }).errors.length, 0);
    assert.equal(validateEffect({ type: 'resource', target: 'BRA', resource: 'economy', delta: 5 }).errors.length, 0);
    assert.equal(validateEffect({ type: 'resource', target: 'BRA', resource: 'nope', delta: 5 }).errors.length > 0, true);
    assert.equal(validateEffect({ type: 'relation', target: 'A', targetB: 'B', delta: -10 }).errors.length, 0);
    assert.equal(validateEffect({ type: 'relation', target: 'A', delta: -10 }).errors.length > 0, true);
    assert.equal(validateEffect({ type: 'bogus' }).errors.length > 0, true);
    const crisisStart = validateEffect({ type: 'crisis', action: 'start', crisis: { title: 'T', severity: 'high' } });
    assert.equal(crisisStart.errors.length, 0);
    assert.equal(validateEffect({ type: 'crisis', action: 'resolve' }).errors.length > 0, true);
});

test('all EFFECT_TYPES are recognized by isEffectType', () => {
    for (const ty of EFFECT_TYPES) assert.ok(isEffectType(ty));
    assert.equal(isEffectType('nonexistent'), false);
});

test('EVENT_SCHEMA and EFFECT_SCHEMA are JSON-serializable', () => {
    const a = JSON.parse(JSON.stringify(EVENT_SCHEMA));
    const b = JSON.parse(JSON.stringify(EFFECT_SCHEMA));
    assert.equal(a.type, 'object');
    assert.equal(b.type, 'object');
    assert.ok(Array.isArray(a.required));
    assert.ok(a.properties.options);
});

test('createCrisis produces a valid crisis with defaults', () => {
    const c = createCrisis({ title: 'Golpe em curso', severity: 'critical', involvedNationIds: ['BRA'] });
    assert.equal(c.title, 'Golpe em curso');
    assert.equal(c.severity, 'critical');
    assert.deepEqual(c.involvedNationIds, ['BRA']);
    assert.equal(typeof c.id, 'string');
    // invalid severity falls back to medium
    assert.equal(createCrisis({ title: 'x', severity: 'weird' }).severity, 'medium');
});

test('i18n t() interpolates and loadLocale registers keys', () => {
    loadLocale({ hoi_test_key: 'Olá {name}, turno {turn}' });
    assert.ok(hasKey('hoi_test_key'));
    assert.equal(t('hoi_test_key', { name: 'Rei', turn: 3 }), 'Olá Rei, turno 3');
    // unknown key returns the key itself
    assert.equal(t('hoi_unknown_key_xyz'), 'hoi_unknown_key_xyz');
});

test('stContext returns a usable mock under node', () => {
    assert.equal(isLive(), false, 'ST should not be live under node');
    const ctx = getContext();
    assert.ok(ctx && typeof ctx === 'object');
    assert.ok(ctx.__hoiMock, 'should be the mock context');
    assert.ok(Array.isArray(ctx.chat));
    assert.equal(typeof ctx.saveMetadata, 'function');
    assert.ok(ctx.event_types && typeof ctx.event_types.APP_READY === 'string');
});

test('getSeedRandom is deterministic for a given seed', () => {
    const sr = getSeedRandom();
    const a = sr('fixed-seed');
    const b = sr('fixed-seed');
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    assert.deepEqual(seqA, seqB);
    for (const n of seqA) assert.ok(n >= 0 && n < 1);
});
