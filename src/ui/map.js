/**
 * @file src/ui/map.js
 * Interactive world map for the HOI UI (Module D).
 *
 * Renders a lightweight INLINE SVG world map directly from scenario geometry:
 * one <path> (or <circle> fallback) per nation, keyed by nation id. Territories
 * are colored by relation-to-player (or bloc when no player is set yet) and the
 * player's nation is highlighted. Clicking a region selects/inspects a nation.
 * Minimal CSS-transform pan/zoom, no heavy dependencies.
 *
 * Geometry is read from the WorldState/ScenarioData passed in (world.geo or
 * scenario.geo), expected to be a GeoJSON FeatureCollection whose feature
 * properties.id is the nation id (ISO alpha-3). If geo is absent or empty, the
 * map degrades to a readable grid of nation chips so nothing crashes and the
 * player can still inspect/select nations.
 *
 * Node-safe: all DOM access is guarded; importing this file does nothing.
 */

import { getLibs } from '../core/stContext.js';
import { t } from '../i18n/i18n.js';
import { buildMapColorMap, PLAYER_COLOR } from './viewModels.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Default viewBox for an equirectangular-ish world projection (lon/lat). */
const VIEW_W = 360;
const VIEW_H = 180;

/**
 * Render (or re-render) the interactive world map into `container`.
 *
 * @param {HTMLElement} container          Host element (cleared and repopulated).
 * @param {import('../contract/worldState.js').WorldState & {geo?:object}} world
 *        World state; may carry `.geo` (GeoJSON FeatureCollection). A scenario
 *        object with `.geo` + `.nations` also works for the setup preview.
 * @param {Object} [opts]
 * @param {(nationId:string)=>void} [opts.onSelectNation] Click callback.
 * @returns {void}
 */
export function renderMap(container, world, opts = {}) {
    if (!isElement(container)) return;
    const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    const onSelect = typeof opts.onSelectNation === 'function' ? opts.onSelectNation : () => {};
    const colorMap = buildMapColorMap(world);
    const geo = extractGeo(world);

    container.classList.add('hoi-map');
    container.textContent = '';

    const features = geoFeatures(geo);
    if (!features.length) {
        renderFallbackChips(container, doc, colorMap, onSelect);
        return;
    }

    // --- SVG scaffold -----------------------------------------------------
    const viewport = doc.createElement('div');
    viewport.className = 'hoi-map__viewport';

    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'hoi-map__svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('hoi_map_title'));

    const stage = doc.createElementNS(SVG_NS, 'g');
    stage.setAttribute('class', 'hoi-map__stage');

    for (const feature of features) {
        const id = featureId(feature);
        if (!id) continue;
        const info = colorMap[id] || null;
        const el = featureToElement(doc, feature, id, info);
        if (!el) continue;
        if (onSelect) {
            el.addEventListener('click', () => onSelect(id));
            el.style.cursor = 'pointer';
        }
        stage.appendChild(el);
    }

    svg.appendChild(stage);
    viewport.appendChild(svg);
    container.appendChild(viewport);

    // --- Controls + pan/zoom ---------------------------------------------
    const controls = buildControls(doc);
    container.appendChild(controls.wrap);
    attachPanZoom(viewport, stage, controls);

    // --- Legend -----------------------------------------------------------
    container.appendChild(buildLegend(doc, world));

    const hint = doc.createElement('div');
    hint.className = 'hoi-map__hint';
    hint.textContent = t('hoi_map_select_hint');
    container.appendChild(hint);
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Pull a geo object off a world/scenario shape. */
function extractGeo(world) {
    if (!world || typeof world !== 'object') return null;
    if (world.geo && typeof world.geo === 'object') return world.geo;
    return null;
}

/** Return the feature array of a GeoJSON FeatureCollection (or []). */
function geoFeatures(geo) {
    if (!geo || typeof geo !== 'object') return [];
    if (Array.isArray(geo.features)) return geo.features.filter(Boolean);
    return [];
}

/** Extract the nation id from a feature's properties. */
function featureId(feature) {
    const p = (feature && feature.properties) || {};
    return p.id || p.ISO_A3 || p.iso_a3 || feature.id || null;
}

/**
 * Convert a GeoJSON feature to an SVG element. Supports Polygon/MultiPolygon
 * geometry (projected equirectangularly), a pre-baked SVG path string
 * (properties.path / properties.d), or a point marker (properties.cx/cy or a
 * Point geometry) as a last resort.
 * @returns {SVGElement|null}
 */
function featureToElement(doc, feature, id, info) {
    const p = (feature && feature.properties) || {};
    const fill = info ? info.color : '#3a4454';
    const isPlayer = info ? info.isPlayer : false;

    const geom = feature.geometry || {};
    let el = null;

    // 1. Pre-baked path string (simple SVG maps ship this).
    const d = p.d || p.path || (typeof feature.d === 'string' ? feature.d : null);
    if (d) {
        el = doc.createElementNS(SVG_NS, 'path');
        el.setAttribute('d', String(d));
    } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        const dStr = polygonsToPath(geom);
        if (dStr) {
            el = doc.createElementNS(SVG_NS, 'path');
            el.setAttribute('d', dStr);
        }
    }

    // 2. Point / centroid marker fallback.
    if (!el) {
        const pt = pointOf(feature, p);
        if (pt) {
            el = doc.createElementNS(SVG_NS, 'circle');
            el.setAttribute('cx', String(pt.x));
            el.setAttribute('cy', String(pt.y));
            el.setAttribute('r', isPlayer ? '4' : '3');
        }
    }

    if (!el) return null;

    el.setAttribute('class', 'hoi-map__region' + (isPlayer ? ' is-player' : ''));
    el.setAttribute('fill', fill);
    el.setAttribute('data-nation', id);
    const title = doc.createElementNS(SVG_NS, 'title');
    title.textContent = (info && info.name) || id;
    el.appendChild(title);
    return el;
}

