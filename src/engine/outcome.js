/**
 * @file src/engine/outcome.js
 * Victory / defeat (DESIGN §3.7).
 *   Defeat:  global nuclear war (tension 100), player annexed / capitulated / puppet,
 *            player stability 0 for 2 consecutive turns (golpe de Estado).
 *   Victory: endDate reached with the player active (score = rank + stability + tension
 *            avoided), or Hegemonia: every enemy the player fought capitulated while the
 *            player is rank 1 and no longer at war.
 */

import { NATION_STATUS, PHASES } from '../contract/constants.js';
import { formatDate } from '../contract/presentation.js';
import { monthsBetween } from '../contract/worldState.js';
import { addHeadline } from './collector.js';
import { textFor } from './text.js';
import { ensureEngine, isAtWar, pushLog } from './util.js';
import { rankingOf } from './view.js';

/** Survival score 0..100 (shown in the victory reason). */
export function survivalScore(state) {
    const pid = state.player.nationId;
    const ranking = rankingOf(state);
    const rank = Math.max(1, ranking.findIndex((r) => r.id === pid) + 1 || ranking.length + 1);
    const stab = state.nations[pid] ? state.nations[pid].resources.stability : 0;
    const rankPts = Math.max(0, 40 - (rank - 1) * 4);
    return { score: Math.round(rankPts + stab * 0.3 + (100 - state.globalTension) * 0.3), rank };
}

/**
 * Checks the outcome on a MUTABLE state; sets state.outcome + phase GAME_OVER.
 * @param {Object} state
 * @param {{endOfTurn?: boolean, tc?: Object}} [opts] endOfTurn enables the per-turn
 *        conditions (coup counter, survival, hegemony).
 * @returns {?{kind:'victory'|'defeat', reason:string}}
 */
export function checkOutcome(state, opts = {}) {
    if (state.outcome) return { kind: state.outcome.kind, reason: state.outcome.reason };
    const t = textFor(state);
    const pid = state.player.nationId;
    const p = state.nations[pid];
    const e = ensureEngine(state);
    let out = null;
    if (state.globalTension >= 100) {
        out = { kind: 'defeat', reason: 'Guerra nuclear global: as grandes potências trocaram ataques nucleares e a civilização entrou em colapso.' };
    } else if (!p || p.status === NATION_STATUS.ANNEXED) {
        const by = p && p.controller && p.controller !== pid ? ` ${t.por(p.controller)}` : '';
        out = { kind: 'defeat', reason: `${t.The(pid)} ${t.v(pid, 'foi', 'foram')} ${t.g(pid, 'anexado', 'anexada')}${by}. Seu governo deixou de existir.` };
    } else if (p.status === NATION_STATUS.CAPITULATED || p.status === NATION_STATUS.PUPPET) {
        out = { kind: 'defeat', reason: `${t.The(pid)} ${t.v(pid, 'capitulou', 'capitularam')}. O governo caiu e o país está à mercê dos vencedores.` };
    } else if (opts.endOfTurn) {
        if (p.resources.stability <= 0) e.zeroStability += 1;
        else e.zeroStability = 0;
        if (e.zeroStability >= 2) {
            out = { kind: 'defeat', reason: `Golpe de Estado: após dois meses de colapso da ordem, os militares depuseram o governo ${t.de(pid)}.` };
        } else {
            const { score, rank } = survivalScore(state);
            const fought = e.foughtEnemies.filter((id) => state.nations[id]);
            const allBeaten = fought.length > 0 && fought.every((id) => state.nations[id].status !== NATION_STATUS.ACTIVE);
            if (allBeaten && rank === 1 && !isAtWar(state, pid)) {
                out = { kind: 'victory', reason: `Hegemonia: todos os inimigos capitularam e ${t.the(pid)} ${t.v(pid, 'é', 'são')} a maior potência do mundo.` };
            } else if (monthsBetween(state.date, state.endDate) <= 0) {
                out = {
                    kind: 'victory',
                    reason: `Sobrevivência: ${t.the(pid)} ${t.v(pid, 'chegou', 'chegaram')} a ${formatDate(state.endDate)} na ${rank}ª posição do ranking de poder. Pontuação: ${score}.`,
                };
            }
        }
    }
    if (!out) return null;
    state.outcome = { kind: out.kind, reason: out.reason, turn: state.turn };
    state.phase = PHASES.GAME_OVER;
    pushLog(state, 'system', `Fim de jogo (${out.kind === 'victory' ? 'vitória' : 'derrota'}): ${out.reason}`);
    addHeadline(opts.tc, `Fim da campanha: ${out.reason}`, 10, 'player', [pid]);
    return out;
}
