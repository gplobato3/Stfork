/**
 * @file src/ui/warroom/viewModel.js
 * Pure view-model helpers for the War Room (top bar, action lists, lists in
 * the left panel, dossier, ticker, turn report). No DOM; node-testable.
 */

import { ACTION_CATEGORIES, CRISIS_SEVERITIES, NATION_STATUS, PLACEHOLDERS, RESOURCE_KEYS, BOUNDS } from '../../contract/constants.js';
import {
    BLOC_COLORS,
    BLOC_LABELS,
    CATEGORY_ICONS,
    CATEGORY_LABELS,
    PC_ICON,
    PC_LABEL,
    RESOURCE_ICONS,
    RESOURCE_LABELS,
    SEVERITY_COLORS,
    SEVERITY_LABELS,
    defcon,
    formatDate,
    formatDateShort,
    relationTier,
    signed,
} from '../../contract/presentation.js';
import { getRelation, monthsBetween } from '../../contract/worldState.js';

export const PACT_TYPE_LABELS = Object.freeze({
    alliance: 'Aliança',
    defense: 'Pacto de Defesa',
    trade: 'Acordo Comercial',
    nonAggression: 'Pacto de Não Agressão',
    guarantee: 'Garantia de Independência',
});

export const NUCLEAR_LABELS = Object.freeze({
    0: 'Sem armas nucleares',
    1: 'Arsenal nuclear limitado',
    2: 'Arsenal nuclear estratégico',
});

export const NEWS_KIND_ICONS = Object.freeze({
    world: 'fa-solid fa-globe',
    player: 'fa-solid fa-landmark-flag',
    war: 'fa-solid fa-person-rifle',
    crisis: 'fa-solid fa-triangle-exclamation',
    diplomacy: 'fa-solid fa-handshake',
    economy: 'fa-solid fa-chart-line',
});

export const RELATION_SORTS = Object.freeze({
    relation: 'Relação',
    name: 'Nome',
    power: 'Poder',
});

/* ------------------------------------------------------------- generic */

export function nameOf(state, id) {
    const n = state && state.nations ? state.nations[id] : null;
    return (n && n.name) || String(id || '');
}

