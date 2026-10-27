/**
 * @file src/engine/actions.js
 * Action availability (requirements + pt-BR reasons), success chance and execution
 * (costs, cooldowns, dice, effects, scripted specials, records).
 */

import { NATION_STATUS, PHASES, RESOURCE_KEYS } from '../contract/constants.js';
import { RESOURCE_LABELS } from '../contract/presentation.js';
import { clamp, clampTension, getRelation } from '../contract/worldState.js';
import { CATALOG, MOBILIZATION_SOURCES, getActionDef } from './catalog.js';
import { addEvent, addHeadline } from './collector.js';
import { deescalateCrisis, sevIndex, startUnrest, unrestCrisisOf } from './crises.js';
import { PACT_INDEFINITE, acceptanceChance, pactExists } from './diplomacy.js';
import { applyEffectsInPlace, resolveNationRef } from './effects.js';
import { buildProposalEvent } from './engineEvents.js';
import { fmtNum, monthsLabel, textFor } from './text.js';
import {
    addRelation,
    addResource,
    canProject,
    isActive,
    isAllied,
    isAtWar,
    isMajor,
    nationPower,
    nextSeq,
    pushLog,
    pushRecentAction,
    sideOf,
    warBetween,
} from './util.js';
import { pushFront } from './war.js';

/** Proposals the AI can send to the player as engine events. */
const PROPOSALS_TO_PLAYER = new Set([
    'dip_trade_agreement',
    'eco_energy_deal',
    'dip_propose_alliance',
    'dip_defense_pact',
    'dip_propose_ceasefire',
    'dip_propose_peace',
]);

/** True when `id` has an active partial/total mobilization modifier. */
export function isMobilized(state, id) {
    return state.modifiers.some((m) => m.nationId === id && MOBILIZATION_SOURCES.includes(m.source));
}

/** True when `id` has an active counter-intelligence modifier (intel actions against it: -20%). */
export function hasCounterintel(state, id) {
    return state.modifiers.some((m) => m.nationId === id && m.source === 'intel_counterintel');
}

function cooldownLeft(state, actorId, actionId) {
    const until = state.cooldowns && state.cooldowns[actorId] ? state.cooldowns[actorId][actionId] : 0;
    return Math.max(0, (Number(until) || 0) - state.turn);
}

function targetStatusReason(state, target) {
    const t = textFor(state);
    if (target.status === NATION_STATUS.ANNEXED) return 'Alvo indisponível: território anexado';
    if (target.status === NATION_STATUS.CAPITULATED) return 'Alvo indisponível: capitulou e aguarda os termos de paz';
    if (target.status === NATION_STATUS.PUPPET) return `Alvo indisponível: Estado-fantoche ${t.de(target.overlord)}`;
    return 'Alvo indisponível';
}

/**
 * Success chance 0..100 (ChanceSpec formula, acceptance for proposals, 100 when null).
 */
export function computeChance(state, def, actorId, targetId) {
    const actor = state.nations[actorId];
    const target = targetId ? state.nations[targetId] : null;
    if (def.acceptance) return target && targetId !== actorId ? acceptanceChance(state, actorId, targetId, def.acceptance) : 50;
    if (!def.chance || !actor) return 100;
    const c = def.chance;
    let v = Number(c.base) || 0;
    if (c.stats) for (const [k, w] of Object.entries(c.stats)) v += (actor.resources[k] || 0) * w;
    if (c.relationWeight && target) v += getRelation(state, actorId, targetId) * c.relationWeight;
    if (c.targetStats && target) for (const [k, w] of Object.entries(c.targetStats)) v += (target.resources[k] || 0) * w;
    if (def.category === 'intel' && target && hasCounterintel(state, targetId)) v -= 20;
    return Math.round(clamp(v, 5, 95));
}

/**
 * Evaluates one action for actor/target.
 * @param {{fast?: boolean}} [opts] fast: stop at the first failing check (AI).
 * @returns {import('../contract/events.js').ActionAvailability}
 */
