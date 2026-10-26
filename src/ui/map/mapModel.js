/**
 * @file src/ui/map/mapModel.js
 * Pure map view-model: per-mode fills, occupation hatching, legends, label
 * visibility, tooltip text and marker placement. No DOM; node-testable.
 */

import { CRISIS_SEVERITIES, MAP_MODES, NATION_STATUS } from '../../contract/constants.js';
import {
    BLOC_COLORS,
    BLOC_LABELS,
    RELATION_TIERS,
    SEVERITY_COLORS,
    SEVERITY_LABELS,
    WAR_TIER,
    relationTier,
    signed,
} from '../../contract/presentation.js';
import { getRelation } from '../../contract/worldState.js';
import { colorKey, jitter, mix } from './color.js';

/* ------------------------------------------------------------------ constants */

export const MAP_MODE_META = Object.freeze({
    political: { label: 'Político', icon: 'fa-solid fa-flag', hint: 'Blocos e territórios controlados' },
    diplomatic: { label: 'Diplomático', icon: 'fa-solid fa-handshake', hint: 'Relação de cada país com a sua nação' },
    military: { label: 'Militar', icon: 'fa-solid fa-person-rifle', hint: 'Guerras, aliados e ocupação' },
    crisis: { label: 'Crises', icon: 'fa-solid fa-triangle-exclamation', hint: 'Gravidade das crises em curso' },
});

/** Colors that mirror css/base.css variables (fills are set from JS). */
export const MAP_COLORS = Object.freeze({
    landNeutral: '#59605a',
    landDim: '#3d4440',
    player: '#c9a227',
    playerDiplo: '#b8962e',
    military: Object.freeze({
        player: '#b08f2a',
        enemy: '#a63a2f',
        ally: '#4d8a5a',
        belligerent: '#c4843a',
        neutral: '#464d48',
    }),
    hatchDefault: '#a8433d',
});

export const MILITARY_LABELS = Object.freeze({
    player: 'Sua nação',
    enemy: 'Inimigos',
    ally: 'Aliados',
    belligerent: 'Outros beligerantes',
    neutral: 'Neutros',
});

/** Modes that draw occupation hatching. */
export const HATCH_MODES = Object.freeze(['political', 'military']);

/** Label sizing (screen px) and visibility thresholds. */
export const LABEL_RULES = Object.freeze({
    majorFontPx: 11.5,
    minorFontPx: 9.5,
    /** Average uppercase glyph width as a fraction of the font size (incl. letter spacing). */
    glyphWidth: 0.72,
    /** Minimum on-screen area (px²) of a minor country before its label shows. */
    minScreenArea: 520,
    /** Label must fit in this share of the country's on-screen bbox width. */
    fitWidth: 1.05,
});

/* ----------------------------------------------------------------- helpers */

export function nextMapMode(mode, dir = 1) {
    const i = MAP_MODES.indexOf(mode);
    const n = MAP_MODES.length;
    return MAP_MODES[(((i < 0 ? 0 : i) + dir) % n + n) % n];
}

/** Display name of a nation id (falls back to the id). */
export function nationName(state, id) {
    const n = state && state.nations ? state.nations[id] : null;
    return (n && n.name) || String(id || '');
}

/** 'A', 'A e B', 'A, B e C', 'A, B, C e mais 2' (pt-BR list). */
export function joinNames(names, max = 3) {
    const list = names.filter(Boolean);
    if (list.length === 0) return '';
    if (list.length > max) {
        const rest = list.length - max;
        return `${list.slice(0, max).join(', ')} e mais ${rest}`;
    }
    if (list.length === 1) return list[0];
    return `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`;
}

/** Occupation progress -> hatch density level 1..4 (0 = none). */
export function progressLevel(progress) {
    const p = Number(progress) || 0;
    if (p <= 0) return 0;
    return Math.max(1, Math.min(4, Math.ceil(p / 25)));
}

function addToSetMap(map, key, value) {
    let s = map.get(key);
    if (!s) map.set(key, (s = new Set()));
    s.add(value);
}

/**
 * Precomputed lookups for one WorldState (wars, fronts, occupation, crises,
 * pacts). Build once per refresh; every other helper takes it.
 */
