/**
 * @file src/llm/narration.js
 * Optional immersive in-chat narration after a decision is resolved.
 *
 * Unlike the event engine (which uses generateRaw for structured JSON), this
 * uses generateQuietPrompt so the narration is produced in the CURRENT chat
 * context and respects the loaded character/preset — it reads as the story's
 * own voice. It degrades gracefully: on any failure it returns an empty string
 * and never throws, so the game loop is unaffected.
 *
 * Prompt scaffolding is English; the narration requested is pt-BR.
 */

import { getCoreFn } from '../core/stContext.js';

/**
 * Produce a short immersive pt-BR narration describing the aftermath of the
 * player's decision, suitable to render in the normal chat.
 *
 * @param {import('../contract/worldState.js').WorldState} worldState
 * @param {{event: import('../contract/events.js').GameEvent, optionId?: string}|import('../contract/events.js').GameEvent} resolvedEvent
 *        Either the resolved event, or {event, optionId} describing the choice.
 * @returns {Promise<string>} narration text, or '' if generation failed/empty.
 */
export async function generateFlavorNarration(worldState, resolvedEvent) {
    try {
        const quietPrompt = buildQuietPrompt(worldState, resolvedEvent);
        if (!quietPrompt) return '';
        const generateQuietPrompt = getCoreFn('generateQuietPrompt');
        const out = await generateQuietPrompt({ quietPrompt });
        return normalizeOutput(out);
    } catch {
        // Narration is a nicety; never let it break the turn.
        return '';
    }
}

/**
 * Build the quiet prompt describing the decision + its stakes and asking for a
 * concise pt-BR narrative beat in the loaded character/preset's voice.
 *
 * @param {import('../contract/worldState.js').WorldState} ws
 * @param {*} resolvedEvent
 * @returns {string}
 */
export function buildQuietPrompt(ws, resolvedEvent) {
    const { event, optionId } = unpack(resolvedEvent);
    if (!event) return '';

    const chosen = findOption(event, optionId);
    const player = getPlayerNation(ws);
    const nationName = (player && player.name) || 'a nação do jogador';
    const leader = (player && player.leaderTitle) || 'líder';

    const lines = [];
    lines.push('[Instruction — write the response in Brazilian Portuguese (pt-BR).]');
    lines.push(
        `Narre, em 2 a 4 frases imersivas, as consequências imediatas da decisão do(a) ${leader} de ${nationName}.`,
    );
    lines.push(`Evento: "${event.title || 'Decisão'}".`);
    if (event.narrative) lines.push(`Contexto: ${truncate(event.narrative, 400)}`);
    if (chosen) {
        lines.push(`Decisão tomada: "${chosen.label}".`);
        if (chosen.rationale) lines.push(`Intenção: ${truncate(chosen.rationale, 200)}`);
        const impact = describeEffects(chosen.effects);
        if (impact) lines.push(`Impacto mecânico (para dar sabor, não liste números): ${impact}`);
    }
    lines.push('Mantenha o tom coerente com o relatório de situação e o personagem/preset carregado. Não use listas nem JSON.');
    return lines.join('\n');
}

/* ----------------------------- small helpers ------------------------------ */

/**
 * @param {*} resolvedEvent
 * @returns {{event: import('../contract/events.js').GameEvent|null, optionId: string|undefined}}
 */
function unpack(resolvedEvent) {
    if (!resolvedEvent || typeof resolvedEvent !== 'object') return { event: null, optionId: undefined };
    if (resolvedEvent.event && typeof resolvedEvent.event === 'object') {
        return { event: resolvedEvent.event, optionId: resolvedEvent.optionId };
    }
    // Treat it as the event itself.
    return { event: resolvedEvent, optionId: undefined };
}

/**
 * @param {import('../contract/events.js').GameEvent} event
 * @param {string|undefined} optionId
 * @returns {import('../contract/events.js').Option|null}
 */
function findOption(event, optionId) {
    const options = Array.isArray(event.options) ? event.options : [];
    if (optionId) {
        const match = options.find((o) => o && o.id === optionId);
        if (match) return match;
    }
    return options[0] || null;
}

/**
 * Human-ish pt-BR summary of what the effects do, for narrative colour.
 * @param {import('../contract/events.js').Effect[]} effects
 * @returns {string}
 */
function describeEffects(effects) {
    if (!Array.isArray(effects) || !effects.length) return '';
    const parts = [];
    for (const eff of effects.slice(0, 5)) {
        if (!eff || typeof eff !== 'object') continue;
        switch (eff.type) {
            case 'resource':
                parts.push(`${eff.resource} de ${eff.target} ${signWord(eff.delta)}`);
                break;
            case 'tension':
                parts.push(`tensão global ${signWord(eff.delta)}`);
                break;
            case 'relation':
                parts.push(`relação ${eff.target}↔${eff.targetB} ${signWord(eff.delta)}`);
                break;
            case 'war':
                parts.push(`guerra (${eff.action}) entre ${eff.target} e ${eff.targetB}`);
                break;
            case 'crisis':
                parts.push(`crise (${eff.action})`);
                break;
            case 'bloc':
                parts.push(`${eff.target} muda para o bloco ${eff.bloc}`);
                break;
            default:
                break;
        }
    }
    return parts.join('; ');
}

/**
 * @param {number} delta
 * @returns {string}
 */
function signWord(delta) {
    const n = Number(delta) || 0;
    if (n > 0) return 'melhora';
    if (n < 0) return 'piora';
    return 'estável';
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
 * Normalize generateQuietPrompt output (string, or {text}/{content} wrapper).
 * @param {*} out
 * @returns {string}
 */
function normalizeOutput(out) {
    if (out == null) return '';
    if (typeof out === 'string') return out.trim();
    if (typeof out === 'object') {
        if (typeof out.text === 'string') return out.text.trim();
        if (typeof out.content === 'string') return out.content.trim();
    }
    return '';
}

/**
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function truncate(s, max) {
    const str = String(s);
    return str.length > max ? str.slice(0, max) + '…' : str;
}
