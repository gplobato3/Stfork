/**
 * @file src/ui/settings/settingsPanel.js
 * "Grande Estratégia" drawer in SillyTavern's Extensions panel.
 *
 * Contract (DESIGN §6.2):
 *   mountSettingsPanel({ getSettings, onChange, onOpenWarRoom, onNewCampaign,
 *     onImportCharacter, onResetCampaign, listConnectionProfiles }) -> { refresh(), unmount() }
 *
 * Markup follows the built-in extensions (public/scripts/extensions/memory/settings.html):
 *   .inline-drawer > .inline-drawer-toggle.inline-drawer-header (+ .inline-drawer-icon)
 *                  > .inline-drawer-content
 * ST opens/closes it with its own delegated click handler (public/script.js:12193),
 * so no toggle logic lives here. Controls use ST classes (checkbox_label,
 * text_pole, menu_button) to match the rest of the panel.
 */

import { openConfirm } from '../dialogs/confirm.js';
import { h, icon } from '../dialogs/dom.js';
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings, settingsPatch } from './settingsModel.js';

export const SETTINGS_ROOT_ID = 'hoi_settings';

const POSITION_OPTIONS = [
    ['in_chat', 'No chat (na profundidade abaixo)'],
    ['in_prompt', 'Após o prompt principal'],
    ['before_prompt', 'Antes do prompt principal'],
];
const ROLE_OPTIONS = [['system', 'Sistema'], ['user', 'Usuário'], ['assistant', 'Assistente']];
// Plain "~": ST's bundled Noto Sans subset has no "≈" glyph.
const DETAIL_OPTIONS = [['compact', 'Compacto (~300 tokens)'], ['full', 'Completo (~700 tokens)']];
const ORDERS_OPTIONS = [
    ['auto', 'Automático: analisar cada mensagem sua'],
    ['command', 'Só pelo comando /hoi-ordem'],
    ['off', 'Desligado'],
];
const DIFFICULTY_OPTIONS = [['facil', 'Fácil'], ['normal', 'Normal'], ['dificil', 'Difícil']];

/** Enter/Space activation for div-based ST buttons (keeps ST's global Enter handler from double-firing). */
function activate(el, fn) {
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            fn(e);
        }
    });
    return el;
}

function stButton(id, iconCls, label, { danger = false, title = null } = {}) {
    return h('div', {
        className: `menu_button menu_button_icon interactable hoi-settings__btn${danger ? ' redWarningBG hoi-settings__btn--danger' : ''}`,
        attrs: { id, tabindex: '0', role: 'button', title: title || label },
    }, icon(iconCls), h('span', { text: label }));
}

function select(id, options) {
    return h('select', { className: 'text_pole', attrs: { id } },
        options.map(([value, label]) => h('option', { text: label, attrs: { value } })));
}

function help(text) {
    return h('small', { className: 'hoi-settings__help', text });
}

function checkbox(id, label) {
    const input = h('input', { attrs: { id, type: 'checkbox' } });
    const lbl = h('label', { className: 'checkbox_label', attrs: { for: id } }, input, h('span', { text: label }));
    return { input, label: lbl };
}

function field(labelText, control, helpText, extraClass = '') {
    const id = control.id;
    return h('div', { className: `hoi-settings__field ${extraClass}`.trim() },
        h('label', { className: 'hoi-settings__label', text: labelText, attrs: { for: id || null } }),
        control,
        helpText ? help(helpText) : null);
}

function section(title, iconCls, ...children) {
    return h('div', { className: 'hoi-settings__section' },
        h('h4', { className: 'hoi-settings__h' }, icon(iconCls), h('span', { text: title })),
        ...children);
}

