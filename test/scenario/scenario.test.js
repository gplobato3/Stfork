/**
 * SCENARIO module tests: data integrity, map, flags, bookmarks and the loader.
 * Run: node --test test/scenario/
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createScenarioLoader, extensionBaseUrl, buildScenario, SCENARIO_FILES } from '../../src/scenario/index.js';
import { generateMinor } from '../../src/scenario/build.js';
import {
    BLOCS, CRISIS_SEVERITIES, EVENT_CATEGORIES, PACT_TYPES, RESOURCE_KEYS, NATION_STATUS,
} from '../../src/contract/constants.js';
import { relationKey, monthsBetween } from '../../src/contract/worldState.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const RAW = Object.fromEntries(Object.entries(SCENARIO_FILES).map(([k, f]) => [k, readJson(`assets/${f}`)]));
const MAP = readJson('assets/map/world.map.json');
const GEO = readJson('assets/scenario/world.geo.json');
const MAP_IDS = Object.keys(MAP.countries).sort();

const NATO_MEMBERS = ['ALB', 'BEL', 'BGR', 'CAN', 'HRV', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN',
    'ISL', 'ITA', 'LVA', 'LTU', 'LUX', 'MNE', 'NLD', 'MKD', 'NOR', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE',
    'TUR', 'GBR', 'USA'];
const FLAGLESS = ['CYN', 'SOL']; // no flag in flag-icons: UI falls back to the emoji

/** Mirror of the contract semantics: nations/relations patched, pacts/wars/crises replaced. */
function applyBookmark(data, bookmark) {
    const o = bookmark.overrides || {};
    const nations = {};
    for (const [id, n] of Object.entries(data.nations)) nations[id] = { ...n, ...((o.nations || {})[id] || {}) };
    return {
        tension: bookmark.tension,
        nations,
        relations: { ...data.relations, ...(o.relations || {}) },
        pacts: o.pacts || data.pacts,
        wars: o.wars || data.wars,
        crises: o.crises || data.crises,
    };
}

let data;
const warnings = [];
before(async () => {
    data = await createScenarioLoader({ warn: (m) => warnings.push(m) }).load();
});

describe('loader output', () => {
    test('loads without data warnings', () => {
        assert.deepEqual(warnings, []);
    });

    test('every nation has map geometry and every map country is a nation', () => {
        assert.deepEqual(Object.keys(data.nations).sort(), MAP_IDS);
        for (const id of MAP_IDS) assert.equal(data.nations[id].id, id);
    });

    test('at least 45 playable authored nations incl. the v1 roster and DESIGN §4 regional list', () => {
        const playable = Object.values(data.nations).filter((n) => n.playable).map((n) => n.id);
        assert.ok(playable.length >= 45, `only ${playable.length} playable`);
        const required = ['USA', 'CAN', 'GBR', 'FRA', 'DEU', 'POL', 'ITA', 'ESP', 'TUR', 'UKR', 'RUS', 'BLR', 'KAZ',
            'CHN', 'PRK', 'IRN', 'IND', 'BRA', 'JPN', 'KOR', 'SAU', 'ISR', 'AUS', 'ZAF', 'MEX', 'IDN',
            'ARG', 'VEN', 'COL', 'CHL', 'PER', 'EGY', 'SYR', 'IRQ', 'ARE', 'QAT', 'NGA', 'ETH', 'DZA',
            'VNM', 'THA', 'PHL', 'TWN', 'PAK', 'BGD', 'MYS', 'NLD', 'SWE', 'FIN', 'NOR', 'GRC', 'ROU', 'HUN', 'SRB'];
        for (const id of required) assert.ok(playable.includes(id), `${id} not playable`);
        for (const id of Object.keys(RAW.nations)) assert.equal(data.nations[id].playable, true);
    });

    test('minors are generated, passive and not playable', () => {
        const minors = Object.values(data.nations).filter((n) => !n.playable);
        assert.ok(minors.length > 90);
        for (const n of minors) {
            assert.equal(n.major, false);
            assert.equal(n.nuclear, 0);
            assert.ok(n.personality.aggression <= 0.5, `${n.id} too aggressive`);
            assert.ok(n.resources.economy <= 75 && n.resources.military <= 40, `${n.id} stats not modest`);
            assert.ok(n.name && n.name !== n.id, `${n.id} has no name`);
        }
        assert.deepEqual(generateMinor('AUT', 'Áustria', RAW.minors.AUT), generateMinor('AUT', 'Áustria', RAW.minors.AUT));
    });

    test('ScenarioData is JSON-serializable and has the contract keys', () => {
        const copy = JSON.parse(JSON.stringify(data));
        assert.deepEqual(copy, data);
        for (const k of ['id', 'name', 'nations', 'relations', 'pacts', 'wars', 'crises', 'bookmarks', 'neighbors']) {
            assert.ok(k in data, `missing ${k}`);
        }
    });
});

