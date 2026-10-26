/**
 * @file src/ui/eventModal.js
 * Per-turn event / decision modal (Module D).
 *
 * showEventModal(container, event, onChoose) renders a GameEvent (pt-BR title +
 * narrative + 2..4 options with rationale) and calls onChoose(optionId) when the
 * player clicks an option. It also exposes loading and error/fallback states so
 * the controller (FEAT-006) can show "generating..." while the LLM works and a
 * retry affordance if generation fails.
 *
 * Pure projection is buildEventViewModel() (viewModels.js). Rendering uses the
 * Handlebars template (templates/eventModal.html) when ST is live, else a
 * programmatic DOM fallback. Node-safe.
 */

import { t } from '../i18n/i18n.js';
import { buildEventViewModel, tensionViewModel } from './viewModels.js';
import { renderTemplate, patchHtml, el, isElement } from './render.js';

/**
 * Build pt-BR template data for an event.
 * @param {import('../contract/events.js').GameEvent} event
 * @returns {Object}
 */
export function buildEventTemplateData(event) {
    const vm = buildEventViewModel(event);
    let tensionBadge = '';
    let tensionColor = '';
    if (vm.tensionDelta) {
        const sign = vm.tensionDelta > 0 ? '+' : '';
        tensionBadge = `${t('hoi_tension_label')} ${sign}${vm.tensionDelta}`;
        // Positive delta = escalation (danger color), negative = calming.
        tensionColor = tensionViewModel(vm.tensionDelta > 0 ? 80 : 10).color;
    }
    return {
        id: vm.id,
        title: vm.title,
        narrative: vm.narrative,
        context: vm.context,
        hasContext: vm.hasContext,
        contextLabel: t('hoi_event_context_label'),
        optionsLabel: t('hoi_event_options_label'),
        rationaleLabel: t('hoi_event_rationale_label'),
        tensionBadge,
        tensionColor,
        options: vm.options.map((o) => ({
            id: o.id,
            label: o.label,
            rationale: o.rationale,
            hasRationale: o.hasRationale,
        })),
    };
}

/**
 * Render the event modal into `container` and wire option clicks.
 * @param {HTMLElement} container
 * @param {import('../contract/events.js').GameEvent} event
 * @param {(optionId:string)=>void} onChoose
 * @returns {Promise<void>}
 */
export async function showEventModal(container, event, onChoose) {
    if (!isElement(container)) return;
    container.classList.add('hoi-event-host');

    const data = buildEventTemplateData(event);
    const html = await renderTemplate('eventModal', data);
    if (html) {
        patchHtml(container, html);
    } else {
        container.textContent = '';
        container.appendChild(buildEventDom(container.ownerDocument, data));
    }

    const buttons = container.querySelectorAll('[data-option]');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            if (typeof onChoose === 'function') onChoose(btn.getAttribute('data-option'));
        });
    });
}

/**
 * Show a loading state while the turn event is generated.
 * @param {HTMLElement} container
 * @returns {void}
 */
export function showEventLoading(container) {
    if (!isElement(container)) return;
    const doc = container.ownerDocument;
    container.classList.add('hoi-event-host');
    container.textContent = '';
    const wrap = el(doc, 'div', { className: 'hoi-event hoi-event--loading' });
    wrap.appendChild(el(doc, 'div', { className: 'hoi-spinner' }));
    wrap.appendChild(el(doc, 'div', { className: 'hoi-event__loading-title', text: t('hoi_event_loading_title') }));
    wrap.appendChild(el(doc, 'div', { className: 'hoi-event__loading-desc', text: t('hoi_event_loading_desc') }));
    container.appendChild(wrap);
}

/**
 * Show an error / fallback state with an optional retry button.
 * @param {HTMLElement} container
 * @param {Object} [opts]
 * @param {()=>void} [opts.onRetry]
 * @param {string} [opts.message] pt-BR message override.
 * @returns {void}
 */
export function showEventError(container, opts = {}) {
    if (!isElement(container)) return;
    const doc = container.ownerDocument;
    container.classList.add('hoi-event-host');
    container.textContent = '';
    const wrap = el(doc, 'div', { className: 'hoi-event hoi-event--error' });
    wrap.appendChild(el(doc, 'div', { className: 'hoi-event__error-title', text: t('hoi_event_error_title') }));
    wrap.appendChild(el(doc, 'p', { className: 'hoi-event__error-msg', text: opts.message || t('hoi_err_generation') }));
    if (typeof opts.onRetry === 'function') {
        const retry = el(doc, 'button', {
            className: 'hoi-btn hoi-btn--primary',
            attrs: { type: 'button' },
            text: t('hoi_event_error_retry'),
        });
        retry.addEventListener('click', () => opts.onRetry());
        wrap.appendChild(retry);
    }
    container.appendChild(wrap);
}

/**
 * Programmatic DOM fallback mirroring templates/eventModal.html.
 * @param {Document} doc
 * @param {Object} data
 * @returns {HTMLElement}
 */
function buildEventDom(doc, data) {
    const root = el(doc, 'div', { className: 'hoi-event' });

    const header = el(doc, 'header', { className: 'hoi-event__header' });
    header.appendChild(el(doc, 'h3', { className: 'hoi-event__title', text: data.title }));
    if (data.tensionBadge) {
        const badge = el(doc, 'span', { className: 'hoi-event__tension', text: data.tensionBadge });
        badge.style.color = data.tensionColor;
        header.appendChild(badge);
    }
    root.appendChild(header);

    const body = el(doc, 'div', { className: 'hoi-event__body' });
    body.appendChild(el(doc, 'p', { className: 'hoi-event__narrative', text: data.narrative }));
    if (data.hasContext) {
        const ctx = el(doc, 'div', { className: 'hoi-event__context' });
        ctx.appendChild(el(doc, 'div', { className: 'hoi-event__context-label', text: data.contextLabel }));
        ctx.appendChild(el(doc, 'p', { text: data.context }));
        body.appendChild(ctx);
    }
    root.appendChild(body);

    const options = el(doc, 'div', { className: 'hoi-event__options', attrs: { 'data-role': 'event-options' } });
    options.appendChild(el(doc, 'div', { className: 'hoi-event__options-label', text: data.optionsLabel }));
    for (const o of data.options) {
        const btn = el(doc, 'button', {
            className: 'hoi-option',
            attrs: { type: 'button', 'data-option': o.id },
        });
        btn.appendChild(el(doc, 'span', { className: 'hoi-option__label', text: o.label }));
        if (o.hasRationale) {
            const rat = el(doc, 'span', { className: 'hoi-option__rationale' });
            rat.appendChild(el(doc, 'em', { text: data.rationaleLabel + ':' }));
            rat.appendChild(doc.createTextNode(' ' + o.rationale));
            btn.appendChild(rat);
        }
        options.appendChild(btn);
    }
    root.appendChild(options);

    return root;
}
