/**
 * @file src/ui/wand.js
 * Entry in SillyTavern's extensions ("wand") menu.
 *
 * Contract (DESIGN §6.2):
 *   addWandMenuItem({ label, icon, onClick }) -> remove()
 * Markup (same as built-ins, e.g. public/scripts/extensions/gallery/index.js:801):
 *   <div class="list-group-item flex-container flexGap5 interactable" tabindex="0">
 *     <div class="fa-solid … extensionsMenuExtensionButton"></div><span>label</span>
 *   </div>
 * appended to #extensionsMenu (public/scripts/templates/wandMenu.html). ST
 * closes the menu on any outside click (extensions.js:716) and shows the
 * wand button once the menu has visible children (extensions.js:228).
 * Idempotent by id: calling it again with the same label replaces the item.
 */

const RETRY_MS = 500;
const MAX_RETRIES = 40;

/** Stable DOM id for a label ('Grande Estratégia' -> 'hoi_wand_grande_estrategia'). */
export function wandItemId(label) {
    const slug = String(label || 'item')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `hoi_wand_${slug || 'item'}`;
}

/** 'fa-earth-americas' | 'fa-solid fa-earth-americas' -> class list with a style prefix. */
export function wandIconClasses(iconCls) {
    const parts = String(iconCls || 'fa-earth-americas').split(/\s+/).filter(Boolean);
    if (!parts.some((c) => /^fa-(solid|regular|brands)$/.test(c))) parts.unshift('fa-solid');
    return [...parts, 'extensionsMenuExtensionButton'];
}

/**
 * @param {Object} opts
 * @param {string} opts.label
 * @param {string} [opts.icon]   Font Awesome class, e.g. 'fa-earth-americas'.
 * @param {() => void} opts.onClick
 * @returns {() => void} remove
 */
export function addWandMenuItem({ label, icon, onClick } = {}) {
    if (typeof document === 'undefined') return () => {};
    const id = wandItemId(label);
    let timer = null;
    let removed = false;
    let item = null;

    const run = () => {
        try {
            if (typeof onClick === 'function') onClick();
        } catch (err) {
            console.error('[HOI] wand item failed', err);
        }
    };

    function build() {
        const el = document.createElement('div');
        el.id = id;
        el.className = 'list-group-item flex-container flexGap5 interactable';
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.title = String(label || '');
        const ic = document.createElement('div');
        ic.className = wandIconClasses(icon).join(' ');
        ic.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = String(label || '');
        el.append(ic, text);
        el.addEventListener('click', run);
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation(); // ST's global Enter handler would click() it a second time
                el.click();
            }
        });
        return el;
    }

    function attach(attempt = 0) {
        if (removed) return;
        const menu = document.getElementById('extensionsMenu');
        if (!menu) {
            // ST builds the menu during extension init; wait for it briefly.
            if (attempt < MAX_RETRIES) timer = setTimeout(() => attach(attempt + 1), RETRY_MS);
            return;
        }
        const existing = document.getElementById(id);
        if (existing) existing.remove();
        item = build();
        menu.appendChild(item);
    }

    attach();

    // Removes the menu entry with this id, even if a later call replaced the
    // element (so any stored remover cleans up on unmount).
    return function remove() {
        removed = true;
        if (timer) clearTimeout(timer);
        timer = null;
        if (item) item.remove();
        item = null;
        const current = document.getElementById(id);
        if (current && current.closest('#extensionsMenu')) current.remove();
    };
}