export function buildWorldIndex(state) {
    const nations = (state && state.nations) || {};
    const playerId = (state && state.player && state.player.nationId) || null;
    const enemies = new Map();
    const coBelligerents = new Map();
    const occupation = new Map();
    const fronts = [];
    const crisisByNation = new Map();
    const pactPartners = new Map();

    for (const war of (state && state.wars) || []) {
        const atk = war.attackers || [];
        const def = war.defenders || [];
        for (const a of atk) for (const d of def) {
            addToSetMap(enemies, a, d);
            addToSetMap(enemies, d, a);
        }
        for (const side of [atk, def]) {
            for (const x of side) for (const y of side) if (x !== y) addToSetMap(coBelligerents, x, y);
        }
        for (const f of war.fronts || []) {
            const progress = Math.max(0, Math.min(100, Number(f.progress) || 0));
            fronts.push({ warId: war.id, attacker: f.attacker, defender: f.defender, progress, ceasefire: !!war.ceasefire });
            const cur = occupation.get(f.defender);
            if (progress > 0 && (!cur || progress > cur.progress)) {
                occupation.set(f.defender, { progress, occupier: f.attacker });
            }
        }
    }

    for (const c of (state && state.crises) || []) {
        const rank = CRISIS_SEVERITIES.indexOf(c.severity);
        for (const id of c.involved || []) {
            let entry = crisisByNation.get(id);
            if (!entry) crisisByNation.set(id, (entry = { rank: -1, severity: null, crises: [] }));
            entry.crises.push(c);
            if (rank > entry.rank) {
                entry.rank = rank;
                entry.severity = c.severity;
            }
        }
    }
    for (const entry of crisisByNation.values()) {
        entry.crises.sort((a, b) => CRISIS_SEVERITIES.indexOf(b.severity) - CRISIS_SEVERITIES.indexOf(a.severity));
    }

    for (const p of (state && state.pacts) || []) {
        if (p.type !== 'alliance' && p.type !== 'defense') continue;
        const m = p.members || [];
        for (const x of m) for (const y of m) if (x !== y) addToSetMap(pactPartners, x, y);
    }

    /** Who owns a territory on the map (annexed -> controller chain). */
    function ownerOf(id) {
        let cur = id;
        for (let i = 0; i < 6; i++) {
            const n = nations[cur];
            if (!n || n.status !== NATION_STATUS.ANNEXED || !n.controller || n.controller === cur) return cur;
            cur = n.controller;
        }
        return cur;
    }

    return { playerId, nations, enemies, coBelligerents, occupation, fronts, crisisByNation, pactPartners, ownerOf };
}

/* ---------------------------------------------------------------- fills */

/** Political base color of a nation (bloc hue, per-nation jitter). */
export function nationBaseColor(state, id) {
    const n = state && state.nations ? state.nations[id] : null;
    if (!n) return MAP_COLORS.landNeutral;
    const bloc = BLOC_COLORS[n.bloc] || BLOC_COLORS.NON_ALIGNED;
    // Non-aligned minors are the most numerous: vary them more so neighbours stay distinct.
    return jitter(bloc, id, n.major ? 0.7 : n.bloc === 'NON_ALIGNED' || !BLOC_COLORS[n.bloc] ? 1.6 : 1);
}

/** Political color: bloc color; puppets tinted toward their overlord. */
export function politicalColor(state, id, index) {
    const owner = index.ownerOf(id);
    const n = state && state.nations ? state.nations[owner] : null;
    if (!n) return MAP_COLORS.landNeutral;
    const base = nationBaseColor(state, owner);
    if (n.status === NATION_STATUS.PUPPET && n.overlord && state.nations[n.overlord]) {
        return mix(base, nationBaseColor(state, index.ownerOf(n.overlord)), 0.6);
    }
    return base;
}

