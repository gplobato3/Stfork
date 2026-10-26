/**
 * @file src/llm/situationReport.js
 * Builds the compact, pt-BR "SITUATION REPORT" (relatório de situação) that the
 * interceptor splices into the chat so the user's own preset/character-driven
 * generation is grounded in the live game state.
 *
 * Display strings are pt-BR; code/comments are English. Pure w.r.t. the world
 * state (no ST imports, no side effects) so it is trivially testable and safe
 * under node.
 */

import { RESOURCE_KEYS, relationKey } from '../contract/worldState.js';

/**
 * pt-BR labels for the 7 resources, keyed by the stable RESOURCE_KEYS order.
 * @type {Object.<string,string>}
 */
const RESOURCE_LABELS_PT = Object.freeze({
    economy: 'Economia',
    military: 'Militar',
    stability: 'Estabilidade',
    influence: 'Influência',
    tech: 'Tecnologia',
    manpower: 'Efetivos',
    warSupport: 'Apoio à Guerra',
});

/** pt-BR month names (index 1..12). */
const MONTHS_PT = Object.freeze([
    '',
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]);

/** pt-BR severity labels for crises. */
const SEVERITY_LABELS_PT = Object.freeze({
    low: 'baixa',
    medium: 'média',
    high: 'alta',
    critical: 'crítica',
});

/** Rough chars-per-token heuristic (English/pt mix). Conservative. */
const CHARS_PER_TOKEN = 4;

/**
 * Detail levels, from richest (3) to leanest (0). The builder starts at the
 * richest level that fits the token budget, degrading gracefully as the budget
 * shrinks. Level meaning:
 *   3: header + resources + tension + crises + relations
 *   2: header + resources + tension + crises (drop relations)
 *   1: header + resources + tension       (drop crises)
 *   0: header + tension only              (bare minimum)
 */
const MAX_LEVEL = 3;

/**
 * Produce a compact pt-BR situation report string.
 *
 * Token-budget aware: `maxTokensBudget` (typically a fraction of the
 * interceptor's `contextSize`) controls how much detail is included. As the
 * budget shrinks, the lowest-priority sections (diplomatic relations, then
 * crises) are dropped first, and long lists are truncated.
 *
 * @param {import('../contract/worldState.js').WorldState} worldState
 * @param {{maxTokensBudget?: number}} [opts]
 * @returns {string} Plain text suitable to splice into chat as a system note.
 */
export function buildSituationReport(worldState, opts = {}) {
    if (!worldState || typeof worldState !== 'object') return '';

    const budgetTokens = normalizeBudget(opts.maxTokensBudget);
    const budgetChars = budgetTokens * CHARS_PER_TOKEN;

    // Try the richest detail level that fits; always return at least level 0.
    for (let level = MAX_LEVEL; level >= 0; level--) {
        const text = render(worldState, level, budgetChars);
        if (text.length <= budgetChars || level === 0) {
            return text;
        }
    }
    // Unreachable, but keeps the type-checker and callers safe.
    return render(worldState, 0, budgetChars);
}

/**
 * Coerce a possibly-missing/invalid budget into a sane positive token count.
 * @param {*} v
 * @returns {number}
 */
function normalizeBudget(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 512; // generous default
    // Clamp to a reasonable window so a huge contextSize doesn't produce an
    // absurd report, and a tiny one still yields something.
    return Math.max(24, Math.min(4096, Math.round(n)));
}

/**
 * Render the report at a given detail level, respecting a char budget for the
 * variable-length sections (crises/relations list sizes).
 * @param {import('../contract/worldState.js').WorldState} ws
 * @param {number} level
 * @param {number} budgetChars
 * @returns {string}
 */
function render(ws, level, budgetChars) {
    const lines = [];
    lines.push('[RELATÓRIO DE SITUAÇÃO — HOI Grande Estratégia]');
    lines.push(headerLine(ws));

    const player = getPlayerNation(ws);
    if (player) {
        lines.push(playerLine(player));
    }

    lines.push(tensionLine(ws));

    if (level >= 1 && player) {
        lines.push('Recursos: ' + resourcesLine(player));
    }

    if (level >= 2) {
        const crisisLines = crisesSection(ws, budgetChars);
        if (crisisLines.length) lines.push(...crisisLines);
    }

    if (level >= 3) {
        const relLines = relationsSection(ws, budgetChars);
        if (relLines.length) lines.push(...relLines);
    }

    lines.push('[FIM DO RELATÓRIO — responda no personagem/preset carregado, em pt-BR.]');
    return lines.join('\n');
}

/**
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string}
 */
function headerLine(ws) {
    const d = ws.date || {};
    const month = MONTHS_PT[Number(d.month)] || String(d.month ?? '?');
    const year = d.year ?? '?';
    const turn = Number.isFinite(ws.turn) ? ws.turn : '?';
    return `Data: ${month} de ${year} · Turno ${turn} · Fase ${ws.phase ?? '?'}`;
}

/**
 * @param {import('../contract/worldState.js').Nation} nation
 * @returns {string}
 */
