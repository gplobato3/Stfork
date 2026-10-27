/**
 * @file src/st/json.js
 * Tolerant JSON extraction for LLM output. Pure and node-safe.
 *
 * Handles: plain JSON, ```json fenced blocks, leading/trailing prose, reasoning
 * blocks (<think>…</think>, <thinking>, <reasoning>), trailing commas and
 * typographic quotes used as JSON delimiters.
 */

const REASONING_TAGS = ['think', 'thinking', 'reasoning', 'thought', 'reflection'];

/**
 * Remove reasoning blocks. An unterminated opening tag drops everything up to
 * the first '{' after it (the model ran out of tokens or the closing tag was
 * swallowed by a stop string).
 * @param {string} text
 * @returns {string}
 */
export function stripReasoning(text) {
    let out = String(text ?? '');
    for (const tag of REASONING_TAGS) {
        const closed = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
        out = out.replace(closed, '');
        const open = new RegExp(`<${tag}\\b[^>]*>`, 'i');
        const m = open.exec(out);
        if (m) {
            const rest = out.slice(m.index + m[0].length);
            const brace = rest.indexOf('{');
            out = out.slice(0, m.index) + (brace >= 0 ? rest.slice(brace) : '');
        }
        // Stray closing tag (opening tag was in the prefill / reasoning field).
        const strayClose = new RegExp(`^[\\s\\S]*?<\\/${tag}>`, 'i');
        out = out.replace(strayClose, '');
    }
    return out;
}

function tryParse(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false };
    }
}

/** Cheap repairs: smart quotes used as delimiters, trailing commas. */
function repair(text) {
    return text
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/,\s*([}\]])/g, '$1');
}

/** End index (inclusive) of the balanced block opening at `start`, or -1. String-aware. */
function blockEnd(text, start) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * Balanced {...} / [...] substrings. `nested=false`: top-level blocks only
 * (an example object before the real answer stays a separate candidate);
 * `nested=true`: every block, used when the outer object is broken.
 * @param {string} text
 * @param {boolean} nested
 * @returns {string[]}
 */
function balancedCandidates(text, nested) {
    const out = [];
    for (let start = 0; start < text.length && out.length < 16; start++) {
        if (text[start] !== '{' && text[start] !== '[') continue;
        const end = blockEnd(text, start);
        if (end < 0) continue;
        out.push(text.slice(start, end + 1));
        if (!nested) start = end;
    }
    return out;
}

/** Longest candidate that parses (as-is or repaired) to an object/array. */
function bestCandidate(candidates) {
    let best = null;
    for (const candidate of candidates) {
        if (!candidate || (best && candidate.length <= best.len)) continue;
        let p = tryParse(candidate);
        if (!(p.ok && p.value && typeof p.value === 'object')) p = tryParse(repair(candidate));
        if (p.ok && p.value && typeof p.value === 'object') best = { len: candidate.length, value: p.value };
    }
    return best ? { ok: true, value: best.value } : null;
}

/**
 * Parse an LLM response into a JSON value.
 * Objects already parsed by ST (ConnectionManager + json_schema returns an
 * object, custom-request.js:491) are returned as-is.
 * @param {any} input
 * @returns {{ok: true, value: any} | {ok: false, error: string}}
 */
export function parseJsonLoose(input) {
    if (input && typeof input === 'object') return { ok: true, value: input };
    if (typeof input !== 'string') return { ok: false, error: 'resposta vazia' };

    const text = stripReasoning(input.replace(/^\uFEFF/, '')).trim();
    if (!text) return { ok: false, error: 'resposta vazia' };

    const direct = tryParse(text);
    if (direct.ok) return direct;

    const fenced = [];
    const fence = /```(?:json|JSON|javascript|js)?\s*([\s\S]*?)```/g;
    let m;
    while ((m = fence.exec(text))) fenced.push(m[1].trim());
    // Unterminated fence (output cut at max tokens).
    const openFence = /```(?:json|JSON)?\s*([\s\S]*)$/.exec(text);
    if (openFence && !fenced.length) fenced.push(openFence[1].trim());

    const found = bestCandidate(fenced)
        || bestCandidate(fenced.flatMap((f) => balancedCandidates(f, false)))
        || bestCandidate(balancedCandidates(text, false))
        || bestCandidate(balancedCandidates(text, true));
    if (found) return found;
    const whole = tryParse(repair(text));
    if (whole.ok) return whole;
    return { ok: false, error: 'JSON inválido na resposta do modelo' };
}

/**
 * True for `{}` — what ST's extractJsonFromData returns when extraction fails
 * (script.js:6366 `JSON.stringify(result ?? {})`).
 * @param {any} value
 * @returns {boolean}
 */
export function isEmptyObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}
