/**
 * @file src/ui/dialogs/gameOver.js
 * End-of-campaign screen: victory/defeat art, reason, campaign stats and the
 * top-10 power ranking.
 *
 * Contract (DESIGN §6.2):
 *   openGameOver({ outcome, state, ranking, assetUrl }) -> Promise<'new'|'close'>
 * Esc / backdrop resolve 'close'. Never rejects.
 */

import { defcon, formatDate } from '../../contract/presentation.js';
import { flagEl, h, icon, paragraphs, safeImg, urlFor } from './dom.js';
import { openModal } from './modalHost.js';

/**
 * Pure campaign statistics for the end screen.
 * @param {?import('../../contract/worldState.js').WorldState} state
 * @param {Array<{id:string, name:string, power:number}>} [ranking]
 */
export function campaignStats(state, ranking) {
    const s = state || {};
    const player = (s.player && s.player.nationId) || null;
    const months = Math.max(0, (Number(s.turn) || 1) - 1);
    const warIds = new Set();
    for (const w of Array.isArray(s.wars) ? s.wars : []) {
        if (w && ((w.attackers || []).includes(player) || (w.defenders || []).includes(player))) warIds.add(w.id || w.name);
    }
    for (const entry of Array.isArray(s.log) ? s.log : []) {
        const d = entry && entry.kind === 'war' && entry.data;
        if (!d || !d.warId) continue;
        const sides = [...(d.attackers || []), ...(d.defenders || [])];
        if (sides.includes(player)) warIds.add(d.warId);
    }
    const flagged = Number(s.flags && s.flags.warsFought);
    const wars = Math.max(warIds.size, Number.isFinite(flagged) ? flagged : 0);
    const allies = new Set();
    for (const p of Array.isArray(s.pacts) ? s.pacts : []) {
        if (!p || (p.type !== 'alliance' && p.type !== 'defense') || !(p.members || []).includes(player)) continue;
        for (const m of p.members) if (m !== player) allies.add(m);
    }
    const list = Array.isArray(ranking) ? ranking : [];
    const idx = list.findIndex((r) => r && r.id === player);
    return {
        months,
        wars,
        rank: idx >= 0 ? idx + 1 : null,
        rankOf: list.length,
        decisions: Array.isArray(s.decisions) ? s.decisions.length : 0,
        tension: Math.round(Number(s.globalTension) || 0),
        allies: allies.size,
    };
}

/** "1 mês" / "14 meses" */
export function monthsLabel(n) {
    return n === 1 ? '1 mês' : `${n} meses`;
}

/**
 * @param {Object} opts
 * @param {{kind: 'victory'|'defeat', reason: string}} opts.outcome
 * @param {?import('../../contract/worldState.js').WorldState} opts.state
 * @param {Array<{id:string, name:string, power:number}>} [opts.ranking]
 * @param {(path: string) => string} [opts.assetUrl]
 * @returns {Promise<'new'|'close'>}
 */
