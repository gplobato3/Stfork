/**
 * @file src/ui/warroom/topBar.js
 * War Room top bar: identity (flag, nation, ruler), date, political capital,
 * the 7 resources with last-month deltas, DEFCON gauge, pending decision,
 * "Avançar Mês", menu and close.
 */

import { RESOURCE_KEYS } from '../../contract/constants.js';
import { PC_ICON, PC_LABEL, RESOURCE_ICONS, RESOURCE_LABELS } from '../../contract/presentation.js';
import { h, icon, setAttr, setText, toggleClass, updateFlag, flagEl } from './dom.js';

export function createTopBar(ctx) {
    const flag = flagEl(ctx.assetUrl, null, 'lg');
    const nation = h('div', { class: 'hoi-tb__nation' });
    const leader = h('div', { class: 'hoi-tb__leader' });
    const ident = h('button', { type: 'button', class: 'hoi-tb__ident', title: 'Ver o dossiê da sua nação' },
        h('span', { class: 'hoi-tb__flagframe' }, flag),
        h('span', { class: 'hoi-tb__names' }, nation, leader));
    ident.addEventListener('click', () => {
        const st = ctx.getState();
        if (st && st.player) ctx.selectNation(st.player.nationId, { focus: true, pane: 'dossier' });
    });

    const date = h('div', { class: 'hoi-tb__date' });
    const dateShort = h('div', { class: 'hoi-tb__date hoi-tb__date--short' });
    const dateSub = h('div', { class: 'hoi-tb__datesub hoi-num' });
    const dateBlock = h('div', { class: 'hoi-tb__cell hoi-tb__dateblock' }, icon('fa-solid fa-calendar-days', 'hoi-tb__dateicon'), h('div', null, date, dateShort, dateSub));

    const pcVal = h('span', { class: 'hoi-tb__pcval hoi-num' });
    const pcBar = h('span', { class: 'hoi-tb__pcbar' }, h('span', { class: 'hoi-tb__pcfill' }));
    const pc = h('div', { class: 'hoi-tb__cell hoi-tb__pc', title: PC_LABEL },
        h('span', { class: 'hoi-tb__pcicon' }, icon(PC_ICON)),
        h('span', { class: 'hoi-tb__pcbody' },
            h('span', { class: 'hoi-tb__lbl', text: 'Capital Político' }),
            h('span', { class: 'hoi-tb__pcline' }, pcVal, h('span', { class: 'hoi-tb__pcmax hoi-num' })),
            pcBar));

    const resCells = new Map();
    const resWrap = h('div', { class: 'hoi-tb__res', role: 'list', 'aria-label': 'Recursos nacionais' });
    for (const key of RESOURCE_KEYS) {
        const val = h('span', { class: 'hoi-tb__rval hoi-num' });
        const delta = h('span', { class: 'hoi-tb__rdelta hoi-num' });
        const cell = h('div', { class: 'hoi-tb__r', role: 'listitem', dataset: { res: key } },
            h('span', { class: 'hoi-tb__ricon' }, icon(RESOURCE_ICONS[key])),
            h('span', { class: 'hoi-tb__rbody' },
                h('span', { class: 'hoi-tb__rlbl', text: RESOURCE_LABELS[key] }),
                h('span', { class: 'hoi-tb__rline' }, val, delta)));
        resCells.set(key, { cell, val, delta });
        resWrap.appendChild(cell);
    }

    const segs = [];
    const segWrap = h('div', { class: 'hoi-defcon__segs', 'aria-hidden': 'true' });
    for (let lvl = 5; lvl >= 1; lvl--) {
        const seg = h('span', { class: 'hoi-defcon__seg', text: String(lvl), dataset: { level: String(lvl) } });
        segs.push(seg);
        segWrap.appendChild(seg);
    }
    const defLabel = h('div', { class: 'hoi-defcon__state' });
    const defTension = h('span', { class: 'hoi-defcon__tension hoi-num' });
    const defcon = h('div', { class: 'hoi-tb__cell hoi-defcon', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100' },
        h('div', { class: 'hoi-defcon__head' }, h('span', { class: 'hoi-defcon__title', text: 'DEFCON' }), defTension),
        segWrap, defLabel);

    const badge = h('span', { class: 'hoi-badge hoi-num' });
    const pending = h('button', { type: 'button', class: 'hoi-btn hoi-tb__pending', title: 'Abrir a decisão pendente' },
        icon('fa-solid fa-scroll'),
        h('span', { class: 'hoi-tb__btnlbl hoi-tb__btnlbl--long', text: 'Decisão pendente' }),
        h('span', { class: 'hoi-tb__btnlbl hoi-tb__btnlbl--short', text: 'Decisão' }),
        badge);
    pending.addEventListener('click', () => {
        if (!ctx.isBusy()) ctx.handlers.onOpenEvent();
    });

    const endTurn = h('button', { type: 'button', class: 'hoi-btn hoi-btn--primary hoi-btn--lg hoi-tb__end', title: 'Encerrar o mês e deixar o mundo agir' },
        icon('fa-solid fa-forward-step'), h('span', { class: 'hoi-tb__btnlbl', text: 'Avançar Mês' }));
    endTurn.addEventListener('click', () => {
        if (!ctx.isBusy()) ctx.handlers.onEndTurn();
    });

    const newGame = h('button', { type: 'button', class: 'hoi-btn hoi-btn--primary hoi-btn--lg hoi-tb__new' },
        icon('fa-solid fa-flag'), h('span', { text: 'Nova campanha' }));
    newGame.addEventListener('click', () => ctx.handlers.onNewCampaign());

    const menu = h('button', { type: 'button', class: 'hoi-btn hoi-btn--ghost hoi-btn--icon hoi-tb__icon', title: 'Gabinete: salvar, opções e campanha', 'aria-label': 'Abrir menu do gabinete' }, icon('fa-solid fa-gear'));
    menu.addEventListener('click', () => ctx.openMenu());
    const close = h('button', { type: 'button', class: 'hoi-btn hoi-btn--ghost hoi-btn--icon hoi-tb__icon hoi-tb__close', title: 'Fechar a Sala de Guerra (Esc)', 'aria-label': 'Fechar a Sala de Guerra' }, icon('fa-solid fa-xmark'));
    close.addEventListener('click', () => ctx.close());

    const outcome = h('div', { class: 'hoi-tb__outcome', hidden: true });
    const brand = h('div', { class: 'hoi-tb__brand' }, icon('fa-solid fa-earth-americas'), h('span', { class: 'hoi-title', text: 'Sala de Guerra' }));

    const el = h('header', { class: 'hoi-wr__top' },
        brand,
        ident,
        h('div', { class: 'hoi-tb__sep' }),
        dateBlock,
        pc,
        resWrap,
        defcon,
        h('div', { class: 'hoi-tb__spacer' }),
        outcome,
        h('div', { class: 'hoi-tb__actions' }, pending, endTurn, newGame, menu, close));

    /** @param {ReturnType<import('./viewModel.js').topBarModel>} m */
    function update(m, { busy = false, busyLabel = '' } = {}) {
        toggleClass(el, 'is-empty', !m.hasCampaign);
        newGame.hidden = m.hasCampaign;
        if (!m.hasCampaign) {
            pending.hidden = true;
            endTurn.hidden = true;
            outcome.hidden = true;
            return;
        }
        endTurn.hidden = false;
        updateFlag(flag, ctx.assetUrl, { id: m.nationId, flag: m.flag, name: m.nationName }, ' hoi-flag--lg');
        setText(nation, m.nationName);
        setText(leader, m.leaderLine);
        setText(date, m.dateText);
        setText(dateShort, m.dateShort);
        setText(dateSub, `Turno ${m.turn}`);
        dateBlock.title = `${m.dateText} — turno ${m.turn}`;

        setText(pcVal, String(m.pc));
        setText(pc.querySelector('.hoi-tb__pcmax'), `/${m.pcMax}`);
        pc.querySelector('.hoi-tb__pcfill').style.width = `${Math.round((m.pc / m.pcMax) * 100)}%`;
        pc.title = `${PC_LABEL}: ${m.pc} de ${m.pcMax}. Gasto pelas ações do mês; renova a cada turno.`;

        for (const r of m.resources) {
            const c = resCells.get(r.key);
            if (!c) continue;
            setText(c.val, String(r.value));
            setText(c.delta, r.deltaText);
            c.delta.dataset.tone = r.tone;
            c.cell.title = r.title;
            setAttr(c.cell, 'aria-label', r.title);
            c.cell.dataset.level = r.value < 25 ? 'low' : r.value >= 70 ? 'high' : 'mid';
        }

        const lvl = m.defcon.level;
        for (const seg of segs) {
            const sl = Number(seg.dataset.level);
            toggleClass(seg, 'is-lit', sl >= lvl);
            toggleClass(seg, 'is-current', sl === lvl);
        }
        defcon.style.setProperty('--defcon', m.defcon.color);
        setText(defLabel, m.defcon.label);
        setText(defTension, `Tensão ${m.tension}`);
        defcon.title = m.defconTitle;
        setAttr(defcon, 'aria-valuenow', m.tension);
        setAttr(defcon, 'aria-valuetext', m.defconTitle);
        defcon.dataset.level = String(lvl);

        pending.hidden = m.pendingCount === 0;
        setText(badge, String(m.pendingCount));
        toggleClass(pending, 'is-pulsing', m.pendingCount > 0);
        pending.title = m.pendingCount > 1
            ? `${m.pendingCount} decisões aguardam o seu despacho`
            : 'Uma decisão aguarda o seu despacho';

        if (m.gameOver && m.outcome) {
            outcome.hidden = false;
            setText(outcome, m.outcome.kind === 'victory' ? 'Vitória' : 'Derrota');
            outcome.dataset.kind = m.outcome.kind;
            outcome.title = m.outcome.reason || '';
        } else outcome.hidden = true;

        const blocked = busy || m.gameOver;
        endTurn.disabled = blocked;
        endTurn.title = busy ? (busyLabel || 'Aguarde…') : m.gameOver ? 'A campanha terminou.' : 'Encerrar o mês e deixar o mundo agir';
        pending.disabled = busy;
    }

    return { el, update };
}
