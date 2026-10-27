/**
 * @file src/ui/dialogs/modalHost.js
 * Modal host for every HOI dialog: fixed overlay above the War Room
 * (z-index --hoi-z-modal), backdrop, focus trap, Esc to dismiss, focus
 * restoration and stacking. Node-safe at import time.
 *
 * Contract (DESIGN §6.2):
 *   openModal({ className, content, dismissible, onDismiss }) -> { close() }
 *
 * Semantics:
 * - "dismiss" = Esc / backdrop click (only when dismissible) or closeAllModals().
 *   A dismissal calls onDismiss exactly once and then closes the modal.
 * - close() closes without calling onDismiss (the caller already has its answer).
 *   Both are idempotent; after one of them the other is a no-op.
 *
 * Keyboard events inside a modal stop propagating at the layer so SillyTavern's
 * document-level hotkeys (ArrowLeft/Right swipe, Escape closing panels —
 * public/scripts/RossAscends-mods.js processHotkeys) never fire behind a dialog.
 */

import { h } from './dom.js';

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
].join(',');

const CLOSE_ANIMATION_MS = 170;

/** @type {Array<{layer: HTMLElement, dialog: HTMLElement, dismissible: boolean, dismiss: Function, close: Function}>} */
const stack = [];
let focusGuardInstalled = false;

function topEntry() {
    return stack.length ? stack[stack.length - 1] : null;
}

function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false;
    return el.getClientRects().length > 0;
}

function focusablesIn(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => isVisible(el) && !el.closest('[hidden], [inert]'));
}

function focusInitial(dialog) {
    const preferred = dialog.querySelector('[data-hoi-autofocus]') || dialog.querySelector('[autofocus]');
    const target = preferred && isVisible(preferred) ? preferred : dialog;
    try {
        target.focus({ preventScroll: true });
    } catch {
        /* ignore */
    }
}

/** Keep focus inside the topmost modal (SillyTavern popups/toasts are exempt). */
function onDocumentFocusIn(e) {
    const top = topEntry();
    if (!top) return;
    const t = e.target;
    if (!(t instanceof Node) || top.layer.contains(t)) return;
    if (t instanceof Element && t.closest('dialog, .popup, #toast-container, .hoi-tooltip')) return;
    focusInitial(top.dialog);
}

function ensureFocusGuard() {
    if (focusGuardInstalled || typeof document === 'undefined') return;
    document.addEventListener('focusin', onDocumentFocusIn, true);
    focusGuardInstalled = true;
}

function releaseFocusGuard() {
    if (!focusGuardInstalled || stack.length) return;
    document.removeEventListener('focusin', onDocumentFocusIn, true);
    focusGuardInstalled = false;
}

function findTitleId(dialog) {
    const title = dialog.querySelector('[data-hoi-modal-title]');
    if (!title) return null;
    if (!title.id) title.id = `hoi-modal-title-${Math.random().toString(36).slice(2, 9)}`;
    return title.id;
}

/**
 * Open a modal.
 * @param {Object} opts
 * @param {string} [opts.className]   Extra class(es) for the dialog box.
 * @param {Node|string} opts.content  Dialog content (string = plain text).
 * @param {boolean} [opts.dismissible=true]  Esc / backdrop click dismiss it.
 * @param {() => void} [opts.onDismiss]      Called once when dismissed.
 * @returns {{close: () => void}}
 */
export function openModal({ className = '', content, dismissible = true, onDismiss } = {}) {
    const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;

    const dialog = h('div', {
        className: `hoi-modal ${className || ''}`.trim(),
        attrs: { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
    });
    if (content instanceof Node) dialog.appendChild(content);
    else if (content !== undefined && content !== null) dialog.appendChild(h('div', { className: 'hoi-modal__text', text: String(content) }));

    const backdrop = h('div', { className: 'hoi-modal-backdrop', attrs: { 'aria-hidden': 'true' } });
    const layer = h('div', { className: 'hoi-root hoi-modal-layer', dataset: { depth: stack.length } }, backdrop, dialog);
    if (dismissible) layer.classList.add('is-dismissible');

    let state = 'open'; // 'open' | 'closed'

    const entry = {
        layer,
        dialog,
        dismissible: !!dismissible,
        dismiss: () => dismiss(),
        close: () => close(),
    };

    function teardown() {
        if (state !== 'open') return false;
        state = 'closed';
        const i = stack.indexOf(entry);
        if (i >= 0) stack.splice(i, 1);
        layer.classList.add('is-closing');
        layer.setAttribute('aria-hidden', 'true');
        const remove = () => layer.remove();
        if (typeof window !== 'undefined' && window.setTimeout) window.setTimeout(remove, CLOSE_ANIMATION_MS);
        else remove();
        releaseFocusGuard();
        // Restore focus to the opener (or the new top modal).
        const top = topEntry();
        const back = previouslyFocused && previouslyFocused.isConnected ? previouslyFocused : null;
        try {
            if (back && (!top || top.layer.contains(back))) back.focus({ preventScroll: true });
            else if (top) focusInitial(top.dialog);
        } catch {
            /* ignore */
        }
        return true;
    }

    function close() {
        teardown();
    }

    function dismiss() {
        if (!teardown()) return;
        if (typeof onDismiss === 'function') {
            try {
                onDismiss();
            } catch (err) {
                console.error('[HOI] onDismiss failed', err);
            }
        }
    }

    // Backdrop: dismiss only when the press started AND ended on the backdrop.
    let pressOnBackdrop = false;
    backdrop.addEventListener('pointerdown', (e) => {
        pressOnBackdrop = true;
        e.preventDefault(); // keep focus inside the dialog
    });
    layer.addEventListener('pointerup', (e) => {
        const ok = pressOnBackdrop && e.target === backdrop;
        pressOnBackdrop = false;
        if (ok && entry.dismissible && topEntry() === entry) dismiss();
    });

    layer.addEventListener('keydown', (e) => {
        if (topEntry() === entry) {
            if (e.key === 'Escape' && !e.defaultPrevented) {
                e.preventDefault();
                if (entry.dismissible) dismiss();
            } else if (e.key === 'Tab') {
                const items = focusablesIn(dialog);
                if (!items.length) {
                    e.preventDefault();
                    dialog.focus({ preventScroll: true });
                } else {
                    const first = items[0];
                    const last = items[items.length - 1];
                    const active = document.activeElement;
                    if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
                        e.preventDefault();
                        last.focus();
                    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }
        }
        // Never let keys reach SillyTavern's global hotkeys while a dialog is up.
        e.stopPropagation();
    });

    const titleId = findTitleId(dialog);
    if (titleId) dialog.setAttribute('aria-labelledby', titleId);

    stack.push(entry);
    document.body.appendChild(layer);
    ensureFocusGuard();
    focusInitial(dialog);

    return { close };
}

/**
 * Dismiss every open modal (top first), calling each onDismiss — used on
 * unmount / chat change so no dialog promise is ever left dangling.
 */
export function closeAllModals() {
    for (const entry of stack.slice().reverse()) entry.dismiss();
}

/** Number of HOI modals currently open. */
export function openModalCount() {
    return stack.length;
}