describe('nation fields', () => {
    test('required fields and value ranges', () => {
        for (const n of Object.values(data.nations)) {
            for (const f of ['id', 'name', 'flag', 'bloc', 'capital', 'government', 'leaderTitle']) {
                assert.equal(typeof n[f], 'string', `${n.id}.${f}`);
                assert.ok(n[f].length > 0, `${n.id}.${f} empty`);
            }
            assert.ok(BLOCS.includes(n.bloc), `${n.id} bloc`);
            assert.ok([0, 1, 2].includes(n.nuclear), `${n.id} nuclear`);
            assert.equal(typeof n.playable, 'boolean');
            assert.equal(typeof n.major, 'boolean');
            assert.deepEqual(Object.keys(n.resources).sort(), [...RESOURCE_KEYS].sort());
            for (const k of RESOURCE_KEYS) {
                const v = n.resources[k];
                assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `${n.id}.${k}=${v}`);
            }
            for (const k of ['aggression', 'diplomacy', 'blocLoyalty']) {
                const v = n.personality[k];
                assert.ok(typeof v === 'number' && v >= 0 && v <= 1, `${n.id}.personality.${k}`);
            }
            assert.ok(['facil', 'normal', 'dificil'].includes(n.difficulty));
            assert.equal(n.status, NATION_STATUS.ACTIVE);
            assert.equal(n.controller, n.id);
            assert.equal(n.overlord, null);
            assert.ok(Number.isInteger(n.pc) && n.pc >= 0 && n.pc <= 30);
            assert.ok(Array.isArray(n.traits) && n.traits.length >= 1 && n.traits.length <= 4, `${n.id} traits`);
        }
    });

    test('authored nations are fully specified in the raw file', () => {
        const keys = ['id', 'name', 'flag', 'bloc', 'capital', 'government', 'leaderTitle', 'playable', 'major',
            'nuclear', 'resources', 'personality', 'traits', 'blurb', 'difficulty'];
        for (const [id, n] of Object.entries(RAW.nations)) {
            for (const k of keys) assert.ok(k in n, `${id} missing ${k}`);
            assert.equal(n.id, id);
            assert.ok(n.traits.length >= 2 && n.traits.length <= 4, `${id} needs 2-4 traits`);
            const sentences = n.blurb.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length;
            assert.ok(sentences >= 1 && sentences <= 3, `${id} blurb has ${sentences} sentences`);
            for (const k of RESOURCE_KEYS) assert.equal(typeof n.resources[k], 'number', `${id}.${k}`);
        }
    });

    test('nuclear powers and leader titles', () => {
        const nuclear = Object.values(data.nations).filter((n) => n.nuclear > 0).map((n) => n.id).sort();
        assert.deepEqual(nuclear, ['CHN', 'FRA', 'GBR', 'IND', 'ISR', 'PAK', 'PRK', 'RUS', 'USA']);
        for (const id of ['USA', 'RUS', 'CHN']) assert.equal(data.nations[id].nuclear, 2);
        assert.equal(data.nations.DEU.leaderTitle, 'Chanceler');
        assert.equal(data.nations.QAT.leaderTitle, 'Emir');
        assert.equal(data.nations.SAU.leaderTitle, 'Príncipe Herdeiro');
        assert.equal(data.nations.IRN.leaderTitle, 'Líder Supremo');
        assert.equal(data.nations.MAR.leaderTitle, 'Rei');
        assert.equal(data.nations.BRA.leaderTitle, 'Presidente');
        assert.equal(data.nations.GBR.leaderTitle, 'Primeiro-Ministro');
    });

    test('no real living leaders are named in scenario text', () => {
        const text = JSON.stringify([RAW.nations, RAW.minors, RAW.crises, RAW.bookmarks, RAW.wars, RAW.pacts]);
        for (const name of ['Putin', 'Trump', 'Xi Jinping', 'Lula', 'Zelensky', 'Zelenskyy', 'Maduro', 'Khamenei',
            'Netanyahu', 'Modi', 'Milei', 'Erdoğan', 'Erdogan', 'Kim Jong', 'Macron', 'Bolsonaro', 'Rodríguez',
            'Machado', 'Petro', 'Sheinbaum', 'Lukashenko']) {
            const re = new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, 'u');
            assert.ok(!re.test(text), `scenario text mentions ${name}`);
        }
    });
});

