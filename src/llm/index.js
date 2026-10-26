/**
 * @file src/llm/index.js
 * LlmAPI: decision events, orders arbiter, bulletins and the sitrep.
 * Never throws: every failure resolves to a fallback / empty result.
 * All SillyTavern access goes through the injected StAPI.
 */

import { buildSitrep as buildSitrepPure } from './sitrep.js';
import { EVENT_SCHEMA, ORDERS_SCHEMA } from './schemas.js';
import { buildEventPrompts, buildRepairPrompt, buildArbiterPrompts, buildBulletinPrompt } from './prompts.js';
import { buildFallbackEvent } from './fallback.js';
import { stripReasoning } from '../st/json.js';

export { buildSitrepPure as buildSitrep };

export const MAX_ORDERS = 3;
const ARBITER_MAX_TOKENS = 400;
const BULLETIN_MIN_CHARS = 40;
const BULLETIN_MAX_CHARS = 1200;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Validate the arbiter output against the catalog and the roster.
 * @param {any} value Parsed model output.
 * @param {{state: any, availability: import('../contract/events.js').ActionAvailability[], text: string}} env
 * @returns {Array<{actionId: string, targetId: ?string, quote: string}>}
 */
export function validateOrders(value, { state, availability, text }) {
    const list = value && Array.isArray(value.orders) ? value.orders : [];
    const defs = new Map(availability.map((a) => [a.def.id, a.def]));
    const playerId = state.player.nationId;
    const byName = new Map();
    for (const n of Object.values(state.nations || {})) if (n?.name) byName.set(norm(n.name), n.id);

    const resolveTarget = (raw) => {
        const s = String(raw ?? '').trim();
        if (!s) return null;
        const up = s.toUpperCase();
        if (state.nations?.[up]) return up;
        return byName.get(norm(s)) || null;
    };

    const out = [];
    const seen = new Set();
    for (const o of list) {
        if (out.length >= MAX_ORDERS) break;
        if (!o || typeof o !== 'object') continue;
        const actionId = String(o.actionId ?? '').trim();
        const def = defs.get(actionId);
        if (!def) continue;
        let targetId = null;
        if (def.target === 'nation') {
            targetId = resolveTarget(o.targetId);
            if (!targetId || targetId === playerId) continue;
            const n = state.nations[targetId];
            if (!n || n.status === 'annexed') continue;
        }
        const key = `${actionId}|${targetId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let quote = String(o.quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!quote || /^<.*>$/.test(quote)) quote = String(text).replace(/\s+/g, ' ').trim().slice(0, 120); // empty or the prompt's placeholder echoed back
        out.push({ actionId, targetId, quote });
    }
    return out;
}

/** Strip reasoning, labels, fences and wrapping quotes from a bulletin. */
export function cleanBulletin(text) {
    let s = stripReasoning(String(text ?? '')).trim();
    s = s.replace(/^```[a-z]*\s*|```$/gi, '').trim();
    s = s.replace(/^\s*(?:\*\*|__|#+\s*)?\s*boletim internacional\s*[:\-—–]?\s*(?:\*\*|__)?\s*[:\-—–]?\s*/i, '').trim();
    if (/^["“].*["”]$/s.test(s)) s = s.slice(1, -1).trim();
    s = s.replace(/\n{3,}/g, '\n\n');
    if (s.length > BULLETIN_MAX_CHARS) {
        const cut = s.slice(0, BULLETIN_MAX_CHARS);
        const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
        s = (end > BULLETIN_MAX_CHARS / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`).trim();
    }
    return s.length >= BULLETIN_MIN_CHARS ? s : '';
}

/**
 * @param {{st: import('../contract/interfaces.js').StAPI, engine: import('../contract/interfaces.js').EngineAPI}} deps
 * @returns {import('../contract/interfaces.js').LlmAPI}
 */