/**
 * @param {Object} deps
 * @param {() => import('../../contract/interfaces.js').HoiSettings} deps.getSettings
 * @param {(patch: Partial<import('../../contract/interfaces.js').HoiSettings>) => void} deps.onChange
 * @param {() => void} [deps.onOpenWarRoom]
 * @param {() => void} [deps.onNewCampaign]
 * @param {() => void} [deps.onImportCharacter]
 * @param {() => void} [deps.onResetCampaign]
 * @param {() => Array<{id: string, name: string}>} [deps.listConnectionProfiles]
 * @returns {{refresh: () => void, unmount: () => void}}
 */
export function mountSettingsPanel({
    getSettings,
    onChange,
    onOpenWarRoom,
    onNewCampaign,
    onImportCharacter,
    onResetCampaign,
    listConnectionProfiles,
} = {}) {
    const noop = { refresh() {}, unmount() {} };
    if (typeof document === 'undefined') return noop;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return noop;
    const old = document.getElementById(SETTINGS_ROOT_ID);
    if (old) old.remove();

    const current = () => {
        try {
            return normalizeSettings(typeof getSettings === 'function' ? getSettings() : DEFAULT_SETTINGS);
        } catch {
            return normalizeSettings(DEFAULT_SETTINGS);
        }
    };
    const emit = (path, value) => {
        const patch = settingsPatch(current(), path, value);
        if (!Object.keys(patch).length) return;
        try {
            if (typeof onChange === 'function') onChange(patch);
        } catch (err) {
            console.error('[HOI] settings onChange failed', err);
        }
        sync();
    };
    const safe = (fn) => () => {
        try {
            if (typeof fn === 'function') fn();
        } catch (err) {
            console.error('[HOI] settings action failed', err);
        }
    };

    // ------------------------------------------------------------ controls
    const cEnabled = checkbox('hoi_enabled', 'Ativar Grande Estratégia');
    const cInject = checkbox('hoi_injection_enabled', 'Injetar o relatório de situação no prompt');
    const sPosition = select('hoi_injection_position', POSITION_OPTIONS);
    const nDepth = h('input', { className: 'text_pole', attrs: { id: 'hoi_injection_depth', type: 'number', min: LIMITS.depth.min, max: LIMITS.depth.max, step: 1, inputmode: 'numeric' } });
    const sRole = select('hoi_injection_role', ROLE_OPTIONS);
    const sDetail = select('hoi_injection_detail', DETAIL_OPTIONS);
    const sOrders = select('hoi_orders_mode', ORDERS_OPTIONS);
    const cEvents = checkbox('hoi_llm_events', 'Eventos de decisão escritos pela IA');
    const sProfile = h('select', { className: 'text_pole', attrs: { id: 'hoi_engine_profile' } });
    const nTokens = h('input', {
        className: 'text_pole',
        attrs: { id: 'hoi_event_max_tokens', type: 'number', min: LIMITS.eventMaxTokens.min, max: LIMITS.eventMaxTokens.max, step: LIMITS.eventMaxTokens.step, inputmode: 'numeric' },
    });
    const cBulletins = checkbox('hoi_post_bulletins', 'Publicar um boletim no chat a cada mês');
    const cHud = checkbox('hoi_show_hud', 'Mostrar a barra da campanha acima do chat');
    const cArt = checkbox('hoi_show_art', 'Mostrar ilustrações nos eventos');
    const sDifficulty = select('hoi_difficulty', DIFFICULTY_OPTIONS);

    const bWarRoom = activate(stButton('hoi_open_warroom', 'fa-map-location-dot', 'Abrir Sala de Guerra'), safe(onOpenWarRoom));
    const bNew = activate(stButton('hoi_new_campaign', 'fa-flag', 'Nova Campanha'), safe(onNewCampaign));
    const bImport = activate(stButton('hoi_import_character', 'fa-user-plus', 'Importar personagem “Conselho de Guerra”'), safe(onImportCharacter));
    const bReset = activate(stButton('hoi_reset_campaign', 'fa-trash-can', 'Apagar campanha deste chat', { danger: true }), async () => {
        const ok = await openConfirm({
            title: 'Apagar campanha?',
            text: 'A campanha salva neste chat será apagada de vez: nação, mapa, guerras e histórico de decisões.\nAs mensagens do chat não são afetadas.',
            okLabel: 'Apagar campanha',
            cancelLabel: 'Manter',
            danger: true,
        });
        if (ok) safe(onResetCampaign)();
    });

    // ------------------------------------------------------------- markup
    const injectionBlock = h('div', { className: 'hoi-settings__group' },
        h('div', { className: 'hoi-settings__grid' },
            field('Posição', sPosition, null, 'hoi-settings__field--wide'),
            field('Profundidade', nDepth, null, 'hoi-settings__field--depth'),
            field('Papel', sRole, null),
            field('Tamanho', sDetail, null, 'hoi-settings__field--wide')),
        help('“No chat” com profundidade 1 coloca o relatório logo antes da última mensagem. O tamanho define quanto do seu orçamento de contexto o relatório usa.'));

    const content = h('div', { className: 'inline-drawer-content hoi-settings__content' },
        h('p', { className: 'hoi-settings__intro', text: 'Campanha de grande estratégia no estilo Hearts of Iron dentro deste chat. O chat narra; o motor do jogo decide.' }),
        h('div', { className: 'hoi-settings__actions' }, bWarRoom, bNew),

        section('Geral', 'fa-power-off',
            cEnabled.label,
            help('Desligado, o jogo não injeta nada no prompt nem interpreta ordens. A campanha continua salva no chat.')),

        section('Relatório de situação', 'fa-satellite-dish',
            cInject.label,
            help('Antes de cada resposta, um bloco [SITUAÇÃO] com data, recursos, guerras, crises e ordens executadas entra no prompt, para o personagem narrar sem inventar números. Ele se soma ao seu preset; não substitui nada.'),
            injectionBlock),

        section('Ordens no chat', 'fa-person-military-rifle',
            field('Modo das ordens', sOrders, 'Automático: quando você dá uma ordem como governante no chat (“Mobilizem as tropas na fronteira”), um árbitro a converte em ações do catálogo, com custo e chance reais. Conversa comum é ignorada. “Só pelo comando” exige /hoi-ordem.')),

        section('Eventos e motor', 'fa-gears',
            cEvents.label,
            help('Desligado, só aparecem decisões do próprio motor (chamados às armas, termos de paz) e eventos de contingência: nenhuma chamada extra à IA por turno.'),
            field('Perfil de conexão do motor', sProfile, 'Perfil separado (Connection Manager) para eventos e árbitro de ordens, por exemplo um modelo mais rápido ou barato. O chat continua usando a conexão atual.'),
            field('Limite de tokens por evento', nTokens, `Orçamento de resposta para cada evento gerado (${LIMITS.eventMaxTokens.min}–${LIMITS.eventMaxTokens.max}). Valores maiores dão narrativas mais longas, mas custam mais.`)),

        section('Chat e interface', 'fa-display',
            cBulletins.label,
            help('Depois de cada mês, um boletim curto de notícias é postado como mensagem de narrador, na voz do seu preset.'),
            cHud.label,
            help('Barra compacta com bandeira, data, DEFCON, Capital Político e o botão “Avançar Mês”.'),
            cArt.label,
            help('Ilustrações no topo dos eventos e na escolha de período.')),

        section('Novas campanhas', 'fa-chess-king',
            field('Dificuldade padrão', sDifficulty, 'Sugerida no assistente de nova campanha. Fácil: +1 de Capital Político por mês; Difícil: −1.')),

        section('Personagem e dados', 'fa-user-shield',
            h('div', { className: 'hoi-settings__actions' }, bImport),
            help('Adiciona o personagem “Conselho de Guerra”, um mestre de jogo que dá voz ao gabinete e às reações do mundo. Funciona com qualquer preset.'),
            h('div', { className: 'hoi-settings__actions' }, bReset),
            help('Remove apenas a campanha salva neste chat. Pede confirmação.')));

    const root = h('div', { className: 'hoi-root hoi-settings', attrs: { id: SETTINGS_ROOT_ID } },
        h('div', { className: 'inline-drawer' },
            h('div', { className: 'inline-drawer-toggle inline-drawer-header' },
                h('b', { className: 'hoi-settings__title' }, icon('fa-earth-americas'), h('span', { text: 'Grande Estratégia' })),
                h('div', { className: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })),
            content));

    // -------------------------------------------------------------- events
    cEnabled.input.addEventListener('change', () => emit('enabled', cEnabled.input.checked));
    cInject.input.addEventListener('change', () => emit('injection.enabled', cInject.input.checked));
    sPosition.addEventListener('change', () => emit('injection.position', sPosition.value));
    nDepth.addEventListener('change', () => emit('injection.depth', nDepth.value));
    sRole.addEventListener('change', () => emit('injection.role', sRole.value));
    sDetail.addEventListener('change', () => emit('injection.detail', sDetail.value));
    sOrders.addEventListener('change', () => emit('ordersMode', sOrders.value));
    cEvents.input.addEventListener('change', () => emit('llmEvents', cEvents.input.checked));
    sProfile.addEventListener('change', () => emit('engineProfileId', sProfile.value));
    nTokens.addEventListener('change', () => emit('eventMaxTokens', nTokens.value));
    cBulletins.input.addEventListener('change', () => emit('postBulletins', cBulletins.input.checked));
    cHud.input.addEventListener('change', () => emit('showHud', cHud.input.checked));
    cArt.input.addEventListener('change', () => emit('showArt', cArt.input.checked));
    sDifficulty.addEventListener('change', () => emit('difficulty', sDifficulty.value));

    function fillProfiles(selectedId) {
        let profiles = [];
        try {
            profiles = typeof listConnectionProfiles === 'function' ? listConnectionProfiles() || [] : [];
        } catch {
            profiles = [];
        }
        const opts = [h('option', { text: 'Conexão atual do chat', attrs: { value: '' } })];
        for (const p of profiles) {
            if (p && p.id) opts.push(h('option', { text: p.name || p.id, attrs: { value: p.id } }));
        }
        if (selectedId && !profiles.some((p) => p && p.id === selectedId)) {
            opts.push(h('option', { text: 'Perfil não encontrado (usa a conexão atual)', attrs: { value: selectedId } }));
        }
        sProfile.replaceChildren(...opts);
        sProfile.value = selectedId || '';
        sProfile.title = profiles.length ? '' : 'Nenhum perfil encontrado. Crie perfis na extensão Connection Manager.';
    }

    function sync() {
        const s = current();
        cEnabled.input.checked = s.enabled;
        cInject.input.checked = s.injection.enabled;
        sPosition.value = s.injection.position;
        nDepth.value = String(s.injection.depth);
        sRole.value = s.injection.role;
        sDetail.value = s.injection.detail;
        sOrders.value = s.ordersMode;
        cEvents.input.checked = s.llmEvents;
        if (sProfile.value !== s.engineProfileId || !sProfile.options.length) fillProfiles(s.engineProfileId);
        nTokens.value = String(s.eventMaxTokens);
        cBulletins.input.checked = s.postBulletins;
        cHud.input.checked = s.showHud;
        cArt.input.checked = s.showArt;
        sDifficulty.value = s.difficulty;

        const injOff = !s.enabled || !s.injection.enabled;
        for (const el of [sPosition, sRole, sDetail]) el.disabled = injOff;
        nDepth.disabled = injOff || s.injection.position !== 'in_chat';
        injectionBlock.classList.toggle('is-disabled', injOff);
        nTokens.disabled = !s.llmEvents;
        root.classList.toggle('is-off', !s.enabled);
    }

    host.appendChild(root);
    fillProfiles(current().engineProfileId);
    sync();

    return {
        refresh() {
            if (!root.isConnected) return;
            fillProfiles(current().engineProfileId);
            sync();
        },
        unmount() {
            root.remove();
        },
    };
}
