/**
 * @file src/ui/map/mapView.js
 * Interactive SVG world map (DOM). Renders a pre-projected MapData, colors it
 * per map mode from a WorldState and handles zoom/pan/selection/hover.
 *
 * Performance notes:
 *  - Country <path>s are created once (setData) and cached by id; render()
 *    only writes fills/overlays that changed.
 *  - Pan/zoom only rewrites the viewBox plus one CSS variable (--hoi-u, map
 *    units per screen px) inside a requestAnimationFrame; labels and markers
 *    read --hoi-u from CSS so they keep a constant on-screen size.
 *  - No layout reads during interaction (container size comes from a
 *    ResizeObserver; tooltip placement uses transforms only).
 *  - No SVG filters (the player "glow" is a wide translucent stroke).
 */

import { MAP_MODES } from '../../contract/constants.js';
import { clear, flagEl, h, icon, s, setAttr, setText, toggleClass, updateFlag } from '../warroom/dom.js';
import { STAR, SWORDS_BLADES, SWORDS_GUARDS, SWORDS_POMMELS, WARN_BANG, WARN_DOT, WARN_TRIANGLE } from './icons.js';
import {
    MAP_MODE_META,
    buildWorldIndex,
    capitalMarkers,
    computeMapPaint,
    crisisMarkers,
    frontMarkers,
    labelItems,
    legendEntries,
    nextMapMode,
    playerTerritories,
    tooltipModel,
    visibleLabels,
} from './mapModel.js';
import {
    clampView,
    easeOutCubic,
    initialView,
    lerpView,
    openingView,
    panBy,
    scaleOf,
    viewBoxOf,
    viewForBBox,
    wheelDeltaPx,
    wheelFactor,
    zoomAt,
} from './viewport.js';

const HATCH_PERIOD = 7; // screen px between stripes
const HATCH_WIDTH = [0, 1.4, 2.4, 3.4, 4.7]; // stripe width per density level
const DRAG_THRESHOLD = 4;

let instanceCounter = 0;

/**
 * @param {Object} opts
 * @param {(id: string) => void} [opts.onSelect]
 * @param {(mode: string) => void} [opts.onModeChange]
 * @param {(path: string) => string} [opts.assetUrl]
 * @param {string} [opts.initialMode]
 */