/** Lowercase, accent-free text for search. */
export function foldText(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** '+3' / '−2' / '' for zero/missing deltas. */
export function formatDelta(delta) {
    const v = Math.round(Number(delta) || 0);
    return v === 0 ? '' : signed(v);
}

export function toneOf(delta) {
    const v = Math.round(Number(delta) || 0);
    return v > 0 ? 'good' : v < 0 ? 'bad' : 'neutral';
}

/** Number of decisions waiting for the player. */
export function pendingCount(state) {
    if (!state) return 0;
    return (state.pendingEvent ? 1 : 0) + (Array.isArray(state.eventQueue) ? state.eventQueue.length : 0);
}

/* ------------------------------------------------------------ top bar */

/**
 * Per-resource deltas between a baseline snapshot and current values.
 * @param {Record<string, number>} current
 * @param {?Record<string, number>} baseline
 */
export function resourceDeltas(current, baseline) {
    const out = {};
    for (const k of RESOURCE_KEYS) {
        const cur = Number(current && current[k]) || 0;
        out[k] = baseline && typeof baseline[k] === 'number' ? Math.round(cur - baseline[k]) : 0;
    }
    return out;
}

/**
 * Top bar model.
 * @param {?Object} state WorldState
 * @param {{deltas?: Record<string, number>}} [opts] last-turn deltas per resource
 */
export function topBarModel(state, opts = {}) {
    if (!state || !state.player || !state.nations || !state.nations[state.player.nationId]) {
        return { hasCampaign: false, title: 'Sala de Guerra', resources: [], pendingCount: 0 };
    }
    const n = state.nations[state.player.nationId];
    const deltas = opts.deltas || {};
    const resources = RESOURCE_KEYS.map((key) => {
        const value = Math.round(Number(n.resources && n.resources[key]) || 0);
        const delta = Math.round(Number(deltas[key]) || 0);
        const deltaText = formatDelta(delta);
        return {
            key,
            label: RESOURCE_LABELS[key],
            icon: RESOURCE_ICONS[key],
            value,
            delta,
            deltaText,
            tone: toneOf(delta),
            title: `${RESOURCE_LABELS[key]}: ${value}/100${deltaText ? ` (${deltaText} no último mês)` : ''}`,
        };
    });
    const tension = Math.round(Number(state.globalTension) || 0);
    const dc = defcon(tension);
    const title = state.player.title || n.leaderTitle || 'Governante';
    return {
        hasCampaign: true,
        nationId: n.id,
        nationName: n.name,
        flag: n.flag || n.flagEmoji || '',
        leaderLine: `${title} ${state.player.leaderName || ''}`.trim(),
        dateText: formatDate(state.date),
        dateShort: formatDateShort(state.date),
        turn: state.turn,
        pc: Math.round(Number(n.pc) || 0),
        pcMax: BOUNDS.PC_MAX,
        pcLabel: PC_LABEL,
        pcIcon: PC_ICON,
        resources,
        tension,
        defcon: dc,
        defconTitle: `DEFCON ${dc.level} — ${dc.label}. Tensão global ${tension}/100.`,
        pendingCount: pendingCount(state),
        gameOver: state.phase === 'GAME_OVER' || !!state.outcome,
        outcome: state.outcome || null,
    };
}

/* ------------------------------------------------------------- actions */

/** Cost chips for an ActionDef.cost. */
export function costParts(cost) {
    const parts = [];
    const pc = Math.round(Number(cost && cost.pc) || 0);
    if (pc > 0) parts.push({ key: 'pc', icon: PC_ICON, label: 'PC', title: PC_LABEL, value: pc });
    const res = (cost && cost.resources) || {};
    for (const k of RESOURCE_KEYS) {
        const v = Math.round(Number(res[k]) || 0);
        if (v > 0) parts.push({ key: k, icon: RESOURCE_ICONS[k], label: RESOURCE_LABELS[k], title: RESOURCE_LABELS[k], value: v });
    }
    return parts;
}

/** '3 PC · 5 Economia' (or 'Sem custo'). */
export function formatCost(cost) {
    const parts = costParts(cost);
    if (!parts.length) return 'Sem custo';
    return parts.map((p) => `${p.value} ${p.label}`).join(' · ');
}

export function chanceTone(chance) {
    const c = Number(chance) || 0;
    return c >= 70 ? 'good' : c >= 40 ? 'neutral' : 'bad';
}

/** 'Recarga: 1 mês' / 'Recarga: 3 meses'. */
export function monthsText(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    return `${v} ${v === 1 ? 'mês' : 'meses'}`;
}

/** Normalized row model for one ActionAvailability. */
export function actionItem(av) {
    const def = av.def || {};
    const chance = Math.round(Number(av.chance != null ? av.chance : 100));
    const reasons = Array.isArray(av.reasons) ? av.reasons.filter(Boolean) : [];
    const cooldownLeft = Math.max(0, Math.round(Number(av.cooldownLeft) || 0));
    const sure = def.chance == null || chance >= 100;
    return {
        id: def.id,
        name: def.name || def.id,
        description: def.description || '',
        icon: def.icon || CATEGORY_ICONS[def.category] || 'fa-solid fa-circle',
        category: def.category,
        target: def.target === 'nation' ? 'nation' : 'none',
        available: !!av.available,
        reasons,
        reasonText: reasons.join(' · '),
        chance,
        chanceText: sure ? 'Garantido' : `${chance}%`,
        chanceTone: sure ? 'good' : chanceTone(chance),
        cooldown: Math.max(0, Math.round(Number(def.cooldown) || 0)),
        cooldownLeft,
        cooldownText: cooldownLeft > 0 ? `Disponível em ${monthsText(cooldownLeft)}` : def.cooldown > 0 ? `Recarga de ${monthsText(def.cooldown)}` : '',
        costParts: costParts(def.cost),
        costText: formatCost(def.cost),
        pcCost: Math.round(Number(def.cost && def.cost.pc) || 0),
        confirm: !!def.confirm,
        onSuccess: Array.isArray(def.onSuccess) ? def.onSuccess : [],
        onFailure: Array.isArray(def.onFailure) ? def.onFailure : [],
    };
}

/**
 * Group availabilities by category (ACTION_CATEGORIES order). Inside a group:
 * available first, then cheapest PC, then name (pt-BR collation).
 * @param {Array} avs ActionAvailability[]
 * @param {{target?: 'none'|'nation'}} [opts] keep only untargeted / targeted actions
 */
export function groupActions(avs, opts = {}) {
    const items = (avs || []).filter((av) => av && av.def).map(actionItem)
        .filter((it) => !opts.target || it.target === opts.target);
    const byCat = new Map();
    for (const it of items) {
        const cat = ACTION_CATEGORIES.includes(it.category) ? it.category : 'internal';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(it);
    }
    const groups = [];
    for (const cat of ACTION_CATEGORIES) {
        const list = byCat.get(cat);
        if (!list || !list.length) continue;
        list.sort(compareActions);
        groups.push({
            category: cat,
            label: CATEGORY_LABELS[cat] || cat,
            icon: CATEGORY_ICONS[cat] || 'fa-solid fa-circle',
            items: list,
            availableCount: list.filter((x) => x.available).length,
        });
    }
    return groups;
}

export function compareActions(a, b) {
    return (b.available - a.available) || (a.pcCost - b.pcCost) || a.name.localeCompare(b.name, 'pt-BR');
}

/** Copy of an effect with SELF/TARGET/PLAYER resolved to concrete nation ids (for previews). */
export function resolvePlaceholders(effect, { self, target, player } = {}) {
    if (!effect || typeof effect !== 'object') return effect;
    const map = { [PLACEHOLDERS.SELF]: self, [PLACEHOLDERS.TARGET]: target, [PLACEHOLDERS.PLAYER]: player || self };
    const fix = (v) => (typeof v === 'string' && map[v] ? map[v] : v);
    const out = { ...effect };
    if ('target' in out) out.target = fix(out.target);
    if ('targetB' in out) out.targetB = fix(out.targetB);
    if (Array.isArray(out.involved)) out.involved = out.involved.map(fix);
    return out;
}

/* ------------------------------------------------------------- ticker */

/** Newest-first ticker items from state.news. */
export function tickerItems(state, max = 14) {
    const news = (state && Array.isArray(state.news)) ? state.news : [];
    const out = [];
    for (let i = news.length - 1; i >= 0 && out.length < max; i--) {
        const n = news[i];
        if (!n || !n.text) continue;
        out.push({
            key: `${n.turn}:${i}:${n.text.length}`,
            text: n.text,
            kind: n.kind || 'world',
            icon: NEWS_KIND_ICONS[n.kind] || NEWS_KIND_ICONS.world,
            dateText: formatDateShort(n.date),
            turn: n.turn,
            isPlayer: n.kind === 'player',
        });
    }
    return out;
}

/* -------------------------------------------------------- left panels */

/**
 * Relations of the player with every other active nation.
 * @param {?Object} state
 * @param {{sort?: 'relation'|'name'|'power', dir?: 'asc'|'desc', filter?: string, power?: Record<string, number>}} [opts]
 */
export function relationsList(state, opts = {}) {
    if (!state || !state.player || !state.nations) return [];
    const pid = state.player.nationId;
    const sort = opts.sort || 'relation';
    const dir = opts.dir || (sort === 'name' ? 'asc' : 'desc');
    const q = foldText(opts.filter || '').trim();
    const power = opts.power || {};
    const enemies = new Set();
    for (const w of state.wars || []) {
        if ((w.attackers || []).includes(pid)) for (const d of w.defenders || []) enemies.add(d);
        if ((w.defenders || []).includes(pid)) for (const a of w.attackers || []) enemies.add(a);
    }
    const rows = [];
    for (const n of Object.values(state.nations)) {
        if (!n || n.id === pid || n.status === NATION_STATUS.ANNEXED) continue;
        if (q && !foldText(n.name).includes(q) && !foldText(n.id).includes(q)) continue;
        const score = getRelation(state, pid, n.id);
        const atWar = enemies.has(n.id);
        const tier = relationTier(score, atWar);
        rows.push({ id: n.id, name: n.name, score, scoreText: signed(score), atWar, tier: tier.id, tierLabel: tier.label, tierColor: tier.color, power: Math.round(Number(power[n.id]) || 0), major: !!n.major, bloc: n.bloc });
    }
    const sign = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
        let c = 0;
        if (sort === 'name') c = a.name.localeCompare(b.name, 'pt-BR');
        else if (sort === 'power') c = a.power - b.power;
        else c = (a.atWar ? -1000 : a.score) - (b.atWar ? -1000 : b.score);
        return c * sign || a.name.localeCompare(b.name, 'pt-BR');
    });
    return rows;
}

