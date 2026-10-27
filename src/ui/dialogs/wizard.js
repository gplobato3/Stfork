/**
 * @file src/ui/dialogs/wizard.js
 * New-campaign wizard: 1) Escolha o Período, 2) Escolha a Nação,
 * 3) Assuma o Governo.
 *
 * Contract (DESIGN §6.2):
 *   openWizard({ scenario, assetUrl, defaultLeaderName, defaultDifficulty })
 *     -> Promise<{bookmarkId, nationId, leaderName, difficulty} | null>
 * Esc / "Cancelar" resolve null. Never rejects.
 */

import {
    BLOC_COLORS,
    BLOC_LABELS,
    RESOURCE_ICONS,
    RESOURCE_LABELS,
    SEVERITY_LABELS,
    defcon,
    formatDate,
} from '../../contract/presentation.js';
import { clear, flagEl, h, icon, isTypingTarget, safeImg, urlFor } from './dom.js';
import { openModal } from './modalHost.js';
import {
    DIFFICULTY_META,
    DIFFICULTY_ORDER,
    LEADER_NAME_MAX,
    NATION_DIFFICULTY_LABELS,
    NUCLEAR_LABELS,
    SORT_MODES,
    applyBookmark,
    blocsIn,
    cleanLeaderName,
    filterNations,
    nationDifficulty,
    nationDiplomacy,
    nationPower,
    playableNations,
    resourceRows,
    sortNations,
    summaryLine,
} from './wizardModel.js';

export {
    applyBookmark,
    cleanLeaderName,
    filterNations,
    nationDiplomacy,
    nationPower,
    normalizeSearch,
    playableNations,
    sortNations,
    summaryLine,
} from './wizardModel.js';

const STEPS = Object.freeze([
    { id: 'period', short: 'Período', title: 'Escolha o Período', icon: 'fa-solid fa-calendar-days' },
    { id: 'nation', short: 'Nação', title: 'Escolha a Nação', icon: 'fa-solid fa-earth-americas' },
    { id: 'ruler', short: 'Governo', title: 'Assuma o Governo', icon: 'fa-solid fa-landmark-flag' },
]);

function defconPill(tension) {
    const d = defcon(tension);
    return h('span', {
        className: 'hoi-wz-defcon',
        style: { '--hoi-defcon': d.color },
        attrs: { title: `Tensão global ${Math.round(Number(tension) || 0)}/100` },
    }, h('span', { className: 'hoi-wz-defcon__level', text: `DEFCON ${d.level}` }), h('span', { className: 'hoi-wz-defcon__label', text: d.label }));
}