/** 'player' | 'enemy' | 'ally' | 'belligerent' | 'neutral' for a territory owner. */
export function militaryCategory(state, ownerId, index) {
    const pid = index.playerId;
    const n = state && state.nations ? state.nations[ownerId] : null;
    if (pid && ownerId === pid) return 'player';
    if (pid && index.enemies.get(pid) && index.enemies.get(pid).has(ownerId)) return 'enemy';
    if (pid) {
        const side = index.coBelligerents.get(pid);
        const pacts = index.pactPartners.get(pid);
        if ((side && side.has(ownerId)) || (pacts && pacts.has(ownerId))) return 'ally';
        if (n && n.status === NATION_STATUS.PUPPET && n.overlord === pid) return 'ally';
    }
    if (index.enemies.get(ownerId) && index.enemies.get(ownerId).size > 0) return 'belligerent';
    return 'neutral';
}

export function diplomaticColor(state, id, index) {
    const pid = index.playerId;
    const owner = index.ownerOf(id);
    if (!pid || !state.nations[owner]) return MAP_COLORS.landNeutral;
    if (owner === pid) return MAP_COLORS.playerDiplo;
    const n = state.nations[owner];
    const atWar = !!(index.enemies.get(pid) && index.enemies.get(pid).has(owner));
    const tier = relationTier(getRelation(state, pid, owner), atWar);
    if (!atWar && n.status === NATION_STATUS.PUPPET && n.overlord === pid) return mix(MAP_COLORS.playerDiplo, tier.color, 0.5);
    return tier.color;
}

export function crisisColor(state, id, index) {
    const owner = index.ownerOf(id);
    if (!state || !state.nations || !state.nations[owner]) return MAP_COLORS.landDim;
    const entry = index.crisisByNation.get(owner);
    if (!entry || !entry.severity) return MAP_COLORS.landDim;
    const base = SEVERITY_COLORS[entry.severity] || SEVERITY_COLORS.low;
    // More simultaneous crises -> hotter (slightly brighter) tint.
    return entry.crises.length > 1 ? mix(base, '#ffd9a0', Math.min(0.25, 0.08 * (entry.crises.length - 1))) : mix(base, MAP_COLORS.landDim, 0.18);
}

/** Fill of a territory in a mode, without hatching. */
export function territoryFill(state, id, mode, index) {
    if (!state || !state.nations || !state.nations[index.ownerOf(id)]) {
        return mode === 'crisis' ? MAP_COLORS.landDim : MAP_COLORS.landNeutral;
    }
    switch (mode) {
        case 'diplomatic': return diplomaticColor(state, id, index);
        case 'military': return MAP_COLORS.military[militaryCategory(state, index.ownerOf(id), index)];
        case 'crisis': return crisisColor(state, id, index);
        case 'political':
        default: return politicalColor(state, id, index);
    }
}

/**
 * Paint for every map country id in a mode.
 * @returns {Map<string, {fill:string, hatch: ?{color:string, level:number, key:string, progress:number, occupier:string}}>}
 */
export function computeMapPaint(state, mode, ids, index = buildWorldIndex(state)) {
    const out = new Map();
    const hatchOn = HATCH_MODES.includes(mode);
    for (const id of ids) {
        const fill = territoryFill(state, id, mode, index);
        let hatch = null;
        const occ = index.occupation.get(id);
        const owner = index.ownerOf(id);
        if (hatchOn && occ && owner === id) {
            const level = progressLevel(occ.progress);
            if (level > 0) {
                const color = territoryFill(state, occ.occupier, mode, index);
                hatch = { color, level, key: `${colorKey(color)}-${level}`, progress: occ.progress, occupier: occ.occupier };
            }
        }
        out.set(id, { fill, hatch });
    }
    return out;
}

/* ---------------------------------------------------------------- legend */

/**
 * Legend entries for a map mode.
 * @returns {Array<{kind:'swatch'|'hatch'|'outline', color:string, label:string}>}
 */