/** Wars for the Guerras tab, player wars first. */
export function warsModel(state) {
    if (!state || !Array.isArray(state.wars)) return [];
    const pid = state.player ? state.player.nationId : null;
    const rows = state.wars.map((w) => {
        const attackers = w.attackers || [];
        const defenders = w.defenders || [];
        const playerSide = attackers.includes(pid) ? 'attackers' : defenders.includes(pid) ? 'defenders' : null;
        const score = Math.round(Number(w.score) || 0);
        const fronts = (w.fronts || []).map((f) => ({
            key: `${f.attacker}>${f.defender}`,
            attacker: f.attacker,
            defender: f.defender,
            attackerName: nameOf(state, f.attacker),
            defenderName: nameOf(state, f.defender),
            progress: Math.max(0, Math.min(100, Math.round(Number(f.progress) || 0))),
            playerAttacking: f.attacker === pid,
            playerDefending: f.defender === pid,
        })).sort((a, b) => b.progress - a.progress);
        const exhaustion = Object.entries(w.exhaustion || {})
            .map(([id, v]) => ({ id, name: nameOf(state, id), value: Math.round(Number(v) || 0), isPlayer: id === pid }))
            .sort((a, b) => (b.isPlayer - a.isPlayer) || (b.value - a.value));
        // Score from the player's point of view when involved.
        const own = playerSide === 'defenders' ? -score : score;
        const months = Number.isFinite(w.startedTurn) && Number.isFinite(state.turn) ? Math.max(0, state.turn - w.startedTurn) : null;
        return {
            id: w.id,
            name: w.name || 'Guerra',
            attackers,
            defenders,
            playerSide,
            involvesPlayer: !!playerSide,
            score,
            ownScore: own,
            scoreText: playerSide ? `${signed(own)} para o seu lado` : `${signed(score)} para os atacantes`,
            scoreTone: playerSide ? toneOf(own) : 'neutral',
            ceasefire: !!w.ceasefire,
            fronts,
            exhaustion,
            months,
            durationText: months == null ? '' : months <= 0 ? 'Começou este mês' : `Há ${monthsText(months)}`,
        };
    });
    rows.sort((a, b) => (b.involvesPlayer - a.involvesPlayer) || (Math.max(0, ...b.fronts.map((f) => f.progress)) - Math.max(0, ...a.fronts.map((f) => f.progress))));
    return rows;
}

