/**
 * @file src/llm/interceptor.js
 * THE INTEGRATION KEYSTONE: the generate interceptor.
 *
 * manifest.json declares "generate_interceptor": "hoiGenerateInterceptor".
 * SillyTavern calls globalThis.hoiGenerateInterceptor(chat, contextSize, abort,
 * type) before every non-dry-run generation, giving extensions a chance to
 * MUTATE the chat array. We use it to splice a single, compact SITUATION REPORT
 * system note into the chat so the user's own preset/character-driven
 * generation is grounded in the live game state — WITHOUT replacing their
 * preset or character.
 *
 * Guarantees:
 *   - Only injects when a campaign is active for the current chat.
 *   - Idempotent: never injects twice (tagged + detected on re-entry).
 *   - Type-aware: skips generation types where a situation note is unwanted.
 *   - Budget-aware: sizes the report against contextSize.
 *   - NEVER throws: the whole body is wrapped in try/catch; on any error it
 *     returns without mutating the chat.
 *
 * World state is read DEFENSIVELY from ctx.chatMetadata[MODULE_NAME] (the shape
 * the engine persists; see MODULE_CONTRACT.md). We do NOT hard-import the
 * engine module so this file imports cleanly under node even if src/engine is
 * not present yet.
 */

import { getContext } from '../core/stContext.js';
import { MODULE_NAME } from '../contract/interfaces.js';
import { isWorldStateShape } from '../contract/worldState.js';
import { buildSituationReport } from './situationReport.js';

/** Display name used on the injected system note (and the idempotency marker). */
export const SITUATION_NOTE_NAME = 'SITUACAO (HOI)';

/**
 * Generation types during which we must NOT inject a situation note. The player
 * is not asking the world to react in these flows (e.g. rewording their own
 * message, continuing their own line, quiet/background prompts we drive
 * ourselves).
 * @type {ReadonlyArray<string>}
 */
const SKIP_TYPES = Object.freeze(['impersonate', 'continue', 'quiet']);

/**
 * The interceptor body. Wired to globalThis.hoiGenerateInterceptor at the
 * bottom of this module. Matches ST's (chat, contextSize, abort, type).
 *
 * @param {Array<object>} chat         The live chat array (mutated in place).
 * @param {number} contextSize         Token budget ST reports for this gen.
 * @param {(stop?: boolean) => void} abort  ST abort callback (unused here).
 * @param {string} type                Generation type ('normal','impersonate',…).
 * @returns {Promise<void>}
 */
export async function hoiGenerateInterceptor(chat, contextSize, abort, type) {
    try {
        if (!Array.isArray(chat)) return;

        // Skip generation types where a situation note is inappropriate.
        if (typeof type === 'string' && SKIP_TYPES.includes(type)) return;

        // Idempotency: never inject twice into the same chat array.
        if (chat.some(isSituationNote)) return;

        const worldState = loadActiveWorldState();
        if (!worldState) return; // no active campaign -> do nothing

        const report = buildSituationReport(worldState, {
            maxTokensBudget: budgetFromContextSize(contextSize),
        });
        if (!report || !report.trim()) return;

        const note = {
            is_user: false,
            is_system: true,
            name: SITUATION_NOTE_NAME,
            send_date: Date.now(),
            mes: report,
            extra: { hoi: true, type: 'situation_report' },
        };

        // Splice the note BEFORE the last message so it reads as fresh context
        // immediately preceding the user's latest turn, without replacing it.
        const insertAt = Math.max(0, chat.length - 1);
        chat.splice(insertAt, 0, note);
    } catch {
        // Never throw from an interceptor: a failure here must not block the
        // user's generation. Return having (possibly) not mutated the chat.
    }
}

/**
 * Detect our own previously-injected situation note (idempotency guard).
 * @param {*} msg
 * @returns {boolean}
 */
export function isSituationNote(msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.extra && msg.extra.hoi && msg.extra.type === 'situation_report') return true;
    return msg.name === SITUATION_NOTE_NAME;
}

/**
 * Load the active campaign's world state from chat metadata, defensively.
 * Returns null when there is no active, well-shaped campaign for this chat.
 * @returns {import('../contract/worldState.js').WorldState|null}
 */
export function loadActiveWorldState() {
    try {
        const ctx = getContext();
        const meta = ctx && ctx.chatMetadata;
        if (!meta || typeof meta !== 'object') return null;
        const saved = meta[MODULE_NAME];
        if (!saved || typeof saved !== 'object') return null;
        // The engine may store the world state directly, or wrapped under a
        // `state`/`worldState` field. Accept whichever is shaped correctly.
        const candidate = pickStateShape(saved);
        if (!candidate) return null;
        // A campaign is only "active" once a nation is chosen / past setup.
        if (!candidate.playerNationId) return null;
        return candidate;
    } catch {
        return null;
    }
}

/**
 * Return the first value that looks like a WorldState among the save object
 * itself and its common nested fields.
 * @param {object} saved
 * @returns {import('../contract/worldState.js').WorldState|null}
 */
function pickStateShape(saved) {
    if (isWorldStateShape(saved)) return saved;
    if (saved.state && isWorldStateShape(saved.state)) return saved.state;
    if (saved.worldState && isWorldStateShape(saved.worldState)) return saved.worldState;
    return null;
}

/**
 * Translate ST's contextSize (total token window) into a sensible token budget
 * for the situation note: a small fraction of the window, floored/capped so the
 * note stays compact and never dominates the prompt.
 * @param {number} contextSize
 * @returns {number}
 */
function budgetFromContextSize(contextSize) {
    const n = Number(contextSize);
    if (!Number.isFinite(n) || n <= 0) return 384;
    // ~6% of the window, clamped to [32, 1024] tokens.
    return Math.max(32, Math.min(1024, Math.round(n * 0.06)));
}

// Wire the global the manifest references. Assigning here (module load) is safe
// under node and in the browser; index.js (FEAT-006) imports this module during
// extension init so the global is present before ST fires a generation.
if (typeof globalThis !== 'undefined') {
    globalThis.hoiGenerateInterceptor = hoiGenerateInterceptor;
}