describe('pt-BR names', () => {
    test('names.json covers every world.geo.json feature and every map country', () => {
        for (const f of GEO.features) assert.ok(RAW.names[f.properties.id], `no pt-BR name for ${f.properties.id}`);
        for (const id of MAP_IDS) assert.equal(data.nations[id].name, RAW.names[id]);
    });

    test('spot-check: no English names left for common countries', () => {
        const expected = {
            USA: 'Estados Unidos', GBR: 'Reino Unido', DEU: 'Alemanha', FRA: 'França', ESP: 'Espanha', ITA: 'Itália',
            JPN: 'Japão', RUS: 'Rússia', IND: 'Índia', ZAF: 'África do Sul', EGY: 'Egito', SAU: 'Arábia Saudita',
            NLD: 'Países Baixos', CHE: 'Suíça', SWE: 'Suécia', NOR: 'Noruega', FIN: 'Finlândia', POL: 'Polônia',
            GRC: 'Grécia', TUR: 'Turquia', MEX: 'México', CIV: 'Costa do Marfim', COD: 'República Democrática do Congo',
            KOR: 'Coreia do Sul', PRK: 'Coreia do Norte', NZL: 'Nova Zelândia', ESH: 'Saara Ocidental',
            GRL: 'Groenlândia', BRA: 'Brasil', CAN: 'Canadá', IRN: 'Irã', BEL: 'Bélgica', CZE: 'Tchéquia',
            SWZ: 'Essuatíni', MMR: 'Mianmar', KOS: 'Kosovo', SOL: 'Somalilândia', CYN: 'Chipre do Norte',
            TWN: 'Taiwan', PSE: 'Palestina', ATA: 'Antártida', FLK: 'Ilhas Malvinas (Falklands)',
        };
        for (const [id, name] of Object.entries(expected)) assert.equal(RAW.names[id], name, id);
        const english = Object.fromEntries(GEO.features.map((f) => [f.properties.id, f.properties.name]));
        const englishMarkers = /\b(Rep\.|Is\.|Republic|United|South|North|Dem\.|Island|Sahara|Herz\.|Eq\.|Lands|Arabia)\b/;
        for (const [id, en] of Object.entries(english)) {
            if (englishMarkers.test(en)) assert.notEqual(RAW.names[id], en, `${id} still English: ${en}`);
        }
    });
});

