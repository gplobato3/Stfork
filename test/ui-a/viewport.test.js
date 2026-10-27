import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    centerRange,
    clampView,
    fitScale,
    initialView,
    lerpView,
    mapToScreen,
    openingView,
    panBy,
    screenToMap,
    viewBoxOf,
    viewForBBox,
    wheelDeltaPx,
    wheelFactor,
    zoomAt,
    ZOOM_LIMITS,
} from '../../src/ui/map/viewport.js';

const MAP = { w: 1000, h: 520 };
const SIZE = { w: 900, h: 600 };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('viewBox keeps the container aspect ratio (exact cursor math)', () => {
    const v = initialView(MAP);
    const [, , w, h] = viewBoxOf(v, SIZE, MAP);
    assert.ok(close(w / h, SIZE.w / SIZE.h));
    assert.ok(close(fitScale(SIZE.w, SIZE.h, MAP.w, MAP.h), 0.9));
});

test('wheel zoom keeps the map point under the cursor fixed', () => {
    const v = { cx: 500, cy: 260, k: 2 };
    const sx = 700;
    const sy = 150;
    const before = screenToMap(v, sx, sy, SIZE, MAP);
    const z = zoomAt(v, 1.7, sx, sy, SIZE, MAP);
    const after = mapToScreen(z, before.x, before.y, SIZE, MAP);
    assert.ok(close(after.x, sx, 1e-6) && close(after.y, sy, 1e-6), JSON.stringify(after));
    assert.ok(close(z.k, 3.4));
});

test('zoom is clamped to ZOOM_LIMITS', () => {
    assert.equal(zoomAt(initialView(MAP), 1000, 450, 300, SIZE, MAP).k, ZOOM_LIMITS.max);
    assert.equal(zoomAt(initialView(MAP), 0.0001, 450, 300, SIZE, MAP).k, ZOOM_LIMITS.min);
});

test('drag pan works at every zoom (including k=1) and stays bounded', () => {
    const v = initialView(MAP);
    const p = panBy(v, 40, 0, SIZE, MAP);
    assert.ok(p.cx < v.cx, 'dragging right moves the view left (map follows the cursor)');
    const far = panBy(v, -100000, -100000, SIZE, MAP);
    const [lo, hi] = centerRange(SIZE.w / 0.9, MAP.w);
    assert.ok(far.cx <= hi + 1e-9 && far.cx >= lo - 1e-9);
    const zoomed = { cx: 500, cy: 260, k: 4 };
    const pz = panBy(zoomed, 100, 50, SIZE, MAP);
    const s = 0.9 * 4;
    assert.ok(close(pz.cx, 500 - 100 / s) && close(pz.cy, 260 - 50 / s));
});

test('centerRange: visible span smaller than the map vs. larger', () => {
    const [lo, hi] = centerRange(200, 1000, 0.1);
    assert.ok(close(lo, 80) && close(hi, 920));
    const [a, b] = centerRange(1200, 1000, 0.1);
    assert.ok(a < 500 && b > 500 && close((a + b) / 2, 500));
});

test('viewForBBox frames a country and respects zoom bounds', () => {
    const v = viewForBBox([300, 100, 320, 120], SIZE, MAP, { padding: 50, maxK: 5 });
    assert.equal(v.k, 5);
    assert.ok(close(v.cx, 310) && close(v.cy, 110));
    const big = viewForBBox([0, 0, 1000, 520], SIZE, MAP, { minK: 1 });
    assert.equal(big.k, 1);
});

test('openingView zooms toward cover and centres on the focus point', () => {
    const v = openingView({ w: 930, h: 780 }, MAP, { x: 366, y: 295 });
    assert.ok(v.k > 1 && v.k <= 1.8);
    assert.ok(Math.abs(v.cx - 366) < 1);
    assert.deepEqual(openingView({ w: 0, h: 0 }, MAP, null), initialView(MAP));
});

test('lerpView interpolates zoom geometrically; wheel helpers normalise deltas', () => {
    const m = lerpView({ cx: 0, cy: 0, k: 1 }, { cx: 100, cy: 50, k: 4 }, 0.5);
    assert.ok(close(m.k, 2) && close(m.cx, 50) && close(m.cy, 25));
    assert.equal(wheelDeltaPx(3, 1), 48);
    assert.equal(wheelDeltaPx(1, 2), 400);
    assert.ok(wheelFactor(-100) > 1 && wheelFactor(100) < 1);
    assert.ok(close(wheelFactor(100) * wheelFactor(-100), 1));
    assert.deepEqual(clampView({ cx: NaN, cy: NaN, k: 1 }, null, MAP), { cx: 500, cy: 260, k: 1 });
});
