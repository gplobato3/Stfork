/**
 * @file src/ui/dialogs/eventDialog.js
 * HOI4-style decision event: art header, category/source/date, title,
 * narrative, wire headlines, involved nations and large option buttons with
 * effect preview chips.
 *
 * Contract (DESIGN §6.2):
 *   openEventDialog({ event, state, assetUrl, showArt, dismissible }) -> Promise<number|null>
 * Resolves the chosen option index, or null when postponed ("Decidir depois",
 * Esc, backdrop) — only possible when dismissible. Keys 1-4 pick an option.
 * All event text is untrusted (LLM): rendered with textContent only.
 */

import { EVENT_CATEGORIES } from '../../contract/constants.js';
import { formatDate } from '../../contract/presentation.js';
import { describeEffect } from './effectPreview.js';
import { flagEl, h, icon, isTypingTarget, paragraphs, urlFor } from './dom.js';
import { openModal } from './modalHost.js';

/** pt-BR label + Font Awesome icon + accent per EVENT_CATEGORIES entry. */
export const EVENT_CATEGORY_META = Object.freeze({
    diplomacy: { label: 'Diplomacia', icon: 'fa-solid fa-handshake', color: '#4a7fb5' },
    military: { label: 'Militar', icon: 'fa-solid fa-person-rifle', color: '#8a9a5b' },
    naval: { label: 'Naval', icon: 'fa-solid fa-anchor', color: '#3f7f9a' },
    nuclear: { label: 'Nuclear', icon: 'fa-solid fa-radiation', color: '#d0453a' },
    economy: { label: 'Economia', icon: 'fa-solid fa-chart-line', color: '#c9a227' },
    unrest: { label: 'Agitação Interna', icon: 'fa-solid fa-bullhorn', color: '#d9733a' },
    cyber: { label: 'Guerra Cibernética', icon: 'fa-solid fa-laptop-code', color: '#3fa39a' },
    intel: { label: 'Inteligência', icon: 'fa-solid fa-user-secret', color: '#7d74b5' },
    humanitarian: { label: 'Crise Humanitária', icon: 'fa-solid fa-hand-holding-heart', color: '#c77b8b' },
    tech: { label: 'Tecnologia', icon: 'fa-solid fa-microchip', color: '#4fa3c9' },
    politics: { label: 'Política', icon: 'fa-solid fa-landmark', color: '#a7aa9e' },
    energy: { label: 'Energia', icon: 'fa-solid fa-bolt', color: '#e0b43a' },
    war: { label: 'Guerra', icon: 'fa-solid fa-burst', color: '#c4473a' },
});

/** Badge describing where the decision comes from. */
export const EVENT_SOURCE_META = Object.freeze({
    llm: { label: 'Despacho de Inteligência', icon: 'fa-solid fa-satellite-dish' },
    engine: { label: 'Diplomacia', icon: 'fa-solid fa-envelope-open-text' },
    fallback: { label: 'Expediente de Governo', icon: 'fa-solid fa-landmark' },
});

/** Category id with a safe default ('politics', as sanitizeEvent does). */
export function eventCategory(event) {
    const c = event && event.category;
    return EVENT_CATEGORIES.includes(c) && EVENT_CATEGORY_META[c] ? c : 'politics';
}

/** Source badge meta; avoids "Diplomacia · Diplomacia" for engine diplomacy events. */
export function eventSourceMeta(event) {
    const src = event && EVENT_SOURCE_META[event.source] ? event.source : 'llm';
    if (src === 'engine' && eventCategory(event) === 'diplomacy') {
        return { label: 'Comunicado Oficial', icon: EVENT_SOURCE_META.engine.icon };
    }
    return EVENT_SOURCE_META[src];
}

