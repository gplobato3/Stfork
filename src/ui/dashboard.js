/**
 * @file src/ui/dashboard.js
 * Ruler "war room" dashboard renderer (Module D).
 *
 * renderDashboard(container, world) builds the player's 7 resource gauges, the
 * global tension / WW3 meter, the active-crises list, a color-coded diplomacy
 * panel, the current date/turn, and the turn-advance control.
 *
 * Rendering strategy: try ST's Handlebars template (templates/dashboard.html)
 * via renderTemplate(); if ST is not live (node / template missing) fall back
 * to building the DOM programmatically so the view is testable/visible anywhere.
 * All non-trivial logic lives in the PURE buildDashboardViewModel (viewModels.js).
 *
 * Node-safe: DOM access is guarded.
 */

import { t } from '../i18n/i18n.js';
import { PHASES } from '../contract/worldState.js';
import { buildDashboardViewModel } from './viewModels.js';
import { renderTemplate, patchHtml, el, isElement } from './render.js';

/** Map a phase constant to its i18n label key. */
const PHASE_LABEL_KEYS = {
    [PHASES.SETUP]: 'hoi_phase_setup',
    [PHASES.PLAYER_TURN]: 'hoi_phase_player_turn',
    [PHASES.RESOLVING]: 'hoi_phase_resolving',
    [PHASES.GAME_OVER]: 'hoi_phase_game_over',
};

/**
 * Translate the pure view-model into the flat, pt-BR data object the Handlebars
 * template expects (all labels already run through t()).
 * @param {import('../contract/worldState.js').WorldState} world
 * @returns {Object}
 */
export function buildDashboardTemplateData(world) {
    const vm = buildDashboardViewModel(world);
    return {
        hasNation: vm.hasNation,
        nation: vm.nation || { flagEmoji: '', name: t('hoi_dashboard_no_nation'), leaderTitle: '', government: '' },
        turnLabel: t('hoi_turn_label', { turn: vm.turn }),
        dateLabel: t('hoi_date_label', { month: vm.date.month, year: vm.date.year }),
        phase: vm.phase,
        phaseLabel: t(PHASE_LABEL_KEYS[vm.phase] || 'hoi_phase_setup'),
        tensionLabel: t('hoi_tension_label'),
        tension: {
            value: vm.tension.value,
            pct: vm.tension.pct,
            color: vm.tension.color,
            levelLabel: t(vm.tension.labelKey),
        },
        resourcesLabel: t('hoi_dashboard_resources_label'),
        resources: vm.resources.map((r) => ({
            key: r.key,
            label: t(r.labelKey),
            value: r.value,
            pct: r.pct,
        })),
        relationsLabel: t('hoi_relations_label'),
        relations: vm.relations.map((r) => ({
            id: r.id,
            name: r.name,
            flagEmoji: r.flagEmoji,
            bloc: r.bloc,
            blocColor: r.blocColor,
            score: r.score,
            color: r.color,
            tierLabel: t(r.tierLabelKey),
        })),
        crisesLabel: t('hoi_crises_label'),
        noCrisesLabel: t('hoi_no_crises'),
        crises: vm.crises.map((c) => ({
            id: c.id,
            title: c.title,
            description: c.description,
            severity: c.severity,
            severityLabel: t(c.severityLabelKey),
        })),
        nextTurnLabel: t('hoi_btn_next_turn'),
    };
}

/**
 * Render the dashboard into `container`.
 * @param {HTMLElement} container
 * @param {import('../contract/worldState.js').WorldState} world
 * @param {Object} [opts]
 * @param {()=>void} [opts.onNextTurn] Handler for the turn-advance button.
 * @param {(nationId:string)=>void} [opts.onSelectNation] Click a relation row.
 * @returns {Promise<void>}
 */
export async function renderDashboard(container, world, opts = {}) {
    if (!isElement(container)) return;
    container.classList.add('hoi-dashboard-host');

    const data = buildDashboardTemplateData(world);
    const html = await renderTemplate('dashboard', data);

    if (html) {
        patchHtml(container, html);
    } else {
        container.textContent = '';
        container.appendChild(buildDashboardDom(container.ownerDocument, data));
    }

    wireDashboard(container, opts);
}

/** Attach click handlers after (re)render. */
function wireDashboard(container, opts) {
    const onNext = typeof opts.onNextTurn === 'function' ? opts.onNextTurn : null;
    const onSelect = typeof opts.onSelectNation === 'function' ? opts.onSelectNation : null;

    if (onNext) {
        const btn = container.querySelector('[data-action="next-turn"]');
        if (btn) btn.addEventListener('click', onNext);
    }
    if (onSelect) {
        const rows = container.querySelectorAll('.hoi-rel[data-nation]');
        rows.forEach((row) => {
            row.addEventListener('click', () => onSelect(row.getAttribute('data-nation')));
        });
    }
}

/**
 * Programmatic DOM fallback mirroring templates/dashboard.html (used when ST is
 * not live). Returns a detached element.
 * @param {Document} doc
 * @param {Object} data buildDashboardTemplateData() output
 * @returns {HTMLElement}
 */
