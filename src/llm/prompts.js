/**
 * @file src/llm/prompts.js
 * Prompt builders. Scaffolding in English (models follow it best), every
 * requested output in pt-BR. Text Completion backends do not enforce JSON
 * schemas, so each structured prompt spells out the format with a compact
 * example. Pure and node-safe.
 *
 * All chat/user-derived text is passed through `neutralize()` because ST runs
 * substituteParams() on generateRaw prompts (script.js:3945, :3955), which would
 * otherwise evaluate macros typed in the chat.
 */

import {
    EVENT_CATEGORIES,
    EFFECT_LIMITS,
    RESOURCE_KEYS,
    OPTION_COUNT,
    NARRATOR_NAME,
} from '../contract/constants.js';
import { formatDate, RESOURCE_LABELS, signed } from '../contract/presentation.js';
import { playerNation, getRelation } from '../contract/worldState.js';

/** Break macro syntax ({{...}}) so ST does not evaluate it inside our prompts. */
export function neutralize(text) {
    return String(text ?? '').replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }');
}

function oneLine(text, max = 200) {
    const s = neutralize(text).replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clip(text, max) {
    const s = neutralize(text).trim();
    return s.length > max ? `…${s.slice(s.length - max)}` : s;
}

function playerInfo(state) {
    const n = playerNation(state) || {};
    return {
        id: state.player.nationId,
        name: oneLine(n.name || state.player.nationId, 60),
        title: oneLine(state.player.title || n.leaderTitle || 'Chefe de Estado', 40),
        leader: oneLine(state.player.leaderName || 'Governante', 60),
    };
}

/* ------------------------------------------------------------------ roster */

/**
 * Nation ids most relevant for the player (player first). Used to keep the
 * prompt small; validation still accepts any existing nation id.
 * @param {any} state
 * @param {{max?: number, text?: string}} [opts] `text`: also include nations whose name stem appears in it.
 * @returns {string[]}
 */
export function relevantNationIds(state, { max = 40, text = '' } = {}) {
    const playerId = state.player.nationId;
    const active = (id) => state.nations[id] && state.nations[id].status !== 'annexed';
    const score = new Map();
    const bump = (id, v) => {
        if (!id || !active(id) || id === playerId) return;
        score.set(id, (score.get(id) || 0) + v);
    };
    for (const w of state.wars || []) {
        const involved = [...(w.attackers || []), ...(w.defenders || [])];
        const mine = involved.includes(playerId);
        for (const id of involved) bump(id, mine ? 100 : 20);
    }
    for (const c of state.crises || []) {
        const mine = (c.involved || []).includes(playerId);
        for (const id of c.involved || []) bump(id, mine ? 60 : 15);
    }
    for (const p of state.pacts || []) {
        if ((p.members || []).includes(playerId)) for (const id of p.members) bump(id, 40);
    }
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const haystack = norm(text);
    for (const n of Object.values(state.nations)) {
        if (!n || !active(n.id) || n.id === playerId) continue;
        if (n.major) bump(n.id, 30);
        else if (n.playable) bump(n.id, 5);
        const rel = Math.abs(getRelation(state, playerId, n.id));
        if (rel >= 40) bump(n.id, rel / 4);
        if (haystack) {
            const nm = norm(n.name);
            const stem = nm.length > 6 ? nm.slice(0, Math.max(5, nm.length - 3)) : nm;
            if (nm && (haystack.includes(nm) || (stem.length >= 4 && haystack.includes(stem)))) bump(n.id, 500);
        }
    }
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
    return [playerId, ...ranked.slice(0, Math.max(0, max - 1))];
}

/** 'BRA = Brasil (jogador), ARG = Argentina, ...' */
export function rosterText(state, ids) {
    const playerId = state.player.nationId;
    return ids
        .map((id) => `${id} = ${oneLine(state.nations[id]?.name || id, 40)}${id === playerId ? ' (jogador)' : ''}`)
        .join(', ');
}

/* -------------------------------------------------------------- turn report */

/**
 * Compact English-labelled, pt-BR-content summary of a TurnReport.
 * @param {any} state
 * @param {any} report
 * @returns {string}
 */
export function reportText(state, report) {
    if (!report) return '(no report: this is the first month)';
    const lines = [];
    if (report.date) lines.push(`Month: ${formatDate(report.date)} (turn ${report.turn})`);
    if (Number.isFinite(report.tensionBefore) && Number.isFinite(report.tensionAfter)) {
        lines.push(`World tension: ${report.tensionBefore} -> ${report.tensionAfter}`);
    }
    const deltas = Object.entries(report.playerDeltas || {})
        .filter(([k, v]) => RESOURCE_KEYS.includes(k) && Number(v))
        .map(([k, v]) => `${RESOURCE_LABELS[k]} ${signed(v)}`);
    if (deltas.length) lines.push(`Player resource changes: ${deltas.join(', ')}`);
    if (report.pcGained) lines.push(`Political capital gained: ${report.pcGained}`);
    const heads = (report.headlines || []).slice(0, 8).map((h) => `- ${oneLine(h, 180)}`);
    if (heads.length) lines.push('Headlines:', ...heads);
    const wars = (report.warUpdates || []).slice(0, 5).map((w) => `- ${oneLine(w.summary, 180)}`);
    if (wars.length) lines.push('War updates:', ...wars);
    const playerId = state.player.nationId;
    const ai = (report.aiActions || [])
        .slice()
        .sort((a, b) => (b.targetId === playerId ? 1 : 0) - (a.targetId === playerId ? 1 : 0))
        .slice(0, 6)
        .map((a) => `- ${oneLine(a.summary, 160)}${a.targetId === playerId ? ' [targets the player]' : ''}`);
    if (ai.length) lines.push('AI nation moves:', ...ai);
    if ((report.capitulations || []).length) {
        lines.push(`Capitulations: ${report.capitulations.map((id) => oneLine(state.nations[id]?.name || id, 40)).join(', ')}`);
    }
    if ((report.newCrises || []).length) {
        const titles = report.newCrises.map((id) => oneLine((state.crises || []).find((c) => c.id === id)?.title || id, 80));
        lines.push(`New crises: ${titles.join('; ')}`);
    }
    if ((report.resolvedCrises || []).length) lines.push(`Resolved crises: ${report.resolvedCrises.map((t) => oneLine(t, 80)).join('; ')}`);
    return lines.join('\n');
}

/* ------------------------------------------------------------------- event */

export const EFFECT_VOCABULARY = [
    `{"type":"resource","target":"PLAYER|<id>","resource":"${RESOURCE_KEYS.join('|')}","delta":<-${EFFECT_LIMITS.resource}..${EFFECT_LIMITS.resource}>}`,
    `{"type":"relation","target":"PLAYER|<id>","targetB":"<id>","delta":<-${EFFECT_LIMITS.relation}..${EFFECT_LIMITS.relation}>}`,
    `{"type":"tension","delta":<-${EFFECT_LIMITS.tension}..${EFFECT_LIMITS.tension}>}  (world tension)`,
    `{"type":"pc","target":"PLAYER","delta":<-10..10>}  (political capital)`,
    `{"type":"modifier","target":"PLAYER|<id>","label":"<pt-BR>","perTurn":{"economy":<-${EFFECT_LIMITS.modifierPerTurn}..${EFFECT_LIMITS.modifierPerTurn}>,...},"turns":<1..${EFFECT_LIMITS.modifierTurns}>}`,
    '{"type":"crisis","action":"start","title":"<pt-BR>","description":"<pt-BR>","severity":"low|medium|high|critical","involved":["<id>",...],"category":"<event category>"}',
    '{"type":"crisis","action":"escalate|deescalate|resolve","crisisId":"<existing crisis id>"}',
    '{"type":"pact","action":"create|break","pactType":"alliance|defense|trade|nonAggression|guarantee","target":"PLAYER|<id>","targetB":"<id>"}',
    '{"type":"war","action":"declare","target":"<attacker id|PLAYER>","targetB":"<defender id>"}  (ONLY when the option label explicitly declares war)',
    '{"type":"war","action":"ceasefire|peace","target":"<id|PLAYER>","targetB":"<id>","terms":"whitePeace|reparations|puppet|annex"}',
    `{"type":"front","target":"<attacker id|PLAYER>","targetB":"<defender id>","delta":<-${EFFECT_LIMITS.front}..${EFFECT_LIMITS.front}>}  (occupation progress on an existing front)`,
    '{"type":"bloc","target":"<id>","bloc":"NATO|EU|CSTO|BRICS|NON_ALIGNED"}',
    '{"type":"news","text":"<pt-BR headline>"}',
].join('\n');

export const EVENT_EXAMPLE = JSON.stringify({
    category: 'diplomacy',
    title: 'Buenos Aires propõe um eixo comercial',
    narrative: 'O chanceler argentino desembarcou em Brasília com uma proposta ambiciosa... (60-180 words)',
    headlines: ['Argentina e Brasil discutem acordo de integração industrial'],
    involved: ['ARG'],
    options: [
        {
            label: 'Assinar o acordo comercial',
            rationale: 'Economia cresce, mas a indústria nacional reclama.',
            effects: [
                { type: 'pact', action: 'create', pactType: 'trade', target: 'PLAYER', targetB: 'ARG' },
                { type: 'resource', target: 'PLAYER', resource: 'economy', delta: 4 },
                { type: 'resource', target: 'PLAYER', resource: 'stability', delta: -2 },
            ],
        },
        {
            label: 'Recusar com cortesia',
            rationale: 'Preserva a indústria, esfria a relação.',
            effects: [{ type: 'relation', target: 'PLAYER', targetB: 'ARG', delta: -8 }],
        },
    ],
});

/**
 * @param {any} state
 * @param {{sitrep: string, report?: any, recentChat?: string}} input
 * @returns {{systemPrompt: string, prompt: string}}
 */
export function buildEventPrompts(state, { sitrep, report, recentChat }) {
    const p = playerInfo(state);
    const systemPrompt = [
        'You are the event writer of "HOI — Grande Estratégia", a Hearts of Iron-style grand strategy game set in the modern day, on the edge of World War III.',
        `Each month you write ONE decision event for the player, ${p.title} ${p.leader}, head of state of ${p.name} (id ${p.id}).`,
        '',
        'Rules:',
        '- Ground the event in the situation report, last month\'s engine report and the recent role-play chat. Prefer direct consequences of what just happened (wars, fronts, crises, AI moves, the player\'s orders and statements in the chat) over generic events. Do not repeat recent events.',
        '- ALL player-facing text MUST be in Brazilian Portuguese (pt-BR): title, narrative, headlines, option labels, rationales, crisis titles/descriptions, modifier labels and news texts.',
        '- narrative: 60-180 words, written as an urgent briefing to the head of state; concrete actors, places and stakes. Never contradict the report and never state resource numbers.',
        `- ${OPTION_COUNT.MIN} to ${OPTION_COUNT.MAX} options with real trade-offs; each option has 1 to 4 effects; no option is free of cost. Labels are imperative and at most 60 characters ("Enviar ajuda humanitária"). rationale: one short pt-BR sentence hinting the consequence.`,
        '- Effects use ONLY the vocabulary below. Nation ids ONLY from the roster, or PLAYER for the player\'s nation. Stay inside the numeric limits; typical resource deltas are 2-8.',
        '- A war declaration effect is allowed only when the option label explicitly says war is declared.',
        `- category: one of ${EVENT_CATEGORIES.join(', ')}.`,
        '- headlines: 0-3 short pt-BR world news lines related to the event. involved: nation ids involved.',
        '- Reply with ONE JSON object and nothing else: no markdown fences, no comments, no text before or after it.',
        '',
        'Effect vocabulary:',
        EFFECT_VOCABULARY,
        '',
        'JSON format (example, shortened narrative):',
        EVENT_EXAMPLE,
    ].join('\n');

    const crises = (state.crises || []).slice(0, 8).map((c) => `${c.id}: ${oneLine(c.title, 90)} [${c.severity}]`);
    const recentTitles = (state.decisions || []).slice(-5).map((d) => oneLine(d.eventTitle, 80));
    const roster = rosterText(state, relevantNationIds(state, { max: 40 }));
    const chat = clip(recentChat || '', 2500);

    const prompt = [
        'SITUATION REPORT (pt-BR, ground truth):',
        neutralize(sitrep || ''),
        '',
        'LAST MONTH (engine report):',
        reportText(state, report),
        '',
        'RECENT ROLE-PLAY CHAT (pt-BR, oldest first):',
        chat || '(no recent chat)',
        '',
        'NATION ROSTER (id = name). Use only these ids or PLAYER:',
        roster,
        '',
        'ACTIVE CRISES (crisisId: title [severity]):',
        crises.length ? crises.join('\n') : '(none)',
        '',
        `RECENT EVENTS (do not repeat): ${recentTitles.length ? recentTitles.join(' | ') : '(none)'}`,
        '',
        `Write the decision event for ${formatDate(state.date)} now. Output the JSON object only.`,
    ].join('\n');

    return { systemPrompt, prompt };
}

/**
 * Repair prompt for a second attempt.
 * @param {string} prompt Original user prompt.
 * @param {string|undefined} raw Previous model output.
 * @param {string[]} errors
 * @returns {string}
 */
export function buildRepairPrompt(prompt, raw, errors) {
    const prev = raw ? clip(String(raw), 1500) : '(no usable output)';
    return [
        prompt,
        '',
        'YOUR PREVIOUS ANSWER WAS REJECTED.',
        `Problems: ${(errors || []).filter(Boolean).map((e) => oneLine(e, 160)).join('; ') || 'invalid JSON'}`,
        'Previous answer (truncated):',
        prev,
        '',
        'Write the complete answer again as ONE valid JSON object that follows the format exactly. No markdown, no prose.',
    ].join('\n');
}

/* ----------------------------------------------------------------- arbiter */

function costText(def) {
    const parts = [`${Number(def.cost?.pc) || 0} PC`];
    for (const [k, v] of Object.entries(def.cost?.resources || {})) {
        if (Number(v)) parts.push(`${(RESOURCE_LABELS[k] || k).toLowerCase()} ${v}`);
    }
    return parts.join(' + ');
}

function availabilityText(av) {
    const reasons = (av.reasons || []).filter((r) => !/selecione um alvo/i.test(String(r))).slice(0, 2).map((r) => oneLine(r, 60));
    if (av.def.target === 'nation') return reasons.length ? `needs target; ${reasons.join('; ')}` : 'needs target';
    return av.available ? 'available' : `unavailable: ${reasons.join('; ') || 'blocked'}`;
}

/**
 * @param {any} state
 * @param {string} text Player message (pt-BR).
 * @param {import('../contract/events.js').ActionAvailability[]} availability
 * @returns {{systemPrompt: string, prompt: string}}
 */
export function buildArbiterPrompts(state, text, availability) {
    const p = playerInfo(state);
    const untargeted = availability.find((a) => a.def.target !== 'nation');
    const targeted = availability.find((a) => a.def.target === 'nation');
    const otherId = relevantNationIds(state, { max: 2 })[1] || 'ARG';
    const example = { orders: [] };
    if (untargeted) example.orders.push({ actionId: untargeted.def.id, targetId: '', quote: '<trecho da mensagem>' });
    if (targeted) example.orders.push({ actionId: targeted.def.id, targetId: otherId, quote: '<trecho da mensagem>' });

    const systemPrompt = [
        'You are the orders arbiter of a grand strategy game.',
        `The player is ${p.title} ${p.leader}, head of state of ${p.name} (id ${p.id}), role-playing in Brazilian Portuguese.`,
        'Decide whether the player\'s latest chat message gives concrete executive orders to the government, and map each order to ONE action of the catalog.',
        '',
        'Rules:',
        '- At most 3 orders, in the order they appear in the message.',
        '- actionId must be an id from the catalog, copied exactly.',
        `- If the action needs a target, targetId must be a nation id from the roster (never ${p.id}). If it does not, targetId must be "".`,
        '- Map clear orders even if the action is currently unavailable; the game will explain why it fails.',
        '- Return {"orders":[]} when the message is conversation, a question, a request for advice or analysis, a hypothetical ("e se..."), a threat or opinion without a command, out-of-character text, or anything that is not a direct order to act now.',
        '- Do not invent orders the player did not give. One order = one action; pick the most specific action.',
        '- quote: the exact fragment of the message (pt-BR) that contains the order.',
        '- Reply with ONE JSON object and nothing else.',
        '',
        `Format: ${JSON.stringify(example)}`,
        'No orders: {"orders":[]}',
    ].join('\n');

    // ~50 tokens per action: this prompt runs on every chat message in 'auto' mode.
    const catalog = availability
        .map((a) => {
            const kw = (a.def.keywords || []).slice(0, 5).map((k) => oneLine(k, 24)).join(', ');
            return `${a.def.id} | ${oneLine(a.def.name, 40)} | target=${a.def.target === 'nation' ? 'nation' : 'none'} | ${costText(a.def)} | ${availabilityText(a)} | ${oneLine(a.def.description, 90)}${kw ? ` | ${kw}` : ''}`;
        })
        .join('\n');
    const roster = rosterText(state, relevantNationIds(state, { max: 60, text }));

    const prompt = [
        'ACTION CATALOG (id | name | target | cost | status | description | keywords):',
        catalog,
        '',
        'NATION ROSTER (id = name):',
        roster,
        '',
        'PLAYER MESSAGE (pt-BR):',
        '"""',
        neutralize(String(text).slice(0, 2000)),
        '"""',
        '',
        'Output the JSON object only.',
    ].join('\n');
    return { systemPrompt, prompt };
}

/* ---------------------------------------------------------------- bulletin */

/**
 * Quiet prompt for the post-turn bulletin. Runs through generateQuietPrompt, so
 * the user's preset, character and the sitrep injection are in context.
 * @param {any} state
 * @param {{report: any, decision?: {eventTitle: string, optionLabel: string}}} input
 * @returns {string}
 */
export function buildBulletinPrompt(state, { report, decision }) {
    const p = playerInfo(state);
    const facts = [];
    for (const h of (report?.headlines || []).slice(0, 6)) facts.push(`- ${oneLine(h, 180)}`);
    for (const w of (report?.warUpdates || []).slice(0, 3)) facts.push(`- ${oneLine(w.summary, 180)}`);
    for (const id of (report?.capitulations || []).slice(0, 3)) facts.push(`- Capitulação: ${oneLine(state.nations[id]?.name || id, 40)}`);
    if (!facts.length) facts.push('- Um mês sem grandes manchetes; tensões seguem latentes.');
    const date = formatDate(report?.date || state.date);
    return [
        `[OOC instruction: pause the role-play for this one reply. Do not speak as any character.]`,
        `Write the "${NARRATOR_NAME}" — a short international news wire bulletin about the month that has just begun in the campaign (${date}).`,
        'Requirements:',
        '- Brazilian Portuguese (pt-BR), 80-150 words, one or two paragraphs of plain text.',
        '- Neutral journalistic tone of a world news agency: no dialogue, no role-play actions, no questions to the reader, no headings, no lists, no markdown.',
        `- Cover the facts below in order of importance; ${p.name} is the player's nation (head of state: ${p.title} ${p.leader}).`,
        decision ? `- Mention the government's decision: "${oneLine(decision.eventTitle, 100)}" → "${oneLine(decision.optionLabel, 100)}".` : '- Do not invent decisions by the government.',
        '- Do not invent numbers, casualties or events beyond these facts and the situation report.',
        'Facts:',
        ...facts,
        'Start directly with the bulletin text.',
    ].join('\n');
}