/** Crises sorted by severity (player-involved first among equals). */
export function crisesModel(state) {
    if (!state || !Array.isArray(state.crises)) return [];
    const pid = state.player ? state.player.nationId : null;
    return state.crises.map((c) => {
        const rank = CRISIS_SEVERITIES.indexOf(c.severity);
        const months = Number.isFinite(c.turnStarted) && Number.isFinite(state.turn) ? Math.max(0, state.turn - c.turnStarted) : null;
        return {
            id: c.id,
            title: c.title || 'Crise',
            description: c.description || '',
            severity: c.severity,
            severityLabel: SEVERITY_LABELS[c.severity] || c.severity || '',
            color: SEVERITY_COLORS[c.severity] || SEVERITY_COLORS.low,
            rank,
            region: c.region || '',
            involved: (c.involved || []).map((id) => ({ id, name: nameOf(state, id) })),
            involvesPlayer: !!pid && (c.involved || []).includes(pid),
            months,
            durationText: months == null ? '' : months <= 0 ? 'Novo' : `Há ${monthsText(months)}`,
        };
    }).sort((a, b) => (b.rank - a.rank) || (b.involvesPlayer - a.involvesPlayer) || a.title.localeCompare(b.title, 'pt-BR'));
}

/** Ranking rows (top `max` plus the player's row if outside). */
export function rankingModel(ranking, state, max = 40) {
    const pid = state && state.player ? state.player.nationId : null;
    const rows = (ranking || []).map((r, i) => ({ pos: i + 1, id: r.id, name: r.name, power: Math.round(Number(r.power) || 0), isPlayer: r.id === pid }));
    const top = rows.slice(0, max);
    if (pid && !top.some((r) => r.isPlayer)) {
        const me = rows.find((r) => r.isPlayer);
        if (me) top.push(me);
    }
    return top;
}

