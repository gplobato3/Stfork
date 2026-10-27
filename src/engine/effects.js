/**
 * @file src/engine/effects.js
 * Effect validation (normalizeEffect, shared with sanitizeEvent) and application
 * (applyEffectsInPlace). Unknown or invalid effects are skipped, never thrown.
 * Shapes: src/contract/events.js. Limits: EFFECT_LIMITS.
 */

import {
    BLOCS,
    BOUNDS,
    CRISIS_ACTIONS,
    CRISIS_SEVERITIES,
    EFFECT_LIMITS,
    EFFECT_TYPES,
    EVENT_CATEGORIES,
    NATION_STATUS,
    PACT_ACTIONS,
    PACT_TYPES,
    PEACE_TERMS,
    RESOURCE_KEYS,
    WAR_ACTIONS,
} from '../contract/constants.js';
import { BLOC_LABELS, PC_LABEL, RESOURCE_LABELS, SEVERITY_LABELS, resourceDeltaLine, signed } from '../contract/presentation.js';
import { clamp, clampTension } from '../contract/worldState.js';
import { addHeadline } from './collector.js';
import { deescalateCrisis, escalateCrisis, resolveCrisis, startCrisis } from './crises.js';
import { breakPacts, createPact } from './diplomacy.js';
import { cleanText, monthsLabel, textFor } from './text.js';
import { addRelation, addResource, isActive, nextId, pushLog, uniq, warBetween } from './util.js';
import { applyCeasefire, applyDeclare, applyFrontDelta, applyPeace } from './war.js';

/** Lowercase, accent-free, trimmed. */
export function fold(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

const RESOURCE_ALIASES = (() => {
    const m = new Map();
    for (const k of RESOURCE_KEYS) {
        m.set(fold(k), k);
        m.set(fold(RESOURCE_LABELS[k]), k);
    }
    m.set('militar', 'military');
    m.set('forca', 'military');
    m.set('apoio a guerra', 'warSupport');
    m.set('war_support', 'warSupport');
    m.set('economia', 'economy');
    m.set('populacao', 'manpower');
    return m;
})();

/** Resource key from a key or pt-BR label ("Economia" -> "economy"), else null. */
export function resourceKeyOf(v) {
    if (typeof v !== 'string') return null;
    return RESOURCE_ALIASES.get(fold(v)) || null;
}

const BLOC_ALIASES = (() => {
    const m = new Map();
    for (const b of BLOCS) {
        m.set(fold(b), b);
        m.set(fold(BLOC_LABELS[b]), b);
    }
    m.set('ue', 'EU');
    m.set('non-aligned', 'NON_ALIGNED');
    m.set('nao alinhados', 'NON_ALIGNED');
    return m;
})();

function blocOf(v) {
    if (typeof v !== 'string') return null;
    return BLOC_ALIASES.get(fold(v)) || null;
}

const nameIndexCache = new WeakMap();
function nameIndex(state) {
    let idx = nameIndexCache.get(state.nations);
    if (!idx) {
        idx = new Map();
        for (const id of Object.keys(state.nations)) {
            const n = state.nations[id];
            if (n && n.name) idx.set(fold(n.name), id);
        }
        nameIndexCache.set(state.nations, idx);
    }
    return idx;
}

/**
 * Resolves a nation reference: placeholder, id (case-insensitive) or pt-BR name.
 * @param {*} value
 * @param {Object} state
 * @param {{actorId?:string, targetId?:string}} ctx
 * @returns {?string}
 */
export function resolveNationRef(value, state, ctx = {}) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (!v) return null;
    const up = v.toUpperCase();
    if (up === 'SELF') return ctx.actorId && state.nations[ctx.actorId] ? ctx.actorId : null;
    if (up === 'TARGET') return ctx.targetId && state.nations[ctx.targetId] ? ctx.targetId : null;
    if (up === 'PLAYER') return state.player && state.nations[state.player.nationId] ? state.player.nationId : null;
    if (state.nations[up]) return up;
    if (state.nations[v]) return v;
    return nameIndex(state).get(fold(v)) || null;
}

function lim(v, max) {
    return Math.round(clamp(v, -max, max));
}

const FLAG_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/;

