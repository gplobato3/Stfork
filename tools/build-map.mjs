/**
 * @file tools/build-map.mjs
 * Dev-only: builds assets/map/world.map.json (MapData, see src/contract/interfaces.js)
 * from assets/scenario/world.geo.json (Natural Earth 1:110m Admin-0, properties.id = ISO alpha-3).
 *
 * Pipeline:
 *   1. Read features; fold dependent territories into their sovereign (TERRITORY_OF) and move
 *      Antarctica to a non-interactive `decor` layer. Every remaining feature is a nation id.
 *   2. Land neighbors from the RAW geometry: two countries are neighbors when they share at least
 *      one border vertex within NEIGHBOR_EPS degrees. Then a curated maritime list is added and
 *      the relation is made symmetric.
 *   3. Topology-preserving simplification (topojson presimplify/simplify with spherical triangle
 *      area) so shared borders stay gap-free, then tiny islands are dropped (never the main body).
 *   4. Project with Natural Earth I fitted to a fixed WIDTH x HEIGHT viewBox, path data rounded to
 *      1 decimal. Per country: d, label (pole of inaccessibility of the largest polygon of the
 *      "home" cluster), capital (lat/lon table for authored nations, else centroid of the
 *      largest polygon), area (projected px²), bbox (home cluster: excludes far-flung overseas
 *      parts such as French Guiana or Alaska-side antimeridian slivers), fullBbox (whole extent).
 *   5. 30° graticule and sphere outline.
 *
 * Run: npm run build:map   (needs devDependencies; output is committed, the browser never projects)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { geoNaturalEarth1, geoPath, geoGraticule } from 'd3-geo';
import { topology } from 'topojson-server';
import { feature } from 'topojson-client';
import { presimplify, simplify, sphericalTriangleArea } from 'topojson-simplify';
import polylabel from 'polylabel';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'assets/scenario/world.geo.json');
const OUT = join(ROOT, 'assets/map/world.map.json');

export const WIDTH = 1000;
export const HEIGHT = 520;
const PAD = 4;
/** Degrees. Natural Earth 110m borders share vertices; source is rounded to 0.01°. */
const NEIGHBOR_EPS = 0.02;
/** Spherical triangle-area threshold (steradians) for Visvalingam simplification. */
const SIMPLIFY_MIN_WEIGHT = 8e-7;
/** Islands smaller than this (projected px²) are dropped unless they are a country's largest polygon. */
const MIN_POLYGON_AREA = 0.6;

/**
 * Dependent territories rendered as part of their sovereign (they are not nations in the game).
 * Natural Earth already folds French Guiana into FRA, so France borders Brazil and Suriname.
 */
export const TERRITORY_OF = Object.freeze({
    GRL: 'DNK', // Groenlândia (território autônomo do Reino da Dinamarca)
    PRI: 'USA', // Porto Rico (território dos EUA)
    NCL: 'FRA', // Nova Caledônia (coletividade francesa)
    ATF: 'FRA', // Terras Austrais e Antárticas Francesas
    FLK: 'GBR', // Ilhas Malvinas/Falklands (administradas pelo Reino Unido; reivindicadas pela Argentina)
});

/** Non-country land kept only as decoration (no nation). */
const DECOR_IDS = Object.freeze(['ATA']);

/**
 * Curated maritime / strait adjacencies, plus real land borders too short to survive at 1:110m
 * (EGY-PSE: Gaza; TCD-NGA: Lake Chad). Only pairs whose ids exist are kept (BHR is not in the
 * 110m data, so BHR pairs are skipped). DOM-USA = Mona Passage (Puerto Rico is folded into USA).
 */
