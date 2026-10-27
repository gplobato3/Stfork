/**
 * @file src/ui/warroom/gameMenu.js
 * "Gabinete" menu opened from the War Room gear button: campaign commands
 * (save, new, import council character, end campaign) and quick toggles for
 * the most used settings. Uses UI-B's openModal / openConfirm.
 */

import { h, icon } from './dom.js';

const QUICK_TOGGLES = [
    { key: 'llmEvents', label: 'Eventos escritos pela IA a cada mês', help: 'Desligado: apenas eventos do motor (sem chamadas à IA por turno).' },
    { key: 'postBulletins', label: 'Publicar boletim no chat após cada mês', help: 'Um narrador resume o mês na conversa.' },
    { key: 'showArt', label: 'Mostrar ilustrações nos eventos' },
    { key: 'showHud', label: 'Mostrar a barra da campanha no chat' },
];

const ORDERS_MODES = [
    { value: 'auto', label: 'Automático: toda mensagem no chat pode virar ordem' },
    { value: 'command', label: 'Só por comando (/hoi-ordem) e pela Sala de Guerra' },
    { value: 'off', label: 'Desligado' },
];

/**
 * @param {{handlers: Object, query: Object, openModal: Function, confirm: Function, hasCampaign: boolean}} ctx
 */
export function openGameMenu(ctx) {
    let modal = null;
    const settings = safeSettings(ctx.query);
    const close = () => modal && modal.close();

    const cmd = (label, ico, onClick, cls = '') => {
        const b = h('button', { type: 'button', class: `hoi-btn hoi-menu__cmd ${cls}` }, icon(ico), h('span', { text: label }));
        b.addEventListener('click', onClick);
        return b;
    };

    const commands = h('div', { class: 'hoi-menu__cmds' },
        ctx.hasCampaign ? cmd('Salvar campanha', 'fa-solid fa-floppy-disk', () => {
            close();
            ctx.handlers.onSave();
        }) : null,
        // The controller asks for confirmation when a campaign would be replaced.
        cmd('Nova campanha', 'fa-solid fa-flag', () => {
            close();
            ctx.handlers.onNewCampaign();
        }),
        cmd('Importar o personagem “Conselho de Guerra”', 'fa-solid fa-user-tie', () => {
            close();
            ctx.handlers.onImportCharacter();
        }),
        ctx.hasCampaign ? cmd('Encerrar campanha', 'fa-solid fa-trash-can', async () => {
            const ok = await ctx.confirm({ title: 'Encerrar campanha', text: 'Apagar a campanha deste chat? Esta ação não pode ser desfeita.', okLabel: 'Encerrar', danger: true });
            if (!ok) return;
            close();
            ctx.handlers.onResetCampaign();
        }, 'hoi-menu__danger') : null,
    );

    const toggles = h('div', { class: 'hoi-menu__toggles' });
    for (const t of QUICK_TOGGLES) {
        const input = h('input', { type: 'checkbox', class: 'hoi-menu__check' });
        input.checked = !!settings[t.key];
        input.addEventListener('change', () => ctx.handlers.onSettingsChange({ [t.key]: input.checked }));
        toggles.appendChild(h('label', { class: 'hoi-menu__toggle' }, input,
            h('span', { class: 'hoi-menu__tlabel' }, h('span', { text: t.label }), t.help ? h('small', { class: 'hoi-faint', text: t.help }) : null)));
    }
    const select = h('select', { class: 'hoi-select hoi-menu__select', 'aria-label': 'Ordens pelo chat' });
    for (const o of ORDERS_MODES) {
        const opt = h('option', { value: o.value, text: o.label });
        if (settings.ordersMode === o.value) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener('change', () => ctx.handlers.onSettingsChange({ ordersMode: select.value }));

    const content = h('div', { class: 'hoi-root hoi-menu' },
        h('header', { class: 'hoi-menu__head' }, icon('fa-solid fa-landmark', 'hoi-menu__icon'), h('h3', { class: 'hoi-title', text: 'Gabinete' })),
        h('div', { class: 'hoi-section-head', text: 'Campanha' }),
        commands,
        h('div', { class: 'hoi-section-head', text: 'Opções rápidas' }),
        toggles,
        h('label', { class: 'hoi-menu__field' }, h('span', { text: 'Ordens pelo chat' }), select),
        h('p', { class: 'hoi-menu__note hoi-faint', text: 'Todas as opções ficam em Extensões › HOI — Grande Estratégia.' }),
        h('footer', { class: 'hoi-menu__foot' }, cmd('Fechar', 'fa-solid fa-xmark', () => close(), 'hoi-btn--ghost')),
    );

    modal = ctx.openModal({ className: 'hoi-menu-modal', content, dismissible: true });
    return modal;
}

function safeSettings(query) {
    try {
        return (query && query.getSettings && query.getSettings()) || {};
    } catch {
        return {};
    }
}