export function createMapView(opts = {}) {
    const onSelect = opts.onSelect || (() => {});
    const onModeChange = opts.onModeChange || (() => {});
    const assetUrl = opts.assetUrl || null;
    const uid = `hoi-m${++instanceCounter}`;

    let mode = MAP_MODES.includes(opts.initialMode) ? opts.initialMode : 'political';
    let data = null;
    let map = { w: 1000, h: 520 };
    let ids = [];
    let state = null;
    let index = buildWorldIndex(null);
    let selectedId = null;
    let hoverKey = null;
    let view = { cx: 500, cy: 260, k: 1 };
    let size = { w: 0, h: 0 };
    let rect = { left: 0, top: 0 };
    let applied = null;
    let labelScale = 0;
    let raf = 0;
    let anim = null;
    let wheelAcc = null;
    let pendingTip = null;
    let markerSig = '';
    let playerSig = '';
    let destroyed = false;
    let needsOpening = false;
    let hoverTarget = null;

    const paths = new Map();
    const fills = new Map();
    const labelEls = new Map();
    let labelList = [];
    const hatchEls = new Map();
    const patterns = new Map();

    /* --------------------------------------------------------------- shell */

    const gradId = `${uid}-ocean`;
    const defs = s('defs', null,
        s('radialGradient', { id: gradId, cx: '50%', cy: '42%', r: '70%' },
            s('stop', { offset: '0%', 'stop-color': '#173445' }),
            s('stop', { offset: '55%', 'stop-color': '#10232e' }),
            s('stop', { offset: '100%', 'stop-color': '#08141b' }),
        ),
    );
    const gOcean = s('path', { class: 'hoi-map__ocean', fill: `url(#${gradId})` });
    const gGraticule = s('path', { class: 'hoi-map__graticule' });
    const gCoast = s('path', { class: 'hoi-map__coast' });
    const gDecor = s('g', { class: 'hoi-map__decor' });
    const gCountries = s('g', { class: 'hoi-map__countries' });
    const gOcc = s('g', { class: 'hoi-map__occ' });
    const gOutline = s('path', { class: 'hoi-map__outline' });
    const gPlayer = s('g', { class: 'hoi-map__player' });
    const hoverPath = s('path', { class: 'hoi-map__hover' });
    const selUnder = s('path', { class: 'hoi-map__sel-under' });
    const selPath = s('path', { class: 'hoi-map__sel' });
    const gLabels = s('g', { class: 'hoi-map__labels' });
    const gMarkers = s('g', { class: 'hoi-map__markers' });

    const svg = s('svg', {
        class: 'hoi-map__svg',
        xmlns: 'http://www.w3.org/2000/svg',
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': 'Mapa-múndi',
    }, defs, gOcean, gGraticule, gCoast, gDecor, gCountries, gOcc, gOutline, gPlayer, hoverPath, selUnder, selPath, gLabels, gMarkers);

    // Tooltip
    const tipFlag = flagEl(assetUrl, null, 'sm');
    const tipTitle = h('div', { class: 'hoi-map__tip-title' });
    const tipLines = h('div', { class: 'hoi-map__tip-lines' });
    const tooltip = h('div', { class: 'hoi-map__tip', role: 'tooltip', 'aria-hidden': 'true' },
        h('div', { class: 'hoi-map__tip-head' }, tipFlag, tipTitle), tipLines);

    // Mode switcher
    const modeBtns = new Map();
    const modeBar = h('div', { class: 'hoi-map__modes', role: 'toolbar', 'aria-label': 'Modos de mapa (tecla M)' });
    for (const m of MAP_MODES) {
        const meta = MAP_MODE_META[m];
        const btn = h('button', {
            type: 'button',
            class: 'hoi-map__mode',
            title: `${meta.label} — ${meta.hint} (M alterna)`,
            'aria-pressed': 'false',
            dataset: { mode: m },
            onClick: () => setMode(m, true),
        }, icon(meta.icon), h('span', { text: meta.label }));
        modeBtns.set(m, btn);
        modeBar.appendChild(btn);
    }

    // Legend
    const legendTitleText = h('span');
    const legendTitle = h('button', { type: 'button', class: 'hoi-map__legend-title', 'aria-expanded': 'true', title: 'Mostrar/ocultar legenda' }, legendTitleText, icon('fa-solid fa-chevron-down'));
    const legendList = h('div', { class: 'hoi-map__legend-list' });
    const legend = h('div', { class: 'hoi-map__legend', 'aria-label': 'Legenda do mapa' }, legendTitle, legendList);
    legendTitle.addEventListener('click', () => {
        // Default: open on desktop, closed on small screens (see css/map.css).
        const mobile = typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches;
        const cur = legend.dataset.legend || (mobile ? 'closed' : 'open');
        legend.dataset.legend = cur === 'open' ? 'closed' : 'open';
        setAttr(legendTitle, 'aria-expanded', legend.dataset.legend === 'open' ? 'true' : 'false');
    });

    // Zoom controls
    const zoomBar = h('div', { class: 'hoi-map__zoom', role: 'group', 'aria-label': 'Zoom do mapa' },
        h('button', { type: 'button', class: 'hoi-map__zbtn', title: 'Aproximar (+)', 'aria-label': 'Aproximar', onClick: () => zoomBy(1.6) }, icon('fa-solid fa-plus')),
        h('button', { type: 'button', class: 'hoi-map__zbtn', title: 'Afastar (−)', 'aria-label': 'Afastar', onClick: () => zoomBy(1 / 1.6) }, icon('fa-solid fa-minus')),
        h('button', { type: 'button', class: 'hoi-map__zbtn', title: 'Visão global (0)', 'aria-label': 'Visão global', onClick: () => resetView(true) }, icon('fa-solid fa-earth-americas')),
    );

    const msg = h('div', { class: 'hoi-map__msg', hidden: true });

    const root = h('div', {
        class: 'hoi-map',
        tabindex: '0',
        'aria-label': 'Mapa-múndi interativo. Arraste para mover, roda do mouse para zoom, M alterna o modo.',
        dataset: { mode },
    }, svg, msg, modeBar, legend, zoomBar, tooltip);

    /* ------------------------------------------------------------ geometry */

    function setData(mapData) {
        data = mapData || null;
        clear(gCountries);
        clear(gDecor);
        clear(gLabels);
        clear(gOcc);
        paths.clear();
        fills.clear();
        labelEls.clear();
        hatchEls.clear();
        labelList = [];
        markerSig = '';
        playerSig = '';
        if (!data || !data.countries) {
            showMessage('Mapa indisponível.');
            return;
        }
        hideMessage();
        map = { w: Number(data.width) || 1000, h: Number(data.height) || 520 };
        setAttr(gOcean, 'd', data.outline || `M0 0H${map.w}V${map.h}H0Z`);
        setAttr(gOutline, 'd', data.outline || '');
        setAttr(gGraticule, 'd', data.graticule || '');
        ids = Object.keys(data.countries);
        needsOpening = true;
        let coast = '';
        const frag = document.createDocumentFragment();
        for (const id of ids) {
            const c = data.countries[id];
            const p = s('path', { class: 'hoi-map__c', d: c.d, dataset: { id } });
            paths.set(id, p);
            frag.appendChild(p);
            coast += c.d;
        }
        gCountries.appendChild(frag);
        // Optional non-interactive land (e.g. Antarctica) emitted by tools/build-map.mjs.
        for (const dec of Array.isArray(data.decor) ? data.decor : []) {
            if (dec && dec.d) {
                gDecor.appendChild(s('path', { class: 'hoi-map__decorland', d: dec.d }));
                coast += dec.d;
            }
        }
        setAttr(gCoast, 'd', coast);
        view = initialView(map);
        applied = null;
        labelScale = 0;
        if (state) render({ state, selectedId });
        schedule();
    }

    function showMessage(text) {
        setText(msg, text);
        msg.hidden = false;
    }
    function hideMessage() {
        msg.hidden = true;
    }

    /* -------------------------------------------------------------- render */

    /**
     * Incremental re-render from a WorldState.
     * @param {{state: ?Object, selectedId?: ?string, index?: Object}} p
     */
    function render(p = {}) {
        state = p.state || null;
        if (p.selectedId !== undefined) selectedId = p.selectedId;
        index = p.index || buildWorldIndex(state);
        toggleClass(root, 'is-empty', !state);
        if (!data) return;

        const paint = computeMapPaint(state, mode, ids, index);
        const liveHatch = new Set();
        for (const id of ids) {
            const pt = paint.get(id);
            const el = paths.get(id);
            if (fills.get(id) !== pt.fill) {
                el.style.fill = pt.fill;
                fills.set(id, pt.fill);
            }
            if (pt.hatch) {
                liveHatch.add(id);
                const patId = ensurePattern(pt.hatch);
                let ov = hatchEls.get(id);
                if (!ov) {
                    ov = s('path', { class: 'hoi-map__hatch', d: data.countries[id].d });
                    hatchEls.set(id, ov);
                    gOcc.appendChild(ov);
                }
                setAttr(ov, 'fill', `url(#${patId})`);
            }
        }
        for (const [id, ov] of hatchEls) {
            if (!liveHatch.has(id)) {
                ov.remove();
                hatchEls.delete(id);
            }
        }

        renderPlayerOutline();
        renderSelection();
        renderLabels();
        renderMarkers();
        renderLegend();
        if (hoverKey) refreshTooltipContent();
        schedule();
    }

    function ensurePattern(hatch) {
        const patId = `${uid}-hatch-${hatch.key}`;
        if (patterns.has(patId)) return patId;
        const w = HATCH_WIDTH[hatch.level] || HATCH_WIDTH[1];
        const pat = s('pattern', {
            id: patId,
            patternUnits: 'userSpaceOnUse',
            width: HATCH_PERIOD,
            height: HATCH_PERIOD,
            patternTransform: `rotate(45) scale(${currentUnit()})`,
        }, s('rect', { x: 0, y: 0, width: w, height: HATCH_PERIOD, fill: hatch.color, 'fill-opacity': '0.92' }));
        patterns.set(patId, pat);
        defs.appendChild(pat);
        return patId;
    }

    function renderPlayerOutline() {
        const terr = playerTerritories(state, ids, index);
        const sig = terr.join(',');
        if (sig === playerSig) return;
        playerSig = sig;
        clear(gPlayer);
        for (const id of terr) {
            const d = data.countries[id].d;
            gPlayer.appendChild(s('path', { class: 'hoi-map__player-glow', d }));
            gPlayer.appendChild(s('path', { class: 'hoi-map__player-line', d }));
        }
    }

    function renderSelection() {
        const c = selectedId && data ? data.countries[selectedId] : null;
        const d = c ? c.d : '';
        setAttr(selPath, 'd', d || null);
        setAttr(selUnder, 'd', d || null);
    }

    function renderLabels() {
        const items = labelItems(state, data);
        const keep = new Set();
        for (const it of items) {
            keep.add(it.id);
            let el = labelEls.get(it.id);
            if (!el) {
                el = s('text', { class: `hoi-map__label${it.major ? ' is-major' : ''}`, x: it.x, y: it.y, dataset: { id: it.id } });
                labelEls.set(it.id, el);
                gLabels.appendChild(el);
            }
            toggleClass(el, 'is-major', it.major);
            toggleClass(el, 'is-player', !!index.playerId && it.id === index.playerId);
            setText(el, it.text);
        }
        for (const [id, el] of labelEls) {
            if (!keep.has(id)) {
                el.remove();
                labelEls.delete(id);
            }
        }
        labelList = items;
        labelScale = 0; // force a visibility pass on the next frame
    }

    function updateLabelVisibility(scale) {
        const visible = visibleLabels(labelList, scale, index.playerId);
        for (const it of labelList) {
            const el = labelEls.get(it.id);
            if (el) toggleClass(el, 'is-hidden', !visible.has(it.id));
        }
    }

    function renderMarkers() {
        const caps = capitalMarkers(state, data);
        const fronts = frontMarkers(state, data, index);
        const crises = crisisMarkers(state, data, index);
        const sig = JSON.stringify([caps.map((m) => [m.key, m.isPlayer]), fronts.map((m) => [m.key, m.x, m.y, m.progress, m.ceasefire, m.involvesPlayer]), crises.map((m) => [m.key, m.severity, m.tip])]);
        if (sig === markerSig) return;
        markerSig = sig;
        clear(gMarkers);
        const frag = document.createDocumentFragment();
        for (const m of caps) {
            frag.appendChild(s('g', { class: `hoi-mk hoi-mk--cap${m.isPlayer ? ' is-player' : ''}`, transform: `translate(${m.x} ${m.y})`, dataset: { tip: m.tip, id: m.id } },
                s('g', { class: 'hoi-mk__s' }, s('path', { class: 'hoi-mk__star', d: STAR }))));
        }
        for (const m of crises) {
            const ox = m.slot ? (m.slot % 2 ? 1 : -1) * Math.ceil(m.slot / 2) * 17 : 0;
            frag.appendChild(s('g', { class: `hoi-mk hoi-mk--crisis is-${m.severity}`, transform: `translate(${m.x} ${m.y})`, dataset: { tip: `Crise: ${m.tip}`, id: m.id } },
                s('g', { class: 'hoi-mk__s' },
                    s('g', { transform: `translate(${ox} -16)` },
                        m.pulse ? s('circle', { class: 'hoi-mk__pulse', r: 9, stroke: m.color }) : null,
                        s('path', { class: 'hoi-mk__tri', d: WARN_TRIANGLE, fill: m.color }),
                        s('path', { class: 'hoi-mk__bang', d: WARN_BANG }),
                        s('circle', { class: 'hoi-mk__dot', cx: WARN_DOT.cx, cy: WARN_DOT.cy, r: WARN_DOT.r }),
                    ))));
        }
        for (const m of fronts) {
            frag.appendChild(s('g', {
                class: `hoi-mk hoi-mk--front${m.involvesPlayer ? ' is-player' : ''}${m.ceasefire ? ' is-ceasefire' : ''}`,
                transform: `translate(${m.x} ${m.y})`,
                dataset: { tip: m.tip, id: m.defender },
            }, s('g', { class: 'hoi-mk__s' },
                s('circle', { class: 'hoi-mk__bg', r: 8.6 }),
                s('path', { class: 'hoi-mk__blades', d: SWORDS_BLADES }),
                s('path', { class: 'hoi-mk__guards', d: SWORDS_GUARDS }),
                s('path', { class: 'hoi-mk__pommels', d: SWORDS_POMMELS }),
                s('text', { class: 'hoi-mk__pct', y: 19, text: `${m.progress}%` }),
            )));
        }
        gMarkers.appendChild(frag);
    }

    function renderLegend() {
        const meta = MAP_MODE_META[mode];
        setText(legendTitleText, `Legenda · ${meta.label}`);
        clear(legendList);
        for (const e of legendEntries(mode)) {
            const sw = h('span', { class: `hoi-map__sw hoi-map__sw--${e.kind}` });
            sw.style.setProperty('--sw', e.color);
            legendList.appendChild(h('div', { class: 'hoi-map__legend-item' }, sw, h('span', { text: e.label })));
        }
    }

    /* ---------------------------------------------------------------- mode */

    function setMode(m, fromUser = false) {
        if (!MAP_MODES.includes(m)) return;
        const changed = m !== mode;
        mode = m;
        root.dataset.mode = m;
        for (const [k, b] of modeBtns) {
            setAttr(b, 'aria-pressed', k === m ? 'true' : 'false');
            toggleClass(b, 'is-active', k === m);
        }
        if (changed) {
            render({ state, selectedId, index });
            if (fromUser) onModeChange(m);
        }
    }

    function cycleMode(dir = 1) {
        setMode(nextMapMode(mode, dir), true);
    }

    /* ------------------------------------------------------------ viewport */

    function currentUnit() {
        if (!(size.w > 0)) return 1;
        return 1 / scaleOf(view, size, map);
    }

    function schedule() {
        if (!raf && !destroyed && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
    }

    function frame(now) {
        raf = 0;
        if (destroyed) return;
        let again = false;
        if (anim) {
            const t = Math.min(1, (now - anim.start) / anim.duration);
            view = clampView(lerpView(anim.from, anim.to, easeOutCubic(t)), size, map);
            if (t < 1) again = true;
            else anim = null;
        }
        if (wheelAcc) {
            view = zoomAt(view, wheelFactor(wheelAcc.px), wheelAcc.x, wheelAcc.y, size, map);
            wheelAcc = null;
        }
        applyView();
        if (pendingTip) {
            const { x, y } = pendingTip;
            pendingTip = null;
            const flipX = x > size.w * 0.62;
            const flipY = y > size.h * 0.66;
            tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(${flipX ? 'calc(-100% - 14px)' : '16px'}, ${flipY ? 'calc(-100% - 12px)' : '18px'})`;
        }
        if (again) schedule();
    }

    function applyView() {
        if (!(size.w > 0 && size.h > 0)) return;
        if (needsOpening && data) {
            needsOpening = false;
            const c = index.playerId && data.countries[index.playerId];
            view = openingView(size, map, c && c.label ? { x: c.label[0], y: c.label[1] } : null);
        }
        if (applied && applied.cx === view.cx && applied.cy === view.cy && applied.k === view.k && applied.w === size.w && applied.h === size.h) return;
        if (applied) markMoving();
        const vb = viewBoxOf(view, size, map);
        svg.setAttribute('viewBox', `${vb[0].toFixed(2)} ${vb[1].toFixed(2)} ${vb[2].toFixed(2)} ${vb[3].toFixed(2)}`);
        const scale = scaleOf(view, size, map);
        const u = 1 / scale;
        svg.style.setProperty('--hoi-u', u.toFixed(5));
        if (!labelScale || Math.abs(scale - labelScale) / labelScale > 0.01) {
            labelScale = scale;
            updateLabelVisibility(scale);
            for (const pat of patterns.values()) pat.setAttribute('patternTransform', `rotate(45) scale(${u.toFixed(5)})`);
            root.dataset.zoom = view.k >= 3 ? 'near' : view.k >= 1.6 ? 'mid' : 'far';
        }
        applied = { cx: view.cx, cy: view.cy, k: view.k, w: size.w, h: size.h };
    }

    /**
     * While the view moves, drop the decorative coast halo (a second stroke pass
     * over every coastline; measured to halve the frame rate on software
     * rendering) and restore it shortly after the motion stops.
     */
    let movingTimer = 0;
    function markMoving() {
        if (!root.classList.contains('is-moving')) root.classList.add('is-moving');
        clearTimeout(movingTimer);
        movingTimer = setTimeout(() => root.classList.remove('is-moving'), 160);
    }

    function animateTo(target, duration = 420) {
        if (!(size.w > 0)) {
            view = clampView(target, size, map);
            return;
        }
        anim = { from: { ...view }, to: clampView(target, size, map), start: performance.now(), duration };
        schedule();
    }

    function zoomBy(factor) {
        if (!(size.w > 0)) return;
        animateTo(zoomAt(anim ? anim.to : view, factor, size.w / 2, size.h / 2, size, map), 220);
    }

    function resetView(animated = true) {
        if (animated) animateTo(initialView(map), 380);
        else {
            view = initialView(map);
            schedule();
        }
    }

    /** Pan/zoom so a nation's territory is framed. */
    function focusNation(id, { animated = true } = {}) {
        const c = data && data.countries ? data.countries[id] : null;
        if (!c || !c.bbox || !(size.w > 0)) return;
        const target = viewForBBox(c.bbox, size, map, { padding: 70, minK: 1.15, maxK: 5 });
        if (animated) animateTo(target, 480);
        else {
            view = target;
            schedule();
        }
    }

    /* --------------------------------------------------------- interaction */

    const pointers = new Map();
    let drag = null; // {startX, startY, lastX, lastY, moved, downId}
    let pinch = null;

    function local(e) {
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function refreshRect() {
        const r = root.getBoundingClientRect();
        rect = { left: r.left, top: r.top };
    }

    function targetKey(el) {
        const t = el && el.closest ? el.closest('[data-tip], [data-id]') : null;
        if (!t || !root.contains(t)) return null;
        if (t.dataset.tip && t.classList.contains('hoi-mk')) return { kind: 'marker', key: `mk:${t.dataset.tip}`, tip: t.dataset.tip, id: t.dataset.id || null };
        if (t.dataset.id) return { kind: 'country', key: `c:${t.dataset.id}`, id: t.dataset.id };
        return null;
    }

    function onPointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        refreshRect();
        anim = null;
        const p = local(e);
        pointers.set(e.pointerId, p);
        try {
            svg.setPointerCapture(e.pointerId);
        } catch { /* ignore */ }
        if (pointers.size === 1) {
            const t = targetKey(e.target);
            drag = { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false, downId: t ? t.id : null };
        } else if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view0: { ...view } };
            if (drag) drag.moved = true;
        }
    }

    function onPointerMove(e) {
        if (pointers.has(e.pointerId)) {
            const p = local(e);
            pointers.set(e.pointerId, p);
            if (pinch && pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                let v = zoomAt(pinch.view0, d / pinch.d0, pinch.mid0.x, pinch.mid0.y, size, map);
                v = panBy(v, mid.x - pinch.mid0.x, mid.y - pinch.mid0.y, size, map);
                view = v;
                schedule();
                return;
            }
            if (drag) {
                if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) > DRAG_THRESHOLD) {
                    drag.moved = true;
                    root.classList.add('is-dragging');
                    hideTooltip();
                }
                if (drag.moved) {
                    view = panBy(view, p.x - drag.lastX, p.y - drag.lastY, size, map);
                    schedule();
                }
                drag.lastX = p.x;
                drag.lastY = p.y;
            }
            return;
        }
        // Hover (no button pressed)
        if (e.pointerType === 'touch') return;
        const t = targetKey(e.target);
        setHover(t);
        if (t) {
            pendingTip = local(e);
            schedule();
        }
    }

    function onPointerUp(e) {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        try {
            svg.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        if (pointers.size === 1 && pinch) {
            pinch = null;
            const p = [...pointers.values()][0];
            drag = { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: true, downId: null };
            return;
        }
        if (pointers.size === 0) {
            const wasClick = drag && !drag.moved && e.type === 'pointerup';
            const id = drag ? drag.downId : null;
            drag = null;
            pinch = null;
            root.classList.remove('is-dragging');
            if (wasClick && id && state && state.nations && state.nations[id]) {
                selectedId = id;
                renderSelection();
                onSelect(id);
            }
        }
    }

    let lastRectAt = 0;
    function onWheel(e) {
        e.preventDefault();
        // Read layout at most once per wheel gesture (not on every wheel tick).
        const now = performance.now();
        if (now - lastRectAt > 400) refreshRect();
        lastRectAt = now;
        anim = null;
        const p = local(e);
        const px = wheelDeltaPx(e.deltaY, e.deltaMode) * (e.ctrlKey ? 2.2 : 1);
        if (wheelAcc) {
            wheelAcc.px += px;
            wheelAcc.x = p.x;
            wheelAcc.y = p.y;
        } else wheelAcc = { px, x: p.x, y: p.y };
        schedule();
    }

    function onDblClick(e) {
        e.preventDefault();
        refreshRect();
        const p = local(e);
        animateTo(zoomAt(view, e.shiftKey ? 1 / 2 : 2, p.x, p.y, size, map), 260);
    }

    function onLeave() {
        setHover(null);
    }

    function onKeyDown(e) {
        const step = 90;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = step;
        else if (e.key === 'ArrowRight') dx = -step;
        else if (e.key === 'ArrowUp') dy = step;
        else if (e.key === 'ArrowDown') dy = -step;
        else return;
        e.preventDefault();
        e.stopPropagation();
        animateTo(panBy(anim ? anim.to : view, dx, dy, size, map), 160);
    }

    function setHover(t) {
        const key = t ? t.key : null;
        if (key === hoverKey) return;
        hoverKey = key;
        hoverTarget = t;
        const c = t && t.kind === 'country' && data ? data.countries[t.id] : null;
        setAttr(hoverPath, 'd', c ? c.d : null);
        if (!t) {
            hideTooltip();
            return;
        }
        refreshTooltipContent();
        tooltip.classList.add('is-visible');
        tooltip.setAttribute('aria-hidden', 'false');
    }

    function refreshTooltipContent() {
        const t = hoverTarget;
        if (!t) return;
        clear(tipLines);
        if (t.kind === 'marker') {
            const n = t.id && state && state.nations ? state.nations[t.id] : null;
            updateFlag(tipFlag, assetUrl, n, ' hoi-flag--sm');
            setText(tipTitle, n ? n.name : '');
            tipLines.appendChild(h('div', { class: 'hoi-map__tip-line is-warn', text: t.tip }));
            return;
        }
        const n = state && state.nations ? state.nations[t.id] : null;
        const model = tooltipModel(state, t.id, index);
        updateFlag(tipFlag, assetUrl, n, ' hoi-flag--sm');
        setText(tipTitle, model.title);
        for (const line of model.lines) {
            const el = h('div', { class: `hoi-map__tip-line is-${line.tone}` });
            if (line.color) {
                const dot = h('span', { class: 'hoi-map__tip-dot' });
                dot.style.background = line.color;
                el.appendChild(dot);
            }
            el.appendChild(document.createTextNode(line.text));
            tipLines.appendChild(el);
        }
    }

    function hideTooltip() {
        tooltip.classList.remove('is-visible');
        tooltip.setAttribute('aria-hidden', 'true');
        if (hoverKey) {
            hoverKey = null;
            hoverTarget = null;
            setAttr(hoverPath, 'd', null);
        }
    }

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('pointerleave', onLeave);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('dblclick', onDblClick);
    root.addEventListener('keydown', onKeyDown);

    let ro = null;
    if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver((entries) => {
            const cr = entries[entries.length - 1].contentRect;
            const w = Math.round(cr.width);
            const hh = Math.round(cr.height);
            if (w === size.w && hh === size.h) return;
            size = { w, h: hh };
            refreshRect();
            schedule();
        });
        ro.observe(root);
    }

    setMode(mode);
    renderLegend();
    showMessage('Carregando mapa…');

    function destroy() {
        destroyed = true;
        if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        raf = 0;
        if (ro) ro.disconnect();
        root.remove();
    }

    return {
        el: root,
        setData,
        render,
        setMode: (m) => setMode(m, false),
        cycleMode,
        getMode: () => mode,
        select(id) {
            selectedId = id || null;
            renderSelection();
        },
        focusNation,
        zoomBy,
        resetView,
        showMessage,
        hideMessage,
        destroy,
        /** For tests / debugging. */
        _debug: () => ({ view: { ...view }, size: { ...size }, map: { ...map } }),
    };
}