export function createLlm({ st, engine }) {
    if (!st || !engine) throw new TypeError('createLlm: deps.st and deps.engine are required');

    const settings = () => {
        try {
            return st.getSettings();
        } catch {
            return { llmEvents: true, eventMaxTokens: 1200 };
        }
    };

    function sanitize(value, state) {
        let candidate = value;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate.options) && candidate.event && typeof candidate.event === 'object') {
            candidate = candidate.event; // some models wrap the object once
        }
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return { ok: false, value: null, errors: ['a resposta não é um objeto JSON'] };
        }
        try {
            const res = engine.sanitizeEvent({ ...candidate, source: 'llm', turn: state.turn }, state);
            if (!res || !res.ok || !res.value) return { ok: false, value: null, errors: (res && res.errors) || ['evento inválido'] };
            // sanitizeEvent accepts an event once it has 2 labelled options; also require
            // a narrative and at least 2 options whose effects survived the gate, otherwise
            // the decision is meaningless and the repair retry is worth it.
            const withEffects = (res.value.options || []).filter((o) => Array.isArray(o.effects) && o.effects.length > 0).length;
            const quality = [];
            if (!String(res.value.narrative || '').trim()) quality.push('narrative is empty');
            if (withEffects < 2) quality.push('fewer than 2 options with valid effects (check the effect vocabulary and nation ids)');
            if (quality.length) return { ok: false, value: null, errors: [...quality, ...(res.errors || [])].slice(0, 8) };
            return { ok: true, value: res.value, errors: [] };
        } catch (error) {
            return { ok: false, value: null, errors: [String(error?.message || error)] };
        }
    }

    function fallbackEvent(state, report) {
        const ev = buildFallbackEvent(state, report);
        try {
            const res = engine.sanitizeEvent(ev, state);
            if (res && res.ok && res.value) return { ...res.value, source: 'fallback' };
        } catch (error) {
            console.warn('[HOI] sanitizeEvent rejected the fallback event', error);
        }
        return ev;
    }

    async function generateTurnEvent(state, ctx = {}) {
        const report = ctx?.report;
        try {
            if (!settings().llmEvents) return fallbackEvent(state, report);
            const recentChat = typeof ctx?.recentChat === 'string' ? ctx.recentChat : safeRecentChat();
            const sitrep = buildSitrepPure(state, { detail: 'full', budgetTokens: 900 });
            const { systemPrompt, prompt } = buildEventPrompts(state, { sitrep, report, recentChat });
            const maxTokens = settings().eventMaxTokens || 1200;

            const first = await st.generateStructured({ systemPrompt, prompt, schemaName: 'hoi_event', schema: EVENT_SCHEMA, maxTokens });
            let errors;
            if (first.ok) {
                const s = sanitize(first.value, state);
                if (s.ok) return s.value;
                errors = s.errors;
            } else {
                errors = [first.error || 'falha na geração'];
            }

            // One repair retry. When the first call produced no usable JSON the
            // structured-output request itself may be the problem (unsupported
            // provider, '{}' from ST), so retry prompt-only.
            const second = await st.generateStructured({
                systemPrompt,
                prompt: buildRepairPrompt(prompt, first.raw, errors),
                schemaName: 'hoi_event',
                schema: first.ok ? EVENT_SCHEMA : null,
                maxTokens,
            });
            if (second.ok) {
                const s = sanitize(second.value, state);
                if (s.ok) return s.value;
                errors = s.errors;
            } else {
                errors = [second.error || 'falha na geração'];
            }
            console.warn('[HOI] LLM event failed, using fallback:', errors);
        } catch (error) {
            console.warn('[HOI] generateTurnEvent failed, using fallback', error);
        }
        try {
            return fallbackEvent(state, report);
        } catch (error) {
            console.error('[HOI] fallback event failed', error);
            return {
                id: `fallback-${state?.turn ?? 0}-min`,
                source: 'fallback',
                category: 'politics',
                title: 'Reunião do gabinete',
                narrative: 'O gabinete se reúne para definir as prioridades do mês.',
                headlines: [],
                involved: [],
                options: [
                    { label: 'Priorizar a economia', rationale: 'Mais crescimento.', effects: [{ type: 'resource', target: 'PLAYER', resource: 'economy', delta: 2 }] },
                    { label: 'Priorizar a defesa', rationale: 'Forças armadas mais fortes.', effects: [{ type: 'resource', target: 'PLAYER', resource: 'military', delta: 2 }] },
                ],
                turn: state?.turn ?? 0,
            };
        }
    }

    function safeRecentChat() {
        try {
            return st.recentChatText(8) || '';
        } catch {
            return '';
        }
    }

    async function interpretOrders(state, text) {
        const message = String(text ?? '').trim();
        if (!state || message.length < 4 || !/\p{L}/u.test(message)) return { orders: [] };
        try {
            const availability = (engine.getAvailableActions(state, state.player.nationId, null) || []).filter((a) => a && a.def && a.def.id);
            if (!availability.length) return { orders: [], error: 'Catálogo de ações indisponível.' };
            const { systemPrompt, prompt } = buildArbiterPrompts(state, message, availability);
            let res = await st.generateStructured({ systemPrompt, prompt, schemaName: 'hoi_orders', schema: ORDERS_SCHEMA, maxTokens: ARBITER_MAX_TOKENS });
            if (!res.ok) {
                res = await st.generateStructured({
                    systemPrompt,
                    prompt: buildRepairPrompt(prompt, res.raw, [res.error]),
                    schemaName: 'hoi_orders',
                    schema: null,
                    maxTokens: ARBITER_MAX_TOKENS,
                });
            }
            if (!res.ok) return { orders: [], error: `Não foi possível interpretar a ordem: ${res.error || 'resposta inválida'}` };
            if (!res.value || !Array.isArray(res.value.orders)) return { orders: [], error: 'Resposta do árbitro sem a lista "orders".' };
            return { orders: validateOrders(res.value, { state, availability, text: message }) };
        } catch (error) {
            return { orders: [], error: `Não foi possível interpretar a ordem: ${error?.message || error}` };
        }
    }

    async function writeBulletin(state, ctx = {}) {
        try {
            if (!state) return '';
            const prompt = buildBulletinPrompt(state, { report: ctx?.report, decision: ctx?.decision });
            return cleanBulletin(await st.generateQuiet(prompt));
        } catch (error) {
            console.warn('[HOI] writeBulletin failed', error);
            return '';
        }
    }

    function buildSitrep(state, opts) {
        try {
            return buildSitrepPure(state, opts || {});
        } catch (error) {
            console.warn('[HOI] buildSitrep failed', error);
            return '';
        }
    }

    return { generateTurnEvent, interpretOrders, writeBulletin, buildSitrep };
}
