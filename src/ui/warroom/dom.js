/**
 * @file src/ui/warroom/dom.js
 * Minimal DOM helpers. Text is always assigned with textContent (LLM and
 * scenario text is untrusted; innerHTML is never used). Functions only touch
 * `document` when called, so importing this module under node is safe.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an HTML element.
 * props: class, text, title, dataset, style (object), attrs (object), on<Event> (function),
 * plus any other key set as an attribute (true => '', false/null => skipped).
 */
export function h(tag, props, ...children) {
    const el = document.createElement(tag);
    applyProps(el, props);
    appendChildren(el, children);
    return el;
}

/** Create an SVG element with attributes. */
export function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === 'class') {
                el.setAttribute('class', v);
            } else if (k === 'text') {
                el.textContent = String(v);
            } else if (k === 'dataset') {
                for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
            } else {
                el.setAttribute(k, v === true ? '' : String(v));
            }
        }
    }
    appendChildren(el, children);
    return el;
}

function applyProps(el, props) {
    if (!props) return;
    for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') {
            el.className = v;
        } else if (k === 'text') {
            el.textContent = String(v);
        } else if (k === 'dataset') {
            for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
        } else if (k === 'style') {
            Object.assign(el.style, v);
        } else if (k === 'attrs') {
            for (const [ak, av] of Object.entries(v)) {
                if (av != null && av !== false) el.setAttribute(ak, av === true ? '' : String(av));
            }
        } else if (k.startsWith('on') && typeof v === 'function') {
            el.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
            el.setAttribute(k, v === true ? '' : String(v));
        }
    }
}

function appendChildren(el, children) {
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false) continue;
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
}

/** Font Awesome icon element. */
export function icon(cls, extra = '') {
    const i = document.createElement('i');
    i.className = `${cls}${extra ? ` ${extra}` : ''}`;
    i.setAttribute('aria-hidden', 'true');
    return i;
}

/** Update textContent only when it changed (cheap incremental refresh). */
export function setText(el, text) {
    const t = text == null ? '' : String(text);
    if (el.textContent !== t) el.textContent = t;
}

export function setAttr(el, name, value) {
    if (value == null || value === false) {
        if (el.hasAttribute(name)) el.removeAttribute(name);
        return;
    }
    const v = value === true ? '' : String(value);
    if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}

export function toggleClass(el, cls, on) {
    if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
}

export function setStyleVar(el, name, value) {
    const v = String(value);
    if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v);
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Keyed list reconciliation: reuses elements by key, removes stale ones and
 * only moves nodes whose position changed.
 * @param {HTMLElement} container
 * @param {Array} items
 * @param {(item) => string} keyOf
 * @param {(item) => HTMLElement} create
 * @param {(el: HTMLElement, item) => void} update
 */
export function syncList(container, items, keyOf, create, update) {
    const existing = new Map();
    for (const child of Array.from(container.children)) {
        if (child.dataset && child.dataset.key != null) existing.set(child.dataset.key, child);
    }
    const keep = new Set();
    let prev = null;
    for (const item of items) {
        const key = String(keyOf(item));
        let el = existing.get(key);
        if (!el) {
            el = create(item);
            el.dataset.key = key;
        }
        update(el, item);
        keep.add(key);
        const expected = prev ? prev.nextSibling : container.firstChild;
        if (expected !== el) container.insertBefore(el, expected);
        prev = el;
    }
    for (const [key, el] of existing) if (!keep.has(key)) el.remove();
    // Remove unkeyed leftovers (e.g. an empty-state placeholder).
    for (const child of Array.from(container.children)) {
        if (!child.dataset || child.dataset.key == null) child.remove();
    }
}

const failedFlags = new Set();

/**
 * Flag image with emoji fallback when the SVG fails to load.
 * @param {(path:string)=>string} assetUrl
 * @param {{id:string, flag?:string, name?:string}|null} nation
 * @param {'sm'|'md'|'lg'} size
 */
export function flagEl(assetUrl, nation, size = 'md') {
    const sizeCls = size === 'sm' ? ' hoi-flag--sm' : size === 'lg' ? ' hoi-flag--lg' : '';
    const wrap = document.createElement('span');
    wrap.className = 'hoi-flagbox';
    updateFlag(wrap, assetUrl, nation, sizeCls);
    return wrap;
}

/** Re-point an existing flagEl() box at another nation (no-op when unchanged). */
export function updateFlag(wrap, assetUrl, nation, sizeCls) {
    const id = nation ? nation.id : '';
    const cls = sizeCls != null ? sizeCls : wrap.dataset.size || '';
    if (wrap.dataset.flagId === id && wrap.firstChild) return;
    wrap.dataset.flagId = id;
    wrap.dataset.size = cls;
    clear(wrap);
    if (!nation) return;
    const emoji = () => {
        const span = document.createElement('span');
        span.className = `hoi-flag hoi-flag--emoji${cls}`;
        span.textContent = nation.flag || nation.flagEmoji || '🏳️';
        span.setAttribute('role', 'img');
        span.setAttribute('aria-label', `Bandeira: ${nation.name || id}`);
        return span;
    };
    let url = '';
    try {
        url = assetUrl ? assetUrl(`flags/${id}.svg`) : '';
    } catch {
        url = '';
    }
    if (!url || failedFlags.has(url)) {
        wrap.appendChild(emoji());
        return;
    }
    const img = document.createElement('img');
    img.className = `hoi-flag${cls}`;
    img.alt = `Bandeira: ${nation.name || id}`;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.draggable = false;
    img.addEventListener('error', () => {
        failedFlags.add(url);
        if (img.parentNode === wrap) img.replaceWith(emoji());
    }, { once: true });
    img.src = url;
    wrap.appendChild(img);
}

/** True when an element accepts text input (keyboard shortcuts must not fire). */
export function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
}