/**
 * Validates and normalizes one effect against the state. Placeholders are resolved
 * (SELF/TARGET via ctx, PLAYER via state.player), deltas clamped to EFFECT_LIMITS,
 * unknown fields dropped.
 * @returns {{effect?: import('../contract/events.js').Effect, error?: string}}
 */
export function normalizeEffect(raw, state, ctx = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Efeito malformado.' };
    const type = typeof raw.type === 'string' ? raw.type.trim() : '';
    if (!EFFECT_TYPES.includes(type)) return { error: `Tipo de efeito desconhecido: "${cleanText(String(raw.type), 30)}".` };
    const out = { type };
    const nat = (field) => resolveNationRef(raw[field], state, ctx);
    const delta = (max) => {
        const n = Number(raw.delta);
        if (!Number.isFinite(n)) return null;
        const d = lim(n, max);
        return d === 0 ? null : d;
    };
    const pair = () => {
        const a = nat('target');
        const b = nat('targetB');
        if (!a || !b) return { error: `Efeito "${type}" com nação desconhecida.` };
        if (a === b) return { error: `Efeito "${type}" com a mesma nação nos dois lados.` };
        out.target = a;
        out.targetB = b;
        return null;
    };
    switch (type) {
        case 'resource': {
            const target = nat('target');
            if (!target) return { error: 'Efeito "resource" com nação desconhecida.' };
            const key = resourceKeyOf(raw.resource);
            if (!key) return { error: 'Efeito "resource" com recurso desconhecido.' };
            const d = delta(EFFECT_LIMITS.resource);
            if (d === null) return { error: 'Efeito "resource" sem variação válida.' };
            Object.assign(out, { target, resource: key, delta: d });
            break;
        }
        case 'relation': {
            const e = pair();
            if (e) return e;
            const d = delta(EFFECT_LIMITS.relation);
            if (d === null) return { error: 'Efeito "relation" sem variação válida.' };
            out.delta = d;
            break;
        }
        case 'tension': {
            const d = delta(EFFECT_LIMITS.tension);
            if (d === null) return { error: 'Efeito "tension" sem variação válida.' };
            out.delta = d;
            break;
        }
        case 'pc': {
            const target = nat('target');
            if (!target) return { error: 'Efeito "pc" com nação desconhecida.' };
            const d = delta(EFFECT_LIMITS.pc);
            if (d === null) return { error: 'Efeito "pc" sem variação válida.' };
            Object.assign(out, { target, delta: d });
            break;
        }
        case 'modifier': {
            const target = nat('target');
            if (!target) return { error: 'Efeito "modifier" com nação desconhecida.' };
            const perTurn = {};
            const src = raw.perTurn && typeof raw.perTurn === 'object' && !Array.isArray(raw.perTurn) ? raw.perTurn : {};
            for (const [k, v] of Object.entries(src)) {
                const key = resourceKeyOf(k);
                const n = Number(v);
                if (!key || !Number.isFinite(n)) continue;
                const d = lim(n, EFFECT_LIMITS.modifierPerTurn);
                if (d !== 0) perTurn[key] = d;
            }
            if (!Object.keys(perTurn).length) return { error: 'Efeito "modifier" sem variação por turno.' };
            const turnsN = Number(raw.turns);
            const turns = Number.isFinite(turnsN) ? Math.round(clamp(turnsN, 1, EFFECT_LIMITS.modifierTurns)) : 6;
            Object.assign(out, { target, label: cleanText(raw.label, 60) || 'Modificador temporário', perTurn, turns });
            break;
        }
        case 'crisis': {
            const action = typeof raw.action === 'string' ? raw.action : '';
            if (!CRISIS_ACTIONS.includes(action)) return { error: 'Efeito "crisis" com ação inválida.' };
            out.action = action;
            if (action === 'start') {
                const title = cleanText(raw.title, 100);
                if (!title) return { error: 'Crise sem título.' };
                out.title = title;
                out.description = cleanText(raw.description, 400);
                out.severity = CRISIS_SEVERITIES.includes(raw.severity) ? raw.severity : 'medium';
                const inv = Array.isArray(raw.involved) ? raw.involved : [];
                out.involved = uniq(inv.map((x) => resolveNationRef(x, state, ctx)).filter(Boolean)).slice(0, 8);
                if (EVENT_CATEGORIES.includes(raw.category)) out.category = raw.category;
            } else {
                const id = typeof raw.crisisId === 'string' ? raw.crisisId.trim() : '';
                const crisis = state.crises.find((c) => c.id === id) || state.crises.find((c) => fold(c.title) === fold(id));
                if (!crisis) return { error: 'Efeito "crisis" com crise desconhecida.' };
                out.crisisId = crisis.id;
            }
            break;
        }
        case 'pact': {
            const action = typeof raw.action === 'string' ? raw.action : '';
            if (!PACT_ACTIONS.includes(action)) return { error: 'Efeito "pact" com ação inválida.' };
            if (!PACT_TYPES.includes(raw.pactType)) return { error: 'Efeito "pact" com tipo inválido.' };
            const e = pair();
            if (e) return e;
            out.action = action;
            out.pactType = raw.pactType;
            const label = cleanText(raw.label, 60);
            if (label) out.label = label;
            break;
        }
        case 'war': {
            const action = typeof raw.action === 'string' ? raw.action : '';
            if (!WAR_ACTIONS.includes(action)) return { error: 'Efeito "war" com ação inválida.' };
            const e = pair();
            if (e) return e;
            out.action = action;
            if (action === 'peace') out.terms = PEACE_TERMS.includes(raw.terms) ? raw.terms : 'whitePeace';
            const label = cleanText(raw.label, 60);
            if (label && action === 'declare') out.label = label;
            break;
        }
        case 'front': {
            const e = pair();
            if (e) return e;
            const d = delta(EFFECT_LIMITS.front);
            if (d === null) return { error: 'Efeito "front" sem variação válida.' };
            out.delta = d;
            break;
        }
        case 'bloc': {
            const target = nat('target');
            const bloc = blocOf(raw.bloc);
            if (!target || !bloc) return { error: 'Efeito "bloc" inválido.' };
            Object.assign(out, { target, bloc });
            break;
        }
        case 'flag': {
            const key = typeof raw.key === 'string' ? raw.key.trim() : '';
            if (!FLAG_KEY.test(key)) return { error: 'Efeito "flag" com chave inválida.' };
            let value = raw.value === undefined ? true : raw.value;
            if (typeof value === 'string') value = cleanText(value, 200);
            else if (typeof value === 'number') {
                if (!Number.isFinite(value)) return { error: 'Efeito "flag" com valor inválido.' };
            } else if (typeof value !== 'boolean' && value !== null) return { error: 'Efeito "flag" com valor inválido.' };
            Object.assign(out, { key, value });
            break;
        }
        case 'news': {
            const text = cleanText(raw.text, 200);
            if (!text) return { error: 'Efeito "news" sem texto.' };
            out.text = text;
            break;
        }
        default:
            return { error: 'Tipo de efeito não suportado.' };
    }
    const note = cleanText(raw.note, 200);
    if (note) out.note = note;
    return { effect: out };
}

