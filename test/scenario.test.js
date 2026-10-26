/**
 * @file test/scenario.test.js
 * node:test structural + cross-reference tests for Module B (scenario data).
 * These parse the REAL authored asset files under assets/scenario/ and will
 * fail if those assets are malformed or drift from the contract.
 * Run: node --test test/scenario.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
    RESOURCE_KEYS,
    BLOCS,
    BOUNDS,
    relationKey,
} from '../src/contract/worldState.js';
import { CRISIS_SEVERITIES } from '../src/contract/events.js';
import { createScenario, __resetScenarioCache, NEUTRAL_RELATION } from '../src/scenario/scenario.js';

const assetUrl = (name) => new URL(`../assets/scenario/${name}`, import.meta.url);

async function readJson(name) {
    return JSON.parse(await readFile(fileURLToPath(assetUrl(name)), 'utf8'));
}

/** Nations required by the feature spec. */
const REQUIRED_NATIONS = [
    'USA', 'CAN', 'GBR', 'FRA', 'DEU', 'POL', 'ITA', 'ESP', 'TUR', 'UKR',
    'RUS', 'BLR', 'KAZ', 'CHN', 'PRK', 'IRN', 'IND', 'BRA', 'JPN', 'KOR',
    'SAU', 'ISR', 'AUS', 'ZAF', 'MEX', 'IDN',
];

test('all scenario asset files parse as valid JSON', async () => {
    for (const f of ['nations.json', 'relations.json', 'crises.json', 'world.geo.json']) {
        const data = await readJson(f);
        assert.ok(data, `${f} parsed`);
    }
});

test('nations.json has >= 20 nations, all conforming to the Nation shape', async () => {
    const nations = await readJson('nations.json');
    const ids = Object.keys(nations);
    assert.ok(ids.length >= 20, `expected >= 20 nations, got ${ids.length}`);

    // ids unique (object keys are inherently unique) and match ISO alpha-3.
    const seen = new Set();
    for (const [id, nation] of Object.entries(nations)) {
        assert.match(id, /^[A-Z]{3}$/, `id ${id} is ISO alpha-3`);
        assert.equal(seen.has(id), false, `id ${id} unique`);
        seen.add(id);

        // Map key must equal the embedded id.
        assert.equal(nation.id, id, `nation.id matches map key for ${id}`);

        // Required string fields present and non-empty.
        for (const field of ['name', 'flagEmoji', 'bloc', 'capital', 'government', 'leaderTitle']) {
            assert.equal(typeof nation[field], 'string', `${id}.${field} is string`);
            assert.ok(nation[field].length > 0, `${id}.${field} non-empty`);
        }

        // bloc is a known (or scenario-extended) string; required blocs appear.
        assert.equal(typeof nation.bloc, 'string');

        // Resources: all 7 keys, integers within documented range.
        assert.ok(nation.resources && typeof nation.resources === 'object', `${id} has resources`);
        for (const key of RESOURCE_KEYS) {
            const v = nation.resources[key];
            assert.equal(typeof v, 'number', `${id}.resources.${key} is number`);
            assert.ok(Number.isInteger(v), `${id}.resources.${key} is integer`);
            assert.ok(
                v >= BOUNDS.RESOURCE_MIN && v <= BOUNDS.RESOURCE_MAX,
                `${id}.resources.${key}=${v} within [${BOUNDS.RESOURCE_MIN}..${BOUNDS.RESOURCE_MAX}]`,
            );
        }

        // traits: 1..3 pt-BR strings.
        assert.ok(Array.isArray(nation.traits), `${id}.traits is array`);
        assert.ok(nation.traits.length >= 1 && nation.traits.length <= 3, `${id} has 1-3 traits`);
        for (const tr of nation.traits) assert.equal(typeof tr, 'string');

        // major is a boolean flag for the featured picker list.
        assert.equal(typeof nation.major, 'boolean', `${id}.major is boolean`);
    }
});

test('nations.json includes every required nation and spans multiple blocs', async () => {
    const nations = await readJson('nations.json');
    for (const id of REQUIRED_NATIONS) {
        assert.ok(nations[id], `required nation ${id} present`);
    }
    const blocsPresent = new Set(Object.values(nations).map((n) => n.bloc));
    // NATO, CSTO, BRICS and NON_ALIGNED should all be represented.
    for (const bloc of ['NATO', 'CSTO', 'BRICS', 'NON_ALIGNED']) {
        assert.ok(blocsPresent.has(bloc), `bloc ${bloc} represented`);
    }
    // At least one nation flagged major for the featured picker.
    assert.ok(Object.values(nations).some((n) => n.major), 'at least one major nation');
    // Every bloc used is a string (scenario may extend BLOCS); known ones are valid.
    for (const bloc of blocsPresent) {
        assert.equal(typeof bloc, 'string');
    }
    void BLOCS;
});

test('relations.json keys are normalized, reference real nations, and are in range', async () => {
    const nations = await readJson('nations.json');
    const relations = await readJson('relations.json');
    const known = new Set(Object.keys(nations));

    for (const [key, score] of Object.entries(relations)) {
        const parts = key.split('|');
        assert.equal(parts.length, 2, `relation key "${key}" has two parts`);
        const [a, b] = parts;
        assert.notEqual(a, b, `relation key "${key}" is not a self-pair`);
        assert.ok(known.has(a), `relation "${key}" references real nation ${a}`);
        assert.ok(known.has(b), `relation "${key}" references real nation ${b}`);
        // Key must be normalized (sorted ascending) per the contract.
        assert.equal(key, relationKey(a, b), `relation key "${key}" is normalized`);

        assert.equal(typeof score, 'number', `relation "${key}" score is number`);
        assert.ok(
            score >= BOUNDS.RELATION_MIN && score <= BOUNDS.RELATION_MAX,
            `relation "${key}"=${score} within [${BOUNDS.RELATION_MIN}..${BOUNDS.RELATION_MAX}]`,
        );
    }
});

