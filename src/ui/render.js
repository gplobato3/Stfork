/**
 * @file src/ui/render.js
 * Small rendering helpers shared by the HOI UI renderers.
 *
 * Centralizes:
 *   - defensive access to ST's renderExtensionTemplateAsync (Handlebars
 *     templates under templates/*.html, auto-sanitized + i18n-aware),
 *   - efficient DOM updates via morphdom when SillyTavern.libs exposes it,
 *     falling back to innerHTML replacement otherwise,
 *   - DOMPurify sanitize when available.
 *
 * Node-safe: nothing here touches document/window at import time; each function
 * guards its DOM/ST usage so importing the module never throws.
 */

import { getContext, getLibs, isLive } from '../core/stContext.js';
import { EXTENSION_DIR } from '../contract/interfaces.js';

/**
 * Render a Handlebars template through ST (when live) and return the HTML.
 * Returns an empty string under node / when ST is unavailable, so callers can
 * fall back to programmatic DOM building.
 *
 * @param {string} templateName Template base name (no extension), e.g. 'dashboard'.
 * @param {Object} data         Data object passed to the template.
 * @returns {Promise<string>}
 */
export async function renderTemplate(templateName, data) {
    try {
        const ctx = getContext();
        if (isLive() && ctx && typeof ctx.renderExtensionTemplateAsync === 'function') {
            const html = await ctx.renderExtensionTemplateAsync(EXTENSION_DIR, templateName, data);
            return typeof html === 'string' ? html : '';
        }
    } catch {
        /* fall through: not live / template missing */
    }
    return '';
}

/**
 * Sanitize an HTML string with DOMPurify when present; otherwise return it
 * unchanged (ST already sanitizes template output, and we never inject
 * untrusted HTML directly).
 * @param {string} html
 * @returns {string}
 */
export function sanitize(html) {
    const libs = getLibs();
    if (libs && libs.DOMPurify && typeof libs.DOMPurify.sanitize === 'function') {
        return libs.DOMPurify.sanitize(html);
    }
    return String(html == null ? '' : html);
}

/**
 * Replace the contents of `target` with `html`, using morphdom for an efficient
 * diff when available. Falls back to innerHTML. No-op if target is not a DOM
 * element (e.g. under node).
 *
 * @param {HTMLElement} target
 * @param {string} html
 * @returns {void}
 */
export function patchHtml(target, html) {
    if (!isElement(target)) return;
    const clean = sanitize(html);
    const libs = getLibs();
    const morphdom = libs && libs.morphdom;
    if (typeof morphdom === 'function') {
        try {
            const doc = target.ownerDocument;
            const next = doc.createElement(target.tagName);
            next.innerHTML = clean;
            // Keep the same root element; morph only children.
            morphdom(target, next, { childrenOnly: true });
            return;
        } catch {
            /* fall back to innerHTML */
        }
    }
    target.innerHTML = clean;
}

/**
 * Create a DOM element with optional className, attributes and text. Returns
 * null under node. Keeps programmatic fallbacks terse.
 * @param {Document} doc
 * @param {string} tag
 * @param {Object} [props]
 * @param {string} [props.className]
 * @param {Object.<string,string>} [props.attrs]
 * @param {string} [props.text]
 * @returns {HTMLElement|null}
 */
export function el(doc, tag, props = {}) {
    if (!doc || typeof doc.createElement !== 'function') return null;
    const node = doc.createElement(tag);
    if (props.className) node.className = props.className;
    if (props.attrs) {
        for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, String(v));
    }
    if (props.text != null) node.textContent = String(props.text);
    return node;
}

/** True when x looks like a DOM element. */
export function isElement(x) {
    return !!x && typeof x === 'object' && typeof x.appendChild === 'function';
}
