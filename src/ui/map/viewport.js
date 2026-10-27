/**
 * @file src/ui/map/viewport.js
 * Pure viewBox math for the map. A view is {cx, cy, k}: the map point at the
 * center of the container and the zoom factor relative to "whole world fits".
 * The viewBox always has the container's aspect ratio, so 1 map unit maps to
 * `scale` screen px in both axes and cursor math is exact.
 */

export const ZOOM_LIMITS = Object.freeze({ min: 0.85, max: 16 });

/** Screen px per map unit when k = 1 (whole map visible). */
export function fitScale(cw, ch, W, H) {
    if (!(cw > 0 && ch > 0 && W > 0 && H > 0)) return 1;
    return Math.min(cw / W, ch / H);
}

export function scaleOf(view, size, map) {
    return fitScale(size.w, size.h, map.w, map.h) * view.k;
}

/** viewBox [x, y, w, h] for a view. */
export function viewBoxOf(view, size, map) {
    const s = scaleOf(view, size, map);
    const w = size.w / s;
    const h = size.h / s;
    return [view.cx - w / 2, view.cy - h / 2, w, h];
}

/** Share of the visible span that may be panned past the map edge. */
export const PAN_SLACK = 0.08;

/** Allowed center range on one axis (pan works at every zoom, bounded near the edges). */
export function centerRange(visible, total, slack = PAN_SLACK) {
    const half = visible / 2;
    const m = visible * slack;
    let lo = half - m;
    let hi = total - half + m;
    if (lo > hi) {
        // Zoomed out beyond the map: keep it roughly centred, still draggable a little.
        const mid = total / 2;
        const free = (visible - total) / 2 + m;
        lo = mid - free;
        hi = mid + free;
    }
    return [lo, hi];
}

export function clampView(view, size, map, limits = ZOOM_LIMITS) {
    const k = Math.max(limits.min, Math.min(limits.max, Number(view.k) || 1));
    let cx = Number.isFinite(view.cx) ? view.cx : map.w / 2;
    let cy = Number.isFinite(view.cy) ? view.cy : map.h / 2;
    if (size && size.w > 0 && size.h > 0) {
        const s = fitScale(size.w, size.h, map.w, map.h) * k;
        const [xlo, xhi] = centerRange(size.w / s, map.w);
        const [ylo, yhi] = centerRange(size.h / s, map.h);
        cx = Math.max(xlo, Math.min(xhi, cx));
        cy = Math.max(ylo, Math.min(yhi, cy));
    } else {
        cx = Math.max(0, Math.min(map.w, cx));
        cy = Math.max(0, Math.min(map.h, cy));
    }
    return { cx, cy, k };
}

/**
 * Opening view: zoomed so the map fills most of the container height and
 * centred on `focus` (the player's nation) when given.
 */
export function openingView(size, map, focus) {
    if (!(size && size.w > 0 && size.h > 0)) return initialView(map);
    const fit = fitScale(size.w, size.h, map.w, map.h);
    const cover = Math.max(size.w / map.w, size.h / map.h) / fit;
    const k = Math.max(1, Math.min(1.8, cover * 0.85));
    const p = focus || { x: map.w / 2, y: map.h / 2 };
    return clampView({ cx: p.x, cy: p.y, k }, size, map);
}

export function initialView(map) {
    return { cx: map.w / 2, cy: map.h / 2, k: 1 };
}

/** Map point under a container-relative screen point. */
export function screenToMap(view, sx, sy, size, map) {
    const s = scaleOf(view, size, map);
    return { x: view.cx + (sx - size.w / 2) / s, y: view.cy + (sy - size.h / 2) / s };
}

export function mapToScreen(view, x, y, size, map) {
    const s = scaleOf(view, size, map);
    return { x: (x - view.cx) * s + size.w / 2, y: (y - view.cy) * s + size.h / 2 };
}

/** Zoom by `factor` keeping the map point under (sx, sy) fixed on screen. */
export function zoomAt(view, factor, sx, sy, size, map, limits = ZOOM_LIMITS) {
    const p = screenToMap(view, sx, sy, size, map);
    const k = Math.max(limits.min, Math.min(limits.max, view.k * factor));
    const s = fitScale(size.w, size.h, map.w, map.h) * k;
    return clampView({ cx: p.x - (sx - size.w / 2) / s, cy: p.y - (sy - size.h / 2) / s, k }, size, map, limits);
}

/** Pan by a screen-pixel delta (drag right => map moves right). */
export function panBy(view, dx, dy, size, map, limits = ZOOM_LIMITS) {
    const s = scaleOf(view, size, map);
    return clampView({ cx: view.cx - dx / s, cy: view.cy - dy / s, k: view.k }, size, map, limits);
}

/** View that frames a bbox with padding (screen px), zoom clamped to [minK, maxK]. */
export function viewForBBox(bbox, size, map, { padding = 60, minK = 1, maxK = 6 } = {}) {
    const [x0, y0, x1, y1] = bbox;
    const bw = Math.max(1, x1 - x0);
    const bh = Math.max(1, y1 - y0);
    const base = fitScale(size.w, size.h, map.w, map.h);
    const availW = Math.max(40, size.w - padding * 2);
    const availH = Math.max(40, size.h - padding * 2);
    const k = Math.max(minK, Math.min(maxK, Math.min(availW / bw, availH / bh) / base));
    return clampView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k }, size, map, { min: ZOOM_LIMITS.min, max: ZOOM_LIMITS.max });
}

/** Interpolate views (zoom interpolated geometrically for a natural feel). */
export function lerpView(a, b, t) {
    const e = Math.max(0, Math.min(1, t));
    return {
        cx: a.cx + (b.cx - a.cx) * e,
        cy: a.cy + (b.cy - a.cy) * e,
        k: a.k * Math.pow(b.k / a.k, e),
    };
}

export function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

/** Normalize a WheelEvent delta to pixels. */
export function wheelDeltaPx(deltaY, deltaMode) {
    if (deltaMode === 1) return deltaY * 16; // lines
    if (deltaMode === 2) return deltaY * 400; // pages
    return deltaY;
}

/** Zoom factor for an accumulated wheel delta (px). */
export function wheelFactor(deltaPx) {
    const d = Math.max(-600, Math.min(600, deltaPx));
    return Math.exp(-d * 0.0018);
}
