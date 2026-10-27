/**
 * @file src/ui/dialogs/confirm.js
 * HOI-styled confirmation dialog.
 *
 * Contract (DESIGN §6.2):
 *   openConfirm({ title, text, okLabel, cancelLabel, danger }) -> Promise<boolean>
 * Esc / backdrop / cancel resolve false. Never rejects.
 */

import { h, icon, paragraphs } from './dom.js';
import { openModal } from './modalHost.js';

/**
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.text]
 * @param {string} [opts.okLabel='Confirmar']
 * @param {string} [opts.cancelLabel='Cancelar']
 * @param {boolean} [opts.danger=false]
 * @returns {Promise<boolean>}
 */
export function openConfirm({ title, text, okLabel, cancelLabel, danger } = {}) {
    return new Promise((resolve) => {
        let settled = false;
        let handle = null;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
            if (handle) handle.close();
        };

        const ok = h('button', {
            className: `hoi-btn hoi-btn--lg ${danger ? 'hoi-btn--danger' : 'hoi-btn--primary'}`,
            attrs: { type: 'button' },
            on: { click: () => finish(true) },
        }, icon(danger ? 'fa-triangle-exclamation' : 'fa-check'), h('span', { text: okLabel || 'Confirmar' }));
        const cancel = h('button', {
            className: 'hoi-btn hoi-btn--lg',
            attrs: { type: 'button' },
            on: { click: () => finish(false) },
        }, h('span', { text: cancelLabel || 'Cancelar' }));
        // Safer default focus for destructive actions.
        (danger ? cancel : ok).setAttribute('data-hoi-autofocus', '');

        const content = h('div', { className: `hoi-confirm${danger ? ' hoi-confirm--danger' : ''}` },
            h('div', { className: 'hoi-confirm__emblem', attrs: { 'aria-hidden': 'true' } },
                icon(danger ? 'fa-triangle-exclamation' : 'fa-circle-question')),
            h('div', { className: 'hoi-confirm__body' },
                h('h2', { className: 'hoi-title hoi-confirm__title', text: title || 'Confirmar', attrs: { 'data-hoi-modal-title': '' } }),
                h('div', { className: 'hoi-confirm__text' }, paragraphs(text))),
            h('div', { className: 'hoi-confirm__actions' }, cancel, ok));

        handle = openModal({
            className: 'hoi-modal--confirm',
            content,
            dismissible: true,
            onDismiss: () => finish(false),
        });
    });
}
