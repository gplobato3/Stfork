/**
 * @file src/ui/warroom/toasts.js
 * Lightweight HOI-styled toast stack (fixed, above the War Room). Created
 * lazily on first use; text is set with textContent.
 */

import { h, icon } from './dom.js';

const KIND_ICONS = {
    info: 'fa-solid fa-circle-info',
    success: 'fa-solid fa-circle-check',
    warning: 'fa-solid fa-triangle-exclamation',
    error: 'fa-solid fa-circle-xmark',
};

const MAX_VISIBLE = 4;

export function createToaster() {
    let stack = null;

    function ensure() {
        if (stack && stack.isConnected) return stack;
        stack = h('div', { class: 'hoi-root hoi-toasts', role: 'status', 'aria-live': 'polite' });
        document.body.appendChild(stack);
        return stack;
    }

    /**
     * @param {string} msg
     * @param {'info'|'success'|'warning'|'error'} [kind]
     * @param {{title?: string, details?: string[], timeout?: number}} [opts]
     */
    function toast(msg, kind = 'info', opts = {}) {
        if (typeof document === 'undefined' || !msg) return;
        const k = KIND_ICONS[kind] ? kind : 'info';
        const el = h('div', { class: `hoi-toast hoi-toast--${k}`, role: k === 'error' ? 'alert' : 'status' },
            icon(KIND_ICONS[k], 'hoi-toast__icon'),
            h('div', { class: 'hoi-toast__body' },
                opts.title ? h('div', { class: 'hoi-toast__title', text: opts.title }) : null,
                h('div', { class: 'hoi-toast__msg', text: msg }),
                Array.isArray(opts.details) && opts.details.length
                    ? h('ul', { class: 'hoi-toast__details' }, opts.details.slice(0, 6).map((d) => h('li', { text: d })))
                    : null,
            ),
            h('button', { type: 'button', class: 'hoi-toast__x', 'aria-label': 'Fechar aviso', onClick: () => dismiss() }, icon('fa-solid fa-xmark')),
        );
        const host = ensure();
        host.appendChild(el);
        while (host.children.length > MAX_VISIBLE) host.firstElementChild.remove();
        const timeout = opts.timeout || (k === 'error' ? 9000 : k === 'warning' ? 7000 : 5200);
        let timer = setTimeout(dismiss, timeout);
        el.addEventListener('mouseenter', () => clearTimeout(timer));
        el.addEventListener('mouseleave', () => {
            clearTimeout(timer);
            timer = setTimeout(dismiss, 2500);
        });
        function dismiss() {
            clearTimeout(timer);
            if (!el.isConnected) return;
            el.classList.add('is-leaving');
            setTimeout(() => el.remove(), 220);
        }
    }

    function destroy() {
        if (stack) stack.remove();
        stack = null;
    }

    return { toast, destroy };
}
