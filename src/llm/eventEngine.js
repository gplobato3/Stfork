/**
 * @file src/llm/eventEngine.js
 * The per-turn event engine: asks the LLM (via ST generateRaw + structured
 * output) for ONE GameEvent as JSON, validates it against the shared contract,
 * retries ONCE with a repair prompt on failure, and finally falls back to a
 * safe deterministic local event so the game loop never dies.
 *
 * generateTurnEvent NEVER throws. On fallback it surfaces a pt-BR toast.
 *
 * Prompt scaffolding is English; the produced narrative/labels are pt-BR.
 */

import { getCoreFn, getContext } from '../core/stContext.js';
import { EVENT_SCHEMA, validateEvent } from '../contract/schemas.js';
import { OPTION_COUNT } from '../contract/events.js';
import { buildSystemPrompt, buildUserPrompt, buildRepairPrompt } from './prompts.js';

/**
 * Generate (or synthesize) the next turn's GameEvent.
 *
 * Flow: generateRaw(structured) -> validateEvent -> on failure, repair retry
 * once -> on still-failure, deterministic safe fallback + toast.
 *
 * @param {import('../contract/worldState.js').WorldState} worldState
 * @param {{retries?: number, toast?: (msg: string) => void}} [opts]
 * @returns {Promise<import('../contract/events.js').GameEvent>} always a valid event
 */
export async function generateTurnEvent(worldState, opts = {}) {
    const systemPrompt = safe(() => buildSystemPrompt(worldState), '');
    const userPrompt = safe(() => buildUserPrompt(worldState), '');

    // First attempt.
    let lastErrors = [];
    let lastRaw = '';
    try {
        const raw = await callGenerateRaw({ systemPrompt, prompt: userPrompt });
        lastRaw = stringifyRaw(raw);
        const res = validateEvent(extractJson(raw));
        if (res.ok) return res.value;
        lastErrors = res.errors;
    } catch (e) {
        lastErrors = [`generation error: ${errMsg(e)}`];
    }

    // Single repair retry.
    try {
        const repairPrompt = buildRepairPrompt(lastErrors, lastRaw);
        const prompt = userPrompt + '\n\n' + repairPrompt;
        const raw = await callGenerateRaw({ systemPrompt, prompt, prefill: '{' });
        const res = validateEvent(extractJson(raw));
        if (res.ok) return res.value;
        lastErrors = res.errors;
    } catch (e) {
        lastErrors = [`repair generation error: ${errMsg(e)}`];
    }

    // Deterministic safe fallback — the game loop must continue.
    const toast = pickToast(opts);
    try {
        toast('O conselho não chegou a um consenso; apresentando uma decisão de rotina.');
    } catch {
        /* toast must never break the engine */
    }
    return buildFallbackEvent(worldState);
}

/**
 * Call ST generateRaw with EVENT_SCHEMA structured output, resolved at call
 * time so test mocks installed on the context take effect. Passes the JSON
 * schema under several common field names so whichever ST build we run against
 * picks it up; unknown fields are ignored by generateRaw.
 *
 * @param {{systemPrompt:string, prompt:string, prefill?:string}} args
 * @returns {Promise<*>}
 */
async function callGenerateRaw(args) {
    const generateRaw = getCoreFn('generateRaw');
    return generateRaw({
        systemPrompt: args.systemPrompt,
        prompt: args.prompt,
        prefill: args.prefill || '',
        // Structured-output hints. ST forwards a JSON schema to capable backends.
        jsonSchema: EVENT_SCHEMA,
        schema: EVENT_SCHEMA,
    });
}

/**
 * Normalize whatever generateRaw returned into a value validateEvent accepts
 * (object or JSON string). ST generateRaw typically resolves to a string; some
 * mocks/backends resolve to an object or {text}/{content} wrapper.
 * @param {*} raw
 * @returns {*}
 */
function extractJson(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object') {
        // Common wrapper shapes.
        if (typeof raw.text === 'string') return stripFences(raw.text);
        if (typeof raw.content === 'string') return stripFences(raw.content);
        return raw; // already a parsed object
    }
    if (typeof raw === 'string') return stripFences(raw);
    return raw;
}

