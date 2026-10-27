/**
 * @file src/ui/dialogs/dom.js
 * Tiny DOM helpers shared by the UI-B surfaces (dialogs, HUD, settings).
 * Everything goes through createElement/textContent: LLM text is untrusted and
 * must never reach innerHTML. Node-safe at import time (no DOM access here).
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {Object} [props]
 * @param {string} [props.className]
 * @param {string} [props.text]            textContent
 * @param {Object<string, string|number|boolean|null|undefined>} [props.attrs]  null/false = skip
 * @param {Object<string, string>} [props.dataset]
 * @param {Object<string, string>} [props.style]  CSS properties (custom properties allowed)
 * @param {Object<string, Function>} [props.on]   event listeners
 * @param {...(Node|string|number|null|undefined|false|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
    const el = document.createElement(tag);
    const p = props || {};
    if (p.className) el.className = p.className;
    if (p.text !== undefined && p.text !== null) el.textContent = String(p.text);
    if (p.attrs) {
        for (const [k, v] of Object.entries(p.attrs)) {
            if (v === null || v === undefined || v === false) continue;
            el.setAttribute(k, v === true ? '' : String(v));
        }
    }
    if (p.dataset) {
        for (const [k, v] of Object.entries(p.dataset)) {
            if (v !== null && v !== undefined) el.dataset[k] = String(v);
        }
    }
    if (p.style) {
        for (const [k, v] of Object.entries(p.style)) {
            if (v === null || v === undefined) continue;
            if (k.startsWith('--')) el.style.setProperty(k, String(v));
            else el.style[k] = String(v);
        }
    }
    if (p.on) {
        for (const [k, fn] of Object.entries(p.on)) {
            if (typeof fn === 'function') el.addEventListener(k, fn);
        }
    }
    appendChildren(el, children);
    return el;
}

/** Append children (strings become text nodes; falsy values are skipped). */
export function appendChildren(el, children) {
    for (const c of children.flat(Infinity)) {
        if (c === null || c === undefined || c === false || c === '') continue;
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
}

/** `<i class="fa-solid fa-x" aria-hidden="true">` */
export function icon(cls, extra = '') {
    const full = /\bfa-(solid|regular|brands)\b/.test(String(cls || '')) ? cls : `fa-solid ${cls || 'fa-circle'}`;
    return h('i', { className: `${full} ${extra}`.trim(), attrs: { 'aria-hidden': 'true' } });
}

/** Remove every child node. */
export function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
    return el;
}

/** Emoji flag of a nation (v2 `flag`, v1 `flagEmoji`), or a neutral white flag. */
export function flagEmoji(nation) {
    return (nation && (nation.flag || nation.flagEmoji)) || '\u{1F3F3}\uFE0F';
}

/**
 * Flag image for a nation with emoji fallback when the SVG is missing.
 * @param {(path: string) => string} [assetUrl]
 * @param {Object} nation
 * @param {''|'sm'|'lg'} [size]
 * @returns {HTMLElement}
 */
export function flagEl(assetUrl, nation, size = '') {
    const sizeCls = size ? ` hoi-flag--${size}` : '';
    const name = (nation && nation.name) || '';
    const emoji = () => h('span', {
        className: `hoi-flag hoi-flag--emoji${sizeCls}`,
        text: flagEmoji(nation),
        attrs: { role: 'img', 'aria-label': name ? `Bandeira: ${name}` : 'Bandeira' },
    });
    if (typeof assetUrl !== 'function' || !nation || !nation.id) return emoji();
    let src = '';
    try {
        src = assetUrl(`flags/${nation.id}.svg`);
    } catch {
        src = '';
    }
    if (!src) return emoji();
    const img = h('img', {
        className: `hoi-flag${sizeCls}`,
        attrs: { src, alt: name ? `Bandeira: ${name}` : '', loading: 'lazy', decoding: 'async', draggable: 'false' },
    });
    img.addEventListener('error', () => {
        if (img.parentNode) img.replaceWith(emoji());
    }, { once: true });
    return img;
}

/**
 * Image that removes `hideTarget` (or itself) when it fails to load.
 * @param {string} src
 * @param {Object} [opts]
 * @param {string} [opts.className]
 * @param {string} [opts.alt]
 * @param {string} [opts.fallback]   Second source tried once (adds class 'is-fallback').
 * @param {() => void} [opts.onError] Called when every source failed (the img is removed).
 */
export function safeImg(src, { className = '', alt = '', fallback = '', onError } = {}) {
    const img = h('img', { className, attrs: { src, alt, decoding: 'async', draggable: 'false' } });
    let usedFallback = false;
    const fail = () => {
        if (fallback && !usedFallback) {
            usedFallback = true;
            img.classList.add('is-fallback');
            img.src = fallback;
            return;
        }
        img.removeEventListener('error', fail);
        img.remove();
        if (typeof onError === 'function') onError();
    };
    img.addEventListener('error', fail);
    return img;
}

/** Safe wrapper for the optional assetUrl dependency. */
export function urlFor(assetUrl, path) {
    if (typeof assetUrl !== 'function') return '';
    try {
        return assetUrl(path) || '';
    } catch {
        return '';
    }
}

/** Split untrusted narrative text into paragraph elements. */
export function paragraphs(text, className = '') {
    return String(text || '')
        .split(/\n\s*\n|\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => h('p', { className, text: s }));
}

let uid = 0;
/** Unique DOM id with a prefix. */
export function uniqueId(prefix = 'hoi') {
    uid += 1;
    return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

/** True when the keyboard event comes from a text-entry control. */
export function isTypingTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const tag = String(target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
        const type = String(target.type || 'text').toLowerCase();
        return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(type);
    }
    return !!target.isContentEditable;
}