export const MARITIME = Object.freeze([
    'EGY-PSE', 'TCD-NGA', 'DOM-USA',
    'GBR-FRA', 'GBR-IRL', 'GBR-NLD', 'GBR-BEL', 'GBR-NOR', 'GBR-ISL', 'GBR-DNK', 'ISL-NOR', 'ISL-DNK',
    'DNK-SWE', 'DNK-NOR', 'SWE-EST', 'SWE-LVA', 'SWE-LTU', 'SWE-POL', 'SWE-DEU', 'FIN-EST',
    'ESP-MAR', 'ESP-DZA', 'FRA-DZA', 'ITA-LBY', 'ITA-TUN', 'ITA-ALB', 'ITA-HRV', 'ITA-GRC',
    'GRC-TUR', 'GRC-LBY', 'GRC-EGY', 'GRC-CYP', 'CYP-TUR', 'CYP-SYR', 'CYP-LBN', 'CYP-ISR', 'CYP-EGY',
    'CYN-TUR', 'EGY-SAU', 'EGY-JOR', 'SAU-ERI', 'SAU-SDN', 'SAU-IRN', 'QAT-IRN', 'ARE-IRN', 'OMN-IRN',
    'KWT-IRN', 'BHR-SAU', 'BHR-QAT', 'YEM-DJI', 'YEM-ERI', 'YEM-SOM', 'YEM-SOL', 'MDG-MOZ',
    'IRN-RUS', 'KAZ-AZE', 'TKM-AZE', 'RUS-USA', 'CAN-DNK', 'ARG-GBR', 'TTO-VEN',
    'CUB-USA', 'CUB-BHS', 'CUB-JAM', 'CUB-HTI', 'CUB-MEX', 'BHS-USA', 'JAM-HTI',
    'JPN-KOR', 'JPN-CHN', 'JPN-RUS', 'JPN-TWN', 'JPN-PRK', 'JPN-PHL', 'TWN-CHN', 'TWN-PHL',
    'KOR-CHN', 'CHN-PHL', 'VNM-PHL', 'MYS-PHL', 'IDN-PHL', 'LKA-IND',
    'AUS-IDN', 'AUS-PNG', 'AUS-TLS', 'NZL-AUS', 'SLB-PNG', 'VUT-SLB', 'FJI-VUT',
]);

/** Capital [lon, lat] for authored nations (minors use the centroid of their largest polygon). */
export const CAPITALS = Object.freeze({
    USA: [-77.04, 38.9], CAN: [-75.7, 45.42], MEX: [-99.13, 19.43], CUB: [-82.37, 23.11],
    BRA: [-47.88, -15.79], ARG: [-58.38, -34.6], VEN: [-66.9, 10.48], COL: [-74.07, 4.71],
    CHL: [-70.67, -33.45], PER: [-77.04, -12.05], URY: [-56.16, -34.9], BOL: [-68.15, -16.5],
    ECU: [-78.47, -0.18], PRY: [-57.58, -25.26],
    GBR: [-0.13, 51.51], FRA: [2.35, 48.86], DEU: [13.4, 52.52], ITA: [12.5, 41.9], ESP: [-3.7, 40.42],
    PRT: [-9.14, 38.72], NLD: [4.9, 52.37], BEL: [4.35, 50.85], POL: [21.01, 52.23], CZE: [14.42, 50.08],
    HUN: [19.04, 47.5], ROU: [26.1, 44.43], GRC: [23.73, 37.98], SRB: [20.46, 44.79], SWE: [18.07, 59.33],
    NOR: [10.75, 59.91], FIN: [24.94, 60.17], DNK: [12.57, 55.68], EST: [24.75, 59.44], LVA: [24.11, 56.95],
    LTU: [25.28, 54.69], UKR: [30.52, 50.45], BLR: [27.56, 53.9],
    RUS: [37.62, 55.76], TUR: [32.85, 39.93], KAZ: [71.45, 51.17], AZE: [49.87, 40.41], GEO: [44.79, 41.72],
    ARM: [44.51, 40.18],
    IRN: [51.39, 35.69], ISR: [35.21, 31.77], SAU: [46.72, 24.71], EGY: [31.24, 30.04], SYR: [36.29, 33.51],
    IRQ: [44.37, 33.31], ARE: [54.37, 24.45], QAT: [51.53, 25.29],
    ZAF: [28.19, -25.75], NGA: [7.49, 9.06], ETH: [38.75, 9.03], DZA: [3.06, 36.75], MAR: [-6.84, 34.02],
    KEN: [36.82, -1.29],
    CHN: [116.4, 39.9], PRK: [125.75, 39.03], KOR: [126.98, 37.57], JPN: [139.69, 35.69], TWN: [121.56, 25.03],
    IND: [77.21, 28.61], PAK: [73.05, 33.68], BGD: [90.41, 23.81], IDN: [106.85, -6.21], VNM: [105.85, 21.03],
    THA: [100.5, 13.75], PHL: [120.98, 14.6], MYS: [101.69, 3.14],
    AUS: [149.13, -35.28], NZL: [174.78, -41.29],
});

const r1 = (n) => Math.round(n * 10) / 10;

/** Signed planar ring area (shoelace). */
function ringArea(ring) {
    let s = 0;
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
        s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    }
    return s / 2;
}

function pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function bboxOfRings(rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of rings) {
        for (const [x, y] of ring) {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
        }
    }
    return [x0, y0, x1, y1];
}

function unionBbox(a, b) {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function bboxGap(a, b) {
    const dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
    const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
    return Math.hypot(dx, dy);
}

/** Polygons (array of rings) of a GeoJSON Polygon/MultiPolygon geometry. */
function polygonsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
}