function tensionBar(tension) {
    const t = Math.max(0, Math.min(100, Math.round(Number(tension) || 0)));
    return h('div', { className: 'hoi-wz-tension' },
        h('span', { className: 'hoi-wz-tension__label', text: 'Tensão global' }),
        h('div', { className: 'hoi-bar hoi-wz-tension__bar', attrs: { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': t, 'aria-label': 'Tensão global' } },
            h('div', { className: 'hoi-bar__fill', style: { '--pct': `${t}%`, '--fill': defcon(t).color } })),
        h('span', { className: 'hoi-wz-tension__value hoi-num', text: String(t) }));
}

function blocChip(bloc) {
    return h('span', { className: 'hoi-chip hoi-wz-bloc', style: { '--hoi-bloc': BLOC_COLORS[bloc] || '#6f7a6a' } },
        h('span', { className: 'hoi-wz-bloc__dot', attrs: { 'aria-hidden': 'true' } }),
        h('span', { text: BLOC_LABELS[bloc] || bloc || '—' }));
}

function difficultyDots(diff) {
    const lvl = Math.max(0, DIFFICULTY_ORDER.indexOf(diff)) + 1;
    return h('span', {
        className: `hoi-wz-diff hoi-wz-diff--${diff}`,
        attrs: { title: `Dificuldade: ${NATION_DIFFICULTY_LABELS[diff] || diff}` },
    },
    h('span', { className: 'hoi-wz-diff__dots', attrs: { 'aria-hidden': 'true' } },
        [1, 2, 3].map((i) => h('span', { className: `hoi-wz-diff__dot${i <= lvl ? ' is-on' : ''}` }))),
    h('span', { className: 'hoi-wz-diff__label', text: NATION_DIFFICULTY_LABELS[diff] || diff }));
}

/**
 * @param {Object} opts
 * @param {import('../../contract/interfaces.js').ScenarioData} opts.scenario
 * @param {(path: string) => string} [opts.assetUrl]
 * @param {string} [opts.defaultLeaderName]
 * @param {'facil'|'normal'|'dificil'} [opts.defaultDifficulty]
 * @returns {Promise<?{bookmarkId: string, nationId: string, leaderName: string, difficulty: string}>}
 */
export function openWizard({ scenario, assetUrl, defaultLeaderName, defaultDifficulty } = {}) {
    return new Promise((resolve) => {
        const bookmarks = Array.isArray(scenario && scenario.bookmarks) ? scenario.bookmarks.filter(Boolean) : [];
        const st = {
            step: 0,
            visited: 0,
            bookmarkId: bookmarks.length ? bookmarks[0].id : null,
            nationId: null,
            query: '',
            bloc: 'all',
            sort: 'poder',
            leaderName: cleanLeaderName(defaultLeaderName),
            difficulty: DIFFICULTY_ORDER.includes(defaultDifficulty) ? defaultDifficulty : 'normal',
        };
        const worldCache = new Map();

        let settled = false;
        let handle = null;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
            if (handle) handle.close();
        };

        const bookmark = () => bookmarks.find((b) => b.id === st.bookmarkId) || null;
        const world = () => {
            const key = st.bookmarkId || '';
            if (!worldCache.has(key)) worldCache.set(key, applyBookmark(scenario, bookmark()));
            return worldCache.get(key);
        };
        const playable = () => playableNations(world());
        const recommended = () => {
            const ids = new Set(playable().map((n) => n.id));
            return ((bookmark() && bookmark().recommended) || []).filter((id) => ids.has(id));
        };
        const nation = () => (st.nationId ? world().nations[st.nationId] || null : null);
        const nameOf = (id) => (world().nations[id] && world().nations[id].name) || id;

        function ensureNation() {
            const list = playable();
            if (st.nationId && list.some((n) => n.id === st.nationId)) return;
            const rec = recommended();
            st.nationId = rec[0] || (sortNations(list, 'poder')[0] || {}).id || null;
        }

        // ------------------------------------------------------------ frame
        const bgSrc = urlFor(assetUrl, 'art/title.webp');
        const bg = h('div', { className: 'hoi-wizard__bg', attrs: { 'aria-hidden': 'true' } },
            bgSrc ? safeImg(bgSrc, { className: 'hoi-wizard__bg-img' }) : null);

        const stepNav = h('ol', { className: 'hoi-wz-steps', attrs: { 'aria-label': 'Etapas' } });
        const body = h('div', { className: 'hoi-wizard__body' });
        const btnBack = h('button', { className: 'hoi-btn hoi-btn--lg hoi-wizard__back', attrs: { type: 'button' } });
        const btnNext = h('button', { className: 'hoi-btn hoi-btn--lg hoi-btn--primary hoi-wizard__next', attrs: { type: 'button' } });
        const footInfo = h('div', { className: 'hoi-wizard__selection', attrs: { 'aria-live': 'polite' } });

        const root = h('div', { className: 'hoi-wizard' },
            bg,
            h('header', { className: 'hoi-wizard__header' },
                h('div', { className: 'hoi-wizard__brand' },
                    h('span', { className: 'hoi-wizard__emblem', attrs: { 'aria-hidden': 'true' } }, icon('fa-chess-king')),
                    h('div', null,
                        h('div', { className: 'hoi-subtitle', text: 'Grande Estratégia' }),
                        h('h1', { className: 'hoi-title hoi-wizard__title', text: 'Nova Campanha', attrs: { 'data-hoi-modal-title': '' } }))),
                stepNav,
                h('button', {
                    className: 'hoi-btn hoi-btn--ghost hoi-btn--icon hoi-wizard__close',
                    attrs: { type: 'button', 'aria-label': 'Cancelar e fechar', title: 'Cancelar' },
                    on: { click: () => finish(null) },
                }, icon('fa-xmark'))),
            body,
            h('footer', { className: 'hoi-wizard__footer' }, btnBack, footInfo, btnNext));

        btnBack.addEventListener('click', () => {
            if (st.step === 0) finish(null);
            else go(st.step - 1);
        });
        btnNext.addEventListener('click', () => {
            if (!canAdvance()) return;
            if (st.step < STEPS.length - 1) go(st.step + 1);
            else submit();
        });

        function canAdvance() {
            if (st.step === 0) return !!bookmark();
            if (st.step === 1) return !!nation();
            return !!bookmark() && !!nation() && !!cleanLeaderName(st.leaderName);
        }

        function submit() {
            const leaderName = cleanLeaderName(st.leaderName);
            if (!bookmark() || !nation() || !leaderName) return;
            finish({ bookmarkId: st.bookmarkId, nationId: st.nationId, leaderName, difficulty: st.difficulty });
        }

        function go(step) {
            const target = Math.max(0, Math.min(STEPS.length - 1, step));
            if (target > st.step) {
                // Cannot skip over an incomplete step.
                for (let s = st.step; s < target; s += 1) {
                    if (s === 0 && !bookmark()) return;
                    if (s === 1 && !nation()) return;
                }
            }
            st.step = target;
            st.visited = Math.max(st.visited, target);
            if (target >= 1) ensureNation();
            render();
            const focusTarget = body.querySelector('[data-hoi-step-focus]');
            if (focusTarget) focusTarget.focus({ preventScroll: true });
            body.scrollTop = 0;
            // Bring the pre-selected nation into view inside the (scrollable) grid.
            const selectedTile = body.querySelector('.hoi-wz-tile.is-selected');
            const gridScroll = body.querySelector('.hoi-wz-picker__scroll');
            if (selectedTile && gridScroll && gridScroll.scrollHeight > gridScroll.clientHeight) {
                gridScroll.scrollTop = Math.max(0, selectedTile.offsetTop - gridScroll.offsetTop - 12);
            }
        }

        function renderSteps() {
            clear(stepNav);
            STEPS.forEach((s, i) => {
                const state = i === st.step ? 'current' : i <= st.visited ? 'done' : 'todo';
                const btn = h('button', {
                    className: `hoi-wz-steps__btn is-${state}`,
                    attrs: {
                        type: 'button',
                        'aria-current': i === st.step ? 'step' : null,
                        disabled: i > st.visited && i !== st.step ? true : null,
                    },
                    on: { click: () => go(i) },
                },
                h('span', { className: 'hoi-wz-steps__num', attrs: { 'aria-hidden': 'true' } }, state === 'done' ? icon('fa-check') : String(i + 1)),
                h('span', { className: 'hoi-wz-steps__text', text: s.short }));
                stepNav.appendChild(h('li', { className: 'hoi-wz-steps__item' }, btn));
            });
        }

        function renderFooter() {
            btnBack.replaceChildren(icon(st.step === 0 ? 'fa-xmark' : 'fa-chevron-left'), h('span', { text: st.step === 0 ? 'Cancelar' : 'Voltar' }));
            const last = st.step === STEPS.length - 1;
            btnNext.replaceChildren(
                h('span', { text: last ? 'Assumir o Governo' : 'Avançar' }),
                icon(last ? 'fa-landmark-flag' : 'fa-chevron-right'));
            btnNext.classList.toggle('hoi-wizard__next--final', last);
            btnNext.disabled = !canAdvance();
            clear(footInfo);
            const b = bookmark();
            const n = st.step >= 1 ? nation() : null;
            if (b) {
                footInfo.appendChild(h('span', { className: 'hoi-wizard__sel-item' },
                    icon('fa-solid fa-calendar-days'), h('span', { text: `${b.name} · ${formatDate(b.date)}` })));
            }
            if (n) {
                footInfo.appendChild(h('span', { className: 'hoi-wizard__sel-item' }, flagEl(assetUrl, n, 'sm'), h('span', { text: n.name })));
            }
        }

        function render() {
            renderSteps();
            clear(body);
            root.dataset.step = STEPS[st.step].id;
            if (st.step === 0) body.appendChild(renderPeriod());
            else if (st.step === 1) body.appendChild(renderNation());
            else body.appendChild(renderRuler());
            renderFooter();
        }

        function stepHead(i, lead) {
            return h('div', { className: 'hoi-wz-step__head' },
                h('div', { className: 'hoi-wz-step__kicker', text: `Etapa ${i + 1} de ${STEPS.length}` }),
                h('h2', { className: 'hoi-wz-step__title', text: STEPS[i].title }),
                lead ? h('p', { className: 'hoi-wz-step__lead', text: lead }) : null);
        }

        // -------------------------------------------------- step 1: period
        function renderPeriod() {
            const wrap = h('section', { className: 'hoi-wz-step hoi-wz-step--period' },
                stepHead(0, 'Cada período começa com um mundo diferente: alianças, guerras em curso e nível de tensão global próprios.'));
            const grid = h('div', { className: 'hoi-wz-bookmarks', attrs: { role: 'radiogroup', 'aria-label': 'Períodos' } });
            if (!bookmarks.length) {
                grid.appendChild(h('p', { className: 'hoi-dim', text: 'Nenhum período disponível neste cenário.' }));
            }
            bookmarks.forEach((b, idx) => {
                const selected = b.id === st.bookmarkId;
                const artSrc = urlFor(assetUrl, `art/${b.art || `bookmark-${b.id}`}.webp`);
                const artBox = h('div', { className: 'hoi-wz-bookmark__art' });
                if (artSrc) {
                    const img = safeImg(artSrc, { className: 'hoi-wz-bookmark__img', fallback: bgSrc, onError: () => artBox.classList.add('is-missing') });
                    img.style.setProperty('--hoi-fallback-pos', `${[20, 50, 80][idx % 3]}% 40%`);
                    artBox.appendChild(img);
                }
                else artBox.classList.add('is-missing');
                artBox.style.setProperty('--hoi-bm-tint', defcon(b.tension).color);
                artBox.appendChild(h('div', { className: 'hoi-wz-bookmark__tint', attrs: { 'aria-hidden': 'true' } }));
                artBox.appendChild(h('div', { className: 'hoi-wz-bookmark__placeholder', attrs: { 'aria-hidden': 'true' } }, icon('fa-earth-americas')));
                artBox.appendChild(h('div', { className: 'hoi-wz-bookmark__fade', attrs: { 'aria-hidden': 'true' } }));
                artBox.appendChild(h('div', { className: 'hoi-wz-bookmark__year hoi-num', text: String((b.date && b.date.year) || '') }));

                const rec = (b.recommended || []).map((id) => (scenario && scenario.nations && scenario.nations[id]) || null).filter(Boolean).slice(0, 7);
                const card = h('button', {
                    className: `hoi-wz-bookmark${selected ? ' is-selected' : ''}`,
                    attrs: {
                        type: 'button',
                        role: 'radio',
                        'aria-checked': selected ? 'true' : 'false',
                        'data-hoi-step-focus': selected || (!st.bookmarkId && idx === 0) ? '' : null,
                    },
                    on: {
                        click: () => {
                            st.bookmarkId = b.id;
                            render();
                            const again = body.querySelector('.hoi-wz-bookmark.is-selected');
                            if (again) again.focus({ preventScroll: true });
                        },
                        dblclick: () => {
                            st.bookmarkId = b.id;
                            go(1);
                        },
                    },
                },
                artBox,
                h('span', { className: 'hoi-wz-bookmark__check', attrs: { 'aria-hidden': 'true' } }, icon('fa-check')),
                h('div', { className: 'hoi-wz-bookmark__body' },
                    h('div', { className: 'hoi-wz-bookmark__date' }, icon('fa-solid fa-calendar-days'), h('span', { text: formatDate(b.date) })),
                    h('h3', { className: 'hoi-wz-bookmark__name', text: b.name || b.id }),
                    h('p', { className: 'hoi-wz-bookmark__desc', text: b.description || '' }),
                    h('div', { className: 'hoi-wz-bookmark__stats' }, defconPill(b.tension), tensionBar(b.tension)),
                    rec.length ? h('div', { className: 'hoi-wz-bookmark__rec' },
                        h('span', { className: 'hoi-wz-bookmark__rec-label', text: 'Recomendados' }),
                        h('span', { className: 'hoi-wz-bookmark__rec-flags' }, rec.map((n) => {
                            const f = flagEl(assetUrl, n, 'sm');
                            f.setAttribute('title', n.name || n.id);
                            return f;
                        }))) : null));
                grid.appendChild(card);
            });
            grid.addEventListener('keydown', (e) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || !bookmarks.length) return;
                e.preventDefault();
                const i = Math.max(0, bookmarks.findIndex((b) => b.id === st.bookmarkId));
                const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
                st.bookmarkId = bookmarks[(i + d + bookmarks.length) % bookmarks.length].id;
                render();
                const again = body.querySelector('.hoi-wz-bookmark.is-selected');
                if (again) again.focus({ preventScroll: true });
            });
            wrap.appendChild(grid);
            return wrap;
        }

        // -------------------------------------------------- step 2: nation
        function renderNation() {
            const list = playable();
            const rec = recommended();
            const recSet = new Set(rec);

            const search = h('input', {
                className: 'hoi-input hoi-wz-search__input',
                attrs: {
                    type: 'search',
                    placeholder: 'Buscar nação, capital ou traço…',
                    'aria-label': 'Buscar nação',
                    autocomplete: 'off',
                    spellcheck: 'false',
                    value: st.query,
                    'data-hoi-step-focus': '',
                },
            });
            search.value = st.query;
            const sortSel = h('select', { className: 'hoi-select hoi-wz-picker__sort-select', attrs: { 'aria-label': 'Ordenar por' } },
                SORT_MODES.map((m) => h('option', { text: m.label, attrs: { value: m.id, selected: m.id === st.sort ? true : null } })));
            sortSel.value = st.sort;

            const chips = h('div', { className: 'hoi-wz-picker__chips', attrs: { role: 'group', 'aria-label': 'Filtrar por bloco' } });
            const grid = h('div', { className: 'hoi-wz-picker__grid', attrs: { role: 'listbox', 'aria-label': 'Nações jogáveis' } });
            const count = h('div', { className: 'hoi-wz-picker__count hoi-faint', attrs: { 'aria-live': 'polite' } });
            const dossier = h('aside', { className: 'hoi-wz-dossier hoi-scroll', attrs: { 'aria-label': 'Dossiê da nação' } });

            function renderChips() {
                clear(chips);
                const defs = [{ id: 'all', label: 'Todos', n: list.length }];
                if (rec.length) defs.push({ id: 'recommended', label: 'Recomendados', n: rec.length, icon: 'fa-star' });
                for (const b of blocsIn(list)) defs.push({ id: b, label: BLOC_LABELS[b], n: list.filter((x) => x.bloc === b).length, color: BLOC_COLORS[b] });
                for (const d of defs) {
                    chips.appendChild(h('button', {
                        className: `hoi-wz-filter${st.bloc === d.id ? ' is-active' : ''}`,
                        style: d.color ? { '--hoi-bloc': d.color } : null,
                        attrs: { type: 'button', 'aria-pressed': st.bloc === d.id ? 'true' : 'false' },
                        on: {
                            click: () => {
                                st.bloc = d.id;
                                renderChips();
                                renderGrid();
                            },
                        },
                    },
                    d.icon ? icon(d.icon) : d.color ? h('span', { className: 'hoi-wz-bloc__dot', attrs: { 'aria-hidden': 'true' } }) : null,
                    h('span', { text: d.label }),
                    h('span', { className: 'hoi-wz-filter__n hoi-num', text: String(d.n) })));
                }
            }

            function renderGrid() {
                clear(grid);
                const shown = sortNations(filterNations(list, { query: st.query, bloc: st.bloc, recommended: rec }), st.sort);
                count.textContent = shown.length === 1 ? '1 nação' : `${shown.length} nações`;
                if (!shown.length) {
                    grid.appendChild(h('div', { className: 'hoi-wz-picker__empty' },
                        icon('fa-magnifying-glass'),
                        h('span', { text: 'Nenhuma nação corresponde à busca.' })));
                    return;
                }
                for (const n of shown) {
                    const selected = n.id === st.nationId;
                    const power = nationPower(n);
                    grid.appendChild(h('button', {
                        className: `hoi-wz-tile${selected ? ' is-selected' : ''}${recSet.has(n.id) ? ' is-recommended' : ''}`,
                        style: { '--hoi-bloc': BLOC_COLORS[n.bloc] || '#6f7a6a' },
                        attrs: { type: 'button', role: 'option', 'aria-selected': selected ? 'true' : 'false', 'data-id': n.id },
                        on: {
                            click: () => select(n.id),
                            dblclick: () => {
                                select(n.id);
                                go(2);
                            },
                        },
                    },
                    flagEl(assetUrl, n),
                    h('span', { className: 'hoi-wz-tile__main' },
                        h('span', { className: 'hoi-wz-tile__name', text: n.name || n.id }),
                        h('span', { className: 'hoi-wz-tile__meta' },
                            h('span', { className: 'hoi-wz-tile__bloc' },
                                h('span', { className: 'hoi-wz-bloc__dot', attrs: { 'aria-hidden': 'true' } }),
                                h('span', { className: 'hoi-wz-tile__bloc-text', text: BLOC_LABELS[n.bloc] || n.bloc || '' })),
                            difficultyDots(nationDifficulty(n)))),
                    h('span', { className: 'hoi-wz-tile__power hoi-num', attrs: { title: `Poder ${power}` }, text: String(power) }),
                    recSet.has(n.id) ? h('span', { className: 'hoi-wz-tile__rec', attrs: { title: 'Recomendado para este período' } }, icon('fa-star')) : null));
                }
            }

            function select(id) {
                st.nationId = id;
                for (const el of grid.querySelectorAll('.hoi-wz-tile')) {
                    const on = el.getAttribute('data-id') === id;
                    el.classList.toggle('is-selected', on);
                    el.setAttribute('aria-selected', on ? 'true' : 'false');
                }
                renderDossier();
                renderFooter();
            }

            function renderDossier() {
                clear(dossier);
                const n = nation();
                if (!n) {
                    dossier.appendChild(h('div', { className: 'hoi-wz-dossier__empty hoi-dim' },
                        icon('fa-earth-americas'), h('span', { text: 'Selecione uma nação para ver o dossiê.' })));
                    return;
                }
                const diff = nationDifficulty(n);
                const dip = nationDiplomacy(world(), n.id);
                const nuclear = Number(n.nuclear) || 0;

                dossier.appendChild(h('header', { className: 'hoi-wz-dossier__head' },
                    flagEl(assetUrl, n, 'lg'),
                    h('div', { className: 'hoi-wz-dossier__id' },
                        h('h3', { className: 'hoi-wz-dossier__name', text: n.name || n.id }),
                        h('div', { className: 'hoi-wz-dossier__gov', text: [n.leaderTitle, n.government].filter(Boolean).join(' · ') }),
                        h('div', { className: 'hoi-wz-dossier__badges' },
                            blocChip(n.bloc),
                            h('span', { className: `hoi-chip hoi-wz-diffchip hoi-wz-diffchip--${diff}` }, icon('fa-gauge-high'), h('span', { text: `Dificuldade ${NATION_DIFFICULTY_LABELS[diff]}` })),
                            recSet.has(n.id) ? h('span', { className: 'hoi-chip hoi-chip--brass' }, icon('fa-star'), h('span', { text: 'Recomendado' })) : null))));

                if (n.blurb) dossier.appendChild(h('p', { className: 'hoi-wz-dossier__blurb', text: n.blurb }));

                dossier.appendChild(h('dl', { className: 'hoi-wz-dossier__facts' },
                    fact('fa-solid fa-city', 'Capital', n.capital || '—'),
                    fact('fa-solid fa-user-tie', 'Governante', n.leaderTitle || '—'),
                    fact('fa-solid fa-radiation', 'Arsenal', NUCLEAR_LABELS[nuclear] || NUCLEAR_LABELS[0], nuclear > 0 ? 'is-nuclear' : ''),
                    fact('fa-solid fa-ranking-star', 'Poder', `${nationPower(n)} / 100`)));

                if (Array.isArray(n.traits) && n.traits.length) {
                    dossier.appendChild(h('div', { className: 'hoi-wz-dossier__traits' },
                        n.traits.map((t) => h('span', { className: 'hoi-chip hoi-wz-trait', text: t }))));
                }

                dossier.appendChild(h('div', { className: 'hoi-section-head', text: 'Recursos' }));
                dossier.appendChild(h('div', { className: 'hoi-wz-res' }, resourceRows(n).map((r) => h('div', { className: 'hoi-wz-res__row' },
                    icon(RESOURCE_ICONS[r.key], 'hoi-wz-res__icon'),
                    h('span', { className: 'hoi-wz-res__label', text: RESOURCE_LABELS[r.key] }),
                    h('div', { className: 'hoi-bar hoi-wz-res__bar' }, h('div', { className: 'hoi-bar__fill', style: { '--pct': `${r.value}%`, '--fill': resourceColor(r.value) } })),
                    h('span', { className: 'hoi-wz-res__value hoi-num', text: String(r.value) })))));

                dossier.appendChild(h('div', { className: 'hoi-section-head', text: 'Diplomacia no período' }));
                const dipList = h('ul', { className: 'hoi-wz-dossier__dip' });
                for (const w of dip.wars) {
                    dipList.appendChild(h('li', { className: 'hoi-wz-dip hoi-wz-dip--war' },
                        icon('fa-burst', 'hoi-wz-dip__icon'),
                        h('div', { className: 'hoi-wz-dip__main' },
                            h('div', { className: 'hoi-wz-dip__name', text: w.name }),
                            h('div', { className: 'hoi-wz-dip__sub' },
                                h('span', { text: w.side === 'attacker' ? 'Atacando: ' : 'Defendendo-se de: ' }),
                                nationList(w.enemies)))));
                }
                for (const p of dip.pacts) {
                    dipList.appendChild(h('li', { className: `hoi-wz-dip hoi-wz-dip--pact hoi-wz-dip--${p.type}` },
                        icon(p.type === 'trade' ? 'fa-coins' : p.type === 'guarantee' ? 'fa-shield-halved' : 'fa-file-signature', 'hoi-wz-dip__icon'),
                        h('div', { className: 'hoi-wz-dip__main' },
                            h('div', { className: 'hoi-wz-dip__name', text: p.name !== p.typeLabel ? `${p.name} · ${p.typeLabel}` : p.name }),
                            p.partners.length ? h('div', { className: 'hoi-wz-dip__sub' }, nationList(p.partners, 8)) : null)));
                }
                for (const c of dip.crises) {
                    dipList.appendChild(h('li', { className: `hoi-wz-dip hoi-wz-dip--crisis hoi-wz-dip--sev-${c.severity}` },
                        icon('fa-triangle-exclamation', 'hoi-wz-dip__icon'),
                        h('div', { className: 'hoi-wz-dip__main' },
                            h('div', { className: 'hoi-wz-dip__name', text: c.title || 'Crise' }),
                            h('div', { className: 'hoi-wz-dip__sub', text: `Crise · gravidade ${String(SEVERITY_LABELS[c.severity] || '').toLowerCase()}` }))));
                }
                if (!dipList.children.length) {
                    dipList.appendChild(h('li', { className: 'hoi-wz-dip hoi-wz-dip--none hoi-dim', text: 'Sem pactos, guerras ou crises neste período.' }));
                }
                dossier.appendChild(dipList);
            }

            function fact(iconCls, label, value, extra = '') {
                return h('div', { className: `hoi-wz-fact ${extra}`.trim() },
                    h('dt', null, icon(iconCls), h('span', { text: label })),
                    h('dd', { text: value }));
            }

            function nationList(ids, max = 6) {
                const box = h('span', { className: 'hoi-wz-dip__nations' });
                ids.slice(0, max).forEach((id) => {
                    const n = world().nations[id] || { id, name: id };
                    box.appendChild(h('span', { className: 'hoi-wz-dip__nation' }, flagEl(assetUrl, n, 'sm'), h('span', { text: nameOf(id) })));
                });
                if (ids.length > max) box.appendChild(h('span', { className: 'hoi-faint', text: `+${ids.length - max}` }));
                return box;
            }

            search.addEventListener('input', () => {
                st.query = search.value;
                renderGrid();
            });
            search.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && search.value) {
                    e.preventDefault(); // keep the wizard open: first Esc clears the search
                    search.value = '';
                    st.query = '';
                    renderGrid();
                } else if (e.key === 'ArrowDown') {
                    const first = grid.querySelector('.hoi-wz-tile');
                    if (first) {
                        e.preventDefault();
                        first.focus();
                    }
                } else if (e.key === 'Enter') {
                    const first = grid.querySelector('.hoi-wz-tile');
                    if (first) {
                        e.preventDefault();
                        select(first.getAttribute('data-id'));
                    }
                }
            });
            sortSel.addEventListener('change', () => {
                st.sort = sortSel.value;
                renderGrid();
            });
            grid.addEventListener('keydown', (e) => {
                const tiles = Array.from(grid.querySelectorAll('.hoi-wz-tile'));
                const i = tiles.indexOf(document.activeElement);
                if (i < 0) return;
                let j = -1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(tiles.length - 1, i + 1);
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i - 1);
                else if (e.key === 'Home') j = 0;
                else if (e.key === 'End') j = tiles.length - 1;
                if (j >= 0) {
                    e.preventDefault();
                    tiles[j].focus();
                    select(tiles[j].getAttribute('data-id'));
                }
            });

            renderChips();
            renderGrid();
            renderDossier();

            return h('section', { className: 'hoi-wz-step hoi-wz-step--nation' },
                stepHead(1, `Nações jogáveis em ${formatDate(bookmark() && bookmark().date)}. Os dados já refletem o período escolhido.`),
                h('div', { className: 'hoi-wz-picker-layout' },
                    h('div', { className: 'hoi-wz-picker' },
                        h('div', { className: 'hoi-wz-picker__toolbar' },
                            h('label', { className: 'hoi-wz-search' }, icon('fa-magnifying-glass', 'hoi-wz-search__icon'), search),
                            h('label', { className: 'hoi-wz-picker__sort' }, h('span', { className: 'hoi-faint', text: 'Ordenar' }), sortSel)),
                        chips,
                        h('div', { className: 'hoi-wz-picker__scroll hoi-scroll' }, grid),
                        count),
                    dossier));
        }

        // --------------------------------------------------- step 3: ruler
        function renderRuler() {
            const b = bookmark();
            const n = nation();
            const nameInput = h('input', {
                className: 'hoi-input hoi-wz-ruler__input',
                attrs: {
                    type: 'text',
                    maxlength: LEADER_NAME_MAX,
                    placeholder: 'Ex.: Helena Duarte',
                    autocomplete: 'off',
                    spellcheck: 'false',
                    'aria-describedby': 'hoi-ruler-help',
                    'data-hoi-step-focus': '',
                },
            });
            nameInput.value = st.leaderName;
            const error = h('div', { className: 'hoi-wz-ruler__error', attrs: { role: 'alert' } });
            const summary = h('p', { className: 'hoi-wz-summary__line' });

            const refresh = () => {
                const clean = cleanLeaderName(st.leaderName);
                error.textContent = clean ? '' : 'Informe um nome para o governante.';
                summary.textContent = summaryLine({
                    leaderTitle: n && n.leaderTitle,
                    leaderName: clean || '…',
                    nationName: n && n.name,
                    date: b && b.date,
                });
                btnNext.disabled = !canAdvance();
            };
            nameInput.addEventListener('input', () => {
                st.leaderName = nameInput.value;
                refresh();
            });
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                }
            });

            const diffGroup = h('div', { className: 'hoi-wz-diffs', attrs: { role: 'radiogroup', 'aria-label': 'Dificuldade' } });
            const radioName = `hoi-diff-${Math.random().toString(36).slice(2, 8)}`;
            for (const id of DIFFICULTY_ORDER) {
                const meta = DIFFICULTY_META[id];
                const input = h('input', {
                    className: 'hoi-wz-diffs__radio',
                    attrs: { type: 'radio', name: radioName, value: id, checked: st.difficulty === id ? true : null },
                });
                input.checked = st.difficulty === id;
                input.addEventListener('change', () => {
                    if (!input.checked) return;
                    st.difficulty = id;
                    for (const card of diffGroup.querySelectorAll('.hoi-wz-diffs__card')) card.classList.toggle('is-selected', card.dataset.id === id);
                    diffValue.textContent = meta.label;
                });
                diffGroup.appendChild(h('label', { className: `hoi-wz-diffs__card hoi-wz-diffs__card--${id}${st.difficulty === id ? ' is-selected' : ''}`, dataset: { id } },
                    input,
                    h('span', { className: 'hoi-wz-diffs__icon', attrs: { 'aria-hidden': 'true' } }, icon(meta.icon)),
                    h('span', { className: 'hoi-wz-diffs__label', text: meta.label }),
                    h('span', { className: 'hoi-wz-diffs__text', text: meta.text })));
            }

            const diffValue = h('dd', { text: DIFFICULTY_META[st.difficulty].label });
            const bArt = b ? urlFor(assetUrl, `art/${b.art || `bookmark-${b.id}`}.webp`) : '';
            const banner = h('div', { className: 'hoi-wz-summary__banner' });
            if (bArt) banner.appendChild(safeImg(bArt, { className: 'hoi-wz-summary__banner-img', fallback: bgSrc, onError: () => banner.classList.add('is-missing') }));
            else banner.classList.add('is-missing');
            banner.appendChild(h('div', { className: 'hoi-wz-summary__banner-fade', attrs: { 'aria-hidden': 'true' } }));
            if (n) banner.appendChild(flagEl(assetUrl, n, 'lg'));

            const summaryCard = h('aside', { className: 'hoi-wz-summary' },
                banner,
                h('div', { className: 'hoi-wz-summary__body' },
                    h('div', { className: 'hoi-subtitle', text: 'Juramento de posse' }),
                    summary,
                    h('dl', { className: 'hoi-wz-summary__facts' },
                        h('div', null, h('dt', { text: 'Período' }), h('dd', { text: b ? b.name : '—' })),
                        h('div', null, h('dt', { text: 'Fim da campanha' }), h('dd', { text: b && b.endDate ? formatDate(b.endDate) : '—' })),
                        h('div', null, h('dt', { text: 'Alerta inicial' }), h('dd', null, b ? defconPill(b.tension) : '—')),
                        h('div', null, h('dt', { text: 'Dificuldade' }), diffValue)),
                    h('p', { className: 'hoi-wz-summary__note hoi-faint', text: 'Cada mês você gasta Capital Político em ações e depois avança o turno. O chat continua sendo o palco: suas ordens como governante são executadas pelo motor do jogo.' })));

            const form = h('div', { className: 'hoi-wz-ruler' },
                h('label', { className: 'hoi-wz-field' },
                    h('span', { className: 'hoi-wz-field__label', text: 'Nome do governante' }),
                    nameInput,
                    h('span', { className: 'hoi-wz-field__help hoi-faint', attrs: { id: 'hoi-ruler-help' }, text: 'Como o gabinete, a imprensa e os outros chefes de Estado vão chamar você. Por padrão, o nome da sua persona.' }),
                    error),
                h('div', { className: 'hoi-wz-field' },
                    h('span', { className: 'hoi-wz-field__label', text: 'Dificuldade' }),
                    diffGroup));

            refresh();
            return h('section', { className: 'hoi-wz-step hoi-wz-step--ruler' },
                stepHead(2, 'Defina quem vai governar e o nível de desafio da campanha.'),
                h('div', { className: 'hoi-wz-ruler-layout' }, form, summaryCard));
        }

        root.addEventListener('keydown', (e) => {
            // Alt+ArrowLeft / Alt+ArrowRight move between steps.
            if (!e.altKey || isTypingTarget(e.target)) return;
            if (e.key === 'ArrowLeft' && st.step > 0) {
                e.preventDefault();
                go(st.step - 1);
            } else if (e.key === 'ArrowRight' && canAdvance() && st.step < STEPS.length - 1) {
                e.preventDefault();
                go(st.step + 1);
            }
        });

        render();
        handle = openModal({
            className: 'hoi-modal--wizard',
            content: root,
            dismissible: true,
            onDismiss: () => finish(null),
        });
        const first = body.querySelector('[data-hoi-step-focus]');
        if (first) first.focus({ preventScroll: true });
    });
}

function resourceColor(v) {
    if (v >= 70) return '#6fae6a';
    if (v >= 45) return '#c9a227';
    if (v >= 25) return '#d9863a';
    return '#c4473a';
}
