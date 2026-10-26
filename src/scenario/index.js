/**
 * @file src/scenario/index.js
 * SCENARIO module: implements ScenarioAPI (src/contract/interfaces.js).
 *
 *   const scenario = createScenarioLoader();
 *   await scenario.load();     // ScenarioData: every map country is a nation (authored + generated minors)
 *   await scenario.loadMap();  // MapData (assets/map/world.map.json, pre-projected)
 *   scenario.assetUrl('flags/BRA.svg');  // absolute URL inside the extension folder
 *
 * The extension base URL is derived from import.meta.url (this file lives at
 * <ext>/src/scenario/index.js), so the folder name is never hardcoded. In the browser the
 * assets are fetched; under node (tests) file:// URLs are read with node:fs.
 * Nothing runs at import time.
 */

import { buildScenario } from './build.js';

export { buildScenario, SCENARIO_ID, SCENARIO_NAME } from './build.js';

/** Raw asset files under assets/scenario/. */
export const SCENARIO_FILES = Object.freeze({
    nations: 'scenario/nations.json',
    minors: 'scenario/minors.json',
    names: 'scenario/names.json',
    relations: 'scenario/relations.json',
    pacts: 'scenario/pacts.json',
    wars: 'scenario/wars.json',
    crises: 'scenario/crises.json',
    bookmarks: 'scenario/bookmarks.json',
});
export const MAP_FILE = 'map/world.map.json';

/** Extension root URL (with trailing slash): two levels up from this module. */
export function extensionBaseUrl(moduleUrl = import.meta.url) {
    return new URL('../../', moduleUrl).href;
}

/** Default JSON reader: node:fs for file:// URLs, fetch() otherwise. Throws when the file is missing. */
async function defaultReadJson(url) {
    if (url.startsWith('file:')) {
        const [{ readFile }, { fileURLToPath }] = await Promise.all([import('node:fs/promises'), import('node:url')]);
        let text;
        try {
            text = await readFile(fileURLToPath(url), 'utf8');
        } catch (err) {
            throw new Error(`HOI scenario: missing asset ${url} (${err.code || err.message})`);
        }
        return JSON.parse(text);
    }
    if (typeof fetch !== 'function') throw new Error(`HOI scenario: no fetch() available to load ${url}`);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HOI scenario: missing asset ${url} (HTTP ${res.status})`);
    return res.json();
}

/**
 * @param {{baseUrl?: string, readJson?: (url: string) => Promise<any>, warn?: (msg: string) => void}} [opts]
 *   baseUrl  extension root URL (default: derived from import.meta.url)
 *   readJson override the asset reader (tests)
 *   warn     data-problem reporter (default: console.warn)
 * @returns {import('../contract/interfaces.js').ScenarioAPI}
 */
export function createScenarioLoader(opts = {}) {
    const baseUrl = String(opts.baseUrl || extensionBaseUrl()).replace(/\/?$/, '/');
    const readJson = opts.readJson || defaultReadJson;
    const warn = opts.warn || ((msg) => console.warn(`[HOI scenario] ${msg}`));
    /** @type {?Promise<any>} */
    let mapPromise = null;
    /** @type {?Promise<any>} */
    let scenarioPromise = null;

    /** 'art/event-war.webp' -> '<ext>/assets/art/event-war.webp' (a leading 'assets/' or '/' is tolerated). */
    function assetUrl(path) {
        const clean = String(path || '').replace(/^\/+/, '').replace(/^assets\//, '');
        return new URL(`assets/${clean}`, baseUrl).href;
    }

    function loadMap() {
        if (!mapPromise) {
            mapPromise = readJson(assetUrl(MAP_FILE)).then((map) => {
                if (!map || typeof map !== 'object' || !map.countries) throw new Error('HOI scenario: invalid map file');
                return map;
            });
            mapPromise.catch(() => { mapPromise = null; });
        }
        return mapPromise;
    }

    function load() {
        if (!scenarioPromise) {
            scenarioPromise = (async () => {
                const keys = Object.keys(SCENARIO_FILES);
                const [map, ...values] = await Promise.all([
                    loadMap(),
                    ...keys.map((k) => readJson(assetUrl(SCENARIO_FILES[k]))),
                ]);
                const raw = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
                return buildScenario(raw, map, { warn });
            })();
            scenarioPromise.catch(() => { scenarioPromise = null; });
        }
        return scenarioPromise;
    }

    return { load, loadMap, assetUrl };
}