/** Project [lon,lat] to the equirectangular viewBox coordinate space. */
function project(lon, lat) {
    const x = (Number(lon) + 180) * (VIEW_W / 360);
    const y = (90 - Number(lat)) * (VIEW_H / 180);
    return [round2(x), round2(y)];
}

/** Build an SVG path "d" string from a Polygon/MultiPolygon geometry. */
function polygonsToPath(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    if (!Array.isArray(polys)) return '';
    const parts = [];
    for (const poly of polys) {
        if (!Array.isArray(poly)) continue;
        for (const ring of poly) {
            if (!Array.isArray(ring) || ring.length < 3) continue;
            let seg = '';
            ring.forEach((coord, i) => {
                if (!Array.isArray(coord) || coord.length < 2) return;
                const [x, y] = project(coord[0], coord[1]);
                seg += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
            });
            if (seg) parts.push(seg + 'Z');
        }
    }
    return parts.join(' ').trim();
}

/** Resolve a point for a marker fallback from properties or Point geometry. */
function pointOf(feature, p) {
    if (typeof p.cx === 'number' && typeof p.cy === 'number') return { x: p.cx, y: p.cy };
    if (typeof p.lon === 'number' && typeof p.lat === 'number') {
        const [x, y] = project(p.lon, p.lat);
        return { x, y };
    }
    const geom = feature.geometry || {};
    if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        const [x, y] = project(geom.coordinates[0], geom.coordinates[1]);
        return { x, y };
    }
    return null;
}

/* -------------------------------------------------------------------------- */
/* Controls, pan/zoom, legend, fallback                                       */
/* -------------------------------------------------------------------------- */

function buildControls(doc) {
    const wrap = doc.createElement('div');
    wrap.className = 'hoi-map__controls';
    const zoomIn = iconButton(doc, '+', 'hoi_map_zoom_in');
    const zoomOut = iconButton(doc, '\u2212', 'hoi_map_zoom_out');
    const reset = iconButton(doc, '\u2302', 'hoi_map_reset');
    wrap.append(zoomIn, zoomOut, reset);
    return { wrap, zoomIn, zoomOut, reset };
}

function iconButton(doc, glyph, titleKey) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'hoi-map__ctrl';
    b.textContent = glyph;
    b.title = t(titleKey);
    b.setAttribute('aria-label', t(titleKey));
    return b;
}

/**
 * Wire minimal pan/zoom using a CSS transform on the SVG stage group.
 * Pointer events are used so it works with mouse + touch; everything is guarded.
 */
