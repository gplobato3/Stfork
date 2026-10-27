/**
 * @file src/llm/sitrep.js
 * Deterministic pt-BR situation report ("[SITUAÇÃO — Outubro de 2026] … [/SITUAÇÃO]")
 * used by the prompt injection, the {{hoi_sitrep}} macro, /hoi-status and the
 * event generator. Pure: reads only the WorldState.
 *
 * Budget: tokens are estimated as chars / 3.5. When the report is over budget,
 * the least valuable line is removed until it fits. Section priority, high to
 * low: pending decision, own wars, actions this month, crises, last decision,
 * other wars, headlines, relations, modifiers; a line's value also decays with
 * its position in its section. Sections keep their minimum lines until nothing
 * else is left. The header, ruler, resources, PC/DEFCON, status and the
 * instruction line are never removed.
 */

import { RESOURCE_KEYS } from '../contract/constants.js';
import {
    formatDate,
    defcon,
    RESOURCE_LABELS,
    PC_LABEL,
    SEVERITY_LABELS,
    BLOC_LABELS,
    signed,
} from '../contract/presentation.js';
import { playerNation } from '../contract/worldState.js';

export const CHARS_PER_TOKEN = 3.5;
export const DEFAULT_BUDGET = Object.freeze({ compact: 400, full: 800 });

const LIMITS = Object.freeze({
    compact: { wars: 2, fronts: 2, exhaustion: 1, sides: 3, actions: 4, crises: 3, headlines: 3, allies: 4, rivals: 3, pacts: 3, worldWars: 2, modifiers: 0, crisisDesc: false },
    full: { wars: 5, fronts: 6, exhaustion: 3, sides: 4, actions: 8, crises: 5, headlines: 6, allies: 6, rivals: 5, pacts: 6, worldWars: 4, modifiers: 5, crisisDesc: true },
});

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const PACT_LABELS = { alliance: 'aliança', defense: 'defesa mútua', trade: 'comércio', nonAggression: 'não agressão', guarantee: 'garantia' };
const SOURCE_LABELS = { order: 'ordem no chat', command: 'comando', ui: '', ai: '' };
const MAX_LINE = 240;
/** Priority lost per line position inside a section when trimming. */
const LINE_DECAY = 1.5;

/** @param {string} text */
export function estimateTokens(text) {
    return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}

