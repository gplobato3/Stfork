/**
 * @file src/i18n/i18n.js
 * Tiny i18n helper. Backed by a flat key -> string map. All user-facing copy
 * is pt-BR and routed through t(). loadLocale() merges strings and, when a
 * SillyTavern context is present, forwards them to ST's addLocaleData so ST's
 * own translation plumbing also knows the keys.
 *
 * Safe under node: the ST calls are guarded.
 */

import { getContext } from '../core/stContext.js';

/** Active locale tag. The extension ships pt-br. */
export const DEFAULT_LOCALE = 'pt-br';

/** @type {Object.<string, string>} flat key -> string */
const STRINGS = Object.create(null);

/**
 * Merge a flat map of strings into the active dictionary and, if ST is
 * available, register them via addLocaleData for the given locale.
 * @param {Object.<string, string>} obj   Flat key -> string map.
 * @param {string} [locale]               Locale tag (default pt-br).
 * @returns {void}
 */
export function loadLocale(obj, locale = DEFAULT_LOCALE) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') STRINGS[k] = v;
    }
    try {
        const ctx = getContext();
        if (ctx && typeof ctx.addLocaleData === 'function') {
            ctx.addLocaleData(locale, obj);
        }
    } catch {
        /* ignore: ST not present (node) */
    }
}

/**
 * Translate a key, interpolating {placeholders} from `vars`. If the key is
 * unknown, the key itself is returned (so missing strings are visible but the
 * UI never breaks).
 * @param {string} key               Dictionary key.
 * @param {Object.<string, (string|number)>} [vars] Values for {placeholders}.
 * @returns {string}
 */
export function t(key, vars) {
    let str = Object.prototype.hasOwnProperty.call(STRINGS, key) ? STRINGS[key] : key;
    if (vars && typeof vars === 'object') {
        str = str.replace(/\{(\w+)\}/g, (m, name) =>
            Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
        );
    }
    return str;
}

/**
 * Whether a key is known in the current dictionary.
 * @param {string} key
 * @returns {boolean}
 */
export function hasKey(key) {
    return Object.prototype.hasOwnProperty.call(STRINGS, key);
}

/**
 * Return a shallow copy of the loaded dictionary (debugging/tests).
 * @returns {Object.<string, string>}
 */
export function dumpStrings() {
    return { ...STRINGS };
}