function playerLine(nation) {
    const flag = nation.flagEmoji ? `${nation.flagEmoji} ` : '';
    const title = nation.leaderTitle || 'Líder';
    const bloc = nation.bloc ? ` · Bloco: ${nation.bloc}` : '';
    const capital = nation.capital ? ` · Capital: ${nation.capital}` : '';
    return `Nação do jogador: ${flag}${nation.name || nation.id} (você é o(a) ${title})${capital}${bloc}`;
}

/**
 * Compact single-line listing of the 7 resources in their stable order.
 * @param {import('../contract/worldState.js').Nation} nation
 * @returns {string}
 */
function resourcesLine(nation) {
    const res = nation.resources || {};
    return RESOURCE_KEYS
        .map((k) => `${RESOURCE_LABELS_PT[k]} ${clampShow(res[k])}`)
        .join(' · ');
}

/**
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string}
 */
function tensionLine(ws) {
    const t = clampShow(ws.globalTension);
    return `Tensão global (escalada para 3ª Guerra): ${t}/100 ${tensionBar(ws.globalTension)}`;
}

/**
 * Tiny 10-cell ASCII meter for the tension value. Cheap, deterministic.
 * @param {number} value
 * @returns {string}
 */
function tensionBar(value) {
    const n = Math.max(0, Math.min(10, Math.round((Number(value) || 0) / 10)));
    return '[' + '#'.repeat(n) + '-'.repeat(10 - n) + ']';
}

/**
 * Active-crises section, highest severity first, truncated to fit the budget.
 * @param {import('../contract/worldState.js').WorldState} ws
 * @param {number} budgetChars
 * @returns {string[]}
 */
function crisesSection(ws, budgetChars) {
    const crises = Array.isArray(ws.activeCrises) ? ws.activeCrises.slice() : [];
    if (!crises.length) return [];

    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    crises.sort((a, b) => (order[a && a.severity] ?? 9) - (order[b && b.severity] ?? 9));

    // Smaller budgets show fewer crises.
    const maxItems = budgetChars < 400 ? 2 : budgetChars < 900 ? 3 : 5;
    const top = crises.slice(0, maxItems);

    const lines = ['Crises ativas:'];
    for (const c of top) {
        if (!c) continue;
        const sev = SEVERITY_LABELS_PT[c.severity] || c.severity || '?';
        const involved = Array.isArray(c.involvedNationIds) && c.involvedNationIds.length
            ? ` (${c.involvedNationIds.join(', ')})`
            : '';
        lines.push(`  - [${sev}] ${c.title || 'Crise sem título'}${involved}`);
    }
    if (crises.length > top.length) {
        lines.push(`  - … e mais ${crises.length - top.length} crise(s).`);
    }
    return lines;
}

/**
 * Key diplomatic relations for the player nation, strongest-magnitude first.
 * @param {import('../contract/worldState.js').WorldState} ws
 * @param {number} budgetChars
 * @returns {string[]}
 */
function relationsSection(ws, budgetChars) {
    const pid = ws.playerNationId;
    const relations = ws.relations && typeof ws.relations === 'object' ? ws.relations : {};
    if (!pid || !relations) return [];

    /** @type {{other:string, score:number}[]} */
    const entries = [];
    const nations = ws.nations || {};
    for (const other of Object.keys(nations)) {
        if (other === pid) continue;
        const key = relationKey(pid, other);
        if (Object.prototype.hasOwnProperty.call(relations, key)) {
            const score = Number(relations[key]);
            if (Number.isFinite(score)) entries.push({ other, score });
        }
    }
    if (!entries.length) return [];

    // Most extreme relations are the most strategically relevant.
    entries.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const maxItems = budgetChars < 700 ? 3 : budgetChars < 1200 ? 4 : 6;
    const top = entries.slice(0, maxItems);

    const lines = ['Relações-chave:'];
    for (const e of top) {
        const name = (nations[e.other] && nations[e.other].name) || e.other;
        lines.push(`  - ${name}: ${formatRelation(e.score)}`);
    }
    return lines;
}

/**
 * Turn a -100..100 relation score into a signed number + pt-BR qualifier.
 * @param {number} score
 * @returns {string}
 */
function formatRelation(score) {
    const s = Math.round(score);
    const sign = s > 0 ? '+' : '';
    let qual = 'neutra';
    if (s >= 50) qual = 'aliado próximo';
    else if (s >= 15) qual = 'amistosa';
    else if (s <= -50) qual = 'hostil';
    else if (s <= -15) qual = 'tensa';
    return `${sign}${s} (${qual})`;
}

/**
 * Resolve the player's Nation from world state, if any.
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {import('../contract/worldState.js').Nation|null}
 */
function getPlayerNation(ws) {
    const pid = ws.playerNationId;
    if (!pid || !ws.nations) return null;
    return ws.nations[pid] || null;
}

/**
 * Display a 0..100 value, tolerating missing/NaN.
 * @param {*} v
 * @returns {number|string}
 */
function clampShow(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '?';
    return Math.round(n);
}