describe('references in raw data', () => {
    const ids = new Set(MAP_IDS);
    const checkIds = (list, where) => {
        for (const id of list) assert.ok(ids.has(id), `${where}: unknown id ${id}`);
    };
    const checkRelations = (rel, where) => {
        for (const [k, v] of Object.entries(rel)) {
            const [a, b] = k.split('|');
            checkIds([a, b], `${where} ${k}`);
            assert.notEqual(a, b);
            assert.ok(Number.isInteger(v) && v >= -100 && v <= 100, `${where} ${k}=${v}`);
        }
    };
    const checkPacts = (pacts, where) => {
        for (const p of pacts) {
            assert.ok(PACT_TYPES.includes(p.type), `${where} ${p.id} type`);
            checkIds(p.members, `${where} ${p.id}`);
            assert.ok(p.members.length >= 2);
        }
    };
    const checkWars = (wars, where) => {
        for (const w of wars) {
            checkIds([...w.attackers, ...w.defenders], `${where} ${w.id}`);
            for (const f of w.fronts) {
                assert.ok(w.attackers.includes(f.attacker) && w.defenders.includes(f.defender), `${where} ${w.id} front`);
                assert.ok(f.progress >= 0 && f.progress <= 100);
            }
            checkIds(Object.keys(w.exhaustion), `${where} ${w.id} exhaustion`);
        }
    };
    const checkCrises = (crises, where) => {
        for (const c of crises) {
            checkIds(c.involved, `${where} ${c.id}`);
            assert.ok(CRISIS_SEVERITIES.includes(c.severity), `${where} ${c.id} severity`);
            assert.ok(EVENT_CATEGORIES.includes(c.category), `${where} ${c.id} category`);
            assert.ok(c.region && c.title && c.description, `${where} ${c.id} text`);
        }
    };

    test('authored nations, minors and relations', () => {
        checkIds(Object.keys(RAW.nations), 'nations');
        checkIds(Object.keys(RAW.minors), 'minors');
        for (const id of MAP_IDS) assert.ok(RAW.nations[id] || RAW.minors[id], `${id} neither authored nor minor`);
        checkRelations(RAW.relations, 'relations');
        assert.ok(Object.keys(RAW.relations).length >= 200);
        const keys = Object.keys(RAW.relations).map((k) => relationKey(...k.split('|')));
        assert.equal(new Set(keys).size, keys.length, 'duplicate relation pairs');
    });

    test('pacts, wars and crises', () => {
        checkPacts(RAW.pacts, 'pacts');
        checkWars(RAW.wars, 'wars');
        checkCrises(RAW.crises, 'crises');
        assert.ok(RAW.crises.length >= 8 && RAW.crises.length <= 12);
    });

    test('bookmark overrides', () => {
        for (const b of RAW.bookmarks) {
            const o = b.overrides;
            checkIds(b.recommended, `${b.id} recommended`);
            checkIds(Object.keys(o.nations || {}), `${b.id} nations`);
            for (const patch of Object.values(o.nations || {})) {
                for (const v of Object.values(patch.resources || {})) assert.ok(v >= 0 && v <= 100);
            }
            checkRelations(o.relations || {}, `${b.id} relations`);
            checkPacts([...(o.pacts || []), ...(o.pactsAdd || [])], `${b.id} pacts`);
            for (const r of o.pactsRemove || []) assert.ok(RAW.pacts.some((p) => p.id === r), `${b.id} removes ${r}`);
            checkWars(o.wars || [], `${b.id} wars`);
            checkCrises(o.crises || [], `${b.id} crises`);
        }
    });
});