test('crises.json: 6-10 seeds, each conforming with real involvedNationIds', async () => {
    const nations = await readJson('nations.json');
    const crises = await readJson('crises.json');
    const known = new Set(Object.keys(nations));

    assert.ok(Array.isArray(crises), 'crises.json is an array');
    assert.ok(crises.length >= 6 && crises.length <= 10, `expected 6-10 crises, got ${crises.length}`);

    const ids = new Set();
    for (const c of crises) {
        assert.equal(typeof c.id, 'string', 'crisis id is string');
        assert.ok(c.id.length > 0, 'crisis id non-empty');
        assert.equal(ids.has(c.id), false, `crisis id ${c.id} unique`);
        ids.add(c.id);

        assert.equal(typeof c.title, 'string', `crisis ${c.id} title is string`);
        assert.ok(c.title.length > 0, `crisis ${c.id} title non-empty`);
        assert.equal(typeof c.description, 'string', `crisis ${c.id} description is string`);
        assert.ok(c.description.length > 0, `crisis ${c.id} description non-empty`);

        assert.ok(CRISIS_SEVERITIES.includes(c.severity), `crisis ${c.id} severity valid`);

        assert.ok(Array.isArray(c.involvedNationIds), `crisis ${c.id} involvedNationIds is array`);
        assert.ok(c.involvedNationIds.length > 0, `crisis ${c.id} has involved nations`);
        for (const n of c.involvedNationIds) {
            assert.ok(known.has(n), `crisis ${c.id} references real nation ${n}`);
        }

        assert.equal(typeof c.startingTension, 'number', `crisis ${c.id} startingTension is number`);
        assert.ok(c.startingTension >= 0, `crisis ${c.id} startingTension non-negative`);
    }
});

test('world.geo.json: FeatureCollection; every feature id maps to a nation (log unmatched)', async () => {
    const nations = await readJson('nations.json');
    const geo = await readJson('world.geo.json');
    const known = new Set(Object.keys(nations));

    assert.equal(geo.type, 'FeatureCollection', 'geo is a FeatureCollection');
    assert.ok(Array.isArray(geo.features), 'geo.features is array');
    assert.ok(geo.features.length > 0, 'geo has features');

    let matched = 0;
    const unmatched = [];
    const geoIds = new Set();
    for (const f of geo.features) {
        assert.equal(f.type, 'Feature', 'each entry is a Feature');
        assert.ok(f.properties && typeof f.properties.id === 'string', 'feature has properties.id');
        assert.match(f.properties.id, /^[A-Z]{3}$/, `feature id ${f.properties.id} is ISO alpha-3`);
        assert.ok(f.geometry && typeof f.geometry.type === 'string', 'feature has geometry');
        geoIds.add(f.properties.id);
        if (known.has(f.properties.id)) matched++;
        else unmatched.push(f.properties.id);
    }

    // Awareness log: geo features that do not correspond to a rostered nation.
    if (unmatched.length) {
        console.log(`[scenario.test] ${unmatched.length} geo feature(s) without a rostered nation (OK): ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '…' : ''}`);
    }
    assert.ok(matched > 0, 'at least some geo features map to nations');

    // CRITICAL: every rostered nation must have a geo polygon so the UI can draw it.
    const missingGeo = [...known].filter((id) => !geoIds.has(id));
    assert.deepEqual(missingGeo, [], `every nation has a geo feature; missing: ${missingGeo.join(', ')}`);
});

test('loadScenario() returns the ScenarioData shape and runs under node', async () => {
    __resetScenarioCache();
    const scenario = createScenario();
    const data = await scenario.loadScenario();

    assert.ok(data.nations && typeof data.nations === 'object', 'has nations map');
    assert.ok(data.relations && typeof data.relations === 'object', 'has relations map');
    assert.ok(data.geo && typeof data.geo === 'object', 'has geo');
    assert.ok(Array.isArray(data.crisisSeeds), 'has crisisSeeds array');
    assert.ok(data.meta && typeof data.meta === 'object', 'has meta');

    const ids = Object.keys(data.nations);
    assert.ok(ids.length >= 20, 'loaded >= 20 nations');

    // Relations are fully populated for every pair (specified or neutral baseline).
    const expectedPairs = (ids.length * (ids.length - 1)) / 2;
    assert.equal(Object.keys(data.relations).length, expectedPairs, 'all pairs present after baseline fill');

    // Spot-check the neutral baseline fill for a pair not in the asset.
    // Pick two nations unlikely to have an authored relation.
    const key = relationKey('KAZ', 'MEX');
    assert.equal(typeof data.relations[key], 'number', 'filled pair exists');

    // crisisSeeds carry startingTension for the engine.
    for (const c of data.crisisSeeds) {
        assert.equal(typeof c.startingTension, 'number');
    }
    void NEUTRAL_RELATION;
});

test('listPlayableNationIds() lists majors first and includes all nations', async () => {
    __resetScenarioCache();
    const scenario = createScenario();
    await scenario.loadScenario();
    const ids = scenario.listPlayableNationIds();

    const nations = await readJson('nations.json');
    const total = Object.keys(nations).length;
    assert.equal(ids.length, total, 'every nation is playable');
    assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

    // All majors appear before any non-major.
    const majorCount = Object.values(nations).filter((n) => n.major).length;
    for (let i = 0; i < majorCount; i++) {
        assert.equal(nations[ids[i]].major, true, `position ${i} is a major`);
    }
});