export function evaluateAction(state, def, actorId, targetId, opts = {}) {
    const reasons = [];
    const fast = !!opts.fast;
    const t = textFor(state);
    const actor = state.nations[actorId];
    const cdLeft = actor ? cooldownLeft(state, actorId, def.id) : 0;
    const done = (chance) => ({ def, available: reasons.length === 0, reasons, chance, cooldownLeft: cdLeft });
    const fail = (msg) => {
        reasons.push(msg);
        return fast;
    };
    if (!actor) {
        reasons.push('Nação desconhecida');
        return done(0);
    }
    if (state.phase === PHASES.GAME_OVER && fail('A campanha terminou')) return done(0);
    if (actor.status !== NATION_STATUS.ACTIVE && fail('Sua nação não pode agir neste momento')) return done(0);
    if (def.playerOnly && actorId !== state.player.nationId && fail('Ação exclusiva do jogador')) return done(0);

    let target = null;
    if (def.target === 'nation') {
        if (!targetId) {
            if (fail('Selecione um alvo')) return done(0);
        } else if (targetId === actorId) {
            if (fail('Escolha outra nação como alvo')) return done(0);
        } else if (!state.nations[targetId]) {
            if (fail('Nação-alvo desconhecida')) return done(0);
        } else {
            target = state.nations[targetId];
            const req = def.requires || {};
            if (req.targetActive !== false && target.status !== NATION_STATUS.ACTIVE && fail(targetStatusReason(state, target))) return done(0);
        }
    }
    if (cdLeft > 0 && fail(`Em recarga: ${monthsLabel(cdLeft)} restante${cdLeft === 1 ? '' : 's'}`)) return done(0);
    const pcCost = def.cost.pc || 0;
    if ((actor.pc || 0) < pcCost && fail(`Capital Político insuficiente (${actor.pc || 0}/${pcCost})`)) return done(0);
    for (const [k, amt] of Object.entries(def.cost.resources || {})) {
        if ((actor.resources[k] || 0) < amt && fail(`${RESOURCE_LABELS[k] || k} insuficiente (${actor.resources[k] || 0}/${amt})`)) return done(0);
    }

    const req = def.requires || {};
    // actor-only requirements
    if (req.atWar === true && !isAtWar(state, actorId) && fail('Disponível apenas em tempo de guerra')) return done(0);
    if (req.atWar === false && isAtWar(state, actorId) && fail('Indisponível durante uma guerra')) return done(0);
    if (req.nuclear && !(actor.nuclear > 0) && fail('Requer arsenal nuclear')) return done(0);
    if (req.notNuclear && actor.nuclear > 0 && fail('Indisponível para potências nucleares')) return done(0);
    if (req.minResources) {
        for (const [k, v] of Object.entries(req.minResources)) {
            if ((actor.resources[k] || 0) < v && fail(`${RESOURCE_LABELS[k] || k} precisa ser de pelo menos ${v} (atual ${actor.resources[k] || 0})`)) return done(0);
        }
    }
    if (typeof req.maxTension === 'number' && state.globalTension > req.maxTension && fail(`Tensão global alta demais (máximo ${req.maxTension}, atual ${state.globalTension})`)) return done(0);
    if (typeof req.minTension === 'number' && state.globalTension < req.minTension && fail(`Tensão global baixa demais (mínimo ${req.minTension}, atual ${state.globalTension})`)) return done(0);
    if (req.mobilized && !isMobilized(state, actorId) && fail('Nenhuma mobilização em curso')) return done(0);
    if (req.notMobilized && isMobilized(state, actorId) && fail('Já existe uma mobilização em curso')) return done(0);

    // target requirements
    if (target) {
        const rel = getRelation(state, actorId, targetId);
        const war = warBetween(state, actorId, targetId);
        if (typeof req.minRelation === 'number' && rel < req.minRelation && fail(`Relação ${t.com(targetId)} precisa ser de pelo menos ${fmtNum(req.minRelation)} (atual ${fmtNum(rel)})`)) return done(0);
        if (typeof req.maxRelation === 'number' && rel > req.maxRelation && fail(`Relação ${t.com(targetId)} precisa ser de no máximo ${fmtNum(req.maxRelation)} (atual ${fmtNum(rel)})`)) return done(0);
        if (req.atWarWithTarget && !war && fail(`Não há guerra ${t.com(targetId)}`)) return done(0);
        if (req.notAtWarWithTarget && war && fail(`Já em guerra ${t.com(targetId)}`)) return done(0);
        if (req.notCeasefireWithTarget && war && war.ceasefire && fail(`Já existe um cessar-fogo ${t.com(targetId)}`)) return done(0);
        if (req.targetNeighborOrMajor && !canProject(state, actorId, targetId) && fail(`Sem fronteira ${t.com(targetId)} e sem capacidade de projeção (apenas grandes potências)`)) return done(0);
        if (req.alliedWithTarget && !isAllied(state, actorId, targetId) && fail(`Não há aliança ${t.com(targetId)}`)) return done(0);
        if (req.notAlliedWithTarget && isAllied(state, actorId, targetId) && fail(`Já existe aliança ou pacto de defesa ${t.com(targetId)}`)) return done(0);
        if (req.noPactWithTarget && pactExists(state, req.noPactWithTarget, actorId, targetId) && fail(`Já existe ${PACT_INDEFINITE[req.noPactWithTarget] || 'um pacto'} ${t.com(targetId)}`)) return done(0);
        if (req.strongerThanTarget && nationPower(actor) <= nationPower(target) && fail(`Sua nação precisa ser mais poderosa que ${t.the(targetId)}`)) return done(0);
        if (req.targetAtWar && !isAtWar(state, targetId) && fail(`${t.n(targetId)} ${t.v(targetId, 'não está', 'não estão')} em guerra`)) return done(0);
    }
    return done(def.target === 'nation' && !target ? computeChance(state, def, actorId, null) : computeChance(state, def, actorId, targetId));
}

