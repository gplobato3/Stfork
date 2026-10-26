/**
 * @file src/ui/nationPicker.js
 * New Game nation-selection flow (Module D).
 *
 * showNationPicker(container, scenario, onPick, opts) renders a browsable list
 * of featured major powers + the full roster, shows each nation's starting
 * stats + traits + leaderTitle in a detail pane, and calls onPick(nationId)
 * when the player confirms.
 *
 * `scenario` may be a ScenarioData ({nations, ...}) or a plain {nations} map.
 * A nationIds[] can be passed via opts.playableIds to restrict choices.
 *
 * Rendering: Handlebars template (templates/nationPicker.html) when ST is live,
 * else a programmatic DOM fallback. Pure list logic is buildNationPickerList().
 * Node-safe.
 */

import { t } from '../i18n/i18n.js';
import { buildNationPickerList } from './viewModels.js';
import { renderTemplate, patchHtml, el, isElement } from './render.js';

/**
 * Build the pt-BR template data for the picker.
 * @param {object} scenario
 * @param {Object} [opts]
 * @returns {Object}
 */
export function buildNationPickerTemplateData(scenario, opts = {}) {
    const list = buildNationPickerList(scenario, {
        playableIds: opts.playableIds,
        featuredIds: opts.featuredIds,
    });
    return {
        title: t('hoi_picker_title'),
        hint: t('hoi_picker_hint'),
        searchPlaceholder: t('hoi_picker_search_placeholder'),
        featuredLabel: t('hoi_picker_featured_label'),
        allLabel: t('hoi_picker_all_label'),
        emptyLabel: t('hoi_picker_empty'),
        selectPrompt: t('hoi_picker_select_prompt'),
        cancelLabel: t('hoi_btn_cancel'),
        confirmLabel: t('hoi_btn_confirm'),
        featured: list.featured,
        all: list.all,
    };
}

/**
 * Render the nation picker and wire selection/confirm.
 * @param {HTMLElement} container
 * @param {object} scenario  ScenarioData or {nations}
 * @param {(nationId:string)=>void} onPick
 * @param {Object} [opts]
 * @param {string[]} [opts.playableIds]
 * @param {string[]} [opts.featuredIds]
 * @param {()=>void} [opts.onCancel]
 * @returns {Promise<void>}
 */
export async function showNationPicker(container, scenario, onPick, opts = {}) {
    if (!isElement(container)) return;
    container.classList.add('hoi-picker-host');

    const list = buildNationPickerList(scenario, {
        playableIds: opts.playableIds,
        featuredIds: opts.featuredIds,
    });
    // Index by id so the detail pane can look up full entries.
    const byId = new Map();
    for (const e of list.all) byId.set(e.id, e);
    for (const e of list.featured) if (!byId.has(e.id)) byId.set(e.id, e);

    const data = buildNationPickerTemplateData(scenario, opts);
    const html = await renderTemplate('nationPicker', data);
    if (html) {
        patchHtml(container, html);
    } else {
        container.textContent = '';
        container.appendChild(buildPickerDom(container.ownerDocument, data));
    }

    wirePicker(container, byId, onPick, opts);
}

function wirePicker(container, byId, onPick, opts) {
    const doc = container.ownerDocument;
    const detail = container.querySelector('[data-role="picker-detail"]');
    const confirmBtn = container.querySelector('[data-action="picker-confirm"]');
    const cancelBtn = container.querySelector('[data-action="picker-cancel"]');
    const search = container.querySelector('[data-role="picker-search"]');
    let selectedId = null;

    const select = (id) => {
        const entry = byId.get(id);
        if (!entry) return;
        selectedId = id;
        container.querySelectorAll('[data-nation]').forEach((n) => {
            n.classList.toggle('is-selected', n.getAttribute('data-nation') === id);
        });
        if (detail) {
            detail.textContent = '';
            detail.appendChild(buildDetail(doc, entry));
        }
        if (confirmBtn) confirmBtn.disabled = false;
    };

    container.querySelectorAll('[data-nation]').forEach((node) => {
        node.addEventListener('click', () => select(node.getAttribute('data-nation')));
    });

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            if (selectedId && typeof onPick === 'function') onPick(selectedId);
        });
    }
    if (cancelBtn && typeof opts.onCancel === 'function') {
        cancelBtn.addEventListener('click', () => opts.onCancel());
    }
    if (search) {
        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            container.querySelectorAll('.hoi-nation-row').forEach((row) => {
                const name = (row.getAttribute('data-name') || '').toLowerCase();
                row.style.display = !q || name.includes(q) ? '' : 'none';
            });
        });
    }
}

