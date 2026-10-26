/**
 * @file tools/build-geo.mjs
 * Authoring-time generator for assets/scenario/world.geo.json.
 *
 * Downloads a public-domain, low-resolution (1:110m) world country outline
 * derived from Natural Earth and rewrites it into a compact GeoJSON where
 * every feature carries `properties.id` = ISO-3166-1 alpha-3 (plus a display
 * name) and nothing else. Coordinates are rounded to 2 decimal places to keep
 * the shipped asset small. The resulting static file has NO runtime network
 * dependency.
 *
 * Source : Natural Earth via nvkelso/natural-earth-vector (public domain).
 * License: Public Domain (Natural Earth). See assets/scenario/README.md.
 *
 * Run (network required, authoring time only):
 *   node tools/build-geo.mjs
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'assets/scenario/world.geo.json');

const SOURCE_URL =
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';

/** Decimal places kept per coordinate (2 ≈ ~1 km; plenty for a strategy map). */
const PRECISION = 2;

/** Round a single coordinate value. */
function round(n) {
    const f = 10 ** PRECISION;
    return Math.round(n * f) / f;
}

/** Recursively round every coordinate in a GeoJSON coordinate array. */
function roundCoords(coords) {
    if (typeof coords[0] === 'number') {
        return [round(coords[0]), round(coords[1])];
    }
    return coords.map(roundCoords);
}

/**
 * Pick a usable ISO alpha-3 id from a Natural Earth feature's properties.
 * ISO_A3 is '-99' for a handful of disputed/compound entities, so fall back
 * to the _EH variant and finally to the admin-0 A3 code.
 */
function pickId(props) {
    const candidates = [props.ISO_A3_EH, props.ISO_A3, props.ADM0_A3, props.SOV_A3];
    for (const c of candidates) {
        if (typeof c === 'string' && /^[A-Z]{3}$/.test(c) && c !== '-99') return c;
    }
    return null;
}

async function main() {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
    const src = await res.json();
    if (!src || src.type !== 'FeatureCollection' || !Array.isArray(src.features)) {
        throw new Error('unexpected source GeoJSON shape');
    }

    const features = [];
    for (const f of src.features) {
        const id = pickId(f.properties || {});
        if (!id || !f.geometry) continue;
        features.push({
            type: 'Feature',
            properties: {
                id,
                name: f.properties.NAME || f.properties.ADMIN || id,
            },
            geometry: {
                type: f.geometry.type,
                coordinates: roundCoords(f.geometry.coordinates),
            },
        });
    }

    const out = {
        type: 'FeatureCollection',
        meta: {
            source: 'Natural Earth 1:110m Admin 0 Countries (nvkelso/natural-earth-vector)',
            license: 'Public Domain',
            generatedBy: 'tools/build-geo.mjs',
            precision: PRECISION,
        },
        features,
    };

    await writeFile(OUT, JSON.stringify(out) + '\n', 'utf8');
    console.log(`Wrote ${features.length} features to ${OUT}`);
}

main().catch((e) => {
    console.error('build-geo failed:', e);
    process.exit(1);
});