/**
 * All catalog actions for an actor (DESIGN: targeted actions without a target are
 * unavailable with 'Selecione um alvo').
 * @returns {import('../contract/events.js').ActionAvailability[]}
 */
export function getAvailableActions(state, actorId, targetId = null) {
    const tid = targetId && state.nations[targetId] ? targetId : targetId || null;
    return CATALOG.map((def) => evaluateAction(state, def, actorId, def.target === 'nation' ? tid : null));
}

/* ----------------------------------------------------------------- specials */

function runSpecial(state, def, actorId, targetId, success, rng, tc) {
    const t = textFor(state);
    const details = [];
    switch (def.special) {
        case 'improve': {
            if (!success) break;
            const shared = state.crises.find((c) => c.involved.includes(actorId) && c.involved.includes(targetId));
            if (shared && rng.chance(0.3)) {
                deescalateCrisis(state, shared, tc);
                details.push(`Crise atenuada: ${shared.title}`);
            }
            break;
        }
        case 'total_mobilization':
            if (success) state.modifiers = state.modifiers.filter((m) => !(m.nationId === actorId && m.source === 'mil_partial_mobilization'));
            break;
        case 'demobilize':
            if (success) {
                const before = state.modifiers.length;
                state.modifiers = state.modifiers.filter((m) => !(m.nationId === actorId && MOBILIZATION_SOURCES.includes(m.source)));
                if (state.modifiers.length < before) details.push('Mobilizações encerradas');
            }
            break;
        case 'expeditionary': {
            if (!success) break;
            for (const war of state.wars) {
                if (war.ceasefire || !sideOf(war, targetId)) continue;
                for (const f of war.fronts) {
                    if (f.attacker === targetId) pushFront(state, f, 5);
                    else if (f.defender === targetId) f.progress = Math.max(0, f.progress - 5);
                }
            }
            details.push(`Frentes ${t.de(targetId)} reforçadas`);
            break;
        }
        case 'strike': {
            if (!success) break;
            const war = warBetween(state, actorId, targetId);
            if (war && !war.ceasefire) {
                const f = war.fronts.find((x) => (x.attacker === actorId && x.defender === targetId) || (x.attacker === targetId && x.defender === actorId));
                if (f) {
                    pushFront(state, f, f.attacker === actorId ? 6 : -6);
                    details.push(`Frente ${t.n(f.attacker)} → ${t.n(f.defender)}: ocupação ${f.progress}%`);
                }
            } else {
                state.globalTension = clampTension(state.globalTension + 2);
            }
            break;
        }
        case 'nuclear_test': {
            if (!success) break;
            for (const id of Object.keys(state.nations)) {
                const n = state.nations[id];
                if (id === actorId || !n.major || !isActive(n) || isAllied(state, actorId, id)) continue;
                addRelation(state, actorId, id, -6);
            }
            details.push('Relações com as grandes potências −6');
            break;
        }
        case 'nuclear_strike': {
            if (!success) break;
            const target = state.nations[targetId];
            const actor = state.nations[actorId];
            let extra = 15;
            if ((target.nuclear || 0) > 0) {
                extra += 20;
                addResource(actor, 'economy', -20);
                addResource(actor, 'stability', -20);
                addResource(actor, 'military', -15);
                addResource(actor, 'manpower', -15);
                details.push(`Retaliação nuclear ${t.de(targetId)}: economia, estabilidade e forças armadas devastadas`);
            }
            addResource(actor, 'warSupport', -10);
            for (const id of Object.keys(state.nations)) {
                if (id === actorId || !isActive(state.nations[id])) continue;
                addRelation(state, actorId, id, isAllied(state, actorId, id) ? -10 : -30);
            }
            state.globalTension = clampTension(state.globalTension + extra);
            details.push(`Tensão global +${extra} (reação internacional)`);
            addHeadline(tc, `ATAQUE NUCLEAR: ${t.n(actorId)} ${t.v(actorId, 'atinge', 'atingem')} ${t.the(targetId)}`, 10, 'war', [actorId, targetId]);
            break;
        }
        case 'crackdown': {
            if (!success) break;
            const u = unrestCrisisOf(state, actorId);
            if (u) {
                deescalateCrisis(state, u, tc);
                details.push(`Crise atenuada: ${u.title}`);
            }
            break;
        }
        case 'destabilize': {
            if (!success) break;
            const c = startUnrest(state, targetId, 'medium', tc);
            details.push(`Distúrbios ${t.em(targetId)} (${sevIndex(c.severity) >= 2 ? 'graves' : 'moderados'})`);
            break;
        }
        default:
            break;
    }
    return details;
}