function applyOne(state, e, persp, ctx, tc) {
    const t = textFor(state);
    switch (e.type) {
        case 'resource': {
            const n = state.nations[e.target];
            if (!n || n.status === NATION_STATUS.ANNEXED) return null;
            addResource(n, e.resource, e.delta);
            return e.target === persp ? resourceDeltaLine(e.resource, e.delta) : `${RESOURCE_LABELS[e.resource]} ${t.de(e.target)} ${signed(e.delta)}`;
        }
        case 'relation': {
            addRelation(state, e.target, e.targetB, e.delta);
            if (e.target === persp) return `Relação ${t.com(e.targetB)} ${signed(e.delta)}`;
            if (e.targetB === persp) return `Relação ${t.com(e.target)} ${signed(e.delta)}`;
            return `Relação ${t.n(e.target)}–${t.n(e.targetB)} ${signed(e.delta)}`;
        }
        case 'tension':
            state.globalTension = clampTension(state.globalTension + e.delta);
            return `Tensão global ${signed(e.delta)}`;
        case 'pc': {
            const n = state.nations[e.target];
            if (!n || n.status === NATION_STATUS.ANNEXED) return null;
            n.pc = Math.round(clamp((n.pc || 0) + e.delta, 0, BOUNDS.PC_MAX));
            return e.target === persp ? `${PC_LABEL} ${signed(e.delta)}` : `${PC_LABEL} ${t.de(e.target)} ${signed(e.delta)}`;
        }
        case 'modifier': {
            const n = state.nations[e.target];
            if (!n || n.status === NATION_STATUS.ANNEXED) return null;
            const mod = { id: nextId(state, 'mod'), nationId: e.target, label: e.label, perTurn: { ...e.perTurn }, turnsLeft: e.turns };
            if (ctx.source) mod.source = ctx.source;
            state.modifiers.push(mod);
            const parts = Object.entries(e.perTurn).map(([k, v]) => `${RESOURCE_LABELS[k]} ${signed(v)}/mês`).join(', ');
            const who = e.target === persp ? '' : ` (${t.n(e.target)})`;
            return `${e.label}${who}: ${parts} por ${monthsLabel(e.turns)}`;
        }
        case 'crisis': {
            if (e.action === 'start') {
                const c = startCrisis(state, { title: e.title, description: e.description, severity: e.severity, involved: e.involved, category: e.category }, tc);
                return `Nova crise: ${c.title}`;
            }
            const crisis = state.crises.find((c) => c.id === e.crisisId);
            if (!crisis) return null;
            if (e.action === 'escalate') return escalateCrisis(state, crisis, tc) ? `Crise agravada: ${crisis.title} (${SEVERITY_LABELS[crisis.severity]})` : null;
            if (e.action === 'deescalate') {
                deescalateCrisis(state, crisis, tc);
                return state.crises.includes(crisis) ? `Crise atenuada: ${crisis.title} (${SEVERITY_LABELS[crisis.severity]})` : `Crise encerrada: ${crisis.title}`;
            }
            return resolveCrisis(state, crisis, tc) ? `Crise encerrada: ${crisis.title}` : null;
        }
        case 'pact': {
            if (e.action === 'create') {
                if (!isActive(state.nations[e.target]) || !isActive(state.nations[e.targetB])) return null;
                if (warBetween(state, e.target, e.targetB)) return null;
                const p = createPact(state, e.pactType, e.target, e.targetB, e.label);
                return p ? `Pacto firmado: ${p.name}` : null;
            }
            const names = breakPacts(state, e.pactType, e.target, e.targetB);
            return names.length ? `Pacto rompido: ${names.join(', ')}` : null;
        }
        case 'war': {
            let r;
            if (e.action === 'declare') r = applyDeclare(state, e.target, e.targetB, e.label, tc);
            else if (e.action === 'ceasefire') r = applyCeasefire(state, e.target, e.targetB, tc);
            else r = applyPeace(state, e.target, e.targetB, e.terms, tc);
            return r.ok ? r.text : null;
        }
        case 'front': {
            const r = applyFrontDelta(state, e.target, e.targetB, e.delta, tc);
            return r.ok ? r.text : null;
        }
        case 'bloc': {
            const n = state.nations[e.target];
            if (!n || n.bloc === e.bloc) return null;
            n.bloc = e.bloc;
            return `${t.n(e.target)} ${t.v(e.target, 'passa', 'passam')} ao bloco ${BLOC_LABELS[e.bloc]}`;
        }
        case 'flag':
            if (!state.flags || typeof state.flags !== 'object') state.flags = {};
            state.flags[e.key] = e.value;
            return null;
        case 'news':
            addHeadline(tc, e.text, 4, 'world', []);
            return null;
        default:
            return null;
    }
}

/**
 * Validates + applies effects on a MUTABLE state. Never throws.
 * @param {Object} state working copy
 * @param {Array} effects
 * @param {{actorId?:string, targetId?:string, source?:string}} [ctx] SELF/TARGET resolution;
 *        detail lines are phrased from ctx.actorId's perspective (default: the player).
 * @param {ReturnType<import('./collector.js').createCollector>} [tc]
 * @returns {string[]} pt-BR detail lines
 */
export function applyEffectsInPlace(state, effects, ctx = {}, tc = null) {
    const details = [];
    if (!Array.isArray(effects)) return details;
    const persp = ctx.actorId || (state.player && state.player.nationId);
    for (const raw of effects) {
        try {
            const { effect } = normalizeEffect(raw, state, ctx);
            if (!effect) continue;
            const line = applyOne(state, effect, persp, ctx, tc);
            if (line) details.push(line);
            if (effect.note) pushLog(state, 'event', effect.note);
        } catch {
            // invalid effect: skipped by contract
        }
    }
    return details;
}