/** Every vertex of a geometry (raw lon/lat). */
function verticesOf(geometry) {
    const out = [];
    for (const poly of polygonsOf(geometry)) for (const ring of poly) for (const p of ring) out.push(p);
    return out;
}

/**
 * Land neighbors: countries sharing a vertex within `eps` degrees (grid hash, 3x3 lookup).
 * @param {Array<{id:string, geometry:object}>} features
 */
export function landNeighbors(features, eps = NEIGHBOR_EPS) {
    const grid = new Map();
    const key = (i, j) => `${i}:${j}`;
    for (const f of features) {
        for (const [lon, lat] of verticesOf(f.geometry)) {
            const k = key(Math.floor(lon / eps), Math.floor(lat / eps));
            let cell = grid.get(k);
            if (!cell) grid.set(k, (cell = []));
            cell.push([lon, lat, f.id]);
        }
    }
    const pairs = new Map(features.map((f) => [f.id, new Set()]));
    for (const [k, cell] of grid) {
        const [i, j] = k.split(':').map(Number);
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                const other = grid.get(key(i + di, j + dj));
                if (!other) continue;
                for (const a of cell) {
                    for (const b of other) {
                        if (a[2] === b[2]) continue;
                        if (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps) {
                            pairs.get(a[2]).add(b[2]);
                        }
                    }
                }
            }
        }
    }
    return pairs;
}

function mergeGeometries(geoms) {
    const coords = [];
    for (const g of geoms) for (const poly of polygonsOf(g)) coords.push(poly);
    return coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords };
}

export async function buildMap() {
    const src = JSON.parse(await readFile(SRC, 'utf8'));
    const byId = new Map();
    const decorRaw = [];
    for (const f of src.features) {
        const id = f.properties && f.properties.id;
        if (!id || !f.geometry) continue;
        if (DECOR_IDS.includes(id)) {
            decorRaw.push({ id, geometry: f.geometry });
            continue;
        }
        const owner = TERRITORY_OF[id] || id;
        if (!byId.has(owner)) byId.set(owner, []);
        byId.get(owner).push(f.geometry);
    }
    for (const [territory, owner] of Object.entries(TERRITORY_OF)) {
        if (!byId.has(owner)) throw new Error(`territory ${territory} folds into missing sovereign ${owner}`);
    }
    const raw = [...byId.entries()]
        .map(([id, geoms]) => ({ id, geometry: mergeGeometries(geoms) }))
        .sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set(raw.map((f) => f.id));

    // 2. Neighbors (raw geometry + curated maritime list), symmetric.
    const neighbors = landNeighbors(raw);
    let maritimeAdded = 0;
    for (const pair of MARITIME) {
        const [a, b] = pair.split('-');
        if (!ids.has(a) || !ids.has(b)) continue;
        if (!neighbors.get(a).has(b)) maritimeAdded++;
        neighbors.get(a).add(b);
        neighbors.get(b).add(a);
    }
    for (const [a, set] of neighbors) for (const b of set) neighbors.get(b).add(a);

    // 3. Topology-preserving simplification.
    const objects = {
        countries: {
            type: 'FeatureCollection',
            features: raw.map((f) => ({ type: 'Feature', id: f.id, properties: {}, geometry: f.geometry })),
        },
        decor: {
            type: 'FeatureCollection',
            features: decorRaw.map((f) => ({ type: 'Feature', id: f.id, properties: {}, geometry: f.geometry })),
        },
    };
    let topo = topology(objects, 1e5);
    topo = presimplify(topo, sphericalTriangleArea);
    topo = simplify(topo, SIMPLIFY_MIN_WEIGHT);
    const simplified = feature(topo, topo.objects.countries).features;
    const decorSimplified = feature(topo, topo.objects.decor).features;

    // 4. Projection.
    const projection = geoNaturalEarth1().fitExtent(
        [[PAD, PAD], [WIDTH - PAD, HEIGHT - PAD]],
        { type: 'Sphere' },
    );
    const pathRaw = geoPath(projection);
    const path = geoPath(projection).digits(1);

    const countries = {};
    for (const f of simplified) {
        const id = f.id;
        // Project polygon by polygon so tiny islands can be filtered and the home cluster found.
        // One source polygon may yield several planar parts (antimeridian clipping).
        const polys = [];
        for (const poly of polygonsOf(f.geometry)) {
            const g = { type: 'Polygon', coordinates: poly };
            const area = pathRaw.area(g);
            const parts = projectedParts(projection, g);
            if (!parts.length) continue;
            polys.push({ geo: poly, area, parts });
        }
        if (!polys.length) throw new Error(`country ${id} has no projectable geometry`);
        polys.sort((a, b) => b.area - a.area);
        const kept = polys.filter((p, i) => i === 0 || p.area >= MIN_POLYGON_AREA);
        const parts = kept.flatMap((p) => p.parts).sort((a, b) => b.area - a.area);

        const cap = CAPITALS[id] ? projection(CAPITALS[id]) : null;
        // Home part: the one containing the capital, else the nearest to it, else the largest.
        let home = parts[0];
        if (cap) {
            const containing = parts.find((p) => pointInRing(cap, p.rings[0]));
            if (containing) home = containing;
            else {
                let best = Infinity;
                for (const p of parts) {
                    const g = bboxGap(p.bbox, [cap[0], cap[1], cap[0], cap[1]]);
                    if (g < best) { best = g; home = p; }
                }
            }
        }
        const diag = Math.hypot(home.bbox[2] - home.bbox[0], home.bbox[3] - home.bbox[1]);
        const reach = Math.max(6, diag * 0.35);
        const cluster = parts.filter((p) => p === home || bboxGap(p.bbox, home.bbox) <= reach);
        const main = cluster.reduce((a, b) => (b.area > a.area ? b : a));
        const label = polylabel(main.rings, 0.5);
        const bbox = cluster.map((p) => p.bbox).reduce(unionBbox);
        const fullBbox = parts.map((p) => p.bbox).reduce(unionBbox);
        const capital = cap || centroidOfRings(parts[0].rings);

        const geometry = kept.length === 1
            ? { type: 'Polygon', coordinates: kept[0].geo }
            : { type: 'MultiPolygon', coordinates: kept.map((p) => p.geo) };
        const d = path(geometry);
        countries[id] = {
            id,
            d,
            label: [r1(label[0]), r1(label[1])],
            capital: [r1(capital[0]), r1(capital[1])],
            area: Math.round(kept.reduce((s, p) => s + p.area, 0)),
            bbox: bbox.map(r1),
            fullBbox: fullBbox.map(r1),
            neighbors: [...neighbors.get(id)].sort(),
        };
    }

    const graticule = path(geoGraticule().step([30, 30]).extentMinor([[-180, -90], [180, 90.0001]])());
    const outline = path({ type: 'Sphere' });
    const decor = decorSimplified.map((f) => ({ id: f.id, d: path(f.geometry) }));

    const map = {
        width: WIDTH,
        height: HEIGHT,
        projection: 'naturalEarth1',
        source: 'Natural Earth 1:110m Admin 0 Countries (domínio público), via assets/scenario/world.geo.json',
        territories: { ...TERRITORY_OF },
        countries,
        graticule,
        outline,
        decor,
    };
    await mkdir(dirname(OUT), { recursive: true });
    const json = JSON.stringify(map);
    await writeFile(OUT, json + '\n');
    return { map, bytes: Buffer.byteLength(json) + 1, maritimeAdded };
}