/* ---------------------------------------------------------------- headlines */

/** Deterministic pt-BR headline for an action, or null when not newsworthy. */
export function actionHeadline(state, actionId, a, b, success) {
    const t = textFor(state);
    const A = t.n(a);
    const B = b ? t.n(b) : '';
    const v = (s, p) => t.v(a, s, p);
    const vb = (s, p) => (b ? t.v(b, s, p) : s);
    switch (actionId) {
        case 'dip_improve_relations':
            // friends talking is not news; a thaw between rivals is
            return success && getRelation(state, a, b) < 30 ? `${A} e ${B} intensificam o diálogo diplomático` : null;
        case 'dip_send_aid':
            return `${A} ${v('envia', 'enviam')} ajuda ${t.a(b)}`;
        case 'dip_trade_agreement':
            return success ? `${A} e ${B} assinam acordo comercial` : `${B} ${vb('rejeita', 'rejeitam')} acordo comercial proposto ${t.por(a)}`;
        case 'dip_propose_alliance':
            return success ? `${A} e ${B} formam uma aliança militar` : `${B} ${vb('recusa', 'recusam')} aliança ${t.com(a)}`;
        case 'dip_defense_pact':
            return success ? `${A} e ${B} assinam pacto de defesa mútua` : null;
        case 'dip_guarantee':
            return `${A} ${v('garante', 'garantem')} a independência ${t.de(b)}`;
        case 'dip_sanctions':
            return success ? `${A} ${v('impõe', 'impõem')} sanções ${t.contra(b)}` : null;
        case 'dip_expel_diplomats':
            return `${A} ${v('expulsa', 'expulsam')} diplomatas ${t.de(b)}`;
        case 'dip_ultimatum':
            return success ? `${B} ${vb('cede', 'cedem')} ao ultimato ${t.de(a)}` : `${B} ${vb('rejeita', 'rejeitam')} o ultimato ${t.de(a)}`;
        case 'dip_declare_war':
            return null; // war.js already headlines declarations / joins
        case 'dip_propose_ceasefire':
            return success ? null : `${B} ${vb('rejeita', 'rejeitam')} cessar-fogo proposto ${t.por(a)}`;
        case 'dip_propose_peace':
            return success ? null : `${B} ${vb('rejeita', 'rejeitam')} a proposta de paz ${t.de(a)}`;
        case 'mil_partial_mobilization':
            return `${A} ${v('decreta', 'decretam')} mobilização parcial`;
        case 'mil_total_mobilization':
            return `${A} ${v('decreta', 'decretam')} mobilização total`;
        case 'mil_demobilize':
            return `${A} ${v('desmobiliza', 'desmobilizam')} suas tropas`;
        case 'mil_border_exercises':
            return `${A} ${v('realiza', 'realizam')} exercícios militares perto ${t.de(b)}`;
        case 'mil_modernization':
            return success ? `${A} ${v('anuncia', 'anunciam')} programa de modernização militar` : null;
        case 'mil_expeditionary':
            return `${A} ${v('envia', 'enviam')} força expedicionária ${t.para(b)}`;
        case 'mil_limited_strike':
            return success ? `${A} ${v('bombardeia', 'bombardeiam')} alvos militares ${t.em(b)}` : `Ataque ${t.de(a)} ${t.contra(b)} fracassa`;
        case 'mil_nuclear_alert':
            return `${A} ${v('coloca', 'colocam')} suas forças nucleares em alerta máximo`;
        case 'mil_nuclear_test':
            return `${A} ${v('realiza', 'realizam')} teste nuclear e o mundo condena`;
        case 'mil_nuclear_strike':
            return null; // special already headlines it
        case 'eco_stimulus':
            return success ? `${A} ${v('lança', 'lançam')} pacote de estímulo econômico` : `Pacote econômico ${t.de(a)} gera inflação`;
        case 'eco_austerity':
            return `${A} ${v('anuncia', 'anunciam')} medidas de austeridade`;
        case 'eco_industrial_investment':
            return success ? `${A} ${v('investe', 'investem')} pesado na indústria nacional` : null;
        case 'eco_research_program':
            return success ? `${A} ${v('lança', 'lançam')} programa nacional de pesquisa` : null;
        case 'eco_energy_deal':
            return success ? `${A} e ${B} fecham acordo energético` : null;
        case 'int_propaganda':
            return `Governo ${t.de(a)} intensifica campanha de propaganda`;
        case 'int_political_reforms':
            return success ? `Governo ${t.de(a)} aprova reformas políticas` : `Reformas políticas fracassam ${t.em(a)}`;
        case 'int_crackdown':
            return `Governo ${t.de(a)} reprime protestos e opositores`;
        case 'int_early_elections':
            return success ? `Governo ${t.de(a)} vence as eleições antecipadas` : `Governo ${t.de(a)} é derrotado nas eleições antecipadas`;
        case 'intel_espionage':
            return success ? null : `Rede de espionagem ${t.de(a)} é desmantelada ${t.em(b)}`;
        case 'intel_cyberattack':
            return success ? `Ataque cibernético paralisa sistemas ${t.de(b)}` : `${B} ${vb('acusa', 'acusam')} ${t.the(a)} de tentar um ataque cibernético`;
        case 'intel_destabilize':
            return success ? `Onda de protestos abala ${t.the(b)}` : `${B} ${vb('denuncia', 'denunciam')} complô ${t.de(a)}`;
        default:
            return null;
    }
}