function buildDashboardDom(doc, data) {
    const root = el(doc, 'div', { className: 'hoi-dashboard' });

    // Header
    const header = el(doc, 'header', { className: 'hoi-dash__header' });
    const identity = el(doc, 'div', { className: 'hoi-dash__identity' });
    identity.appendChild(el(doc, 'span', { className: 'hoi-dash__flag', text: data.nation.flagEmoji }));
    const titles = el(doc, 'div', { className: 'hoi-dash__titles' });
    titles.appendChild(el(doc, 'div', { className: 'hoi-dash__nation', text: data.nation.name }));
    titles.appendChild(el(doc, 'div', {
        className: 'hoi-dash__leader',
        text: `${data.nation.leaderTitle} \u00b7 ${data.nation.government}`,
    }));
    identity.appendChild(titles);
    const meta = el(doc, 'div', { className: 'hoi-dash__meta' });
    meta.appendChild(el(doc, 'div', { className: 'hoi-dash__turn', text: data.turnLabel }));
    meta.appendChild(el(doc, 'div', { className: 'hoi-dash__date', text: data.dateLabel }));
    meta.appendChild(el(doc, 'div', { className: 'hoi-dash__phase', attrs: { 'data-phase': data.phase }, text: data.phaseLabel }));
    header.append(identity, meta);
    root.appendChild(header);

    // Tension
    const tSec = section(doc, data.tensionLabel, 'hoi-dash__tension');
    const level = el(doc, 'span', { className: 'hoi-dash__tension-level', text: `${data.tension.levelLabel} \u00b7 ${data.tension.value}` });
    level.style.color = data.tension.color;
    tSec.querySelector('.hoi-dash__section-head').appendChild(level);
    tSec.appendChild(gauge(doc, data.tension.pct, data.tension.color, 'hoi-gauge--tension'));
    root.appendChild(tSec);

    // Resources
    const rSec = section(doc, data.resourcesLabel, 'hoi-dash__resources');
    const gauges = el(doc, 'div', { className: 'hoi-dash__gauges' });
    for (const r of data.resources) {
        const cell = el(doc, 'div', { className: 'hoi-res', attrs: { 'data-res': r.key } });
        const row = el(doc, 'div', { className: 'hoi-res__row' });
        row.appendChild(el(doc, 'span', { className: 'hoi-res__label', text: r.label }));
        row.appendChild(el(doc, 'span', { className: 'hoi-res__value', text: String(r.value) }));
        cell.appendChild(row);
        cell.appendChild(gauge(doc, r.pct, null));
        gauges.appendChild(cell);
    }
    rSec.appendChild(gauges);
    root.appendChild(rSec);

    // Diplomacy
    const dSec = section(doc, data.relationsLabel, 'hoi-dash__diplomacy');
    const relList = el(doc, 'ul', { className: 'hoi-dash__relations' });
    for (const rel of data.relations) {
        const li = el(doc, 'li', { className: 'hoi-rel', attrs: { 'data-nation': rel.id } });
        li.appendChild(el(doc, 'span', { className: 'hoi-rel__flag', text: rel.flagEmoji }));
        li.appendChild(el(doc, 'span', { className: 'hoi-rel__name', text: rel.name }));
        const bloc = el(doc, 'span', { className: 'hoi-rel__bloc', text: rel.bloc });
        bloc.style.color = rel.blocColor;
        li.appendChild(bloc);
        const tier = el(doc, 'span', { className: 'hoi-rel__tier', text: `${rel.tierLabel} (${rel.score})` });
        tier.style.color = rel.color;
        li.appendChild(tier);
        relList.appendChild(li);
    }
    dSec.appendChild(relList);
    root.appendChild(dSec);

    // Crises
    const cSec = section(doc, data.crisesLabel, 'hoi-dash__crises');
    if (data.crises.length) {
        const list = el(doc, 'ul', { className: 'hoi-dash__crisis-list' });
        for (const c of data.crises) {
            const li = el(doc, 'li', { className: 'hoi-crisis', attrs: { 'data-severity': c.severity } });
            li.appendChild(el(doc, 'span', { className: 'hoi-crisis__sev', text: c.severityLabel }));
            li.appendChild(el(doc, 'span', { className: 'hoi-crisis__title', text: c.title }));
            li.appendChild(el(doc, 'span', { className: 'hoi-crisis__desc', text: c.description }));
            list.appendChild(li);
        }
        cSec.appendChild(list);
    } else {
        cSec.appendChild(el(doc, 'div', { className: 'hoi-dash__empty', text: data.noCrisesLabel }));
    }
    root.appendChild(cSec);

    // Footer
    const footer = el(doc, 'footer', { className: 'hoi-dash__footer' });
    const nextBtn = el(doc, 'button', {
        className: 'hoi-btn hoi-btn--primary',
        attrs: { type: 'button', 'data-action': 'next-turn' },
        text: data.nextTurnLabel,
    });
    footer.appendChild(nextBtn);
    root.appendChild(footer);

    return root;
}

function section(doc, title, extraClass) {
    const sec = el(doc, 'section', { className: `hoi-dash__section ${extraClass}` });
    const head = el(doc, 'div', { className: 'hoi-dash__section-head' });
    head.appendChild(el(doc, 'span', { text: title }));
    sec.appendChild(head);
    return sec;
}

function gauge(doc, pct, color, extraClass) {
    const g = el(doc, 'div', { className: 'hoi-gauge' + (extraClass ? ' ' + extraClass : '') });
    g.setAttribute('role', 'meter');
    g.setAttribute('aria-valuenow', String(pct));
    g.setAttribute('aria-valuemin', '0');
    g.setAttribute('aria-valuemax', '100');
    const fill = el(doc, 'div', { className: 'hoi-gauge__fill' });
    fill.style.width = pct + '%';
    if (color) fill.style.background = color;
    g.appendChild(fill);
    return g;
}