/** One-line, brace-free text (values may come from the LLM or the user). */
function clean(text, max = MAX_LINE) {
    const s = String(text ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function nameOf(state, id) {
    return clean(state.nations?.[id]?.name || id, 60);
}

function names(state, ids, max = 4) {
    const list = (Array.isArray(ids) ? ids : []).slice(0, max).map((id) => nameOf(state, id));
    const extra = Array.isArray(ids) && ids.length > max ? ` +${ids.length - max}` : '';
    return list.join(', ') + extra;
}

function relationsOf(state, playerId) {
    const out = [];
    for (const [key, value] of Object.entries(state.relations || {})) {
        const [a, b] = key.split('|');
        if (a !== playerId && b !== playerId) continue;
        const other = a === playerId ? b : a;
        const n = state.nations?.[other];
        if (!n || n.status === 'annexed' || typeof value !== 'number') continue;
        out.push({ id: other, value });
    }
    return out;
}

function warBalance(score) {
    const s = Number(score) || 0;
    if (s >= 15) return 'atacantes em vantagem';
    if (s <= -15) return 'defensores em vantagem';
    return 'equilibrada';
}

function frontText(state, front) {
    return `${nameOf(state, front.attacker)}→${nameOf(state, front.defender)} ${Math.round(Number(front.progress) || 0)}% ocupado`;
}

function playerWarLine(state, war, playerId, limits) {
    const fronts = (war.fronts || [])
        .slice()
        .sort((x, y) => {
            const px = x.attacker === playerId || x.defender === playerId ? 1 : 0;
            const py = y.attacker === playerId || y.defender === playerId ? 1 : 0;
            return py - px || (Number(y.progress) || 0) - (Number(x.progress) || 0);
        })
        .slice(0, limits.fronts)
        .map((f) => frontText(state, f));
    const ex = war.exhaustion || {};
    const exhaustion = Object.entries(ex)
        .filter(([id]) => (war.attackers || []).includes(id) || (war.defenders || []).includes(id))
        .sort((x, y) => (x[0] === playerId ? -1 : y[0] === playerId ? 1 : (y[1] || 0) - (x[1] || 0)))
        .slice(0, limits.exhaustion)
        .map(([id, v]) => `${nameOf(state, id)} ${Math.round(Number(v) || 0)}`);
    const parts = [
        `${clean(war.name, 80)} (${names(state, war.attackers, limits.sides)} × ${names(state, war.defenders, limits.sides)})${war.ceasefire ? ' — CESSAR-FOGO em vigor' : ''}`,
        fronts.length ? `frentes: ${fronts.join('; ')}` : 'sem frentes ativas',
        `situação ${warBalance(war.score)}`,
    ];
    if (exhaustion.length) parts.push(`cansaço: ${exhaustion.join(', ')}`);
    return parts.join('; ');
}

function worldWarLine(state, war) {
    const top = (war.fronts || []).slice().sort((x, y) => (Number(y.progress) || 0) - (Number(x.progress) || 0))[0];
    return `${clean(war.name, 80)}: ${names(state, war.attackers, 3)} × ${names(state, war.defenders, 3)}${top ? `; ${frontText(state, top)}` : ''}${war.ceasefire ? ' (cessar-fogo)' : ''}`;
}

function actionLine(rec) {
    const summary = clean(rec.summary || rec.actionId, 180);
    const hasOutcome = /sucesso|falh|fracass/i.test(summary);
    const outcome = hasOutcome ? '' : rec.success ? ' (sucesso)' : ' (falhou)';
    const src = SOURCE_LABELS[rec.source] ? ` [${SOURCE_LABELS[rec.source]}]` : '';
    return `${summary}${outcome}${src}`;
}

function modifierLine(mod) {
    const per = Object.entries(mod.perTurn || {})
        .filter(([, v]) => Number(v))
        .map(([k, v]) => `${(RESOURCE_LABELS[k] || k).toLowerCase()} ${signed(v)}/mês`)
        .join(', ');
    const months = `${Math.max(0, Number(mod.turnsLeft) || 0)} meses`;
    return `${clean(mod.label, 80)} (${per ? `${per}; ` : ''}${months})`;
}

/**
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {{budgetTokens?: number, detail?: 'compact'|'full'}} [opts]
 * @returns {string} '' when there is no campaign.
 */
export function buildSitrep(state, opts = {}) {
    if (!state || !state.player || !state.nations) return '';
    const detail = opts.detail === 'full' ? 'full' : 'compact';
    const limits = LIMITS[detail];
    const budget = Number(opts.budgetTokens) > 0 ? Number(opts.budgetTokens) : DEFAULT_BUDGET[detail];

    const playerId = state.player.nationId;
    const nation = playerNation(state) || { name: playerId, resources: {}, pc: 0 };
    const nationName = clean(nation.name || playerId, 60);
    const title = clean(state.player.title || nation.leaderTitle || 'Chefe de Estado', 40);
    const leader = clean(state.player.leaderName || 'Governante', 60);
    const dateText = formatDate(state.date);

    /* ---------------------------------------------- mandatory lines */
    const top = [];
    top.push(`[SITUAÇÃO — ${dateText}]`);
    const govt = [nation.government ? clean(nation.government, 50) : '', nation.bloc ? `bloco ${BLOC_LABELS[nation.bloc] || nation.bloc}` : '']
        .filter(Boolean)
        .join('; ');
    // Country names are used without prepositions/articles ("Nação: Brasil"):
    // pt-BR needs "do Brasil" / "da Argentina" / "de Portugal" and the scenario
    // data has no grammatical gender.
    top.push(
        `Governante: ${title} ${leader}, chefe de Estado. Nação: ${nationName}${govt ? ` (${govt})` : ''}. ` +
        `Mês ${Number(state.turn) || 1} da campanha${state.endDate ? `, que termina em ${formatDate(state.endDate)}` : ''}.`,
    );
    const res = nation.resources || {};
    top.push(`Recursos (0-100): ${RESOURCE_KEYS.map((k) => `${RESOURCE_LABELS[k]} ${Math.round(Number(res[k]) || 0)}`).join(', ')}.`);
    const d = defcon(state.globalTension);
    top.push(`${PC_LABEL}: ${Math.round(Number(nation.pc) || 0)}/30. Tensão mundial: ${Math.round(Number(state.globalTension) || 0)}/100 (DEFCON ${d.level} — ${d.label}).`);
    if (nation.status === 'puppet' && nation.overlord) top.push(`Status: Estado-fantoche de ${nameOf(state, nation.overlord)}.`);
    else if (nation.status === 'capitulated') top.push('Status: o país capitulou e aguarda os termos de paz.');
    if (state.outcome) {
        top.push(`Campanha encerrada: ${state.outcome.kind === 'victory' ? 'VITÓRIA' : 'DERROTA'} — ${clean(state.outcome.reason, 160)}.`);
    }

    const instruction =
        `Instrução: estes dados são o estado real do jogo. Narre de forma coerente com eles, sem contradizê-los e sem inventar números, ` +
        `resultados ou mudanças de recursos (só o jogo altera o estado). O usuário interpreta ${title} ${leader}, chefe de Estado (${nationName}): ` +
        'narre as consequências das ações listadas e deixe as decisões para ele.';
    const footer = '[/SITUAÇÃO]';

    /* --------------------------------------------- optional sections */
    /** @type {Array<{id:string, priority:number, min:number, title:?string, lines:string[], inline?: boolean}>} */
    const sections = [];

    if (state.pendingEvent) {
        const queued = Array.isArray(state.eventQueue) ? state.eventQueue.length : 0;
        sections.push({
            id: 'pending', priority: 9, min: 1, title: null, inline: true,
            lines: [`Decisão pendente do governo: "${clean(state.pendingEvent.title, 100)}"${queued ? ` (+${queued} na fila)` : ''}.`],
        });
    }

    const wars = Array.isArray(state.wars) ? state.wars : [];
    const isPlayerWar = (w) => (w.attackers || []).includes(playerId) || (w.defenders || []).includes(playerId);
    const playerWars = wars.filter(isPlayerWar);
    sections.push({
        id: 'wars', priority: 8, min: 1, title: 'Guerras do país:',
        lines: playerWars.slice(0, limits.wars).map((w) => playerWarLine(state, w, playerId, limits)),
    });

    const turn = Number(state.turn) || 0;
    const actions = (Array.isArray(state.recentActions) ? state.recentActions : [])
        .filter((r) => r && r.actorId === playerId && Number(r.turn) === turn)
        .slice(-limits.actions);
    sections.push({
        id: 'actions', priority: 7, min: 1, title: 'Ações do governo neste mês:',
        lines: actions.map(actionLine),
    });

    const lastDecision = Array.isArray(state.decisions) ? state.decisions[state.decisions.length - 1] : null;
    if (lastDecision && Number(lastDecision.turn) >= turn - 1) {
        sections.push({
            id: 'decision', priority: 5, min: 0, title: null, inline: true,
            lines: [`Última decisão do governo: "${clean(lastDecision.eventTitle, 90)}" → ${clean(lastDecision.optionLabel, 90)}.`],
        });
    }

    const crises = (Array.isArray(state.crises) ? state.crises : [])
        .slice()
        .sort((a, b) => {
            // severity x2, +3 when the player is involved: a critical world crisis
            // outranks a low/medium one involving the player, but not a high one.
            const score = (c) => (SEVERITY_RANK[c.severity] || 0) * 2 + ((c.involved || []).includes(playerId) ? 3 : 0);
            return score(b) - score(a) || (Number(b.turnStarted) || 0) - (Number(a.turnStarted) || 0) || String(a.id).localeCompare(String(b.id));
        })
        .slice(0, limits.crises)
        .map((c) => {
            const base = `[${SEVERITY_LABELS[c.severity] || c.severity}] ${clean(c.title, 90)} — ${names(state, c.involved)}`;
            return limits.crisisDesc && c.description ? `${base}: ${clean(c.description, 140)}` : base;
        });
    sections.push({ id: 'crises', priority: 6, min: 1, title: 'Crises:', lines: crises });

    const news = (Array.isArray(state.news) ? state.news : [])
        .slice(-limits.headlines)
        .reverse()
        .map((n) => clean(n.text, 160))
        .filter(Boolean);
    sections.push({ id: 'news', priority: 3, min: 0, title: 'Manchetes recentes:', lines: news });

    const rel = relationsOf(state, playerId);
    const relValue = new Map(rel.map((r) => [r.id, r.value]));
    const pacts = (Array.isArray(state.pacts) ? state.pacts : []).filter((p) => (p.members || []).includes(playerId));
    const pactPartners = new Set();
    for (const p of pacts) {
        if (p.type === 'alliance' || p.type === 'defense') for (const m of p.members || []) if (m !== playerId) pactPartners.add(m);
    }
    const allies = [...new Set([...pactPartners, ...rel.filter((r) => r.value >= 60).map((r) => r.id)])]
        .filter((id) => state.nations[id] && state.nations[id].status !== 'annexed')
        .sort((a, b) => (relValue.get(b) ?? 0) - (relValue.get(a) ?? 0))
        .slice(0, limits.allies)
        .map((id) => `${nameOf(state, id)} (${signed(relValue.get(id) ?? 0)})`);
    const rivals = rel
        .filter((r) => r.value <= -25)
        .sort((a, b) => a.value - b.value)
        .slice(0, limits.rivals)
        .map((r) => `${nameOf(state, r.id)} (${signed(r.value)})`);
    const relLines = [];
    if (allies.length) relLines.push(`Aliados: ${allies.join(', ')}.`);
    if (rivals.length) relLines.push(`Rivais: ${rivals.join(', ')}.`);
    if (pacts.length) {
        relLines.push(`Pactos: ${pacts.slice(0, limits.pacts).map((p) => `${clean(p.name, 50)} (${PACT_LABELS[p.type] || p.type})`).join(', ')}.`);
    }
    sections.push({ id: 'relations', priority: 2, min: 0, title: null, inline: true, lines: relLines });

    if (limits.modifiers > 0) {
        const mods = (Array.isArray(state.modifiers) ? state.modifiers : [])
            .filter((m) => m && m.nationId === playerId && Number(m.turnsLeft) > 0)
            .slice(0, limits.modifiers)
            .map(modifierLine);
        sections.push({ id: 'modifiers', priority: 1, min: 0, title: 'Medidas em vigor:', lines: mods });
    }

    // Wars between other nations: biggest first (more belligerents, then fronts).
    const worldWars = wars
        .filter((w) => !isPlayerWar(w))
        .map((w, i) => ({ w, i, size: (w.attackers || []).length + (w.defenders || []).length, fronts: (w.fronts || []).length }))
        .sort((a, b) => b.size - a.size || b.fronts - a.fronts || a.i - b.i)
        .slice(0, limits.worldWars)
        .map(({ w }) => worldWarLine(state, w));
    sections.push({ id: 'worldWars', priority: 4, min: 0, title: 'Outras guerras no mundo:', lines: worldWars });

    /* ------------------------------------------------------- render */
    const render = () => {
        const body = [];
        for (const s of sections) {
            if (!s.lines.length) continue;
            if (s.inline) body.push(...s.lines);
            else body.push(s.title, ...s.lines.map((l) => `- ${l}`));
        }
        return [...top, ...body, instruction, footer].join('\n');
    };

    // Each line's value decays with its position in the section, so the 5th
    // minor crisis goes before the first line of a lower-priority section.
    const lastLineValue = (s) => s.priority - (s.lines.length - 1) * LINE_DECAY;
    const cheapest = (list) => list.sort((a, b) => lastLineValue(a) - lastLineValue(b) || a.priority - b.priority)[0];
    let text = render();
    let guard = 300;
    while (estimateTokens(text) > budget && guard-- > 0) {
        const target = cheapest(sections.filter((s) => s.lines.length > s.min)) || cheapest(sections.filter((s) => s.lines.length > 0));
        if (!target) break;
        target.lines.pop();
        text = render();
    }
    return text;
}