/* ------------------------------------------------------------- dossier */

/**
 * Dossier model from a NationView (engine) plus the state.
 * @param {?Object} view NationView
 * @param {?Object} state WorldState
 * @param {{rank?: number}} [opts]
 */
export function dossierModel(view, state, opts = {}) {
    if (!view || !view.nation) return null;
    const n = view.nation;
    const pid = state && state.player ? state.player.nationId : null;
    const isPlayer = n.id === pid;
    const statusChips = [];
    if (n.status === NATION_STATUS.PUPPET && n.overlord) statusChips.push({ text: `Fantoche de ${nameOf(state, n.overlord)}`, tone: 'bad' });
    if (n.status === NATION_STATUS.ANNEXED) statusChips.push({ text: `Anexada por ${nameOf(state, view.controller || n.controller)}`, tone: 'bad' });
    if (n.status === NATION_STATUS.CAPITULATED) statusChips.push({ text: 'Capitulou', tone: 'bad' });
    if (n.major) statusChips.push({ text: 'Grande potência', tone: 'brass' });
    if (n.nuclear > 0) statusChips.push({ text: n.nuclear >= 2 ? 'Potência nuclear' : 'Arsenal nuclear', tone: 'bad', icon: 'fa-solid fa-radiation' });
    const tierAtWar = (view.atWarWith || []).includes(pid);
    const tier = relationTier(Number(view.relationToPlayer) || 0, tierAtWar || view.relationTier === 'guerra');
    const resources = RESOURCE_KEYS.map((k) => ({ key: k, label: RESOURCE_LABELS[k], icon: RESOURCE_ICONS[k], value: Math.round(Number(n.resources && n.resources[k]) || 0) }));
    const pacts = (view.pacts || []).map((p) => ({
        id: p.id,
        name: p.name || PACT_TYPE_LABELS[p.type] || p.type,
        type: p.type,
        typeLabel: PACT_TYPE_LABELS[p.type] || p.type,
        members: (p.members || []).filter((m) => m !== n.id).map((m) => ({ id: m, name: nameOf(state, m) })),
    }));
    const crises = (view.crises || []).map((c) => ({ id: c.id, title: c.title, severity: c.severity, severityLabel: SEVERITY_LABELS[c.severity] || '', color: SEVERITY_COLORS[c.severity] || SEVERITY_COLORS.low }));
    return {
        id: n.id,
        name: n.name,
        isPlayer,
        nation: n,
        government: n.government || '',
        leaderTitle: n.leaderTitle || '',
        capital: n.capital || '',
        bloc: n.bloc,
        blocLabel: BLOC_LABELS[n.bloc] || n.bloc || '',
        blocColor: BLOC_COLORS[n.bloc] || BLOC_COLORS.NON_ALIGNED,
        statusChips,
        power: Math.round(Number(view.power) || 0),
        rank: opts.rank || null,
        relation: isPlayer ? null : { score: Math.round(Number(view.relationToPlayer) || 0), scoreText: signed(view.relationToPlayer), tierLabel: tier.label, tierColor: tier.color, pct: Math.round(((Number(view.relationToPlayer) || 0) + 100) / 2) },
        resources,
        pacts,
        atWarWith: (view.atWarWith || []).map((id) => ({ id, name: nameOf(state, id) })),
        allies: (view.allies || []).map((id) => ({ id, name: nameOf(state, id) })),
        occupation: view.occupation > 0 ? { pct: Math.round(view.occupation), occupier: view.occupier, occupierName: nameOf(state, view.occupier) } : null,
        crises,
        traits: Array.isArray(n.traits) ? n.traits : [],
        blurb: n.blurb || '',
        nuclearLabel: NUCLEAR_LABELS[n.nuclear] || NUCLEAR_LABELS[0],
        pc: Math.round(Number(n.pc) || 0),
    };
}

/* ---------------------------------------------------------- turn report */

/**
 * Sections of the slide-in turn report.
 * @param {Object} report TurnReport
 * @param {?Object} state WorldState (after the turn)
 */
