/**
 * @file src/ui/hud/hud.js
 * Compact campaign bar docked at the top of SillyTavern's chat column.
 *
 * Contract (DESIGN §6.2):
 *   createHud({ onOpenWarRoom, onEndTurn, onOpenEvent, assetUrl })
 *     -> { mount(), unmount(), update(state, { busy, settings }) }
 *
 * Placement: inserted as the first flow child of #sheld, right before #chat.
 * #sheld is a flex column sitting below #top-bar (public/style.css:772,
 * `top: var(--topBarBlockSize)`), and #chat is its `flex-grow: 1` child
 * (style.css:861), so the bar never overlaps ST's top bar or the messages:
 * the chat simply shrinks by the bar's height. Same on mobile
 * (css/mobile-styles.css:592 only resizes #sheld). Width adapts through a
 * container query on the bar (the column is 50vw by default, 100vw on mobile).
 */

import { BOUNDS } from '../../contract/constants.js';
import { PC_ICON, PC_LABEL, defcon, formatDate, formatDateShort } from '../../contract/presentation.js';
import { clear, flagEl, h, icon } from '../dialogs/dom.js';

export const HUD_COLLAPSE_KEY = 'hoi.hud.collapsed';

/**
 * Pure view model of the HUD.
 * @param {?import('../../contract/worldState.js').WorldState} state
 * @param {{busy?: boolean|string, settings?: Partial<import('../../contract/interfaces.js').HoiSettings>}} [opts]
 */
export function hudViewModel(state, { busy = false, settings = {} } = {}) {
    const s = settings || {};
    if (s.showHud === false || s.enabled === false) return { mode: 'hidden' };
    const playerId = state && state.player && state.player.nationId;
    const nation = playerId && state.nations ? state.nations[playerId] : null;
    if (!state || !nation || state.phase === 'SETUP') return { mode: 'start' };
    const tension = Math.max(0, Math.min(100, Math.round(Number(state.globalTension) || 0)));
    const wars = (Array.isArray(state.wars) ? state.wars : []).filter((w) => (w.attackers || []).includes(playerId) || (w.defenders || []).includes(playerId));
    const queue = Array.isArray(state.eventQueue) ? state.eventQueue.length : 0;
    const pending = (state.pendingEvent ? 1 : 0) + queue;
    const pendingTitle = state.pendingEvent ? String(state.pendingEvent.title || '') : queue ? String(state.eventQueue[0].title || '') : '';
    const gameOver = state.phase === 'GAME_OVER' || !!state.outcome;
    return {
        mode: 'campaign',
        nation,
        nationName: nation.name || playerId,
        leaderLine: [state.player.title || nation.leaderTitle, state.player.leaderName].filter(Boolean).join(' '),
        dateText: formatDate(state.date),
        dateShort: formatDateShort(state.date),
        defcon: defcon(tension),
        tension,
        pc: Math.max(0, Math.round(Number(nation.pc) || 0)),
        pcMax: BOUNDS.PC_MAX,
        pending,
        pendingTitle,
        wars: wars.length,
        gameOver,
        outcomeKind: state.outcome ? state.outcome.kind : null,
        busy: !!busy,
        busyLabel: typeof busy === 'string' && busy ? busy : 'Processando…',
    };
}

function readCollapsed() {
    try {
        return globalThis.localStorage ? globalThis.localStorage.getItem(HUD_COLLAPSE_KEY) === '1' : false;
    } catch {
        return false;
    }
}

function writeCollapsed(v) {
    try {
        if (globalThis.localStorage) globalThis.localStorage.setItem(HUD_COLLAPSE_KEY, v ? '1' : '0');
    } catch {
        /* storage may be unavailable (private mode) */
    }
}

/**
 * @param {Object} deps
 * @param {() => void} [deps.onOpenWarRoom]
 * @param {() => void} [deps.onEndTurn]
 * @param {() => void} [deps.onOpenEvent]
 * @param {(path: string) => string} [deps.assetUrl]
 */
