/**
 * @file src/ui/warroom/dossier.js
 * Right-hand dossier for the selected nation: identity, relation with the
 * player, power, resources, pacts, wars, occupation, crises, traits and the
 * catalog actions that target it.
 */

import { RESOURCE_KEYS } from '../../contract/constants.js';
import { RESOURCE_ICONS, RESOURCE_LABELS } from '../../contract/presentation.js';
import { createActionList } from './actionList.js';
import { clear, flagEl, h, icon, setText, toggleClass, updateFlag } from './dom.js';
import { dossierModel, groupActions } from './viewModel.js';

export function createDossier(ctx) {
    const flag = flagEl(ctx.assetUrl, null, 'lg');
    const name = h('h2', { class: 'hoi-title hoi-dos__name' });
    const gov = h('div', { class: 'hoi-dos__gov' });
    const chips = h('div', { class: 'hoi-dos__chips' });
    const focusBtn = h('button', { type: 'button', class: 'hoi-btn hoi-btn--ghost hoi-btn--icon hoi-dos__focus', title: 'Centralizar no mapa', 'aria-label': 'Centralizar no mapa' }, icon('fa-solid fa-location-crosshairs'));
    focusBtn.addEventListener('click', () => current && ctx.selectNation(current, { focus: true }));
    const head = h('header', { class: 'hoi-dos__head' },
        h('span', { class: 'hoi-dos__flagframe' }, flag),
        h('div', { class: 'hoi-dos__id' }, name, gov, chips),
        focusBtn);

    // Relation with the player
    const relTier = h('span', { class: 'hoi-dos__tier' });
    const relScore = h('span', { class: 'hoi-dos__score hoi-num' });
    const relFill = h('span', { class: 'hoi-dos__relfill' });
    const relation = h('section', { class: 'hoi-dos__rel' },
        h('div', { class: 'hoi-dos__relhead' }, h('span', { class: 'hoi-dos__k', text: 'Relação conosco' }), relTier, relScore),
        h('div', { class: 'hoi-dos__relbar' }, relFill, h('span', { class: 'hoi-dos__relmid' })));

    // Power + rank
    const powerVal = h('span', { class: 'hoi-dos__power hoi-num' });
    const rankVal = h('span', { class: 'hoi-dos__rank hoi-num' });
    const pcVal = h('span', { class: 'hoi-dos__pc hoi-num' });
    const stats = h('section', { class: 'hoi-dos__stats' },
        statBox('Poder', powerVal, 'fa-solid fa-chess-king'),
        statBox('Ranking', rankVal, 'fa-solid fa-ranking-star'),
        statBox('Cap. Político', pcVal, 'fa-solid fa-landmark'));

    // Resources
    const resRows = new Map();
    const resGrid = h('div', { class: 'hoi-dos__res' });
    for (const k of RESOURCE_KEYS) {
        const val = h('span', { class: 'hoi-dos__rval hoi-num' });
        const fill = h('span', { class: 'hoi-dos__rfill' });
        const row = h('div', { class: 'hoi-dos__r', dataset: { res: k } },
            h('span', { class: 'hoi-dos__ricon' }, icon(RESOURCE_ICONS[k])),
            h('span', { class: 'hoi-dos__rlbl', text: RESOURCE_LABELS[k] }),
            h('span', { class: 'hoi-dos__rbar' }, fill),
            val);
        resRows.set(k, { row, val, fill });
        resGrid.appendChild(row);
    }

    const facts = h('section', { class: 'hoi-dos__facts' });
    const traits = h('section', { class: 'hoi-dos__traits' });
    const blurb = h('p', { class: 'hoi-dos__blurb' });

    const actionsHead = h('div', { class: 'hoi-section-head' }, h('span', null, icon('fa-solid fa-chess'), h('span', { class: 'hoi-dos__acttitle' })), h('span', { class: 'hoi-faint hoi-hint', text: 'Custo · chance' }));
    const actions = createActionList(ctx, { emptyText: 'Nenhuma ação diplomática ou militar disponível contra este país.' });
    const selfNote = h('div', { class: 'hoi-dos__self' },
        icon('fa-solid fa-circle-info'),
        h('span', { text: 'Esta é a sua nação. As medidas internas, econômicas e militares estão na aba Governo.' }));
    const selfBtn = h('button', { type: 'button', class: 'hoi-btn', text: 'Abrir Governo' });
    selfBtn.addEventListener('click', () => ctx.openTab('gov'));
    selfNote.appendChild(selfBtn);
    const actionsSec = h('section', { class: 'hoi-dos__actions' }, actionsHead, actions.el);

    // Actions come right after relation/power: they are what the player came here for.
    const body = h('div', { class: 'hoi-dos__body' },
        relation,
        stats,
        selfNote,
        actionsSec,
        h('div', { class: 'hoi-section-head' }, h('span', null, icon('fa-solid fa-chart-column'), ' Recursos')),
        resGrid,
        facts,
        traits,
        blurb);
    const empty = h('div', { class: 'hoi-empty hoi-dos__empty' }, icon('fa-solid fa-hand-pointer'), h('span', { text: 'Selecione um país no mapa para abrir o dossiê.' }));
    const el = h('div', { class: 'hoi-dos hoi-scroll' }, head, body, empty);

    let current = null;
    let factsSig = '';

    function statBox(label, valueEl, ico) {
        return h('div', { class: 'hoi-dos__stat' }, icon(ico, 'hoi-dos__staticon'), h('div', null, h('div', { class: 'hoi-dos__k', text: label }), valueEl));
    }

    function nationLink(id, label) {
        const state = ctx.getState();
        const n = state && state.nations ? state.nations[id] : null;
        const b = h('button', { type: 'button', class: 'hoi-natchip', title: `Abrir dossiê: ${label}` }, flagEl(ctx.assetUrl, n || { id, name: label }, 'sm'), h('span', { text: label }));
        b.addEventListener('click', () => ctx.selectNation(id, { focus: true }));
        return b;
    }

    function factRow(label, ico, content) {
        return h('div', { class: 'hoi-dos__fact' }, h('div', { class: 'hoi-dos__k' }, icon(ico), ` ${label}`), h('div', { class: 'hoi-dos__v' }, content));
    }

    /** @param {?string} id selected nation id */
    function update(id) {
        current = id || null;
        const state = ctx.getState();
        let view = null;
        if (state && current && state.nations[current]) {
            try {
                view = ctx.query.getNationView(current);
            } catch (err) {
                console.error('[HOI] getNationView failed', err);
            }
        }
        const rankIdx = ctx.getRanking().findIndex((r) => r.id === current);
        const m = dossierModel(view, state, { rank: rankIdx >= 0 ? rankIdx + 1 : null });
        toggleClass(el, 'is-empty', !m);
        head.hidden = !m;
        body.hidden = !m;
        empty.hidden = !!m;
        if (!m) return;

        updateFlag(flag, ctx.assetUrl, m.nation, ' hoi-flag--lg');
        setText(name, m.name);
        setText(gov, [m.government, m.leaderTitle ? `chefe: ${m.leaderTitle}` : ''].filter(Boolean).join(' · '));
        clear(chips);
        const bloc = h('span', { class: 'hoi-chip hoi-dos__bloc', text: m.blocLabel });
        bloc.style.setProperty('--bloc', m.blocColor);
        chips.appendChild(bloc);
        if (m.isPlayer) chips.appendChild(h('span', { class: 'hoi-chip hoi-chip--brass' }, icon('fa-solid fa-crown'), h('span', { text: 'Sua nação' })));
        for (const c of m.statusChips) {
            const cls = c.tone === 'bad' ? 'hoi-chip--bad' : c.tone === 'brass' ? 'hoi-chip--brass' : '';
            chips.appendChild(h('span', { class: `hoi-chip ${cls}` }, c.icon ? icon(c.icon) : null, h('span', { text: c.text })));
        }

        relation.hidden = !m.relation;
        if (m.relation) {
            setText(relTier, m.relation.tierLabel);
            relTier.style.setProperty('--tier', m.relation.tierColor);
            setText(relScore, m.relation.scoreText);
            const half = Math.abs(m.relation.score) / 2;
            relFill.style.left = m.relation.score >= 0 ? '50%' : `${50 - half}%`;
            relFill.style.width = `${half}%`;
            relFill.style.background = m.relation.tierColor;
        }

        setText(powerVal, String(m.power));
        setText(rankVal, m.rank ? `${m.rank}º` : '—');
        setText(pcVal, String(m.pc));

        for (const r of m.resources) {
            const row = resRows.get(r.key);
            setText(row.val, String(r.value));
            row.fill.style.width = `${r.value}%`;
            row.row.dataset.level = r.value < 25 ? 'low' : r.value >= 70 ? 'high' : 'mid';
        }

        const sig = JSON.stringify([m.id, m.capital, m.nuclearLabel, m.pacts, m.atWarWith, m.allies, m.occupation, m.crises, m.traits, m.blurb]);
        if (sig !== factsSig) {
            factsSig = sig;
            clear(facts);
            if (m.capital) facts.appendChild(factRow('Capital', 'fa-solid fa-location-dot', h('span', { text: m.capital })));
            facts.appendChild(factRow('Arsenal', 'fa-solid fa-radiation', h('span', { text: m.nuclearLabel })));
            if (m.atWarWith.length) facts.appendChild(factRow('Em guerra com', 'fa-solid fa-person-rifle', h('div', { class: 'hoi-dos__links is-war' }, m.atWarWith.map((x) => nationLink(x.id, x.name)))));
            if (m.occupation) {
                const b = h('div', { class: 'hoi-bar', title: `${m.occupation.pct}% ocupado por ${m.occupation.occupierName}` }, h('div', { class: 'hoi-bar__fill' }));
                b.style.setProperty('--pct', `${m.occupation.pct}%`);
                b.style.setProperty('--fill', 'var(--hoi-red)');
                facts.appendChild(factRow('Ocupação', 'fa-solid fa-flag', h('div', { class: 'hoi-dos__occ' }, h('span', { class: 'hoi-num', text: `${m.occupation.pct}% · ${m.occupation.occupierName}` }), b)));
            }
            if (m.allies.length) facts.appendChild(factRow('Aliados', 'fa-solid fa-shield', h('div', { class: 'hoi-dos__links' }, m.allies.slice(0, 12).map((x) => nationLink(x.id, x.name)), m.allies.length > 12 ? h('span', { class: 'hoi-faint', text: `+${m.allies.length - 12}` }) : null)));
            if (m.pacts.length) {
                facts.appendChild(factRow('Pactos', 'fa-solid fa-file-signature', h('div', { class: 'hoi-dos__pacts' }, m.pacts.map((p) => h('span', { class: 'hoi-chip', title: `${p.typeLabel}${p.members.length ? ` com ${p.members.slice(0, 8).map((x) => x.name).join(', ')}${p.members.length > 8 ? '…' : ''}` : ''}` }, h('span', { text: p.name }), p.name !== p.typeLabel ? h('span', { class: 'hoi-faint', text: ` · ${p.typeLabel}` }) : null)))));
            }
            if (m.crises.length) {
                facts.appendChild(factRow('Crises', 'fa-solid fa-triangle-exclamation', h('div', { class: 'hoi-dos__crises' }, m.crises.map((c) => {
                    const chip = h('span', { class: 'hoi-chip hoi-dos__crisis', title: `Gravidade: ${c.severityLabel}` }, h('span', { class: 'hoi-dot' }), h('span', { text: c.title }));
                    chip.style.setProperty('--sev', c.color);
                    return chip;
                }))));
            }
            clear(traits);
            for (const t of m.traits) traits.appendChild(h('span', { class: 'hoi-chip hoi-chip--brass', text: t }));
            traits.hidden = m.traits.length === 0;
            setText(blurb, m.blurb);
            blurb.hidden = !m.blurb;
        }

        selfNote.hidden = !m.isPlayer;
        actionsSec.hidden = m.isPlayer;
        if (!m.isPlayer) {
            setText(actionsHead.querySelector('.hoi-dos__acttitle'), ` Ações contra ${m.name}`);
            let avs = [];
            try {
                avs = ctx.query.getPlayerActions(m.id) || [];
            } catch (err) {
                console.error('[HOI] getPlayerActions failed', err);
            }
            actions.update(groupActions(avs, { target: 'nation' }), m.id);
        }
    }

    return { el, update, getCurrent: () => current };
}
