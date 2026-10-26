/**
 * @file src/ui/warroom/actionList.js
 * Action catalog list (grouped by category) used by the Governo tab
 * (untargeted actions) and by the dossier (actions targeting the selected
 * nation). Rows are reconciled by key so refreshes never rebuild the list.
 */

import { clear, h, icon, setAttr, setText, syncList, toggleClass } from './dom.js';
import { resolvePlaceholders } from './viewModel.js';

/**
 * @param {Object} ctx  War Room context ({ runAction, describe, isBusy, getState })
 * @param {{emptyText?: string}} [opts]
 */
export function createActionList(ctx, opts = {}) {
    const el = h('div', { class: 'hoi-actions' });
    const empty = h('div', { class: 'hoi-empty', text: opts.emptyText || 'Nenhuma ação disponível.' });
    const collapsed = new Set();
    const seen = new Set();
    const expanded = new Set();
    let targetId = null;

    function createGroup(g) {
        const head = h('button', { type: 'button', class: 'hoi-actgroup__head', 'aria-expanded': 'true' },
            icon(g.icon, 'hoi-actgroup__icon'),
            h('span', { class: 'hoi-actgroup__label' }),
            h('span', { class: 'hoi-actgroup__count hoi-num' }),
            icon('fa-solid fa-chevron-down', 'hoi-actgroup__chev'));
        const list = h('div', { class: 'hoi-actgroup__list' });
        const wrap = h('section', { class: 'hoi-actgroup' }, head, list);
        head.addEventListener('click', () => {
            const cat = wrap.dataset.key;
            if (collapsed.has(cat)) collapsed.delete(cat);
            else collapsed.add(cat);
            applyCollapsed(wrap, head);
        });
        wrap._head = head;
        wrap._list = list;
        return wrap;
    }

    function applyCollapsed(wrap, head) {
        const isCollapsed = collapsed.has(wrap.dataset.key);
        toggleClass(wrap, 'is-collapsed', isCollapsed);
        setAttr(head, 'aria-expanded', isCollapsed ? 'false' : 'true');
    }

    function updateGroup(wrap, g) {
        // First time a category shows up: fold it when nothing in it is usable.
        if (!seen.has(g.category)) {
            seen.add(g.category);
            if (g.availableCount === 0) collapsed.add(g.category);
        }
        setText(wrap._head.querySelector('.hoi-actgroup__label'), g.label);
        setText(wrap._head.querySelector('.hoi-actgroup__count'), `${g.availableCount}/${g.items.length}`);
        applyCollapsed(wrap, wrap._head);
        syncList(wrap._list, g.items, (it) => it.id, createItem, updateItem);
    }

    function createItem(it) {
        // Row: [icon | name / cost chips + meta] [chance] [execute]
        const name = h('span', { class: 'hoi-act__name' });
        const meta = h('span', { class: 'hoi-act__meta' });
        const cost = h('span', { class: 'hoi-act__cost' });
        const main = h('button', { type: 'button', class: 'hoi-act__main', 'aria-expanded': 'false' },
            h('span', { class: 'hoi-act__icon' }, icon(it.icon)),
            h('span', { class: 'hoi-act__text' }, name, h('span', { class: 'hoi-act__sub' }, cost, meta)));
        const chance = h('span', { class: 'hoi-act__chance hoi-num' });
        const go = h('button', { type: 'button', class: 'hoi-btn hoi-btn--icon hoi-act__go' }, icon('fa-solid fa-play'));
        const details = h('div', { class: 'hoi-act__details', hidden: true });
        const row = h('div', { class: 'hoi-act' }, main, chance, go, details);
        row._p = { main, name, meta, cost, chance, go, details, sig: '', detailSig: '' };
        main.addEventListener('click', () => {
            const id = row.dataset.key;
            if (expanded.has(id)) expanded.delete(id);
            else expanded.add(id);
            renderDetails(row, row._item, true);
        });
        go.addEventListener('click', () => {
            const item = row._item;
            if (!item || !item.available || ctx.isBusy()) return;
            ctx.runAction(item, item.target === 'nation' ? targetId : null);
        });
        return row;
    }

    function updateItem(row, it) {
        const p = row._p;
        row._item = it;
        toggleClass(row, 'is-unavailable', !it.available);
        toggleClass(row, 'is-danger', it.confirm);
        setText(p.name, it.name);
        const metaText = !it.available && it.reasons.length ? it.reasons[0] : it.cooldownText || it.description;
        setText(p.meta, metaText);
        toggleClass(p.meta, 'is-reason', !it.available && it.reasons.length > 0);
        p.main.title = it.available ? it.description : `${it.description}\nIndisponível: ${it.reasonText}`;
        const iconEl = p.main.querySelector('.hoi-act__icon i');
        if (iconEl && iconEl.className !== `${it.icon}`) iconEl.className = it.icon;

        const costSig = it.costParts.map((c) => `${c.key}${c.value}`).join(',');
        if (p.cost.dataset.sig !== costSig) {
            p.cost.dataset.sig = costSig;
            clear(p.cost);
            if (!it.costParts.length) p.cost.appendChild(h('span', { class: 'hoi-cost hoi-cost--free', text: 'Grátis' }));
            for (const c of it.costParts) {
                p.cost.appendChild(h('span', { class: `hoi-cost hoi-cost--${c.key === 'pc' ? 'pc' : 'res'}`, title: `${c.value} ${c.title}` },
                    icon(c.icon), h('span', { class: 'hoi-num', text: String(c.value) })));
            }
        }
        setText(p.chance, it.chanceText);
        p.chance.dataset.tone = it.chanceTone;
        p.chance.title = it.chanceText === 'Garantido' ? 'Sucesso garantido' : `Chance de sucesso: ${it.chanceText}`;

        const busy = ctx.isBusy();
        const disabled = !it.available || busy;
        setAttr(p.go, 'aria-disabled', disabled ? 'true' : 'false');
        toggleClass(p.go, 'hoi-btn--primary', !disabled && !it.confirm);
        toggleClass(p.go, 'hoi-btn--danger', !disabled && it.confirm);
        const goLabel = it.available ? `Executar: ${it.name} (${it.costText})` : `Indisponível: ${it.reasonText || it.name}`;
        setAttr(p.go, 'aria-label', goLabel);
        p.go.title = busy ? 'Aguarde: o gabinete está ocupado.' : goLabel;
        renderDetails(row, it, false);
    }

    function renderDetails(row, it, toggled) {
        const p = row._p;
        const isOpen = expanded.has(row.dataset.key);
        setAttr(p.main, 'aria-expanded', isOpen ? 'true' : 'false');
        toggleClass(row, 'is-open', isOpen);
        p.details.hidden = !isOpen;
        if (!isOpen) return;
        const sig = JSON.stringify([it.description, it.reasons, it.chanceText, it.cooldownText, targetId, it.onSuccess, it.onFailure]);
        if (!toggled && sig === p.detailSig) return;
        p.detailSig = sig;
        clear(p.details);
        if (it.description) p.details.appendChild(h('p', { class: 'hoi-act__desc', text: it.description }));
        if (!it.available && it.reasons.length) {
            p.details.appendChild(h('ul', { class: 'hoi-act__reasons' }, it.reasons.map((r) => h('li', null, icon('fa-solid fa-lock'), h('span', { text: r })))));
        }
        const state = ctx.getState();
        const self = state && state.player ? state.player.nationId : null;
        const dctx = { actorId: self, targetId: targetId || undefined };
        const fx = (list) => list.map((e) => ctx.describe(resolvePlaceholders(e, { self, target: targetId, player: self }), state, dctx)).filter((d) => d && d.text);
        const ok = fx(it.onSuccess);
        if (ok.length) p.details.appendChild(effectLine(it.chanceText === 'Garantido' ? 'Efeitos' : 'Se tiver sucesso', ok));
        const bad = fx(it.onFailure);
        if (bad.length) p.details.appendChild(effectLine('Se falhar', bad));
        const facts = [`Custo: ${it.costText}`, it.chanceText === 'Garantido' ? 'Sucesso garantido' : `Chance: ${it.chanceText}`];
        if (it.cooldownText) facts.push(it.cooldownText);
        if (it.confirm) facts.push('Exige confirmação');
        p.details.appendChild(h('div', { class: 'hoi-act__facts', text: facts.join(' · ') }));
    }

    function effectLine(label, effects) {
        return h('div', { class: 'hoi-act__fx' },
            h('span', { class: 'hoi-act__fxlabel', text: label }),
            effects.map((d) => h('span', { class: `hoi-chip hoi-fx hoi-fx--${d.tone || 'neutral'}` }, d.icon ? icon(d.icon) : null, h('span', { text: d.text }))));
    }

    /**
     * @param {Array} groups output of groupActions()
     * @param {?string} target target nation id for targeted lists
     */
    function update(groups, target = null) {
        if (target !== targetId) {
            // New target nation: re-derive which categories start folded.
            targetId = target;
            expanded.clear();
            seen.clear();
            collapsed.clear();
        }
        if (!groups || !groups.length) {
            if (!empty.isConnected) {
                clear(el);
                el.appendChild(empty);
            }
            return;
        }
        if (empty.isConnected) empty.remove();
        syncList(el, groups, (g) => g.category, createGroup, updateGroup);
    }

    return { el, update };
}
