/**
 * @file src/ui/warroom/leftPanel.js
 * Left tabbed panel: Governo (untargeted actions + active modifiers),
 * Diplomacia (sortable relations), Guerras (fronts + exhaustion), Crises,
 * Ranking. Only the visible tab is rendered; hidden tabs re-render when shown.
 */

import { RESOURCE_LABELS, PC_LABEL, signed } from '../../contract/presentation.js';
import { createActionList } from './actionList.js';
import { clear, flagEl, h, icon, setAttr, setText, syncList, toggleClass, updateFlag } from './dom.js';
import {
    RELATION_SORTS,
    crisesModel,
    groupActions,
    monthsLeftText,
    monthsText,
    rankingModel,
    relationsList,
    warsModel,
} from './viewModel.js';

export const LEFT_TABS = Object.freeze([
    { id: 'gov', label: 'Governo', icon: 'fa-solid fa-landmark' },
    { id: 'diplo', label: 'Diplomacia', icon: 'fa-solid fa-handshake' },
    { id: 'wars', label: 'Guerras', icon: 'fa-solid fa-person-rifle' },
    { id: 'crises', label: 'Crises', icon: 'fa-solid fa-triangle-exclamation' },
    { id: 'rank', label: 'Ranking', icon: 'fa-solid fa-ranking-star' },
]);