/**
 * Project a lon/lat polygon into planar parts using d3's clipping (handles the antimeridian).
 * Rings are grouped into shells + holes by containment, largest first.
 * @returns {Array<{rings: number[][][], bbox: number[], area: number}>}
 */
function projectedParts(projection, geometry) {
    const rings = [];
    let current = null;
    const stream = projection.stream({
        point(x, y) { current.push([x, y]); },
        lineStart() { current = []; },
        lineEnd() { if (current && current.length > 2) rings.push(current); current = null; },
        polygonStart() {},
        polygonEnd() {},
        sphere() {},
    });
    streamGeometry(geometry, stream);
    rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
    const parts = [];
    for (const ring of rings) {
        const shell = parts.find((p) => pointInRing(ring[0], p.rings[0]));
        if (shell) {
            shell.rings.push(ring);
            shell.area -= Math.abs(ringArea(ring));
        } else {
            parts.push({ rings: [ring], area: Math.abs(ringArea(ring)) });
        }
    }
    for (const p of parts) p.bbox = bboxOfRings([p.rings[0]]);
    return parts;
}

function streamGeometry(geometry, stream) {
    stream.polygonStart();
    for (const ring of geometry.coordinates) {
        stream.lineStart();
        // GeoJSON rings repeat the first point; d3 streams omit it.
        for (let i = 0, n = ring.length - 1; i < n; i++) stream.point(ring[i][0], ring[i][1]);
        stream.lineEnd();
    }
    stream.polygonEnd();
}

function centroidOfRings(rings) {
    const ring = rings[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        a += f;
        cx += (ring[j][0] + ring[i][0]) * f;
        cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (Math.abs(a) < 1e-9) return ring[0];
    return [cx / (3 * a), cy / (3 * a)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const { map, bytes, maritimeAdded } = await buildMap();
    const n = Object.keys(map.countries).length;
    console.log(`world.map.json: ${n} countries, ${(bytes / 1024).toFixed(1)} KB, +${maritimeAdded} maritime links`);
}