export function legendEntries(mode) {
    switch (mode) {
        case 'diplomatic':
            return [
                { kind: 'swatch', color: MAP_COLORS.playerDiplo, label: 'Sua nação' },
                ...RELATION_TIERS.map((t) => ({ kind: 'swatch', color: t.color, label: t.label })),
                { kind: 'swatch', color: WAR_TIER.color, label: WAR_TIER.label },
            ];
        case 'military':
            return [
                ...Object.keys(MILITARY_LABELS).map((k) => ({ kind: 'swatch', color: MAP_COLORS.military[k], label: MILITARY_LABELS[k] })),
                { kind: 'hatch', color: MAP_COLORS.military.enemy, label: 'Território ocupado' },
            ];
        case 'crisis':
            return [
                ...CRISIS_SEVERITIES.slice().reverse().map((s) => ({ kind: 'swatch', color: SEVERITY_COLORS[s], label: `Crise ${SEVERITY_LABELS[s].toLowerCase()}` })),
                { kind: 'swatch', color: MAP_COLORS.landDim, label: 'Sem crise' },
            ];
        case 'political':
        default:
            return [
                ...Object.keys(BLOC_LABELS).map((b) => ({ kind: 'swatch', color: BLOC_COLORS[b], label: BLOC_LABELS[b] })),
                { kind: 'hatch', color: MAP_COLORS.hatchDefault, label: 'Território ocupado' },
                { kind: 'outline', color: MAP_COLORS.player, label: 'Sua nação' },
            ];
    }
}

/* ---------------------------------------------------------------- labels */

export function labelFontPx(major) {
    return major ? LABEL_RULES.majorFontPx : LABEL_RULES.minorFontPx;
}

/**
 * Should a country label be visible at `scale` (screen px per map unit)?
 * Majors always; minors when the country is big enough on screen and the
 * name fits inside its on-screen bbox.
 */
export function isLabelVisible({ area = 0, bbox = [0, 0, 0, 0], major = false, nameLength = 0 }, scale) {
    if (major) return true;
    const s = Number(scale) || 0;
    const screenArea = area * s * s;
    if (screenArea < LABEL_RULES.minScreenArea) return false;
    const width = Math.max(0, bbox[2] - bbox[0]) * s;
    const textWidth = nameLength * LABEL_RULES.minorFontPx * LABEL_RULES.glyphWidth;
    return width * LABEL_RULES.fitWidth >= textWidth;
}

/** Estimated on-screen label box (px) centred on the label anchor. */
export function labelBox(item, scale) {
    const fpx = labelFontPx(item.major);
    const w = String(item.text || '').length * fpx * LABEL_RULES.glyphWidth + 4;
    const h = fpx * 1.25;
    return { x: item.x * scale - w / 2, y: item.y * scale - h / 2, w, h };
}

function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Which labels are visible at `scale` (screen px per map unit). Priority:
 * the player's nation, then major powers, then minors, bigger countries
 * first. The player and majors are always labelled except when a major
 * would overlap a higher-priority major label (it reappears as soon as you
 * zoom in); minors also need room inside their own territory
 * (isLabelVisible) and never overlap an accepted label.
 * @param {Array<{id:string, text:string, x:number, y:number, major:boolean, area:number, bbox:number[]}>} items
 * @returns {Set<string>}
 */
export function visibleLabels(items, scale, playerId = null) {
    const sorted = items.slice().sort((a, b) => ((b.id === playerId) - (a.id === playerId)) || (b.major - a.major) || (b.area - a.area));
    const accepted = [];
    const out = new Set();
    for (const it of sorted) {
        const isPlayer = it.id === playerId;
        if (!isPlayer && !it.major && !isLabelVisible({ area: it.area, bbox: it.bbox, major: false, nameLength: String(it.text || '').length }, scale)) continue;
        const box = labelBox(it, scale);
        if (!isPlayer && accepted.some((r) => overlaps(box, r))) continue;
        accepted.push(box);
        out.add(it.id);
    }
    return out;
}

/**
 * Label descriptors for every map country that is an existing, non-annexed nation.
 * @returns {Array<{id:string, text:string, x:number, y:number, major:boolean, area:number, bbox:number[]}>}
 */
export function labelItems(state, mapData) {
    const out = [];
    if (!mapData || !mapData.countries) return out;
    for (const c of Object.values(mapData.countries)) {
        const n = state && state.nations ? state.nations[c.id] : null;
        if (!n || n.status === NATION_STATUS.ANNEXED || !Array.isArray(c.label)) continue;
        out.push({ id: c.id, text: n.name, x: c.label[0], y: c.label[1], major: !!n.major, area: c.area || 0, bbox: c.bbox || [0, 0, 0, 0] });
    }
    return out;
}