export function createHud({ onOpenWarRoom, onEndTurn, onOpenEvent, assetUrl } = {}) {
    let root = null;
    let lastState = null;
    let lastOpts = { busy: false, settings: {} };
    let collapsed = readCollapsed();

    const call = (fn) => () => {
        if (typeof fn !== 'function') return;
        try {
            fn();
        } catch (err) {
            console.error('[HOI] HUD handler failed', err);
        }
    };
    const openWarRoom = call(onOpenWarRoom);
    const endTurn = call(onEndTurn);
    const openEvent = call(onOpenEvent);

    function setCollapsed(v) {
        collapsed = !!v;
        writeCollapsed(collapsed);
        render();
        const target = root && root.querySelector(collapsed ? '.hoi-hud__chip' : '.hoi-hud__collapse');
        if (target) target.focus({ preventScroll: true });
    }

    function btn(key, className, label, iconCls, onClick, { disabled = false, title = null, iconOnly = false } = {}) {
        return h('button', {
            className,
            dataset: { hudKey: key },
            // aria-label stays even when narrow layouts hide the text span.
            attrs: { type: 'button', title: title || label, 'aria-label': label, disabled: disabled ? true : null },
            on: { click: onClick },
        }, icon(iconCls), iconOnly ? null : h('span', { className: 'hoi-hud__btn-text', text: label }));
    }

    function renderStart() {
        return h('div', { className: 'hoi-hud__strip' },
            h('button', {
                className: 'hoi-hud__chip hoi-hud__chip--start',
                dataset: { hudKey: 'start' },
                attrs: { type: 'button', title: 'Abrir a Sala de Guerra e começar uma campanha neste chat' },
                on: { click: openWarRoom },
            },
            icon('fa-chess-king', 'hoi-hud__chip-icon'),
            h('span', { className: 'hoi-hud__chip-brand', text: 'Grande Estratégia' }),
            h('span', { className: 'hoi-hud__chip-sep', attrs: { 'aria-hidden': 'true' } }),
            h('span', { className: 'hoi-hud__chip-cta', text: 'Iniciar Campanha' })));
    }

    function renderCollapsed(vm) {
        return h('div', { className: 'hoi-hud__strip' },
            h('button', {
                className: `hoi-hud__chip${vm.pending ? ' has-pending' : ''}`,
                dataset: { hudKey: 'chip' },
                style: { '--hoi-defcon': vm.defcon.color },
                attrs: { type: 'button', 'aria-expanded': 'false', title: 'Expandir barra da campanha' },
                on: { click: () => setCollapsed(false) },
            },
            flagEl(assetUrl, vm.nation, 'sm'),
            h('span', { className: 'hoi-hud__chip-text', text: vm.nationName }),
            h('span', { className: 'hoi-hud__chip-sep', attrs: { 'aria-hidden': 'true' } }),
            h('span', { className: 'hoi-num', text: vm.dateShort }),
            h('span', { className: 'hoi-hud__chip-defcon hoi-num', text: `D${vm.defcon.level}`, attrs: { title: `DEFCON ${vm.defcon.level} · ${vm.defcon.label}` } }),
            vm.pending ? h('span', { className: 'hoi-hud__chip-dot', attrs: { title: 'Decisão pendente' } }) : null,
            icon('fa-chevron-down', 'hoi-hud__chip-caret')));
    }

    function renderBar(vm) {
        const bar = h('div', { className: `hoi-hud__bar${vm.busy ? ' is-busy' : ''}` });

        bar.appendChild(h('button', {
            className: 'hoi-hud__nation',
            dataset: { hudKey: 'nation' },
            attrs: { type: 'button', title: 'Abrir a Sala de Guerra' },
            on: { click: openWarRoom },
        },
        flagEl(assetUrl, vm.nation),
        h('span', { className: 'hoi-hud__nation-text' },
            h('span', { className: 'hoi-hud__nation-name', text: vm.nationName }),
            vm.leaderLine ? h('span', { className: 'hoi-hud__leader', text: vm.leaderLine }) : null),
        vm.wars ? h('span', { className: 'hoi-hud__war', attrs: { title: vm.wars === 1 ? 'Em guerra' : `Em ${vm.wars} guerras` } }, icon('fa-burst')) : null));

        bar.appendChild(h('div', { className: 'hoi-hud__stats' },
            h('span', { className: 'hoi-hud__stat hoi-hud__date', attrs: { title: vm.dateText } },
                icon('fa-calendar-days', 'hoi-hud__stat-icon'),
                h('span', { className: 'hoi-hud__date-long', text: vm.dateText }),
                h('span', { className: 'hoi-hud__date-short hoi-num', text: vm.dateShort })),
            h('span', {
                className: 'hoi-hud__defcon',
                style: { '--hoi-defcon': vm.defcon.color },
                attrs: { title: `DEFCON ${vm.defcon.level} · ${vm.defcon.label} (tensão ${vm.tension}/100)` },
            }, h('span', { className: 'hoi-hud__defcon-k', text: 'DEFCON' }), h('span', { className: 'hoi-hud__defcon-n hoi-num', text: String(vm.defcon.level) })),
            h('span', { className: 'hoi-hud__stat hoi-hud__pc', attrs: { title: `${PC_LABEL}: ${vm.pc} de ${vm.pcMax}` } },
                icon(PC_ICON, 'hoi-hud__stat-icon'),
                h('span', { className: 'hoi-hud__pc-n hoi-num', text: String(vm.pc) }),
                h('span', { className: 'hoi-hud__pc-k', text: 'PC' })),
            h('span', { className: 'hoi-hud__tension', attrs: { title: `Tensão global ${vm.tension}/100` } },
                h('span', { className: 'hoi-hud__tension-k', text: 'Tensão' }),
                h('span', { className: 'hoi-bar hoi-hud__tension-bar', attrs: { role: 'meter', 'aria-label': 'Tensão global', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': vm.tension } },
                    h('span', { className: 'hoi-bar__fill', style: { '--pct': `${vm.tension}%`, '--fill': vm.defcon.color } })),
                h('span', { className: 'hoi-hud__tension-n hoi-num', text: String(vm.tension) }))));

        if (vm.pending) {
            bar.appendChild(h('button', {
                className: 'hoi-hud__pending',
                dataset: { hudKey: 'pending' },
                attrs: {
                    type: 'button',
                    title: vm.pendingTitle ? `Decisão pendente: ${vm.pendingTitle}` : 'Decisão pendente',
                    'aria-label': vm.pending > 1 ? `${vm.pending} decisões pendentes` : 'Decisão pendente',
                },
                on: { click: openEvent },
            },
            icon('fa-gavel'),
            h('span', { className: 'hoi-hud__btn-text', text: vm.pending > 1 ? 'Decisões' : 'Decisão' }),
            h('span', { className: 'hoi-badge hoi-hud__badge hoi-num', text: String(vm.pending) })));
        }

        const actions = h('div', { className: 'hoi-hud__actions' });
        actions.appendChild(btn('warroom', 'hoi-btn hoi-hud__btn hoi-hud__warroom', 'Sala de Guerra', 'fa-map-location-dot', openWarRoom));
        if (vm.gameOver) {
            actions.appendChild(h('span', { className: `hoi-chip hoi-hud__over hoi-hud__over--${vm.outcomeKind || 'end'}` },
                icon(vm.outcomeKind === 'victory' ? 'fa-trophy' : 'fa-flag-checkered'),
                h('span', { className: 'hoi-hud__btn-text', text: 'Campanha encerrada' })));
        } else {
            const end = h('button', {
                className: 'hoi-btn hoi-btn--primary hoi-hud__btn hoi-hud__end',
                dataset: { hudKey: 'end' },
                attrs: {
                    type: 'button',
                    disabled: vm.busy ? true : null,
                    'aria-busy': vm.busy ? 'true' : null,
                    'aria-label': vm.busy ? vm.busyLabel : 'Avançar Mês',
                    title: vm.busy ? vm.busyLabel : 'Encerrar o mês e processar o mundo',
                },
                on: { click: () => { if (!vm.busy) endTurn(); } },
            },
            vm.busy ? h('span', { className: 'hoi-spinner hoi-hud__spinner', attrs: { 'aria-hidden': 'true' } }) : icon('fa-forward-step'),
            h('span', { className: 'hoi-hud__btn-text hoi-hud__end-long', text: vm.busy ? vm.busyLabel : 'Avançar Mês' }),
            h('span', { className: 'hoi-hud__btn-text hoi-hud__end-short', attrs: { 'aria-hidden': 'true' }, text: vm.busy ? 'Aguarde' : 'Avançar' }));
            actions.appendChild(end);
        }
        actions.appendChild(h('button', {
            className: 'hoi-btn hoi-btn--ghost hoi-btn--icon hoi-hud__collapse',
            dataset: { hudKey: 'collapse' },
            attrs: { type: 'button', 'aria-expanded': 'true', 'aria-label': 'Recolher barra da campanha', title: 'Recolher' },
            on: { click: () => setCollapsed(true) },
        }, icon('fa-chevron-up')));
        bar.appendChild(actions);
        return bar;
    }

    function render() {
        if (!root) return;
        const vm = hudViewModel(lastState, lastOpts);
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        const focusKey = active && root.contains(active) && active.dataset ? active.dataset.hudKey : null;

        root.hidden = vm.mode === 'hidden';
        root.dataset.mode = vm.mode;
        root.classList.toggle('is-collapsed', vm.mode === 'campaign' && collapsed);
        clear(root);
        if (vm.mode === 'start') root.appendChild(renderStart());
        else if (vm.mode === 'campaign') root.appendChild(collapsed ? renderCollapsed(vm) : renderBar(vm));

        if (focusKey) {
            const again = root.querySelector(`[data-hud-key="${focusKey}"]`);
            if (again && !again.disabled) again.focus({ preventScroll: true });
        }
    }

    function mount() {
        if (typeof document === 'undefined') return;
        if (root && root.isConnected) return;
        collapsed = readCollapsed();
        root = h('div', {
            className: 'hoi-root hoi-hud',
            attrs: { id: 'hoi_hud', role: 'region', 'aria-label': 'Campanha — Grande Estratégia' },
        });
        const sheld = document.getElementById('sheld');
        if (sheld) {
            const chat = document.getElementById('chat');
            if (chat && chat.parentNode === sheld) sheld.insertBefore(root, chat);
            else sheld.insertBefore(root, sheld.firstChild);
        } else {
            root.classList.add('hoi-hud--floating');
            document.body.appendChild(root);
        }
        render();
    }

    function unmount() {
        if (root) root.remove();
        root = null;
    }

    function update(state, opts = {}) {
        lastState = state || null;
        lastOpts = { busy: opts && opts.busy ? opts.busy : false, settings: (opts && opts.settings) || {} };
        render();
    }

    return { mount, unmount, update };
}