describe('base world (Oct 2026)', () => {
    test('OTAN lists every NATO member; OTSC and key defense pacts exist', () => {
        const nato = data.pacts.find((p) => p.name === 'OTAN');
        assert.equal(nato.type, 'alliance');
        assert.deepEqual([...nato.members].sort(), [...NATO_MEMBERS].sort());
        for (const id of NATO_MEMBERS) assert.equal(data.nations[id].bloc, 'NATO', `${id} bloc`);
        const csto = data.pacts.find((p) => p.id === 'pact-csto');
        assert.deepEqual([...csto.members].sort(), ['BLR', 'KAZ', 'KGZ', 'RUS', 'TJK']);
        const has = (a, b, type) => data.pacts.some((p) => p.type === type && p.members.includes(a) && p.members.includes(b));
        assert.ok(has('USA', 'JPN', 'defense'));
        assert.ok(has('USA', 'KOR', 'defense'));
        assert.ok(has('AUS', 'USA', 'defense'));
        assert.ok(has('CHN', 'PRK', 'defense'));
        assert.ok(data.pacts.some((p) => p.type === 'trade' && p.name === 'Mercosul' && p.members.includes('BRA')));
    });

    test('Russia–Ukraine war is ongoing with RUS at ~20 progress', () => {
        const war = data.wars.find((w) => w.attackers.includes('RUS') && w.defenders.includes('UKR'));
        assert.ok(war);
        assert.equal(war.ceasefire, false);
        const front = war.fronts.find((f) => f.attacker === 'RUS' && f.defender === 'UKR');
        assert.ok(front.progress >= 15 && front.progress <= 25);
    });
});

describe('bookmarks', () => {
    test('three bookmarks with dates, +10y end, tension, art and recommended nations', () => {
        assert.deepEqual(data.bookmarks.map((b) => b.id), ['b2026', 'b2028', 'b2031']);
        const expect = { b2026: [2026, 10, 42], b2028: [2028, 3, 62], b2031: [2031, 8, 84] };
        for (const b of data.bookmarks) {
            const [y, m, t] = expect[b.id];
            assert.deepEqual(b.date, { year: y, month: m });
            assert.equal(monthsBetween(b.date, b.endDate), 120);
            assert.ok(Math.abs(b.tension - t) <= 3);
            assert.equal(b.art, `bookmark-${b.id}`);
            assert.ok(b.recommended.length >= 4 && b.recommended.length <= 8);
            assert.ok(b.recommended.includes('BRA'));
            for (const id of b.recommended) assert.ok(data.nations[id].playable);
            assert.ok(b.name && b.description.length > 120, `${b.id} description`);
        }
        assert.equal(data.bookmarks[0].name, 'O Mundo Hoje');
        assert.equal(data.bookmarks[1].name, 'À Beira do Abismo');
        assert.equal(data.bookmarks[2].name, 'A Terceira Guerra Mundial');
    });

    test('each bookmark produces a different world', () => {
        const worlds = data.bookmarks.map((b) => applyBookmark(data, b));
        const tensions = new Set(worlds.map((w) => w.tension));
        assert.equal(tensions.size, 3);
        const wars = new Set(worlds.map((w) => JSON.stringify(w.wars)));
        assert.equal(wars.size, 3);
        const crises = new Set(worlds.map((w) => JSON.stringify(w.crises.map((c) => c.id))));
        assert.equal(crises.size, 3);
        const usa = new Set(worlds.map((w) => JSON.stringify(w.nations.USA.resources)));
        assert.equal(usa.size, 3);
    });

    test('resource overrides are complete objects merged with the base nation', () => {
        for (const b of data.bookmarks) {
            for (const [id, patch] of Object.entries(b.overrides.nations || {})) {
                if (!patch.resources) continue;
                assert.deepEqual(Object.keys(patch.resources).sort(), [...RESOURCE_KEYS].sort(), `${b.id} ${id}`);
            }
        }
        const twn = data.bookmarks[1].overrides.nations.TWN.resources;
        assert.equal(twn.tech, data.nations.TWN.resources.tech);
        assert.notEqual(twn.stability, data.nations.TWN.resources.stability);
    });

    test('2028: Taiwan blockade, Baltic incidents, Sahel instability, frozen Ukraine front', () => {
        const w = applyBookmark(data, data.bookmarks[1]);
        const crisis = (pred) => w.crises.find(pred);
        const twn = crisis((c) => c.involved.includes('CHN') && c.involved.includes('TWN'));
        assert.ok(twn && twn.severity === 'critical' && twn.category === 'naval');
        assert.ok(crisis((c) => c.involved.includes('EST') && c.involved.includes('RUS') && c.category === 'military'));
        assert.ok(crisis((c) => c.involved.includes('MLI') && c.category === 'unrest'));
        const ukr = w.wars.find((x) => x.defenders.includes('UKR'));
        assert.equal(ukr.ceasefire, true);
        assert.ok(w.pacts.some((p) => p.type === 'guarantee' && p.members[0] === 'USA' && p.members[1] === 'TWN'));
        assert.ok(w.pacts.some((p) => p.id === 'pact-nato'), 'pactsAdd keeps the base pacts');
    });

    test('2031: WW3 — NATO and allies vs a RUS/CHN-led coalition on several fronts', () => {
        const w = applyBookmark(data, data.bookmarks[2]);
        assert.ok(w.wars.length >= 3);
        const fronts = w.wars.flatMap((x) => x.fronts.map((f) => `${f.attacker}>${f.defender}`));
        for (const f of ['RUS>EST', 'RUS>LVA', 'RUS>LTU', 'RUS>POL', 'CHN>TWN', 'PRK>KOR']) assert.ok(fronts.includes(f), f);
        const side = (id) => {
            const s = new Set();
            for (const x of w.wars) {
                if (x.attackers.includes(id)) s.add('axis');
                if (x.defenders.includes(id)) s.add('allies');
            }
            return s;
        };
        for (const id of ['RUS', 'CHN', 'PRK', 'BLR']) assert.deepEqual([...side(id)], ['axis'], id);
        for (const id of ['USA', 'GBR', 'DEU', 'FRA', 'POL', 'JPN', 'KOR', 'TWN']) assert.deepEqual([...side(id)], ['allies'], id);
        const coalition = w.pacts.find((p) => p.type === 'alliance' && p.members.includes('RUS') && p.members.includes('CHN'));
        assert.ok(coalition);
        assert.ok(!w.pacts.some((p) => p.id === 'pact-chn-rus'), 'pactsRemove applied');
        assert.ok(w.crises.some((c) => c.category === 'nuclear' && c.severity === 'critical'));
        assert.ok(w.nations.RUS.resources.economy < data.nations.RUS.resources.economy);
    });
});