export function turnReportModel(report, state) {
    if (!report) return null;
    const pid = state && state.player ? state.player.nationId : null;
    const sections = [];

    const deltas = RESOURCE_KEYS
        .map((k) => ({ key: k, label: RESOURCE_LABELS[k], icon: RESOURCE_ICONS[k], delta: Math.round(Number(report.playerDeltas && report.playerDeltas[k]) || 0) }))
        .filter((d) => d.delta !== 0)
        .map((d) => ({ ...d, text: `${d.label} ${signed(d.delta)}`, tone: toneOf(d.delta) }));
    const pcGained = Math.round(Number(report.pcGained) || 0);
    const tb = Math.round(Number(report.tensionBefore) || 0);
    const ta = Math.round(Number(report.tensionAfter) || 0);
    const playerRows = [];
    if (pcGained) playerRows.push({ icon: PC_ICON, text: `${PC_LABEL} ${signed(pcGained)}`, tone: toneOf(pcGained) });
    for (const d of deltas) playerRows.push({ icon: d.icon, text: d.text, tone: d.tone });
    if (ta !== tb) playerRows.push({ icon: 'fa-solid fa-radiation', text: `Tensão global de ${tb} para ${ta}`, tone: ta > tb ? 'bad' : 'good' });
    if (playerRows.length) sections.push({ id: 'player', title: 'Sua nação', icon: 'fa-solid fa-landmark-flag', rows: playerRows });

    const headlines = (report.headlines || []).filter(Boolean).map((t) => ({ icon: 'fa-solid fa-newspaper', text: t, tone: 'neutral' }));
    if (headlines.length) sections.push({ id: 'headlines', title: 'Manchetes', icon: 'fa-solid fa-newspaper', rows: headlines });

    const wars = (report.warUpdates || []).filter((w) => w && w.summary).map((w) => ({ icon: 'fa-solid fa-person-rifle', text: w.summary, tone: 'neutral' }));
    if (wars.length) sections.push({ id: 'wars', title: 'Frentes de batalha', icon: 'fa-solid fa-person-rifle', rows: wars });

    const involving = (report.aiActions || []).filter((a) => a && pid && (a.targetId === pid || a.actorId === pid))
        .map((a) => ({ icon: 'fa-solid fa-chess-knight', text: a.summary, tone: a.targetId === pid ? 'warn' : 'neutral' }));
    if (involving.length) sections.push({ id: 'ai', title: 'Movimentos que envolvem você', icon: 'fa-solid fa-chess', rows: involving });

    const crisisRows = [];
    for (const id of report.newCrises || []) {
        const c = state && Array.isArray(state.crises) ? state.crises.find((x) => x.id === id) : null;
        crisisRows.push({ icon: 'fa-solid fa-triangle-exclamation', text: c ? `Nova crise: ${c.title}` : 'Nova crise', tone: 'bad' });
    }
    for (const t of report.resolvedCrises || []) crisisRows.push({ icon: 'fa-solid fa-circle-check', text: `Crise encerrada: ${t}`, tone: 'good' });
    for (const id of report.capitulations || []) crisisRows.push({ icon: 'fa-solid fa-flag', text: `${nameOf(state, id)} capitulou`, tone: id === pid ? 'bad' : 'neutral' });
    if (crisisRows.length) sections.push({ id: 'crises', title: 'Crises e capitulações', icon: 'fa-solid fa-fire', rows: crisisRows });

    const decisions = Array.isArray(report.engineEvents) ? report.engineEvents.length : 0;
    return {
        title: `Relatório de ${formatDate(report.date)}`,
        turn: report.turn,
        sections,
        decisions,
        decisionsText: decisions ? `${decisions} ${decisions === 1 ? 'decisão aguarda' : 'decisões aguardam'} o seu despacho.` : '',
        outcome: report.outcome || null,
        empty: sections.length === 0,
    };
}

/** Months left until the campaign ends ('' when unknown). */
export function monthsLeftText(state) {
    if (!state || !state.date || !state.endDate) return '';
    const m = monthsBetween(state.date, state.endDate);
    return m > 0 ? `${monthsText(m)} até o fim da campanha` : 'Último mês da campanha';
}
