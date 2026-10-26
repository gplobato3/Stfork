/**
 * @file src/ui/warroom/turnReport.js
 * Non-blocking slide-in panel with the monthly report (TurnReport).
 */

import { clear, h, icon, setText } from './dom.js';

export function createTurnReportPanel(ctx) {
    const title = h('h3', { class: 'hoi-title hoi-report__title' });
    const sub = h('div', { class: 'hoi-report__sub hoi-subtitle' });
    const closeBtn = h('button', { type: 'button', class: 'hoi-btn hoi-btn--ghost hoi-btn--icon', title: 'Fechar relatório', 'aria-label': 'Fechar relatório' }, icon('fa-solid fa-xmark'));
    closeBtn.addEventListener('click', () => hide());
    const body = h('div', { class: 'hoi-report__body hoi-scroll' });
    const decision = h('button', { type: 'button', class: 'hoi-btn hoi-btn--primary hoi-report__decide' }, icon('fa-solid fa-scroll'), h('span', { text: 'Despachar decisão' }));
    decision.addEventListener('click', () => {
        if (!ctx.isBusy()) ctx.handlers.onOpenEvent();
    });
    const foot = h('footer', { class: 'hoi-report__foot' }, decision);
    const el = h('aside', { class: 'hoi-report', 'aria-label': 'Relatório do mês', 'aria-hidden': 'true', tabindex: '-1' },
        h('header', { class: 'hoi-report__head' }, icon('fa-solid fa-file-lines', 'hoi-report__icon'), h('div', { class: 'hoi-report__titles' }, sub, title), closeBtn),
        body, foot);

    let open = false;

    /** @param {ReturnType<import('./viewModel.js').turnReportModel>} m */
    function show(m) {
        if (!m) return;
        setText(sub, `Turno ${m.turn}`);
        setText(title, m.title);
        clear(body);
        if (m.outcome) {
            body.appendChild(h('div', { class: `hoi-report__outcome is-${m.outcome.kind}` },
                icon(m.outcome.kind === 'victory' ? 'fa-solid fa-trophy' : 'fa-solid fa-skull'),
                h('span', { text: `${m.outcome.kind === 'victory' ? 'Vitória' : 'Derrota'}: ${m.outcome.reason || ''}` })));
        }
        if (m.empty) body.appendChild(h('div', { class: 'hoi-empty', text: 'Um mês tranquilo: nada digno de nota.' }));
        for (const sec of m.sections) {
            body.appendChild(h('section', { class: `hoi-report__sec is-${sec.id}` },
                h('div', { class: 'hoi-section-head' }, h('span', null, icon(sec.icon), ` ${sec.title}`), h('span', { class: 'hoi-faint hoi-num', text: String(sec.rows.length) })),
                h('ul', { class: 'hoi-report__rows' }, sec.rows.map((r) => h('li', { class: `hoi-report__row is-${r.tone}` }, icon(r.icon, 'hoi-report__rowicon'), h('span', { text: r.text }))))));
        }
        foot.hidden = !m.decisions;
        if (m.decisions) {
            setText(decision.lastChild, m.decisions > 1 ? `Despachar decisões (${m.decisions})` : 'Despachar decisão');
            decision.title = m.decisionsText;
        }
        open = true;
        el.classList.add('is-open');
        el.setAttribute('aria-hidden', 'false');
        body.scrollTop = 0;
    }

    function hide() {
        open = false;
        el.classList.remove('is-open');
        el.setAttribute('aria-hidden', 'true');
    }

    function setBusy(busy) {
        decision.disabled = !!busy;
    }

    return { el, show, hide, setBusy, isOpen: () => open };
}