describe('map data', () => {
    test('file size budget and shape', () => {
        const bytes = statSync(join(ROOT, 'assets/map/world.map.json')).size;
        assert.ok(bytes <= 350 * 1024, `map is ${bytes} bytes`);
        assert.equal(MAP.width, 1000);
        assert.equal(MAP.height, 520);
        assert.equal(MAP.projection, 'naturalEarth1');
        assert.ok(MAP.graticule.startsWith('M') && MAP.outline.startsWith('M'));
        for (const [id, c] of Object.entries(MAP.countries)) {
            assert.equal(c.id, id);
            assert.ok(/^M[-\d.]/.test(c.d), `${id} path`);
            assert.ok(!/\d\.\d\d/.test(c.d), `${id} path not rounded to 1 decimal`);
            const [x0, y0, x1, y1] = c.bbox;
            assert.ok(x0 <= x1 && y0 <= y1);
            assert.ok(c.area > 0);
            for (const p of [c.label, c.capital]) {
                assert.ok(p[0] >= 0 && p[0] <= MAP.width && p[1] >= 0 && p[1] <= MAP.height, `${id} point`);
            }
            const [lx, ly] = c.label;
            assert.ok(lx >= x0 - 1 && lx <= x1 + 1 && ly >= y0 - 1 && ly <= y1 + 1, `${id} label outside bbox`);
        }
    });

    test('dependent territories are folded into their sovereign; Antarctica is decoration', () => {
        assert.deepEqual(MAP.territories, { GRL: 'DNK', PRI: 'USA', NCL: 'FRA', ATF: 'FRA', FLK: 'GBR' });
        for (const t of [...Object.keys(MAP.territories), 'ATA']) assert.ok(!(t in MAP.countries), t);
        assert.ok(MAP.decor.some((d) => d.id === 'ATA'));
        for (const id of ['TWN', 'KOS', 'SOL', 'ESH', 'PSE', 'CYN']) assert.ok(id in data.nations, id);
        // Greenland is far from Copenhagen: DNK's focus bbox excludes it, the full extent does not.
        assert.ok(MAP.countries.DNK.fullBbox[0] < MAP.countries.DNK.bbox[0] - 100);
    });

    test('neighbors are symmetric (map and ScenarioData)', () => {
        for (const [id, c] of Object.entries(MAP.countries)) {
            for (const n of c.neighbors) assert.ok(MAP.countries[n].neighbors.includes(id), `${id}->${n}`);
        }
        for (const [id, list] of Object.entries(data.neighbors)) {
            assert.ok(!list.includes(id));
            for (const n of list) assert.ok(data.neighbors[n].includes(id), `${id}->${n}`);
        }
        assert.deepEqual(Object.keys(data.neighbors).sort(), MAP_IDS);
    });

    test('Brazil borders all ten South American neighbours (French Guiana = FRA)', () => {
        const bra = data.neighbors.BRA;
        for (const id of ['ARG', 'URY', 'PRY', 'BOL', 'PER', 'COL', 'VEN', 'GUY', 'SUR', 'FRA']) assert.ok(bra.includes(id), id);
        assert.ok(!bra.includes('CHL') && !bra.includes('ECU'));
    });

    test('land and maritime neighbours spot-check', () => {
        const n = data.neighbors;
        for (const [a, b] of [['RUS', 'UKR'], ['RUS', 'EST'], ['RUS', 'LTU'], ['BLR', 'POL'], ['IND', 'PAK'],
            ['GBR', 'FRA'], ['JPN', 'KOR'], ['TWN', 'CHN'], ['CUB', 'USA'], ['ESP', 'MAR'], ['GRC', 'TUR'],
            ['AUS', 'IDN'], ['LKA', 'IND'], ['QAT', 'IRN'], ['SAU', 'EGY'], ['RUS', 'USA'], ['ARG', 'GBR']]) {
            assert.ok(n[a].includes(b), `${a}-${b}`);
        }
        for (const [a, b] of [['BRA', 'USA'], ['DEU', 'RUS'], ['CHN', 'USA']]) assert.ok(!n[a].includes(b), `${a}-${b}`);
    });
});