/**
 * Build the detail pane for a selected nation entry.
 * @param {Document} doc
 * @param {object} entry buildNationPickerList entry
 * @returns {HTMLElement}
 */
function buildDetail(doc, entry) {
    const wrap = el(doc, 'div', { className: 'hoi-nation-detail' });

    const head = el(doc, 'div', { className: 'hoi-nation-detail__head' });
    head.appendChild(el(doc, 'span', { className: 'hoi-nation-detail__flag', text: entry.flagEmoji }));
    const htitles = el(doc, 'div', {});
    htitles.appendChild(el(doc, 'div', { className: 'hoi-nation-detail__name', text: entry.name }));
    htitles.appendChild(el(doc, 'div', {
        className: 'hoi-nation-detail__leader',
        text: `${entry.leaderTitle}${entry.government ? ' \u00b7 ' + entry.government : ''}`,
    }));
    head.appendChild(htitles);
    wrap.appendChild(head);

    const facts = el(doc, 'div', { className: 'hoi-nation-detail__facts' });
    facts.appendChild(fact(doc, t('hoi_capital_label'), entry.capital));
    facts.appendChild(fact(doc, t('hoi_bloc_label'), entry.bloc));
    facts.appendChild(fact(doc, t('hoi_government_label'), entry.government));
    wrap.appendChild(facts);

    // Starting stats
    const statsTitle = el(doc, 'div', { className: 'hoi-nation-detail__subtitle', text: t('hoi_picker_stats_label') });
    wrap.appendChild(statsTitle);
    const stats = el(doc, 'div', { className: 'hoi-nation-detail__stats' });
    for (const r of entry.resources) {
        const cell = el(doc, 'div', { className: 'hoi-stat', attrs: { 'data-res': r.key } });
        const row = el(doc, 'div', { className: 'hoi-stat__row' });
        row.appendChild(el(doc, 'span', { className: 'hoi-stat__label', text: t(r.labelKey) }));
        row.appendChild(el(doc, 'span', { className: 'hoi-stat__value', text: String(r.value) }));
        cell.appendChild(row);
        const g = el(doc, 'div', { className: 'hoi-gauge' });
        const fill = el(doc, 'div', { className: 'hoi-gauge__fill' });
        fill.style.width = r.value + '%';
        g.appendChild(fill);
        cell.appendChild(g);
        stats.appendChild(cell);
    }
    wrap.appendChild(stats);

    // Traits
    if (entry.traits && entry.traits.length) {
        const traitsTitle = el(doc, 'div', { className: 'hoi-nation-detail__subtitle', text: t('hoi_traits_label') });
        wrap.appendChild(traitsTitle);
        const traits = el(doc, 'div', { className: 'hoi-nation-detail__traits' });
        for (const trait of entry.traits) {
            traits.appendChild(el(doc, 'span', { className: 'hoi-trait', text: trait }));
        }
        wrap.appendChild(traits);
    }

    return wrap;
}

function fact(doc, label, value) {
    const f = el(doc, 'div', { className: 'hoi-fact' });
    f.appendChild(el(doc, 'span', { className: 'hoi-fact__label', text: label }));
    f.appendChild(el(doc, 'span', { className: 'hoi-fact__value', text: value || '\u2014' }));
    return f;
}

/**
 * Programmatic DOM fallback mirroring templates/nationPicker.html.
 * @param {Document} doc
 * @param {Object} data
 * @returns {HTMLElement}
 */