/* --------------------------------------------------------------- tooltip */

/**
 * Hover tooltip content.
 * @returns {{title:string, id:string, lines: Array<{text:string, tone:'good'|'bad'|'warn'|'brass'|'neutral', color?:string}>}}
 */
export function tooltipModel(state, id, index) {
    const n = state && state.nations ? state.nations[id] : null;
    if (!n) return { title: String(id || ''), id, lines: [] };
    const lines = [];
    const pid = index.playerId;
    const owner = index.ownerOf(id);

    if (owner !== id || (n.controller && n.controller !== id)) {
        const ctl = owner !== id ? owner : n.controller;
        lines.push({ text: `Controlado por ${nationName(state, ctl)}`, tone: ctl === pid ? 'brass' : 'bad' });
    }
    if (n.status === NATION_STATUS.PUPPET && n.overlord) {
        lines.push({ text: `Fantoche de ${nationName(state, n.overlord)}`, tone: 'warn' });
    }
    if (n.status === NATION_STATUS.CAPITULATED) lines.push({ text: 'Capitulou', tone: 'bad' });

    if (pid && owner === pid && id === pid) {
        lines.push({ text: 'Sua nação', tone: 'brass' });
    } else if (pid && n.status !== NATION_STATUS.ANNEXED) {
        const atWar = !!(index.enemies.get(pid) && index.enemies.get(pid).has(id));
        const score = getRelation(state, pid, id);
        const tier = relationTier(score, atWar);
        lines.push({ text: atWar ? `${tier.label} com você` : `Relação: ${tier.label} (${signed(score)})`, tone: atWar ? 'bad' : 'neutral', color: tier.color });
    }

    const foes = [...(index.enemies.get(id) || [])].map((x) => nationName(state, x)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (foes.length) lines.push({ text: `Em guerra com ${joinNames(foes, 3)}`, tone: 'bad' });

    const occ = index.occupation.get(id);
    if (occ && occ.progress > 0 && owner === id) {
        lines.push({ text: `Ocupação: ${Math.round(occ.progress)}% (${nationName(state, occ.occupier)})`, tone: 'bad' });
    }

    const crises = index.crisisByNation.get(id);
    if (crises && crises.crises.length) {
        const top = crises.crises[0];
        const more = crises.crises.length > 1 ? ` +${crises.crises.length - 1}` : '';
        lines.push({ text: `Crise: ${top.title} (${SEVERITY_LABELS[top.severity] || top.severity})${more}`, tone: 'warn', color: SEVERITY_COLORS[top.severity] });
    }
    return { title: n.name, id, lines };
}

/* --------------------------------------------------------------- markers */

function areNeighbors(a, d, aId, dId) {
    return (d.neighbors || []).includes(aId) || (a.neighbors || []).includes(dId);
}

/**
 * Fronts as map markers, one per defender. A front is drawn when it is a
 * land front (neighbors) or has already taken ground (progress > 0); distant
 * 0% "power projection" fronts stay in the Guerras tab only. The marker sits
 * between the main attacker's and the defender's label points.
 */
export function frontMarkers(state, mapData, index) {
    const out = [];
    if (!mapData || !mapData.countries) return out;
    const byDefender = new Map();
    for (const f of index.fronts) {
        const a = mapData.countries[f.attacker];
        const d = mapData.countries[f.defender];
        if (!a || !d || !a.label || !d.label) continue;
        if (f.progress <= 0 && !areNeighbors(a, d, f.attacker, f.defender)) continue;
        let g = byDefender.get(f.defender);
        if (!g) byDefender.set(f.defender, (g = []));
        g.push(f);
    }
    const pid = index.playerId;
    for (const [defender, group] of byDefender) {
        group.sort((x, y) => y.progress - x.progress);
        const f = group[0];
        const a = mapData.countries[f.attacker];
        const d = mapData.countries[defender];
        const attackers = [...new Set(group.map((g) => g.attacker))];
        const neighbors = areNeighbors(a, d, f.attacker, defender);
        // On the defender's side facing the main attacker: from the defender's label
        // point toward the attacker's, at most half-way. Land fronts start near the
        // border and move inward as the attacker advances.
        const dx = a.label[0] - d.label[0];
        const dy = a.label[1] - d.label[1];
        const dist = Math.hypot(dx, dy) || 1;
        const bb = d.bbox || [d.label[0], d.label[1], d.label[0], d.label[1]];
        const half = Math.max(3, Math.min(bb[2] - bb[0], bb[3] - bb[1]) / 2);
        const reach = neighbors ? half * 0.85 * (1 - Math.min(0.7, f.progress / 140)) : half * 0.6;
        const r = Math.min(dist * 0.5, reach);
        const x = d.label[0] + (dx / dist) * r;
        const y = d.label[1] + (dy / dist) * r;
        const involvesPlayer = !!pid && (defender === pid || attackers.includes(pid) || isOnPlayerSide(index, defender) || attackers.some((x) => isOnPlayerSide(index, x)));
        const ceasefire = group.every((g) => g.ceasefire);
        out.push({
            key: `front>${defender}`,
            warId: f.warId,
            attacker: f.attacker,
            attackers,
            defender,
            progress: Math.round(f.progress),
            ceasefire,
            involvesPlayer,
            x: round1(x),
            y: round1(y),
            tip: `Frente em ${nationName(state, defender)}: ${Math.round(f.progress)}% ocupado por ${joinNames(attackers.map((x) => nationName(state, x)), 3)}${ceasefire ? ' (cessar-fogo)' : ''}`,
        });
    }
    return out;
}

function isOnPlayerSide(index, id) {
    const s = index.coBelligerents.get(index.playerId);
    return !!(s && s.has(id));
}

/**
 * One ⚠ marker per crisis, anchored on its epicenter (the first involved
 * nation present on the map). Crises sharing an epicenter get consecutive
 * `slot`s so the DOM can offset them side by side. High/critical pulse.
 * (The crisis map mode colors every involved nation; markers stay sparse.)
 */
export function crisisMarkers(state, mapData, index) {
    const out = [];
    if (!mapData || !mapData.countries || !state) return out;
    const slots = new Map();
    for (const crisis of state.crises || []) {
        const epicenter = (crisis.involved || []).find((id) => {
            const n = state.nations ? state.nations[id] : null;
            return n && n.status !== NATION_STATUS.ANNEXED && mapData.countries[id] && mapData.countries[id].label;
        });
        if (!epicenter) continue;
        const rank = CRISIS_SEVERITIES.indexOf(crisis.severity);
        const c = mapData.countries[epicenter];
        const slot = slots.get(epicenter) || 0;
        slots.set(epicenter, slot + 1);
        out.push({
            key: crisis.id,
            id: epicenter,
            crisisId: crisis.id,
            x: c.label[0],
            y: c.label[1],
            slot,
            severity: crisis.severity,
            rank,
            color: SEVERITY_COLORS[crisis.severity] || SEVERITY_COLORS.low,
            pulse: rank >= 2,
            tip: `${crisis.title} (${SEVERITY_LABELS[crisis.severity] || crisis.severity})`,
        });
    }
    void index;
    out.sort((a, b) => a.rank - b.rank);
    return out;
}

/** Capital markers for major powers and the player. */
export function capitalMarkers(state, mapData) {
    const out = [];
    if (!mapData || !mapData.countries || !state || !state.nations) return out;
    const pid = state.player ? state.player.nationId : null;
    for (const c of Object.values(mapData.countries)) {
        const n = state.nations[c.id];
        if (!n || !c.capital || n.status === NATION_STATUS.ANNEXED) continue;
        if (!n.major && c.id !== pid) continue;
        out.push({ key: c.id, id: c.id, x: c.capital[0], y: c.capital[1], isPlayer: c.id === pid, tip: n.capital ? `${n.capital} — capital de ${n.name}` : n.name });
    }
    return out;
}

function round1(v) {
    return Math.round(v * 10) / 10;
}

/** Ids of every territory controlled by the player (own + annexed). */
export function playerTerritories(state, ids, index) {
    const pid = index.playerId;
    if (!pid) return [];
    return ids.filter((id) => index.ownerOf(id) === pid);
}