export function createLeftPanel(ctx) {
    let active = 'gov';
    const tabBtns = new Map();
    const panes = new Map();
    const counts = new Map();
    const tabBar = h('div', { class: 'hoi-tabs', role: 'tablist', 'aria-label': 'Painéis do governo' });
    for (const t of LEFT_TABS) {
        const count = h('span', { class: 'hoi-tabs__count hoi-num', hidden: true });
        const btn = h('button', {
            type: 'button',
            role: 'tab',
            class: 'hoi-tabs__tab',
            id: `hoi-wr-tab-${t.id}`,
            'aria-selected': 'false',
            'aria-controls': `hoi-wr-pane-${t.id}`,
            title: t.label,
        }, icon(t.icon), h('span', { class: 'hoi-tabs__label', text: t.label }), count);
        btn.addEventListener('click', () => setTab(t.id));
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            e.stopPropagation();
            const i = LEFT_TABS.findIndex((x) => x.id === active);
            const next = LEFT_TABS[(i + (e.key === 'ArrowRight' ? 1 : LEFT_TABS.length - 1)) % LEFT_TABS.length];
            setTab(next.id);
            tabBtns.get(next.id).focus();
        });
        tabBtns.set(t.id, btn);
        counts.set(t.id, count);
        tabBar.appendChild(btn);
        const pane = h('div', { class: 'hoi-wr__tabpane hoi-scroll', role: 'tabpanel', id: `hoi-wr-pane-${t.id}`, 'aria-labelledby': `hoi-wr-tab-${t.id}`, hidden: true });
        panes.set(t.id, pane);
    }
    const el = h('div', { class: 'hoi-wr__leftinner' }, tabBar, ...panes.values());

    /* ------------------------------------------------------------ Governo */
    const govHead = h('div', { class: 'hoi-gov__head' });
    const govActions = createActionList(ctx, { emptyText: 'Nenhuma ação interna no catálogo.' });
    const modsWrap = h('div', { class: 'hoi-gov__mods' });
    panes.get('gov').append(
        govHead,
        h('div', { class: 'hoi-section-head' }, h('span', null, icon('fa-solid fa-list-check'), ' Ações de governo'), h('span', { class: 'hoi-faint hoi-hint', text: 'Clique para detalhes' })),
        govActions.el,
        modsWrap);

    function renderGov(state) {
        clear(govHead);
        if (!state) return;
        const n = state.nations[state.player.nationId];
        const pc = Math.round(Number(n && n.pc) || 0);
        govHead.append(
            h('div', { class: 'hoi-gov__pc' }, icon('fa-solid fa-landmark'), h('span', null, `${PC_LABEL}: `), h('strong', { class: 'hoi-num', text: String(pc) }), h('span', { class: 'hoi-faint', text: ' disponível neste mês' })),
            h('div', { class: 'hoi-gov__left hoi-faint', text: monthsLeftText(state) }));
        govActions.update(groupActions(ctx.query.getPlayerActions(null), { target: 'none' }), null);

        clear(modsWrap);
        const mods = (state.modifiers || []).filter((m) => m.nationId === state.player.nationId);
        if (!mods.length) return;
        modsWrap.appendChild(h('div', { class: 'hoi-section-head' }, h('span', null, icon('fa-solid fa-hourglass-half'), ' Medidas em vigor'), h('span', { class: 'hoi-faint hoi-num', text: String(mods.length) })));
        for (const m of mods) {
            const effects = Object.entries(m.perTurn || {}).filter(([, v]) => v).map(([k, v]) => `${RESOURCE_LABELS[k] || k} ${signed(v)}/mês`);
            modsWrap.appendChild(h('div', { class: 'hoi-mod' },
                h('div', { class: 'hoi-mod__top' }, h('span', { class: 'hoi-mod__label', text: m.label }), h('span', { class: 'hoi-chip hoi-num', text: monthsText(m.turnsLeft) })),
                effects.length ? h('div', { class: 'hoi-mod__fx hoi-faint', text: effects.join(' · ') }) : null));
        }
    }

    /* --------------------------------------------------------- Diplomacia */
    let relSort = 'relation';
    let relDir = 'desc';
    let relFilter = '';
    const search = h('input', { type: 'search', class: 'hoi-input hoi-diplo__search', placeholder: 'Buscar país…', 'aria-label': 'Buscar país', maxlength: '40' });
    search.addEventListener('input', () => {
        relFilter = search.value;
        render();
    });
    const sortBtns = new Map();
    const sortBar = h('div', { class: 'hoi-diplo__sort', role: 'group', 'aria-label': 'Ordenar relações' }, h('span', { class: 'hoi-faint', text: 'Ordenar:' }));
    for (const [key, label] of Object.entries(RELATION_SORTS)) {
        const b = h('button', { type: 'button', class: 'hoi-sortbtn', dataset: { sort: key } }, h('span', { text: label }), icon('fa-solid fa-arrow-down', 'hoi-sortbtn__dir'));
        b.addEventListener('click', () => {
            if (relSort === key) relDir = relDir === 'asc' ? 'desc' : 'asc';
            else {
                relSort = key;
                relDir = key === 'name' ? 'asc' : 'desc';
            }
            render();
        });
        sortBtns.set(key, b);
        sortBar.appendChild(b);
    }
    const relSummary = h('div', { class: 'hoi-diplo__summary' });
    const relList = h('div', { class: 'hoi-rel', role: 'list' });
    panes.get('diplo').append(h('div', { class: 'hoi-diplo__tools' }, search, sortBar), relSummary, relList);

    function renderDiplo(state) {
        for (const [key, b] of sortBtns) {
            toggleClass(b, 'is-active', key === relSort);
            const dir = b.querySelector('.hoi-sortbtn__dir');
            dir.className = `fa-solid ${relDir === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down'} hoi-sortbtn__dir`;
            setAttr(b, 'aria-pressed', key === relSort ? 'true' : 'false');
        }
        const power = {};
        for (const r of ctx.getRanking()) power[r.id] = r.power;
        const rows = relationsList(state, { sort: relSort, dir: relDir, filter: relFilter, power });
        const tally = { aliado: 0, amistoso: 0, tenso: 0, hostil: 0, guerra: 0 };
        for (const r of relationsList(state, { power })) if (r.tier in tally) tally[r.tier]++;
        clear(relSummary);
        relSummary.append(
            summaryChip('Aliados', tally.aliado, '#3f9b6b'),
            summaryChip('Amistosos', tally.amistoso, '#7fb069'),
            summaryChip('Tensos', tally.tenso, '#d1913f'),
            summaryChip('Hostis', tally.hostil, '#c4513f'),
            summaryChip('Em guerra', tally.guerra, '#8f1d1d'));
        if (!rows.length) {
            clear(relList);
            relList.appendChild(h('div', { class: 'hoi-empty', text: relFilter ? 'Nenhum país encontrado.' : 'Sem relações.' }));
            return;
        }
        syncList(relList, rows, (r) => r.id, createRelRow, updateRelRow);
    }

    function summaryChip(label, n, color) {
        const c = h('span', { class: 'hoi-chip hoi-num', title: label }, h('span', { class: 'hoi-dot' }), `${label} ${n}`);
        c.firstChild.style.background = color;
        return c;
    }

    function createRelRow(r) {
        const btn = h('button', { type: 'button', class: 'hoi-rel__row', role: 'listitem' },
            flagEl(ctx.assetUrl, null, 'sm'),
            h('span', { class: 'hoi-rel__name' }),
            h('span', { class: 'hoi-rel__tier' }),
            h('span', { class: 'hoi-rel__meter' }, h('span', { class: 'hoi-rel__fill' })),
            h('span', { class: 'hoi-rel__score hoi-num' }));
        btn.addEventListener('click', () => ctx.selectNation(btn.dataset.key, { focus: true, pane: 'dossier' }));
        return btn;
    }

    function updateRelRow(btn, r) {
        const state = ctx.getState();
        updateFlag(btn.firstChild, ctx.assetUrl, state.nations[r.id], ' hoi-flag--sm');
        setText(btn.children[1], r.name);
        const tier = btn.children[2];
        setText(tier, r.tierLabel);
        tier.style.setProperty('--tier', r.tierColor);
        const fill = btn.children[3].firstChild;
        const pct = Math.abs(r.score) / 2;
        fill.style.width = `${pct}%`;
        fill.style.left = r.score >= 0 ? '50%' : `${50 - pct}%`;
        fill.style.background = r.tierColor;
        setText(btn.children[4], r.atWar ? '—' : r.scoreText);
        toggleClass(btn, 'is-selected', r.id === ctx.getSelected());
        toggleClass(btn, 'is-war', r.atWar);
        btn.title = `${r.name}: ${r.tierLabel} (${r.scoreText})${r.power ? ` · poder ${r.power}` : ''}`;
    }

    /* ------------------------------------------------------------ Guerras */
    const warsList = h('div', { class: 'hoi-wars' });
    panes.get('wars').append(warsList);

    function renderWars(state) {
        const wars = warsModel(state);
        if (!wars.length) {
            clear(warsList);
            warsList.appendChild(h('div', { class: 'hoi-empty' }, icon('fa-solid fa-dove'), h('span', { text: 'Nenhuma guerra em curso. O mundo prende a respiração.' })));
            return;
        }
        syncList(warsList, wars, (w) => w.id, () => h('article', { class: 'hoi-war' }), updateWar);
    }

    function nationChip(id, extraCls = '') {
        const state = ctx.getState();
        const n = state && state.nations ? state.nations[id] : null;
        const b = h('button', { type: 'button', class: `hoi-natchip ${extraCls}`, title: n ? n.name : id },
            flagEl(ctx.assetUrl, n || { id, name: id }, 'sm'), h('span', { text: n ? n.name : id }));
        b.addEventListener('click', () => ctx.selectNation(id, { focus: true, pane: 'dossier' }));
        return b;
    }

    function updateWar(card, w) {
        const sig = JSON.stringify(w);
        if (card.dataset.sig === sig) return;
        card.dataset.sig = sig;
        clear(card);
        toggleClass(card, 'is-player', w.involvesPlayer);
        toggleClass(card, 'is-ceasefire', w.ceasefire);
        const pid = ctx.getState().player.nationId;
        card.append(
            h('header', { class: 'hoi-war__head' },
                h('h4', { class: 'hoi-war__name', text: w.name }),
                w.ceasefire ? h('span', { class: 'hoi-chip hoi-chip--brass', text: 'Cessar-fogo' }) : null,
                w.involvesPlayer ? h('span', { class: 'hoi-chip hoi-chip--bad', text: 'Sua guerra' }) : null),
            h('div', { class: 'hoi-war__sides' },
                sideRow('Atacantes', w.attackers, pid, w.playerSide === 'attackers'),
                sideRow('Defensores', w.defenders, pid, w.playerSide === 'defenders')),
            scoreBar(w),
            w.fronts.length ? h('div', { class: 'hoi-war__fronts' },
                h('div', { class: 'hoi-war__sub', text: `Frentes (${w.fronts.length})` }),
                visibleFronts(w).shown.map((f) => h('div', { class: `hoi-front${f.playerAttacking ? ' is-attacking' : ''}${f.playerDefending ? ' is-defending' : ''}` },
                    h('div', { class: 'hoi-front__line' },
                        h('span', { class: 'hoi-front__names', title: `${f.attackerName} avança sobre ${f.defenderName}` }, h('span', { text: f.attackerName }), icon('fa-solid fa-angles-right', 'hoi-front__arrow'), h('span', { text: f.defenderName })),
                        h('span', { class: 'hoi-front__pct hoi-num', text: `${f.progress}%` })),
                    bar(f.progress, f.playerDefending ? 'var(--hoi-red)' : f.playerAttacking ? 'var(--hoi-green)' : 'var(--hoi-amber)', `Território de ${f.defenderName} ocupado: ${f.progress}%`))),
                visibleFronts(w).hidden ? h('div', { class: 'hoi-war__quiet hoi-faint', text: `+${visibleFronts(w).hidden} ${visibleFronts(w).hidden === 1 ? 'frente sem avanço' : 'frentes sem avanço'}` }) : null) : null,
            w.exhaustion.length ? h('div', { class: 'hoi-war__exh' },
                h('div', { class: 'hoi-war__sub', text: 'Exaustão de guerra' }),
                w.exhaustion.slice(0, 6).map((x) => h('div', { class: `hoi-exh${x.isPlayer ? ' is-player' : ''}` },
                    h('span', { class: 'hoi-exh__name', text: x.name }),
                    bar(x.value, x.value >= 70 ? 'var(--hoi-red)' : x.value >= 40 ? 'var(--hoi-amber)' : 'var(--hoi-ink-faint)', `Exaustão de ${x.name}: ${x.value}`),
                    h('span', { class: 'hoi-exh__val hoi-num', text: String(x.value) })))) : null,
            w.durationText ? h('footer', { class: 'hoi-war__foot hoi-faint', text: w.durationText }) : null);
    }

    const SIDE_CHIPS = 6;
    const MAX_FRONTS = 8;

    /** Fronts worth a row: any with ground taken or involving the player (max 8). */
    function visibleFronts(w) {
        const relevant = w.fronts.filter((f) => f.progress > 0 || f.playerAttacking || f.playerDefending);
        const shown = relevant.slice(0, MAX_FRONTS);
        return { shown, hidden: w.fronts.length - shown.length };
    }

    function sideRow(label, ids, pid, isPlayerSide) {
        // Player first, then the original order; long coalitions collapse into "+N".
        const ordered = ids.includes(pid) ? [pid, ...ids.filter((x) => x !== pid)] : ids.slice();
        const shown = ordered.slice(0, SIDE_CHIPS);
        const rest = ordered.slice(SIDE_CHIPS);
        const state = ctx.getState();
        const more = rest.length
            ? h('span', { class: 'hoi-chip hoi-war__more hoi-num', text: `+${rest.length}`, title: rest.map((x) => (state.nations[x] ? state.nations[x].name : x)).join(', ') })
            : null;
        return h('div', { class: `hoi-war__side${isPlayerSide ? ' is-own' : ''}` },
            h('div', { class: 'hoi-war__sidelbl', text: `${label} (${ids.length})` }),
            h('div', { class: 'hoi-war__chips' }, shown.map((id) => nationChip(id, id === pid ? 'is-player' : '')), more));
    }

    function scoreBar(w) {
        // -100..100 balance bar: attackers' share on the left.
        const pct = Math.round((w.score + 100) / 2);
        const wrap = h('div', { class: 'hoi-war__score', title: `Placar da guerra: ${w.scoreText}` },
            h('div', { class: 'hoi-war__scorebar' }, h('span', { class: 'hoi-war__scoreatk' }), h('span', { class: 'hoi-war__scoremid' })),
            h('div', { class: `hoi-war__scoretxt hoi-num hoi-${w.scoreTone}`, text: `Placar ${w.scoreText}` }));
        wrap.querySelector('.hoi-war__scoreatk').style.width = `${pct}%`;
        return wrap;
    }

    function bar(pct, color, title) {
        const b = h('div', { class: 'hoi-bar', title, role: 'img', 'aria-label': title }, h('div', { class: 'hoi-bar__fill' }));
        b.style.setProperty('--pct', `${Math.max(0, Math.min(100, pct))}%`);
        b.style.setProperty('--fill', color);
        return b;
    }

    /* ------------------------------------------------------------- Crises */
    const crisesList = h('div', { class: 'hoi-crises' });
    panes.get('crises').append(crisesList);

    function renderCrises(state) {
        const rows = crisesModel(state);
        if (!rows.length) {
            clear(crisesList);
            crisesList.appendChild(h('div', { class: 'hoi-empty' }, icon('fa-solid fa-circle-check'), h('span', { text: 'Nenhuma crise ativa no momento.' })));
            return;
        }
        syncList(crisesList, rows, (c) => c.id, () => h('article', { class: 'hoi-crisis' }), (card, c) => {
            const sig = JSON.stringify(c);
            if (card.dataset.sig === sig) return;
            card.dataset.sig = sig;
            clear(card);
            card.style.setProperty('--sev', c.color);
            toggleClass(card, 'is-player', c.involvesPlayer);
            card.dataset.severity = c.severity || '';
            card.append(
                h('header', { class: 'hoi-crisis__head' },
                    h('span', { class: 'hoi-crisis__sev', text: c.severityLabel }),
                    h('h4', { class: 'hoi-crisis__title', text: c.title })),
                c.description ? h('p', { class: 'hoi-crisis__desc', text: c.description }) : null,
                h('div', { class: 'hoi-crisis__chips' }, c.involved.map((x) => nationChip(x.id))),
                h('footer', { class: 'hoi-crisis__foot hoi-faint', text: [c.region, c.durationText].filter(Boolean).join(' · ') }));
        });
    }

    /* ------------------------------------------------------------ Ranking */
    const rankList = h('div', { class: 'hoi-rank', role: 'list' });
    panes.get('rank').append(h('div', { class: 'hoi-section-head' }, h('span', null, icon('fa-solid fa-ranking-star'), ' Poder nacional'), h('span', { class: 'hoi-faint', text: '0–100' })), rankList);

    function renderRank(state) {
        const rows = rankingModel(ctx.getRanking(), state, 40);
        const max = Math.max(1, ...rows.map((r) => r.power));
        syncList(rankList, rows, (r) => r.id, () => {
            const b = h('button', { type: 'button', class: 'hoi-rank__row', role: 'listitem' },
                h('span', { class: 'hoi-rank__pos hoi-num' }),
                flagEl(ctx.assetUrl, null, 'sm'),
                h('span', { class: 'hoi-rank__name' }),
                h('span', { class: 'hoi-rank__bar' }, h('span', { class: 'hoi-rank__fill' })),
                h('span', { class: 'hoi-rank__val hoi-num' }));
            b.addEventListener('click', () => ctx.selectNation(b.dataset.key, { focus: true, pane: 'dossier' }));
            return b;
        }, (b, r) => {
            setText(b.children[0], `${r.pos}º`);
            updateFlag(b.children[1], ctx.assetUrl, state.nations[r.id] || { id: r.id, name: r.name }, ' hoi-flag--sm');
            setText(b.children[2], r.name);
            b.children[3].firstChild.style.width = `${Math.round((r.power / max) * 100)}%`;
            setText(b.children[4], String(r.power));
            toggleClass(b, 'is-player', r.isPlayer);
            toggleClass(b, 'is-selected', r.id === ctx.getSelected());
        });
    }

    /* ------------------------------------------------------------ control */

    function setTab(id) {
        if (!panes.has(id)) return;
        active = id;
        for (const [k, b] of tabBtns) {
            setAttr(b, 'aria-selected', k === id ? 'true' : 'false');
            toggleClass(b, 'is-active', k === id);
            b.tabIndex = k === id ? 0 : -1;
        }
        for (const [k, p] of panes) p.hidden = k !== id;
        render();
    }

    function updateCounts(state) {
        const pid = state ? state.player.nationId : null;
        const myWars = state ? state.wars.filter((w) => (w.attackers || []).includes(pid) || (w.defenders || []).includes(pid)).length : 0;
        const wars = state ? state.wars.length : 0;
        const crises = state ? state.crises.length : 0;
        const wc = counts.get('wars');
        wc.hidden = wars === 0;
        setText(wc, String(wars));
        toggleClass(wc, 'is-alert', myWars > 0);
        const cc = counts.get('crises');
        cc.hidden = crises === 0;
        setText(cc, String(crises));
        toggleClass(cc, 'is-alert', !!state && state.crises.some((c) => c.severity === 'critical'));
    }

    function render() {
        const state = ctx.getState();
        updateCounts(state);
        if (!state) return; // the War Room hides the side panels without a campaign
        try {
            if (active === 'gov') renderGov(state);
            else if (active === 'diplo') renderDiplo(state);
            else if (active === 'wars') renderWars(state);
            else if (active === 'crises') renderCrises(state);
            else if (active === 'rank') renderRank(state);
        } catch (err) {
            console.error('[HOI] left panel render failed', err);
        }
    }

    setTab('gov');

    return { el, render, setTab, getTab: () => active };
}