describe('flags', () => {
    const dir = join(ROOT, 'assets/flags');
    test('every nation with a real flag has an svg; budget ≤ 2 MB; attribution present', () => {
        for (const id of MAP_IDS) {
            const file = join(dir, `${id}.svg`);
            if (FLAGLESS.includes(id)) assert.ok(!existsSync(file));
            else assert.ok(existsSync(file), `missing flag ${id}`);
        }
        for (const id of Object.keys(RAW.nations)) assert.ok(existsSync(join(dir, `${id}.svg`)), `playable ${id}`);
        const total = readdirSync(dir).filter((f) => f.endsWith('.svg'))
            .reduce((s, f) => s + statSync(join(dir, f)).size, 0);
        assert.ok(total <= 2 * 1024 * 1024, `flags total ${total}`);
        const svg = readFileSync(join(dir, 'BRA.svg'), 'utf8');
        assert.ok(svg.startsWith('<svg') && svg.includes('viewBox'));
        assert.ok(readFileSync(join(dir, 'LICENSE-flags.md'), 'utf8').includes('MIT'));
    });
});

describe('loader API', () => {
    test('extension base URL is derived from the module URL, never a fixed folder name', () => {
        assert.equal(
            extensionBaseUrl('https://st.local/scripts/extensions/third-party/Minha%20Ext/src/scenario/index.js'),
            'https://st.local/scripts/extensions/third-party/Minha%20Ext/',
        );
        const s = createScenarioLoader({ baseUrl: 'https://st.local/scripts/extensions/third-party/qualquer' });
        assert.equal(s.assetUrl('art/event-war.webp'), 'https://st.local/scripts/extensions/third-party/qualquer/assets/art/event-war.webp');
        assert.equal(s.assetUrl('/assets/flags/BRA.svg'), 'https://st.local/scripts/extensions/third-party/qualquer/assets/flags/BRA.svg');
        const local = createScenarioLoader();
        assert.ok(local.assetUrl('map/world.map.json').endsWith('/assets/map/world.map.json'));
        assert.ok(local.assetUrl('x').startsWith(new URL('../../', import.meta.url).href));
    });

    test('results are cached; each file is read once', async () => {
        const calls = [];
        const s = createScenarioLoader({
            baseUrl: 'https://st.local/ext/',
            readJson: async (url) => {
                calls.push(url);
                const rel = url.replace('https://st.local/ext/', '');
                return readJson(rel);
            },
            warn: () => {},
        });
        const [a, b] = await Promise.all([s.load(), s.load()]);
        assert.equal(a, b);
        assert.equal(await s.loadMap(), await s.loadMap());
        assert.equal(calls.length, Object.keys(SCENARIO_FILES).length + 1);
        assert.equal(new Set(calls).size, calls.length);
    });

    test('missing asset rejects; a retry can succeed', async () => {
        let fail = true;
        const s = createScenarioLoader({
            baseUrl: 'https://st.local/ext/',
            readJson: async (url) => {
                if (fail && url.endsWith('bookmarks.json')) throw new Error('HTTP 404');
                return readJson(url.replace('https://st.local/ext/', ''));
            },
            warn: () => {},
        });
        await assert.rejects(s.load(), /404/);
        fail = false;
        const d = await s.load();
        assert.equal(d.bookmarks.length, 3);
    });

    test('bad references are dropped with a warning, never thrown', () => {
        const warns = [];
        const raw = JSON.parse(JSON.stringify(RAW));
        raw.relations['BRA|XXX'] = 10;
        raw.relations['ARG|BRA'] = 999;
        raw.pacts.push({ id: 'pact-bad', type: 'alliance', name: 'X', members: ['BRA', 'ZZZ'] });
        raw.pacts.push({ id: 'pact-weird', type: 'friendship', name: 'Y', members: ['BRA', 'ARG'] });
        raw.wars.push({ id: 'war-bad', name: 'Z', attackers: ['QQQ'], defenders: ['BRA'], fronts: [] });
        raw.wars[0].fronts.push({ attacker: 'UKR', defender: 'RUS', progress: 5 });
        raw.crises.push({ id: 'c-bad', title: 'T', description: 'D', severity: 'apocalyptic', involved: ['BRA', 'NOPE'], category: 'weather' });
        raw.nations.ATL = { ...raw.nations.BRA, id: 'ATL' };
        raw.bookmarks[1].overrides.nations.XYZ = { resources: { economy: 1 } };
        const d = buildScenario(raw, MAP, { warn: (m) => warns.push(m) });
        assert.ok(!('BRA|XXX' in d.relations));
        assert.equal(d.relations['ARG|BRA'], 100);
        assert.deepEqual(d.pacts.find((p) => p.id === 'pact-bad'), undefined);
        assert.equal(d.pacts.find((p) => p.id === 'pact-weird'), undefined);
        assert.equal(d.wars.find((w) => w.id === 'war-bad'), undefined);
        assert.equal(d.wars[0].fronts.length, 1);
        const c = d.crises.find((x) => x.id === 'c-bad');
        assert.equal(c.severity, 'medium');
        assert.deepEqual(c.involved, ['BRA']);
        assert.ok(!('category' in c));
        assert.ok(!('ATL' in d.nations));
        assert.ok(!('XYZ' in d.bookmarks[1].overrides.nations));
        assert.ok(warns.length >= 8, warns.join('\n'));
    });
});
