/**
 * @file src/llm/llm.js
 * Module C factory: composes the situation report, the structured-output event
 * engine, the flavor narration, and the interceptor body into the LlmAPI that
 * the composition root (FEAT-006) consumes.
 *
 * The real interceptor global (globalThis.hoiGenerateInterceptor) is wired by
 * src/llm/interceptor.js at import time; this factory also exposes the body as
 * `interceptor` per the LlmAPI contract so the glue can reference it directly.
 *
 * @see src/contract/interfaces.js (LlmAPI typedef)
 */

import { MODULE_NAME, INTERCEPTOR_NAME } from '../contract/interfaces.js';
import { buildSituationReport } from './situationReport.js';
import { generateTurnEvent, buildFallbackEvent } from './eventEngine.js';
import { generateFlavorNarration } from './narration.js';
import { hoiGenerateInterceptor } from './interceptor.js';

/**
 * Create the LlmAPI.
 *
 * @param {{toast?: (msgPtBr: string) => void}} [deps] Optional injected deps.
 *        `toast` lets the glue route fallback notices through the UI's toast.
 * @returns {import('../contract/interfaces.js').LlmAPI & {
 *   generateFlavorNarration: typeof generateFlavorNarration,
 *   buildFallbackEvent: typeof buildFallbackEvent,
 *   MODULE_NAME: string,
 *   INTERCEPTOR_NAME: string,
 * }}
 */
export function createLlm(deps = {}) {
    const toast = deps && typeof deps.toast === 'function' ? deps.toast : undefined;

    return {
        /**
         * @param {import('../contract/worldState.js').WorldState} state
         * @param {{maxTokensBudget?: number}} [opts]
         * @returns {string}
         */
        buildSituationReport(state, opts) {
            return buildSituationReport(state, opts || {});
        },

        /**
         * @param {import('../contract/worldState.js').WorldState} state
         * @param {{retries?: number, toast?: Function}} [opts]
         * @returns {Promise<import('../contract/events.js').GameEvent>}
         */
        generateTurnEvent(state, opts) {
            return generateTurnEvent(state, { toast, ...(opts || {}) });
        },

        /**
         * @param {import('../contract/worldState.js').WorldState} state
         * @param {*} resolvedEvent
         * @returns {Promise<string>}
         */
        generateFlavorNarration(state, resolvedEvent) {
            return generateFlavorNarration(state, resolvedEvent);
        },

        /** Deterministic safe fallback event (exposed for tests/glue). */
        buildFallbackEvent,

        /**
         * The interceptor body (also wired to globalThis[INTERCEPTOR_NAME] by
         * the interceptor module at import time).
         * @param {Array} chat
         * @param {number} contextSize
         * @param {(b?: boolean) => void} abort
         * @param {string} type
         * @returns {Promise<void>}
         */
        interceptor(chat, contextSize, abort, type) {
            return hoiGenerateInterceptor(chat, contextSize, abort, type);
        },

        MODULE_NAME,
        INTERCEPTOR_NAME,
    };
}

export default createLlm;
