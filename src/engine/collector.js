/**
 * @file src/engine/collector.js
 * Accumulates headlines, engine events and report fragments while rules run.
 * endTurn turns it into a TurnReport; executeAction / resolvePendingEvent flush
 * it straight into state.news / state.eventQueue.
 */

import { pushNews } from './util.js';

/** Max engine/LLM events kept in state.eventQueue (oldest dropped first). */
export const EVENT_QUEUE_CAP = 10;

/** Max headlines per turn report. */
export const HEADLINES_PER_TURN = 8;

/** Empty collector for one engine operation (turn, action or decision). */
export function createCollector() {
    return {
        /** @type {Array<{text:string, priority:number, kind:string, nations:string[], seq:number}>} */
        headlines: [],
        /** @type {import('../contract/events.js').GameEvent[]} */
        events: [],
        warUpdates: [],
        capitulations: [],
        newCrises: [],
        resolvedCrises: [],
        aiActions: [],
    };
}

/**
 * @param {ReturnType<typeof createCollector>|null|undefined} tc
 * @param {string} text pt-BR headline
 * @param {number} [priority] higher = more important (0..10)
 * @param {string} [kind] NewsItem kind
 * @param {string[]} [nations]
 */
export function addHeadline(tc, text, priority = 3, kind = 'world', nations = []) {
    if (!tc || !text) return;
    if (tc.headlines.some((h) => h.text === text)) return;
    tc.headlines.push({ text, priority, kind, nations: nations.filter(Boolean), seq: tc.headlines.length });
}

/** Queues an engine GameEvent in the collector (dedupe by id). */
export function addEvent(tc, event) {
    if (!tc || !event) return;
    if (tc.events.some((e) => e.id === event.id)) return;
    tc.events.push(event);
}

/** Headlines sorted by priority (stable), capped. */
export function topHeadlines(tc, max = HEADLINES_PER_TURN) {
    return tc.headlines
        .slice()
        .sort((a, b) => b.priority - a.priority || a.seq - b.seq)
        .slice(0, max);
}

/**
 * Pushes events into state.eventQueue (dedupe by id against pending + queue, cap).
 * @returns {import('../contract/events.js').GameEvent[]} events actually queued
 */
export function enqueueEvents(state, events) {
    if (!Array.isArray(state.eventQueue)) state.eventQueue = [];
    const queued = [];
    for (const ev of events) {
        if (!ev || !ev.id) continue;
        if (state.pendingEvent && state.pendingEvent.id === ev.id) continue;
        if (state.eventQueue.some((q) => q.id === ev.id)) continue;
        state.eventQueue.push(ev);
        queued.push(ev);
    }
    if (state.eventQueue.length > EVENT_QUEUE_CAP) state.eventQueue.splice(0, state.eventQueue.length - EVENT_QUEUE_CAP);
    return queued;
}

/** Outside endTurn: every headline goes to news, every event to the queue. */
export function flushCollector(state, tc) {
    for (const h of tc.headlines) pushNews(state, h.text, h.kind, h.nations);
    enqueueEvents(state, tc.events);
}