function buildPickerDom(doc, data) {
    const root = el(doc, 'div', { className: 'hoi-picker' });

    const header = el(doc, 'header', { className: 'hoi-picker__header' });
    header.appendChild(el(doc, 'h2', { className: 'hoi-picker__title', text: data.title }));
    header.appendChild(el(doc, 'p', { className: 'hoi-picker__hint', text: data.hint }));
    const search = el(doc, 'input', {
        className: 'hoi-picker__search',
        attrs: { type: 'search', placeholder: data.searchPlaceholder, 'data-role': 'picker-search' },
    });
    header.appendChild(search);
    root.appendChild(header);

    const body = el(doc, 'div', { className: 'hoi-picker__body' });
    const lists = el(doc, 'div', { className: 'hoi-picker__lists' });

    if (data.featured.length) {
        const group = el(doc, 'div', { className: 'hoi-picker__group' });
        group.appendChild(el(doc, 'div', { className: 'hoi-picker__group-title', text: data.featuredLabel }));
        const grid = el(doc, 'div', { className: 'hoi-picker__featured' });
        for (const n of data.featured) {
            const card = el(doc, 'button', {
                className: 'hoi-nation-card is-featured',
                attrs: { type: 'button', 'data-nation': n.id },
            });
            card.appendChild(el(doc, 'span', { className: 'hoi-nation-card__flag', text: n.flagEmoji }));
            card.appendChild(el(doc, 'span', { className: 'hoi-nation-card__name', text: n.name }));
            const bloc = el(doc, 'span', { className: 'hoi-nation-card__bloc', text: n.bloc });
            bloc.style.color = n.blocColor;
            card.appendChild(bloc);
            card.appendChild(el(doc, 'span', { className: 'hoi-nation-card__power', text: String(n.power) }));
            grid.appendChild(card);
        }
        group.appendChild(grid);
        lists.appendChild(group);
    }

    const allGroup = el(doc, 'div', { className: 'hoi-picker__group' });
    allGroup.appendChild(el(doc, 'div', { className: 'hoi-picker__group-title', text: data.allLabel }));
    if (data.all.length) {
        const allWrap = el(doc, 'div', { className: 'hoi-picker__all', attrs: { 'data-role': 'picker-all' } });
        for (const n of data.all) {
            const row = el(doc, 'button', {
                className: 'hoi-nation-row',
                attrs: { type: 'button', 'data-nation': n.id, 'data-name': n.name },
            });
            row.appendChild(el(doc, 'span', { className: 'hoi-nation-row__flag', text: n.flagEmoji }));
            row.appendChild(el(doc, 'span', { className: 'hoi-nation-row__name', text: n.name }));
            const bloc = el(doc, 'span', { className: 'hoi-nation-row__bloc', text: n.bloc });
            bloc.style.color = n.blocColor;
            row.appendChild(bloc);
            allWrap.appendChild(row);
        }
        allGroup.appendChild(allWrap);
    } else {
        allGroup.appendChild(el(doc, 'div', { className: 'hoi-picker__empty', text: data.emptyLabel }));
    }
    lists.appendChild(allGroup);
    body.appendChild(lists);

    const detail = el(doc, 'aside', { className: 'hoi-picker__detail', attrs: { 'data-role': 'picker-detail' } });
    detail.appendChild(el(doc, 'div', { className: 'hoi-picker__detail-empty', text: data.selectPrompt }));
    body.appendChild(detail);
    root.appendChild(body);

    const footer = el(doc, 'footer', { className: 'hoi-picker__footer' });
    footer.appendChild(el(doc, 'button', {
        className: 'hoi-btn',
        attrs: { type: 'button', 'data-action': 'picker-cancel' },
        text: data.cancelLabel,
    }));
    const confirm = el(doc, 'button', {
        className: 'hoi-btn hoi-btn--primary',
        attrs: { type: 'button', 'data-action': 'picker-confirm' },
        text: data.confirmLabel,
    });
    confirm.disabled = true;
    footer.appendChild(confirm);
    root.appendChild(footer);

    return root;
}
