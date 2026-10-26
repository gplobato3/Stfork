/**
 * @file src/llm/prompts.js
 * Prompt scaffolding for the structured-output event engine.
 *
 * IMPORTANT: prompt scaffolding (role, rules, instructions) is written in
 * ENGLISH — it steers the model. The narrative/labels the model is asked to
 * PRODUCE must be pt-BR, so the instructions explicitly demand pt-BR output.
 *
 * Pure string builders. No ST imports, no side effects. Safe under node. The
 * builders inject the valid nation ids and effect/enum vocabulary straight from
 * the shared contract so the model targets real entities and legal values.
 */

import { RESOURCE_KEYS, BLOCS, relationKey } from '../contract/worldState.js';
import {
    EFFECT_TYPES,
    CRISIS_ACTIONS,
    WAR_ACTIONS,
    CRISIS_SEVERITIES,
    OPTION_COUNT,
    EFFECT_DELTA_BOUNDS,
} from '../contract/events.js';

/**
 * Build the system prompt that frames the model as the world-simulation /
 * advisor council and lays out the hard rules for a schema-valid GameEvent.
 *
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string}
 */
export function buildSystemPrompt(ws) {
    const nationIds = validNationIds(ws);
    const playerId = ws && ws.playerNationId ? ws.playerNationId : '(none)';

    return [
        'You are the WORLD SIMULATION ENGINE and the advisor council for a',
        'Hearts-of-Iron-style grand-strategy game set in a modern-day / near-future',
        'World War III scenario. The human player is the head of state of their nation.',
        '',
        'YOUR TASK: produce EXACTLY ONE "turn event" — a single geopolitical situation',
        'that confronts the player this turn — as a JSON object that STRICTLY matches',
        'the provided JSON schema. Return JSON ONLY, no prose, no markdown fences.',
        '',
        'HARD RULES:',
        `- Provide between ${OPTION_COUNT.MIN} and ${OPTION_COUNT.MAX} options.`,
        '- Every effect MUST reference REAL nation ids from the roster below. Never',
        '  invent nation ids. The player nation id is: ' + playerId + '.',
        '- Effect "type" MUST be one of: ' + EFFECT_TYPES.join(', ') + '.',
        '- resource/resourceSet effects: "resource" MUST be one of: ' + RESOURCE_KEYS.join(', ') + '.',
        '- relation/war effects need both "target" and "targetB" (two nation ids).',
        '- war "action" ∈ ' + WAR_ACTIONS.join(', ') + '; crisis "action" ∈ ' + CRISIS_ACTIONS.join(', ') + '.',
        '- crisis severity ∈ ' + CRISIS_SEVERITIES.join(', ') + '.',
        '- bloc "bloc" ∈ ' + BLOCS.join(', ') + '.',
        '- Signed deltas must stay within bounds: resource ±' + EFFECT_DELTA_BOUNDS.resource.max +
            ', relation ±' + EFFECT_DELTA_BOUNDS.relation.max +
            ', tension ±' + EFFECT_DELTA_BOUNDS.tension.max + '.',
        '- Keep stakes proportional: most turns are tense but not apocalyptic.',
        '',
        'LANGUAGE RULES (critical):',
        '- ALL player-facing text — title, narrative, context, option label, option',
        '  rationale, crisis title/description, effect notes — MUST be written in',
        '  BRAZILIAN PORTUGUESE (pt-BR).',
        '- The tone and facts MUST stay consistent with the SITUATION REPORT already',
        '  present in the chat context (same date, nation, tension, crises).',
        '',
        'VALID NATION IDS (roster): ' + (nationIds.length ? nationIds.join(', ') : '(none yet)'),
    ].join('\n');
}

/**
 * Build the per-turn user prompt: a compact, machine-readable world-state
 * summary plus the active crises, telling the model to generate the next event.
 *
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string}
 */