function attachPanZoom(viewport, stage, controls) {
    const state = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };
    const MIN = 1;
    const MAX = 8;

    const apply = () => {
        stage.setAttribute(
            'transform',
            `translate(${round2(state.x)} ${round2(state.y)}) scale(${round2(state.scale)})`,
        );
    };
    const zoom = (factor) => {
        state.scale = clamp(state.scale * factor, MIN, MAX);
        if (state.scale === MIN) {
            state.x = 0;
            state.y = 0;
        }
        apply();
    };

    controls.zoomIn.addEventListener('click', () => zoom(1.4));
    controls.zoomOut.addEventListener('click', () => zoom(1 / 1.4));
    controls.reset.addEventListener('click', () => {
        state.scale = 1;
        state.x = 0;
        state.y = 0;
        apply();
    });

    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    viewport.addEventListener('pointerdown', (e) => {
        state.dragging = true;
        state.startX = e.clientX - state.x;
        state.startY = e.clientY - state.y;
        if (viewport.setPointerCapture) {
            try { viewport.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }
    });
    viewport.addEventListener('pointermove', (e) => {
        if (!state.dragging || state.scale <= MIN) return;
        state.x = e.clientX - state.startX;
        state.y = e.clientY - state.startY;
        apply();
    });
    const end = () => { state.dragging = false; };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
    viewport.addEventListener('pointerleave', end);

    apply();
}

/** A compact bloc/relation legend. */
function buildLegend(doc, world) {
    const legend = doc.createElement('div');
    legend.className = 'hoi-map__legend';

    const title = doc.createElement('div');
    title.className = 'hoi-map__legend-title';
    title.textContent = t('hoi_map_legend_title');
    legend.appendChild(title);

    const addRow = (color, label) => {
        const row = doc.createElement('div');
        row.className = 'hoi-map__legend-row';
        const sw = doc.createElement('span');
        sw.className = 'hoi-map__swatch';
        sw.style.background = color;
        const txt = doc.createElement('span');
        txt.textContent = label;
        row.append(sw, txt);
        legend.appendChild(row);
    };

    const hasPlayer = !!(world && world.playerNationId);
    addRow(PLAYER_COLOR, t('hoi_map_you_label'));
    if (hasPlayer) {
        addRow('#2e8b57', t('hoi_rel_ally'));
        addRow('#95a5a6', t('hoi_rel_neutral'));
        addRow('#c0392b', t('hoi_rel_hostile'));
    } else {
        // Bloc legend before a nation is chosen.
        const blocs = [
            ['NATO', '#2e6fb0'],
            ['BRICS', '#b07d2e'],
            ['CSTO', '#b03a2e'],
            ['EU', '#2e86b0'],
            ['NON_ALIGNED', '#6b7280'],
        ];
        for (const [name, color] of blocs) addRow(color, name);
    }
    return legend;
}

/**
 * Degrade-gracefully rendering when there is no geometry: a grid of clickable
 * nation chips colored like the map would be.
 */
function renderFallbackChips(container, doc, colorMap, onSelect) {
    const ids = Object.keys(colorMap);
    const note = doc.createElement('div');
    note.className = 'hoi-map__empty';
    note.textContent = ids.length ? t('hoi_map_select_hint') : t('hoi_map_empty');
    container.appendChild(note);

    if (!ids.length) return;

    const grid = doc.createElement('div');
    grid.className = 'hoi-map__chips';
    for (const id of ids) {
        const info = colorMap[id];
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'hoi-map__chip' + (info.isPlayer ? ' is-player' : '');
        chip.style.borderColor = info.color;
        chip.setAttribute('data-nation', id);
        chip.textContent = info.name || id;
        chip.addEventListener('click', () => onSelect(id));
        grid.appendChild(chip);
    }
    container.appendChild(grid);
}

/* -------------------------------------------------------------------------- */
/* tiny utils                                                                 */
/* -------------------------------------------------------------------------- */

function isElement(x) {
    return !!x && typeof x === 'object' && typeof x.appendChild === 'function';
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

// Touch getLibs so the dependency is explicit (morphdom/Leaflet detection point
// for future use); currently the inline SVG path needs no external lib.
void getLibs;
