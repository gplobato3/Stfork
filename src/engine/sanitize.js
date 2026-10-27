/**
 * @file src/engine/sanitize.js
 * sanitizeEvent: the only gate for LLM-produced decisions (DESIGN §3.6). Never throws.
 */

import { EVENT_CATEGORIES, OPTION_COUNT } from '../contract/constants.js';
import { normalizeEffect, resolveNationRef } from './effects.js';
import { hashString } from './rng.js';
import { cleanText } from './text.js';
import { uniq } from './util.js';

export const MAX_EFFECTS_PER_OPTION = 6;
const SOURCES = ['llm', 'engine', 'fallback'];
/** Option text must say "war" for a war declaration to survive. */
const WAR_WORDS = /guerra|invad|invas|atac|ofensiv|hostilidade|declar|combate|bombarde/i;

/**
 * Normalizes an LLM (or engine) event against the state.
 * @param {*} event raw object
 * @param {import('../contract/worldState.js').WorldState} state
 * @returns {{ok: boolean, value: ?import('../contract/events.js').GameEvent, errors: string[]}}
 */
export function sanitizeEvent(event, state) {
    const errors = [];
    try {
        if (!state || !state.nations || !state.player) return { ok: false, value: null, errors: ['Estado do jogo inválido.'] };
        if (!event || typeof event !== 'object' || Array.isArray(event)) return { ok: false, value: null, errors: ['Evento ausente ou malformado.'] };
        const pid = state.player.nationId;
        const ctx = { actorId: pid, targetId: null };
        const turn = Number.isInteger(event.turn) && event.turn >= 1 && event.turn <= state.turn ? event.turn : state.turn;

        let title = cleanText(event.title, 120);
        if (!title) {
            errors.push('Evento sem título; usado título padrão.');
            title = 'Decisão de Estado';
        }
        const narrative = cleanText(event.narrative, 1500, { multiline: true });
        if (!narrative) errors.push('Evento sem narrativa.');
        const catRaw = typeof event.category === 'string' ? event.category.trim().toLowerCase() : '';
        let category = catRaw;
        if (!EVENT_CATEGORIES.includes(category)) {
            if (event.category !== undefined) errors.push(`Categoria desconhecida "${cleanText(String(event.category), 30)}"; usada "politics".`);
            category = 'politics';
        }
        const source = SOURCES.includes(event.source) ? event.source : 'llm';
        const headlines = (Array.isArray(event.headlines) ? event.headlines : [])
            .map((h) => cleanText(h, 160))
            .filter(Boolean)
            .slice(0, 3);
        const involvedRaw = Array.isArray(event.involved) ? event.involved : [];
        const involved = uniq(involvedRaw.map((x) => resolveNationRef(x, state, ctx)).filter(Boolean)).slice(0, 8);
        if (involved.length < involvedRaw.length) errors.push('Nações desconhecidas removidas de "involved".');

        const options = [];
        const rawOptions = Array.isArray(event.options) ? event.options.slice(0, 8) : [];
        rawOptions.forEach((o, i) => {
            if (!o || typeof o !== 'object' || Array.isArray(o)) {
                errors.push(`Opção ${i + 1} malformada.`);
                return;
            }
            const label = cleanText(o.label ?? o.text ?? o.title, 80);
            if (!label) {
                errors.push(`Opção ${i + 1} sem texto.`);
                return;
            }
            const rationale = cleanText(o.rationale ?? o.description ?? '', 200);
            const effects = [];
            const rawEffects = Array.isArray(o.effects) ? o.effects : [];
            for (const raw of rawEffects) {
                const { effect, error } = normalizeEffect(raw, state, ctx);
                if (!effect) {
                    errors.push(`Opção ${i + 1}: ${error}`);
                    continue;
                }
                if (effect.type === 'war' && effect.action === 'declare' && !WAR_WORDS.test(`${label} ${rationale}`)) {
                    errors.push(`Opção ${i + 1}: declaração de guerra removida (o texto da opção não menciona guerra).`);
                    continue;
                }
                if (effects.length >= MAX_EFFECTS_PER_OPTION) {
                    errors.push(`Opção ${i + 1}: efeitos acima do limite de ${MAX_EFFECTS_PER_OPTION} descartados.`);
                    break;
                }
                effects.push(effect);
            }
            const opt = { label, rationale, effects };
            const hint = cleanText(o.aiHint, 200);
            if (hint) opt.aiHint = hint;
            options.push(opt);
        });
        if (options.length < OPTION_COUNT.MIN) {
            errors.push(`O evento precisa de pelo menos ${OPTION_COUNT.MIN} opções válidas.`);
            return { ok: false, value: null, errors };
        }
        if (options.length > OPTION_COUNT.MAX) {
            errors.push(`Opções acima de ${OPTION_COUNT.MAX} descartadas.`);
            options.length = OPTION_COUNT.MAX;
        }
        const rawId = typeof event.id === 'string' ? event.id.trim().replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80) : '';
        const id = rawId || `evt-${state.turn}-${hashString(`${state.seed}|${state.turn}|${title}|${options.map((o) => o.label).join('|')}`)}`;
        const value = { id, source, category, title, narrative, headlines, involved, options, turn };
        if (source === 'engine' && Number.isInteger(event.defaultOption) && event.defaultOption >= 0 && event.defaultOption < options.length) {
            value.defaultOption = event.defaultOption;
        }
        return { ok: true, value, errors };
    } catch (err) {
        errors.push(`Falha ao validar o evento: ${err && err.message ? err.message : String(err)}`);
        return { ok: false, value: null, errors };
    }
}