function optionEffectsRow(option, state) {
    const effects = (Array.isArray(option.effects) ? option.effects : []).filter((e) => e && typeof e === 'object' && e.type !== 'flag');
    const row = h('span', { className: 'hoi-event-option__effects' });
    if (!effects.length) {
        row.appendChild(h('span', { className: 'hoi-chip hoi-event-chip hoi-event-chip--none', text: 'Sem efeitos imediatos' }));
        return row;
    }
    for (const eff of effects) {
        const d = describeEffect(eff, state);
        const toneCls = d.tone === 'good' ? ' hoi-chip--good' : d.tone === 'bad' ? ' hoi-chip--bad' : '';
        const chip = h('span', {
            className: `hoi-chip hoi-event-chip${toneCls}`,
            attrs: { title: eff.note ? String(eff.note) : null },
        }, icon(d.icon), h('span', { text: d.text }));
        row.appendChild(chip);
    }
    return row;
}

/**
 * @param {Object} opts
 * @param {import('../../contract/events.js').GameEvent} opts.event
 * @param {?import('../../contract/worldState.js').WorldState} opts.state
 * @param {(path: string) => string} [opts.assetUrl]
 * @param {boolean} [opts.showArt=true]
 * @param {boolean} [opts.dismissible=true]
 * @returns {Promise<number|null>}
 */