export function openGameOver({ outcome, state, ranking, assetUrl } = {}) {
    return new Promise((resolve) => {
        let settled = false;
        let handle = null;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
            if (handle) handle.close();
        };

        const victory = outcome && outcome.kind === 'victory';
        const kind = victory ? 'victory' : 'defeat';
        const s = state || {};
        const nations = s.nations || {};
        const playerId = s.player && s.player.nationId;
        const pn = playerId ? nations[playerId] : null;
        const stats = campaignStats(s, ranking);
        const d = defcon(stats.tension);

        // ------------------------------------------------------------- art
        const art = h('div', { className: 'hoi-gameover__art' });
        const src = urlFor(assetUrl, `art/${kind}.webp`);
        // Until victory/defeat art exists, fall back to the title art (tinted by CSS).
        if (src) art.appendChild(safeImg(src, { className: 'hoi-gameover__img', fallback: urlFor(assetUrl, 'art/title.webp'), onError: () => art.classList.add('is-missing') }));
        else art.classList.add('is-missing');
        art.appendChild(h('div', { className: 'hoi-gameover__tint', attrs: { 'aria-hidden': 'true' } }));
        art.appendChild(h('div', { className: 'hoi-gameover__fade', attrs: { 'aria-hidden': 'true' } }));
        art.appendChild(h('div', { className: 'hoi-gameover__heading' },
            h('div', { className: 'hoi-gameover__kicker' }, icon(victory ? 'fa-trophy' : 'fa-skull'), h('span', { text: 'Fim da campanha' })),
            h('h2', { className: 'hoi-gameover__title', text: victory ? 'Vitória' : 'Derrota', attrs: { 'data-hoi-modal-title': '' } }),
            h('div', { className: 'hoi-gameover__reason' }, paragraphs(outcome && outcome.reason ? outcome.reason : (victory ? 'Sua nação atravessou a crise.' : 'Seu governo chegou ao fim.')))));

        // ----------------------------------------------------------- stats
        const leader = h('div', { className: 'hoi-gameover__leader' },
            pn ? flagEl(assetUrl, pn, 'lg') : null,
            h('div', null,
                h('div', { className: 'hoi-gameover__leader-name', text: [s.player && s.player.title, s.player && s.player.leaderName].filter(Boolean).join(' ') || 'Governante' }),
                h('div', { className: 'hoi-gameover__leader-sub hoi-dim', text: [pn && pn.name, s.date ? `até ${formatDate(s.date)}` : ''].filter(Boolean).join(' · ') })));

        const tile = (iconCls, label, value, sub) => h('div', { className: 'hoi-go-stat' },
            h('div', { className: 'hoi-go-stat__label' }, icon(iconCls), h('span', { text: label })),
            h('div', { className: 'hoi-go-stat__value hoi-num', text: value }),
            sub ? h('div', { className: 'hoi-go-stat__sub hoi-faint', text: sub }) : null);

        const statsGrid = h('div', { className: 'hoi-gameover__stats' },
            tile('fa-calendar-days', 'Meses governados', String(stats.months), stats.months === 1 ? 'mês no poder' : 'meses no poder'),
            tile('fa-burst', 'Guerras', String(stats.wars), stats.wars === 1 ? 'conflito envolvendo sua nação' : 'conflitos envolvendo sua nação'),
            tile('fa-ranking-star', 'Posição no ranking', stats.rank ? `${stats.rank}º` : '—', stats.rankOf ? `de ${stats.rankOf} nações` : ''),
            tile('fa-gavel', 'Decisões', String(stats.decisions), 'eventos decididos'),
            tile('fa-handshake', 'Aliados', String(stats.allies), 'em pactos de aliança ou defesa'),
            tile('fa-radiation', 'Tensão final', String(stats.tension), `DEFCON ${d.level} · ${d.label}`));

        // --------------------------------------------------------- ranking
        const list = Array.isArray(ranking) ? ranking.filter(Boolean) : [];
        const top = list.slice(0, 10);
        const maxPower = Math.max(1, ...list.map((r) => Number(r.power) || 0));
        const row = (r, pos) => {
            const n = nations[r.id] || { id: r.id, name: r.name };
            const power = Math.round(Number(r.power) || 0);
            return h('tr', { className: r.id === playerId ? 'is-player' : '' },
                h('td', { className: 'hoi-go-rank__pos hoi-num', text: `${pos}º` }),
                h('td', null, h('div', { className: 'hoi-go-rank__nation' }, flagEl(assetUrl, n, 'sm'), h('span', { text: r.name || n.name || r.id }))),
                h('td', { className: 'hoi-go-rank__power-cell' }, h('div', { className: 'hoi-go-rank__power' },
                    h('div', { className: 'hoi-bar hoi-go-rank__bar' }, h('div', { className: 'hoi-bar__fill', style: { '--pct': `${Math.round((power / maxPower) * 100)}%` } })),
                    h('span', { className: 'hoi-num', text: String(power) }))));
        };
        const tbody = h('tbody', null, top.map((r, i) => row(r, i + 1)));
        const pIdx = list.findIndex((r) => r.id === playerId);
        if (pIdx >= 10) {
            tbody.appendChild(h('tr', { className: 'hoi-go-rank__gap', attrs: { 'aria-hidden': 'true' } }, h('td', { attrs: { colspan: 3 }, text: '⋯' })));
            tbody.appendChild(row(list[pIdx], pIdx + 1));
        }
        const rankTable = list.length
            ? h('table', { className: 'hoi-go-rank' },
                h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Nação' }), h('th', { text: 'Poder' }))),
                tbody)
            : h('p', { className: 'hoi-dim', text: 'Ranking indisponível.' });

        const btnNew = h('button', {
            className: 'hoi-btn hoi-btn--lg hoi-btn--primary',
            attrs: { type: 'button', 'data-hoi-autofocus': '' },
            on: { click: () => finish('new') },
        }, icon('fa-flag'), h('span', { text: 'Nova Campanha' }));
        const btnClose = h('button', {
            className: 'hoi-btn hoi-btn--lg',
            attrs: { type: 'button' },
            on: { click: () => finish('close') },
        }, h('span', { text: 'Fechar' }));

        const root = h('div', { className: `hoi-gameover hoi-gameover--${kind}` },
            art,
            h('div', { className: 'hoi-gameover__content hoi-scroll' },
                h('section', { className: 'hoi-gameover__summary' },
                    h('div', { className: 'hoi-section-head', text: 'Balanço do governo' }),
                    leader,
                    statsGrid),
                h('section', { className: 'hoi-gameover__ranking' },
                    h('div', { className: 'hoi-section-head', text: 'Ranking de poder · top 10' }),
                    rankTable)),
            h('footer', { className: 'hoi-gameover__foot' }, btnClose, btnNew));

        handle = openModal({
            className: 'hoi-modal--gameover',
            content: root,
            dismissible: true,
            onDismiss: () => finish('close'),
        });
    });
}