/** Headline priority for AI moves. */
function headlinePriority(state, def, actorId, targetId) {
    const pid = state.player.nationId;
    if (actorId === pid || targetId === pid) return 7;
    if (def.category === 'military' && def.id.startsWith('mil_nuclear')) return 9;
    if (['dip_propose_alliance', 'dip_defense_pact', 'dip_guarantee', 'dip_ultimatum', 'mil_limited_strike', 'intel_destabilize'].includes(def.id)) return 6;
    if (['dip_sanctions', 'mil_total_mobilization', 'mil_expeditionary', 'intel_cyberattack', 'mil_border_exercises'].includes(def.id)) return 5;
    return 3;
}

/* ---------------------------------------------------------------- execution */

/**
 * Executes an action on a MUTABLE state. Returns the ActionResult (ok=false leaves
 * the state untouched).
 * @param {Object} state working copy
 * @param {string} actorId
 * @param {string} actionId
 * @param {?string} targetId
 * @param {{source?: string, rngFor: Function, tc: Object}} opts
 * @returns {import('../contract/events.js').ActionResult}
 */
export function executeInPlace(state, actorId, actionId, targetId, opts) {
    const { rngFor, tc } = opts;
    const source = opts.source || 'ui';
    const t = textFor(state);
    const def = getActionDef(actionId);
    if (!def) {
        return { ok: false, success: false, actionId: String(actionId), targetId: targetId || null, summary: 'Ação desconhecida.', details: [], reasons: ['Ação desconhecida'] };
    }
    const tid = def.target === 'nation' ? resolveNationRef(targetId, state, {}) || targetId || null : null;
    const av = evaluateAction(state, def, actorId, tid);
    if (!av.available) {
        return {
            ok: false,
            success: false,
            actionId,
            targetId: tid,
            summary: `${def.name}: indisponível (${av.reasons[0]}).`,
            details: [],
            reasons: av.reasons,
        };
    }
    const actor = state.nations[actorId];
    const pid = state.player.nationId;
    const details = [];

    // costs + cooldown
    if (def.cost.pc) {
        actor.pc = Math.max(0, (actor.pc || 0) - def.cost.pc);
        details.push(`Capital Político −${def.cost.pc}`);
    }
    for (const [k, amt] of Object.entries(def.cost.resources || {})) {
        if (!RESOURCE_KEYS.includes(k)) continue;
        addResource(actor, k, -amt);
        details.push(`${RESOURCE_LABELS[k]} −${amt}`);
    }
    if (def.cooldown > 0) {
        if (!state.cooldowns[actorId]) state.cooldowns[actorId] = {};
        state.cooldowns[actorId][actionId] = state.turn + def.cooldown;
    }

    const seq = nextSeq(state);
    const rng = rngFor(state, `act:${actorId}:${actionId}:${tid || '-'}:${seq}`);
    const ctx = { actorId, targetId: tid, source: actionId };
    const label = tid ? `${def.name} — ${t.n(tid)}` : def.name;
    let success;
    let summary;

    if (def.acceptance && tid === pid && actorId !== pid) {
        // AI proposal to the player: the player decides through an engine event.
        const concrete = def.onSuccess.map((e) => {
            const c = { ...e };
            for (const f of ['target', 'targetB']) if (c[f] === 'SELF') c[f] = actorId;
            for (const f of ['target', 'targetB']) if (c[f] === 'TARGET') c[f] = 'PLAYER';
            return c;
        });
        if (PROPOSALS_TO_PLAYER.has(def.id)) addEvent(tc, buildProposalEvent(state, actorId, def.id, concrete));
        success = true;
        summary = `${label}: proposta enviada.`;
    } else {
        const chance = av.chance;
        success = def.chance === null && !def.acceptance ? true : rng.next() * 100 < chance;
        const effects = success ? def.onSuccess : def.onFailure || [];
        details.push(...applyEffectsInPlace(state, effects, ctx, tc));
        details.push(...runSpecial(state, def, actorId, tid, success, rng, tc));
        const word = def.acceptance ? (success ? 'proposta aceita' : 'proposta recusada') : success ? 'sucesso' : 'fracasso';
        summary = def.chance === null && !def.acceptance ? `${label}: executada.` : `${label}: ${word} (chance ${chance}%).`;
    }

    const result = { ok: true, success, actionId, targetId: tid, summary, details };
    if (actorId === pid) {
        pushRecentAction(state, { turn: state.turn, actorId, actionId, targetId: tid, success, source, summary });
        pushLog(state, 'action', summary, { actionId, targetId: tid, success });
        const h = actionHeadline(state, actionId, actorId, tid, success) || (actionId === 'dip_improve_relations' && success ? `${t.n(actorId)} e ${t.n(tid)} intensificam o diálogo diplomático` : null);
        if (h) addHeadline(tc, h, 7, 'player', [actorId, tid]);
    } else {
        pushLog(state, 'ai', summary, { actorId, actionId, targetId: tid, success });
        const involvesMajor = isMajor(state, actorId) || (tid && isMajor(state, tid)) || tid === pid;
        const h = involvesMajor ? actionHeadline(state, actionId, actorId, tid, success) : null;
        if (h) addHeadline(tc, h, headlinePriority(state, def, actorId, tid), tid === pid ? 'player' : def.category === 'diplomacy' ? 'diplomacy' : def.category === 'economy' ? 'economy' : 'world', [actorId, tid]);
    }
    return result;
}

export { getActionDef };