export function openEventDialog({ event, state, assetUrl, showArt = true, dismissible = true } = {}) {
    return new Promise((resolve) => {
        const ev = event && typeof event === 'object' ? event : {};
        const options = Array.isArray(ev.options) ? ev.options.filter((o) => o && typeof o === 'object') : [];
        // Without options there is nothing to choose: always allow postponing.
        const canPostpone = !!dismissible || !options.length;
        let settled = false;
        let handle = null;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
            if (handle) handle.close();
        };

        const category = eventCategory(ev);
        const cat = EVENT_CATEGORY_META[category];
        const source = eventSourceMeta(ev);
        const dateText = state && state.date ? formatDate(state.date) : '';

        // The article itself takes initial focus (tabindex -1) so the 1-4 hotkeys
        // work immediately and clicks on plain text keep focus inside it.
        const root = h('article', {
            className: `hoi-event hoi-event--${category}`,
            style: { '--hoi-event-accent': cat.color },
            attrs: { tabindex: '-1', 'data-hoi-autofocus': '' },
        });

        // ---------------------------------------------------------- header
        const art = h('div', { className: 'hoi-event__art' });
        const artSrc = showArt ? urlFor(assetUrl, `art/event-${category}.webp`) : '';
        if (artSrc) {
            const img = h('img', { className: 'hoi-event__art-img', attrs: { src: artSrc, alt: '', decoding: 'async', draggable: 'false' } });
            img.addEventListener('error', () => {
                img.remove();
                root.classList.add('hoi-event--noart');
            }, { once: true });
            art.appendChild(img);
        } else {
            root.classList.add('hoi-event--noart');
        }
        art.appendChild(h('div', { className: 'hoi-event__art-fade', attrs: { 'aria-hidden': 'true' } }));
        art.appendChild(h('div', { className: 'hoi-event__watermark', attrs: { 'aria-hidden': 'true' } }, icon(cat.icon)));

        const meta = h('div', { className: 'hoi-event__meta' },
            h('span', { className: 'hoi-chip hoi-event__category' }, icon(cat.icon), h('span', { text: cat.label })),
            h('span', { className: `hoi-chip hoi-chip--brass hoi-event__source hoi-event__source--${ev.source || 'llm'}` },
                icon(source.icon), h('span', { text: source.label })),
            dateText ? h('span', { className: 'hoi-event__date' }, icon('fa-solid fa-calendar-days'), h('span', { text: dateText })) : null);

        const title = h('h2', {
            className: 'hoi-event__title',
            text: String(ev.title || 'Decisão de Governo'),
            attrs: { 'data-hoi-modal-title': '' },
        });
        art.appendChild(h('div', { className: 'hoi-event__heading' }, meta, title));
        root.appendChild(art);

        // ------------------------------------------------------------ body
        const story = h('div', { className: 'hoi-event__story hoi-scroll' });
        const narrative = paragraphs(ev.narrative, 'hoi-event__p');
        story.appendChild(h('div', { className: 'hoi-event__narrative' },
            narrative.length ? narrative : [h('p', { className: 'hoi-event__p hoi-dim', text: 'Sem relatório detalhado.' })]));

        const headlines = (Array.isArray(ev.headlines) ? ev.headlines : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4);
        if (headlines.length) {
            story.appendChild(h('section', { className: 'hoi-ev-wire', attrs: { 'aria-label': 'Telegramas das agências' } },
                h('div', { className: 'hoi-ev-wire__head' }, icon('fa-tower-broadcast'), h('span', { text: 'Telegramas das agências' })),
                h('ul', { className: 'hoi-ev-wire__list' }, headlines.map((line, i) => h('li', { className: 'hoi-ev-wire__item' },
                    h('span', { className: 'hoi-ev-wire__tag', text: i === 0 ? 'Urgente' : 'Plantão' }),
                    h('span', { className: 'hoi-ev-wire__text', text: line }))))));
        }

        const nations = (state && state.nations) || {};
        const involved = [...new Set(Array.isArray(ev.involved) ? ev.involved : [])].filter((id) => nations[id]).slice(0, 10);
        if (involved.length) {
            story.appendChild(h('section', { className: 'hoi-event__involved' },
                h('div', { className: 'hoi-event__label', text: 'Nações envolvidas' }),
                h('div', { className: 'hoi-event__flags' }, involved.map((id) => h('span', {
                    className: `hoi-chip hoi-event__nation${state && state.player && state.player.nationId === id ? ' is-player' : ''}`,
                }, flagEl(assetUrl, nations[id], 'sm'), h('span', { text: nations[id].name || id }))))));
        }

        // --------------------------------------------------------- options
        const decision = h('div', { className: 'hoi-event__decision' });
        decision.appendChild(h('div', { className: 'hoi-event__label hoi-event__label--decision' },
            icon('fa-gavel'), h('span', { text: 'Sua decisão' })));
        const list = h('div', { className: 'hoi-event__options', attrs: { role: 'group', 'aria-label': 'Opções' } });
        options.forEach((opt, i) => {
            const n = i + 1;
            const btn = h('button', {
                className: 'hoi-event-option',
                attrs: { type: 'button', 'aria-keyshortcuts': n <= 9 ? String(n) : null },
                on: { click: () => finish(i) },
            },
            h('span', { className: 'hoi-event-option__key', text: String(n), attrs: { 'aria-hidden': 'true' } }),
            h('span', { className: 'hoi-event-option__main' },
                h('span', { className: 'hoi-event-option__label', text: String(opt.label || `Opção ${n}`) }),
                opt.rationale ? h('span', { className: 'hoi-event-option__rationale', text: String(opt.rationale) }) : null,
                optionEffectsRow(opt, state)));
            list.appendChild(btn);
        });
        if (!options.length) {
            list.appendChild(h('p', { className: 'hoi-dim', text: 'Nenhuma opção disponível para esta decisão.' }));
        }
        decision.appendChild(list);

        const foot = h('div', { className: 'hoi-event__foot' },
            options.length ? h('span', { className: 'hoi-event__hint hoi-faint' },
                icon('fa-solid fa-keyboard'),
                h('span', { text: options.length > 1 ? `Teclas 1–${Math.min(options.length, 9)} escolhem` : 'Tecla 1 escolhe' })) : h('span'),
            canPostpone ? h('button', {
                className: 'hoi-btn hoi-btn--ghost hoi-event__later',
                attrs: { type: 'button' },
                on: { click: () => finish(null) },
            }, icon('fa-solid fa-clock'), h('span', { text: 'Decidir depois' })) : null);
        decision.appendChild(foot);

        root.appendChild(h('div', { className: 'hoi-event__columns' }, story, decision));

        root.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
            const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '') || /^([1-9])$/.exec(e.key || '');
            if (!m) return;
            const idx = Number(m[1]) - 1;
            if (idx < options.length) {
                e.preventDefault();
                finish(idx);
            }
        });

        handle = openModal({
            className: 'hoi-modal--event',
            content: root,
            dismissible: canPostpone,
            onDismiss: () => finish(null),
        });
    });
}