/**
 * Strip markdown code fences and surrounding prose, returning the substring
 * from the first `{` to the last `}` when present. validateEvent will JSON.parse.
 * @param {string} s
 * @returns {string}
 */
function stripFences(s) {
    let text = String(s).trim();
    // Remove ```json ... ``` fences if the model added them.
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) text = fence[1].trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
        return text.slice(first, last + 1);
    }
    return text;
}

/**
 * @param {*} raw
 * @returns {string}
 */
function stringifyRaw(raw) {
    if (typeof raw === 'string') return raw;
    try {
        return JSON.stringify(raw);
    } catch {
        return String(raw);
    }
}

/**
 * Build a deterministic, schema-valid, low-stakes decision so the game never
 * stalls when the model misbehaves. All pt-BR, no risky effects, targets only
 * the player nation (always a real id when a campaign is active).
 *
 * @param {import('../contract/worldState.js').WorldState} worldState
 * @returns {import('../contract/events.js').GameEvent}
 */
export function buildFallbackEvent(worldState) {
    const pid = worldState && worldState.playerNationId;
    const nation = pid && worldState.nations ? worldState.nations[pid] : null;
    const nationName = (nation && nation.name) || 'sua nação';

    /** @type {import('../contract/events.js').Option[]} */
    const options = [
        {
            id: 'opt_routine_internal',
            label: 'Priorizar assuntos internos',
            rationale: 'Um dia tranquilo no gabinete; foco na administração.',
            effects: pid
                ? [{ type: 'resource', target: pid, resource: 'stability', delta: 1, note: 'Gestão de rotina.' }]
                : [],
        },
        {
            id: 'opt_routine_diplomacy',
            label: 'Fazer contatos diplomáticos de rotina',
            rationale: 'Manter os canais abertos sem grandes compromissos.',
            effects: [{ type: 'tension', delta: -1, note: 'Diplomacia discreta.' }],
        },
    ];

    // Ensure we always satisfy OPTION_COUNT.MIN.
    while (options.length < OPTION_COUNT.MIN) {
        options.push({
            id: `opt_wait_${options.length}`,
            label: 'Aguardar os acontecimentos',
            rationale: 'Observar antes de agir.',
            effects: [],
        });
    }

    return {
        id: `evt-fallback-${turnOf(worldState)}`,
        title: 'Expediente de Governo',
        narrative:
            `Um dia relativamente calmo no comando de ${nationName}. ` +
            'Os assessores apresentam decisões administrativas de baixo risco enquanto ' +
            'o cenário internacional permanece estável por ora.',
        context: 'Evento de contingência gerado localmente (o modelo não retornou um evento válido).',
        options: options.slice(0, OPTION_COUNT.MAX),
        tensionDelta: 0,
    };
}

/* ----------------------------- small helpers ------------------------------ */

/**
 * Resolve a toast function: caller-provided, else ST context's toast surface,
 * else a no-op. Never throws.
 * @param {{toast?: Function}} opts
 * @returns {(msg: string) => void}
 */
function pickToast(opts) {
    if (opts && typeof opts.toast === 'function') return opts.toast;
    try {
        const ctx = getContext();
        if (ctx && ctx.toastr && typeof ctx.toastr.warning === 'function') {
            return (msg) => ctx.toastr.warning(msg);
        }
    } catch {
        /* ignore */
    }
    return () => {};
}

/**
 * @param {import('../contract/worldState.js').WorldState} ws
 * @returns {string|number}
 */
function turnOf(ws) {
    return ws && Number.isFinite(ws.turn) ? ws.turn : Date.now().toString(36);
}

/**
 * Run a thunk, returning a fallback if it throws.
 * @template T
 * @param {() => T} fn
 * @param {T} fallback
 * @returns {T}
 */
function safe(fn, fallback) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

/**
 * @param {*} e
 * @returns {string}
 */
function errMsg(e) {
    return String((e && e.message) || e);
}