export function buildUserPrompt(ws) {
    const player = getPlayerNation(ws);
    const lines = [];
    lines.push('CURRENT WORLD STATE (summary for simulation):');
    lines.push(`- date: ${fmtDate(ws)} | turn: ${num(ws && ws.turn)} | globalTension: ${num(ws && ws.globalTension)}/100`);

    if (player) {
        lines.push(`- player nation: ${player.id} "${player.name || player.id}" | bloc: ${player.bloc || '?'} | leaderTitle(pt-BR): ${player.leaderTitle || '?'}`);
        lines.push('- player resources: ' + RESOURCE_KEYS.map((k) => `${k}=${num(player.resources && player.resources[k])}`).join(', '));
        if (Array.isArray(player.traits) && player.traits.length) {
            lines.push('- player traits: ' + player.traits.join(', '));
        }
    }

    lines.push('- key relations: ' + summarizeRelations(ws));
    lines.push('- active crises: ' + summarizeCrises(ws));
    lines.push('');
    lines.push('Generate ONE new turn event that plausibly follows from this state.');
    lines.push('Respond with a single JSON object matching the schema. pt-BR narrative/labels.');
    return lines.join('\n');
}

/**
 * Build a repair prompt appended after an invalid first attempt. It restates
 * the schema violations (English) and demands a corrected JSON-only response.
 *
 * @param {string[]} errors Validation error strings from validateEvent.
 * @param {string} [rawText] The raw (invalid) model output, truncated.
 * @returns {string}
 */
export function buildRepairPrompt(errors, rawText = '') {
    const list = Array.isArray(errors) && errors.length
        ? errors.map((e) => `- ${e}`).join('\n')
        : '- output was not valid JSON matching the schema.';
    const sample = rawText ? `\n\nYour previous output (truncated):\n${String(rawText).slice(0, 600)}` : '';
    return [
        'Your previous response did NOT satisfy the schema. Problems:',
        list,
        '',
        'Return a CORRECTED response: a single JSON object only, matching the schema',
        'exactly. No prose, no markdown. Keep all player-facing text in pt-BR and keep',
        'using only the valid nation ids and effect enums already specified.',
        sample,
    ].join('\n');
}

/* ----------------------------- small helpers ------------------------------ */

/**
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string[]}
 */
function validNationIds(ws) {
    if (!ws || !ws.nations || typeof ws.nations !== 'object') return [];
    return Object.keys(ws.nations);
}

/**
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {import('../contract/worldState.js').Nation|null}
 */
function getPlayerNation(ws) {
    if (!ws || !ws.playerNationId || !ws.nations) return null;
    return ws.nations[ws.playerNationId] || null;
}

/**
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string}
 */
function summarizeRelations(ws) {
    const pid = ws && ws.playerNationId;
    const relations = ws && ws.relations;
    const nations = (ws && ws.nations) || {};
    if (!pid || !relations) return '(none)';
    const parts = [];
    for (const other of Object.keys(nations)) {
        if (other === pid) continue;
        const key = relationKey(pid, other);
        if (Object.prototype.hasOwnProperty.call(relations, key)) {
            parts.push(`${other}=${num(relations[key])}`);
        }
    }
    if (!parts.length) return '(none)';
    // Keep this compact: strongest-magnitude first, top 8.
    parts.sort((a, b) => Math.abs(parseInt(b.split('=')[1], 10)) - Math.abs(parseInt(a.split('=')[1], 10)));
    return parts.slice(0, 8).join(', ');
}

/**
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string}
 */
function summarizeCrises(ws) {
    const crises = ws && Array.isArray(ws.activeCrises) ? ws.activeCrises : [];
    if (!crises.length) return '(none)';
    return crises
        .slice(0, 6)
        .map((c) => `${(c && c.severity) || '?'}:"${(c && c.title) || '?'}"[${(c && Array.isArray(c.involvedNationIds) ? c.involvedNationIds.join('+') : '')}]`)
        .join('; ');
}

/**
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string}
 */
function fmtDate(ws) {
    const d = (ws && ws.date) || {};
    return `${d.year ?? '?'}-${String(d.month ?? '?').padStart(2, '0')}`;
}

/**
 * @param {*} v
 * @returns {number}
 */
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
}
