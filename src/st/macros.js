/**
 * @file src/st/macros.js
 * {{hoi_*}} macro definitions and registration on both ST macro APIs.
 *
 * ST: public/scripts/macros/macro-system.js:44-60 `macros.register(name, options)`
 *     = MacroRegistry.registerMacro (engine/MacroRegistry.js:198); options.handler
 *     is required (MacroRegistry.js:505), names must match /^[a-zA-Z][\w-_]*$/
 *     (engine/MacroLexer.js:17).
 * ST: public/scripts/st-context.js:180 (registerMacro) -> MacrosParser.registerMacro(key, value, description)
 *     (public/scripts/macros.js:183, deprecated). It mirrors into the new
 *     registry when `power_user.experimental_macro_engine` is on (default true,
 *     power-user.js:302) and otherwise stores the macro in the legacy map used by
 *     substituteParams when the new engine is off (script.js:2997).
 */

import { formatDate, defcon } from '../contract/presentation.js';
import { playerNation } from '../contract/worldState.js';

export const MACRO_NAMES = Object.freeze([
    'hoi_sitrep',
    'hoi_nation',
    'hoi_leader',
    'hoi_title',
    'hoi_date',
    'hoi_defcon',
    'hoi_orders',
]);

/**
 * Summaries of the most recent batch of chat orders (source 'order'): every
 * order record from the latest turn that has any, oldest first, max 3.
 * @param {any} state
 * @returns {string[]}
 */
export function lastOrderSummaries(state) {
    const records = Array.isArray(state?.recentActions) ? state.recentActions.filter((r) => r && r.source === 'order') : [];
    if (!records.length) return [];
    const lastTurn = Math.max(...records.map((r) => Number(r.turn) || 0));
    return records
        .filter((r) => (Number(r.turn) || 0) === lastTurn)
        .slice(-3)
        .map((r) => String(r.summary || r.actionId || '').trim())
        .filter(Boolean);
}

/**
 * Pure macro value table.
 * @param {{getState: () => any, isEnabled: () => boolean, sitrep: (state: any) => string}} deps
 * @returns {Array<{name: string, description: string, value: () => string}>}
 */
export function buildMacroDefs({ getState, isEnabled, sitrep }) {
    const withState = (fn) => () => {
        try {
            if (!isEnabled()) return '';
            const state = getState();
            if (!state) return '';
            const out = fn(state);
            return out == null ? '' : String(out);
        } catch (error) {
            console.warn('[HOI] macro failed', error);
            return '';
        }
    };
    return [
        {
            name: 'hoi_sitrep',
            description: 'HOI: relatório de situação da campanha (o mesmo injetado no prompt).',
            value: withState((s) => sitrep(s)),
        },
        {
            name: 'hoi_nation',
            description: 'HOI: nome da nação governada pelo jogador.',
            value: withState((s) => playerNation(s)?.name || s.player?.nationId || ''),
        },
        {
            name: 'hoi_leader',
            description: 'HOI: nome do governante (o jogador).',
            value: withState((s) => s.player?.leaderName || ''),
        },
        {
            name: 'hoi_title',
            description: 'HOI: título do chefe de Estado (Presidente, Primeiro-Ministro...).',
            value: withState((s) => s.player?.title || playerNation(s)?.leaderTitle || ''),
        },
        {
            name: 'hoi_date',
            description: 'HOI: data atual da campanha (ex.: Outubro de 2026).',
            value: withState((s) => formatDate(s.date)),
        },
        {
            name: 'hoi_defcon',
            description: 'HOI: nível de alerta global (DEFCON) derivado da tensão mundial.',
            value: withState((s) => {
                const d = defcon(s.globalTension);
                return `DEFCON ${d.level} (${d.label})`;
            }),
        },
        {
            name: 'hoi_orders',
            description: 'HOI: resultado das últimas ordens dadas no chat.',
            value: withState((s) => lastOrderSummaries(s).join(' ')),
        },
    ];
}

/**
 * Register the macro table on whatever API the running ST offers.
 * @param {any} ctx Fresh ST context.
 * @param {Array<{name: string, description: string, value: () => string}>} defs
 * @returns {{api: 'new'|'legacy'|'both'|'none', names: string[]}}
 */
export function registerMacrosOn(ctx, defs) {
    const names = [];
    if (!ctx) return { api: 'none', names };
    const hasNew = !!ctx.macros && typeof ctx.macros.register === 'function';
    const hasLegacy = typeof ctx.registerMacro === 'function';
    // ST: power-user.js:302 — new engine is the default; when the user turned it
    // off, substituteParams only reads the legacy MacrosParser map.
    const newEngineOff = ctx.powerUserSettings?.experimental_macro_engine === false;
    let usedNew = false;
    let usedLegacy = false;

    if (hasNew) {
        const category = ctx.macros.category?.MISC || 'misc';
        for (const def of defs) {
            try {
                const result = ctx.macros.register(def.name, {
                    category,
                    description: def.description,
                    handler: () => def.value(),
                });
                if (result !== null) {
                    usedNew = true;
                    names.push(def.name);
                }
            } catch (error) {
                console.warn(`[HOI] macros.register(${def.name}) failed`, error);
            }
        }
    }
    if (hasLegacy && (!hasNew || newEngineOff || !usedNew)) {
        for (const def of defs) {
            try {
                ctx.registerMacro(def.name, () => def.value(), def.description);
                usedLegacy = true;
                if (!names.includes(def.name)) names.push(def.name);
            } catch (error) {
                console.warn(`[HOI] registerMacro(${def.name}) failed`, error);
            }
        }
    }
    const api = usedNew && usedLegacy ? 'both' : usedNew ? 'new' : usedLegacy ? 'legacy' : 'none';
    return { api, names };
}
