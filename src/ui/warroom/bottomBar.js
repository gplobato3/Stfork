/**
 * @file src/ui/warroom/bottomBar.js
 * Bottom strip: scrolling news ticker (with an expandable news log) and the
 * "Ordem ao gabinete" order box that calls handlers.onOrder.
 */

import { clear, h, icon, setAttr, setText, syncList, toggleClass } from './dom.js';
import { tickerItems } from './viewModel.js';

export function createBottomBar(ctx) {
    const track = h('div', { class: 'hoi-ticker__track' });
    const viewport = h('div', { class: 'hoi-ticker__viewport' }, track);
    const logBtn = h('button', { type: 'button', class: 'hoi-ticker__label', 'aria-expanded': 'false', title: 'Ver as últimas notícias' },
        icon('fa-solid fa-tower-broadcast'), h('span', { text: 'Notícias' }), icon('fa-solid fa-chevron-up', 'hoi-ticker__chev'));
    const ticker = h('div', { class: 'hoi-ticker' }, logBtn, viewport);

    const logList = h('ol', { class: 'hoi-newslog__list' });
    const log = h('section', { class: 'hoi-newslog hoi-scroll', 'aria-label': 'Últimas notícias', hidden: true },
        h('div', { class: 'hoi-section-head' }, h('span', null, icon('fa-solid fa-newspaper'), ' Últimas notícias'), h('span', { class: 'hoi-faint', text: 'mais recentes primeiro' })),
        logList);
    logBtn.addEventListener('click', () => setLogOpen(log.hidden));

    const input = h('input', {
        type: 'text',
        class: 'hoi-input hoi-order__input',
        placeholder: 'Ordem ao gabinete… (ex.: Mobilizem as tropas na fronteira)',
        'aria-label': 'Ordem ao gabinete',
        maxlength: '600',
        autocomplete: 'off',
        enterkeyhint: 'send',
    });
    const send = h('button', { type: 'submit', class: 'hoi-btn hoi-btn--primary hoi-order__send', title: 'Enviar a ordem ao gabinete (Enter)' }, icon('fa-solid fa-paper-plane'), h('span', { class: 'hoi-order__sendlbl', text: 'Enviar' }));
    const form = h('form', { class: 'hoi-order', autocomplete: 'off' }, h('span', { class: 'hoi-order__icon', title: 'O gabinete interpreta a ordem e executa ações do catálogo com custos e dados reais.' }, icon('fa-solid fa-user-tie')), input, send);
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text || ctx.isBusy()) return;
        input.value = '';
        ctx.handlers.onOrder(text);
    });

    const el = h('footer', { class: 'hoi-wr__bottom' }, ticker, form, log);
    let tickerSig = '';

    function setLogOpen(open) {
        log.hidden = !open;
        setAttr(logBtn, 'aria-expanded', open ? 'true' : 'false');
        toggleClass(el, 'is-log-open', open);
        if (open) renderLog();
    }

    function renderLog() {
        const items = tickerItems(ctx.getState(), 40);
        if (!items.length) {
            clear(logList);
            logList.appendChild(h('li', { class: 'hoi-empty', text: 'Sem notícias ainda.' }));
            return;
        }
        syncList(logList, items, (it) => it.key, (it) => h('li', { class: `hoi-newslog__item is-${it.kind}` },
            icon(it.icon, 'hoi-newslog__icon'),
            h('span', { class: 'hoi-newslog__date hoi-num', text: it.dateText }),
            h('span', { class: 'hoi-newslog__text', text: it.text })), () => {});
    }

    function update({ busy = false, mobileNews = false } = {}) {
        const items = tickerItems(ctx.getState(), 14);
        const sig = items.map((i) => i.key).join('|');
        if (sig !== tickerSig) {
            tickerSig = sig;
            clear(track);
            if (!items.length) {
                track.appendChild(h('span', { class: 'hoi-ticker__item hoi-faint', text: 'Aguardando os primeiros despachos das agências internacionais…' }));
                track.style.removeProperty('--dur');
                toggleClass(track, 'is-static', true);
            } else if (items.length < 3) {
                // Too little to scroll: show the headlines still.
                for (const it of items) {
                    track.appendChild(h('span', { class: `hoi-ticker__item is-${it.kind}` },
                        icon(it.icon, 'hoi-ticker__icon'),
                        h('span', { class: 'hoi-ticker__date hoi-num', text: it.dateText }),
                        h('span', { class: 'hoi-ticker__text', text: it.text })));
                }
                track.style.removeProperty('--dur');
                toggleClass(track, 'is-static', true);
            } else {
                // Two copies for a seamless loop (translateX -50%).
                for (let copy = 0; copy < 2; copy++) {
                    for (const it of items) {
                        const node = h('span', { class: `hoi-ticker__item is-${it.kind}`, 'aria-hidden': copy ? 'true' : null },
                            icon(it.icon, 'hoi-ticker__icon'),
                            h('span', { class: 'hoi-ticker__date hoi-num', text: it.dateText }),
                            h('span', { class: 'hoi-ticker__text', text: it.text }));
                        track.appendChild(node);
                    }
                }
                const chars = items.reduce((n, it) => n + it.text.length + 12, 0);
                track.style.setProperty('--dur', `${Math.max(40, Math.round(chars * 0.2))}s`);
                toggleClass(track, 'is-static', false);
            }
        }
        if (!log.hidden || mobileNews) renderLog();
        input.disabled = busy;
        send.disabled = busy;
        input.placeholder = busy ? 'O gabinete está ocupado…' : 'Ordem ao gabinete… (ex.: Mobilizem as tropas na fronteira)';
    }

    return { el, update, setLogOpen, focusInput: () => input.focus(), isLogOpen: () => !log.hidden };
}
