/**
 * @file src/engine/ai.js
 * endTurn step 4: AI nations pick catalog actions by personality-driven utility.
 * Every active major acts once per turn; minors act with MINOR_ACT_CHANCE. The AI
 * uses the same catalog, costs, cooldowns and dice as the player and is never
 * suicidal: no wars on nuclear powers it cannot match, on nations shielded by a
 * stronger nuclear protector, or while tension is near the brink.
 */

import { CRISIS_SEVERITIES } from '../contract/constants.js';
import { clamp, getRelation } from '../contract/worldState.js';
import { evaluateAction, executeInPlace, hasCounterintel, isMobilized } from './actions.js';
import { CATALOG, tensionDeltaOf } from './catalog.js';
import { unrestCrisisOf } from './crises.js';
import { sharedEnemy } from './diplomacy.js';
import { attackAssessment } from './war.js';
import {
    activeIds,
    alliesOf,
    enemiesOf,
    hostileBlocs,
    isActive,
    isAllied,
    isAtWar,
    isNeighbor,
    nationPower,
    sharedCrisisLevel,
    sideScore,
    warsOf,
} from './util.js';

/** Chance that a minor nation acts in a given month. */
export const MINOR_ACT_CHANCE = 0.15;
/** Minimum utility for the AI to act at all (otherwise it saves PC). */
export const AI_MIN_UTILITY = 1.0;
/** The AI never takes an action that would push tension to this level or above. */
export const AI_TENSION_CEILING = 95;
/** AI proposals to the player stop while this many decisions are already waiting... */
export const MAX_PENDING_FOR_PROPOSALS = 3;
/** ...and come at most once every PROPOSAL_INTERVAL months. */
export const PROPOSAL_INTERVAL = 3;

const TARGETED = CATALOG.filter((d) => d.target === 'nation' && !d.playerOnly);
const UNTARGETED = CATALOG.filter((d) => d.target !== 'nation' && !d.playerOnly);
const TENSION_DELTA = new Map(CATALOG.map((d) => [d.id, tensionDeltaOf(d)]));
const NEG = -Infinity;
const AUTHORITARIAN = /autorit|partido [úu]nico|teocr|absolut|junta|ditadura|socialista|militar/i;

function actorContext(state, id, g) {
    const n = state.nations[id];
    const wars = warsOf(state, id);
    let exh = 0;
    let losing = false;
    let enemyNuclear = false;
    for (const w of wars) {
        exh = Math.max(exh, (w.exhaustion && w.exhaustion[id]) || 0);
        if (sideScore(w, id) <= -15) losing = true;
    }
    const enemies = new Set(enemiesOf(state, id));
    for (const e of enemies) if ((state.nations[e].nuclear || 0) > 0) enemyNuclear = true;
    const power = g.powerOf(id);
    let threat = 0;
    let rivals = 0;
    const seen = new Set();
    for (const o of [...(state.neighbors[id] || []), ...g.majors]) {
        if (o === id || seen.has(o) || !isActive(state.nations[o])) continue;
        seen.add(o);
        if (getRelation(state, id, o) > -40) continue;
        rivals++;
        threat = Math.max(threat, clamp((g.powerOf(o) - power) / 50 + 0.3, 0, 1));
    }
    return {
        id,
        n,
        p: n.personality || { aggression: 0.3, diplomacy: 0.5, blocLoyalty: 0.5 },
        r: n.resources,
        major: !!n.major,
        nuclear: n.nuclear || 0,
        atWar: wars.length > 0,
        activeWar: wars.some((w) => !w.ceasefire),
        enemies,
        enemyNuclear,
        exh,
        losing,
        threat,
        rivals,
        power,
        mobilized: isMobilized(state, id),
        authoritarian: AUTHORITARIAN.test(n.government || ''),
        counterintel: hasCounterintel(state, id),
        unrest: !!unrestCrisisOf(state, id),
        trade: state.pacts.filter((p) => p.type === 'trade' && p.members.includes(id)).length,
    };
}

function targetContext(state, c, tid, g) {
    const n = state.nations[tid];
    let losing = false;
    let atWar = false;
    for (const w of state.wars) {
        if (!w.attackers.includes(tid) && !w.defenders.includes(tid)) continue;
        atWar = true;
        if (sideScore(w, tid) <= -15) losing = true;
    }
    return {
        id: tid,
        n,
        r: n.resources,
        rel: getRelation(state, c.id, tid),
        isEnemy: c.enemies.has(tid),
        allied: isAllied(state, c.id, tid),
        neighbor: isNeighbor(state, c.id, tid),
        major: !!n.major,
        nuclear: n.nuclear || 0,
        power: g.powerOf(tid),
        atWar,
        losing,
        crisis: sharedCrisisLevel(state, c.id, tid, CRISIS_SEVERITIES),
        threatened: state.crises.some((cr) => cr.involved.includes(tid) && CRISIS_SEVERITIES.indexOf(cr.severity) >= 1),
        hostileBloc: hostileBlocs(c.n.bloc, n.bloc),
    };
}

function targetCandidates(state, c, g) {
    const set = new Set(c.enemies);
    for (const nb of state.neighbors[c.id] || []) set.add(nb);
    const ranked = g.majors
        .filter((m) => m !== c.id)
        .map((m) => ({ m, r: getRelation(state, c.id, m) }))
        .sort((a, b) => Math.abs(b.r) - Math.abs(a.r) || (a.m < b.m ? -1 : 1));
    if (c.major) for (const x of ranked.slice(0, 6)) set.add(x.m);
    else for (const x of ranked.filter((x) => Math.abs(x.r) >= 40).slice(0, 3)) set.add(x.m);
    for (const al of alliesOf(state, c.id)) if (isAtWar(state, al)) set.add(al);
    for (const w of state.wars) {
        for (const x of [...w.attackers, ...w.defenders]) if (!c.enemies.has(x) && getRelation(state, c.id, x) >= 30) set.add(x);
    }
    // majors always weigh the player; minors only when it matters to them
    if (g.pid !== c.id && (c.major || Math.abs(getRelation(state, c.id, g.pid)) >= 40)) set.add(g.pid);
    set.delete(c.id);
    return [...set].filter((x) => state.nations[x] && isActive(state.nations[x])).slice(0, 14);
}

/** War utility with the "never suicidal" gates. */
function warUtility(state, c, t, g) {
    if (c.atWar || t.isEnemy || t.allied) return NEG;
    if (c.p.aggression < 0.5 || t.rel > -40) return NEG;
    if (t.nuclear === 2 || (t.nuclear > 0 && !c.nuclear)) return NEG;
    if (g.tension >= 80 || c.r.stability < 30 || c.r.economy < 25) return NEG;
    const ratio = attackAssessment(state, c.id, t.id, g.powerOf);
    if (ratio === null || ratio < 1.35) return NEG;
    return (
        c.p.aggression * 5 +
        Math.min(1.5, (ratio - 1.35) * 1.5) +
        [0, 0.5, 1, 2][t.crisis] +
        (t.rel < -70 ? 1 : 0) -
        c.p.diplomacy * 2.5 -
        Math.max(0, g.tension - 50) / 10 -
        3.5
    );
}

/** Base utilities (before chance, cost, tension caution and noise). */
const U = {
    dip_improve_relations: (c, t) =>
        t.rel >= 70 || t.isEnemy
            ? NEG
            : 0.6 +
              c.p.diplomacy * 2.5 +
              (t.rel < 0 ? 0.8 : 0) +
              (t.major ? 0.5 : 0) +
              (t.crisis >= 0 ? 1 : 0) -
              Math.max(0, t.rel - 30) / 20 -
              (t.rel < -40 ? c.p.aggression * 2.5 : 0) -
              (t.hostileBloc ? 1 : 0),
    dip_send_aid: (c, t) =>
        c.r.economy < 40 ? NEG : c.p.diplomacy * 2 + (t.r.stability < 35 ? 1.5 : 0) + (t.atWar && t.rel > 30 ? 2 : 0) + (t.rel > 20 ? 0.3 : -1.5) - 1.2,
    dip_trade_agreement: (c, t) => 1.2 + c.p.diplomacy * 2.5 + (c.r.economy < 55 ? 1 : 0) + t.rel / 40 - (t.hostileBloc ? 1.5 : 0) - c.trade * 0.5,
    dip_propose_alliance: (c, t, s) =>
        !c.major && !t.major
            ? NEG
            : -1.5 + c.p.blocLoyalty * 2 + c.p.diplomacy * 1.5 + c.threat * 4 + (sharedEnemy(s, c.id, t.id) ? 2.5 : 0) + (t.rel - 35) / 30,
    dip_defense_pact: (c, t) => -1 + c.p.diplomacy * 1.5 + c.threat * 4 + (t.rel - 20) / 30 + (t.power > c.power ? 1 : 0),
    dip_guarantee: (c, t) => (!c.major || t.major ? NEG : -1 + c.p.diplomacy * 1.5 + c.p.blocLoyalty + t.rel / 40 + (t.threatened ? 2 : 0)),
    dip_sanctions: (c, t) =>
        c.p.aggression * 2.5 + (t.rel < -30 ? 1.5 : -1) + (t.hostileBloc ? 0.8 : 0) + (t.isEnemy ? 1 : 0) - c.p.diplomacy - (c.r.economy < 30 ? 1 : 0) - 0.5,
    dip_expel_diplomats: (c, t) => (t.rel < -75 ? NEG : c.p.aggression * 1.5 + (t.rel < -40 ? 1 : -1.5) - c.p.diplomacy - 0.3),
    dip_ultimatum: (c, t) =>
        !c.major
            ? NEG
            : c.p.aggression * 3.5 +
              (t.rel < -20 ? 1 : 0) +
              Math.min(2, (c.power / Math.max(1, t.power) - 1.5) * 2) +
              (t.crisis >= 1 ? 1.5 : 0) -
              c.p.diplomacy * 1.5 -
              1.5 -
              (t.nuclear === 2 ? 3 : 0),
    dip_declare_war: (c, t, s, g) => warUtility(s, c, t, g),
    dip_propose_ceasefire: (c, t) => (!t.isEnemy ? NEG : c.exh / 25 + (c.losing ? 2 : 0) + c.p.diplomacy * 1.5 - c.p.aggression * 1.5 - 1),
    dip_propose_peace: (c, t) => (!t.isEnemy ? NEG : c.exh / 20 + (c.losing ? 2.5 : 0) + c.p.diplomacy * 2 - c.p.aggression * 2 - 1.5),
    mil_border_exercises: (c, t) =>
        c.p.aggression * 2.5 + (t.rel < -30 ? 1 : -1.5) + (t.neighbor ? 0.5 : 0) + c.threat - c.p.diplomacy * 1.5 - 0.5,
    mil_expeditionary: (c, t) =>
        !t.atWar || t.rel < 30 || c.r.military < 40 ? NEG : c.p.blocLoyalty * 3 + (t.losing ? 1.5 : 0) + t.rel / 50 + (t.allied ? 1 : 0) - 1,
    mil_limited_strike: (c, t) => {
        if (t.nuclear === 2 && !t.isEnemy) return NEG;
        if (t.isEnemy) return 2 + c.p.aggression * 2;
        return c.p.aggression * 3 + (t.rel < -60 ? 1 : 0) - c.p.diplomacy * 2 - 2.5 - (t.nuclear ? 2 : 0);
    },
    eco_energy_deal: (c, t) => 0.2 + c.p.diplomacy * 1.2 + (c.r.economy < 50 ? 1 : 0) + t.rel / 80 - (t.hostileBloc ? 1 : 0),
    intel_espionage: (c, t) => 1 + (t.r.tech > c.r.tech + 5 ? 1 : -0.5) + (t.rel < 0 ? 0.8 : -1) + c.p.aggression * 0.5,
    intel_cyberattack: (c, t) => c.p.aggression * 2.5 + (t.rel < -40 ? 1 : -2) + (t.isEnemy ? 1.5 : 0) - c.p.diplomacy - 1,
    intel_destabilize: (c, t) =>
        c.p.aggression * 2.5 + (t.rel < -50 ? 1 : -2) + (t.r.stability < 40 ? 1 : 0) + (t.isEnemy ? 1 : 0) - c.p.diplomacy - 1.5,

    mil_partial_mobilization: (c, _t, _s, g) =>
        c.mobilized ? NEG : (c.activeWar ? 3 : 0) + c.threat * 2.5 + (g.tension > 60 ? 0.8 : 0) + c.p.aggression - (c.r.economy < 30 ? 2 : 0) - 1.2,
    mil_total_mobilization: (c) => (!c.activeWar ? NEG : 1.5 + (c.losing ? 2.5 : 0) + c.p.aggression - (c.r.economy < 35 ? 2 : 0)),
    mil_demobilize: (c) => (c.mobilized && !c.atWar ? 1 + (c.r.economy < 45 ? 1.5 : 0) + c.p.diplomacy : NEG),
    mil_modernization: (c) => 0.8 + c.threat * 2.5 + (c.r.military < 50 ? 0.8 : 0) + (c.activeWar ? 1 : 0) + c.p.aggression * 0.5 - (c.r.economy < 35 ? 2 : 0),
    mil_nuclear_alert: (c) => (c.activeWar && c.enemyNuclear ? 1.5 : 0) + c.threat * 1.5 + c.p.aggression * 1.5 - 2.5,
    mil_nuclear_test: (c) => c.p.aggression * 2 + (c.nuclear === 1 ? 0.5 : -0.5) - c.p.diplomacy * 1.5 - 1.8,
    eco_stimulus: (c) => 1.2 + (c.r.economy < 45 ? 1.8 : 0) + (c.r.stability < 40 ? 0.5 : 0),
    eco_austerity: (c) => (c.r.economy < 30 && c.r.stability > 45 ? 2.5 : 0.2),
    eco_industrial_investment: (c) => 1.4 + (c.r.economy >= 40 ? 0.4 : -1) + c.threat * 0.8 + (c.activeWar ? 0.5 : 0),
    eco_research_program: (c) => 1.3 + (c.r.tech < 50 ? 0.8 : 0) + c.p.diplomacy * 0.4,
    int_propaganda: (c) => 0.7 + (c.activeWar ? 1.5 : 0) + (c.r.warSupport < 35 ? 1.2 : 0) + (c.r.stability < 40 ? 1 : 0),
    int_political_reforms: (c) => 0.4 + (c.r.stability < 50 ? 2 : 0) + c.p.diplomacy,
    int_crackdown: (c) => (c.r.stability < 30 ? 2.5 : -1) + c.p.aggression + (c.authoritarian ? 1 : -1) + (c.unrest ? 2 : 0),
    int_early_elections: (c) => (c.authoritarian ? NEG : (c.r.stability > 65 ? 1 : -1) + ((c.n.pc || 0) < 6 ? 0.5 : 0) - 0.5),
    intel_counterintel: (c) => (c.counterintel ? NEG : 0.6 + c.threat * 1.5 + (c.rivals >= 2 ? 0.8 : 0)),
};

/** Picks the best action for one AI nation, or null to pass. */
export function chooseAiAction(state, id, g, rng) {
    const c = actorContext(state, id, g);
    let best = null;
    let bestU = AI_MIN_UTILITY;
    const consider = (def, tid, t) => {
        const fn = U[def.id];
        if (!fn) return;
        let u = fn(c, t, state, g);
        if (!(u > 0) || u + 1.2 < bestU) return;
        const td = TENSION_DELTA.get(def.id) || 0;
        if (td > 0 && g.tension + td >= AI_TENSION_CEILING) return;
        const av = evaluateAction(state, def, id, tid, { fast: true });
        if (!av.available) return;
        if (def.acceptance) u *= 0.2 + (0.8 * av.chance) / 100;
        else if (def.chance) u *= 0.4 + (0.6 * av.chance) / 100;
        u -= (def.cost.pc || 0) * 0.12;
        if (td > 0) u -= (td * Math.max(0, g.tension - 35)) / 15;
        u += rng.float(0, 1.2);
        if (u > bestU) {
            bestU = u;
            best = { def, target: tid };
        }
    };
    for (const def of UNTARGETED) consider(def, null, null);
    for (const tid of targetCandidates(state, c, g)) {
        const t = targetContext(state, c, tid, g);
        for (const def of TARGETED) {
            if (tid === g.pid && def.acceptance && (g.playerProposalsLeft <= 0 || g.proposedToPlayer.has(id))) continue;
            consider(def, tid, t);
        }
    }
    return best;
}

/**
 * Runs the AI phase on a MUTABLE state.
 * @param {Object} state working copy
 * @param {Function} rngFor rng factory
 * @param {ReturnType<import('./collector.js').createCollector>} tc
 */
export function runAi(state, rngFor, tc) {
    const rng = rngFor(state, 'ai');
    const pid = state.player.nationId;
    const powerCache = new Map();
    const powerOf = (x) => {
        let v = powerCache.get(x);
        if (v === undefined) {
            v = nationPower(state.nations[x]);
            powerCache.set(x, v);
        }
        return v;
    };
    const ids = activeIds(state);
    const proposedToPlayer = new Set();
    for (const ev of [state.pendingEvent, ...(state.eventQueue || [])]) {
        const m = ev && typeof ev.id === 'string' ? /^eng-prop-[a-z_]+-([A-Z0-9]+)-/.exec(ev.id) : null;
        if (m) proposedToPlayer.add(m[1]);
    }
    // at most one new AI proposal to the player per month, none while decisions pile up
    const pending = (state.eventQueue || []).length + (state.pendingEvent ? 1 : 0);
    const g = {
        tension: state.globalTension,
        powerOf,
        majors: ids.filter((x) => state.nations[x].major),
        pid,
        proposedToPlayer,
        playerProposalsLeft: pending >= MAX_PENDING_FOR_PROPOSALS || state.turn - (state.engine.lastProposalTurn ?? -99) < PROPOSAL_INTERVAL ? 0 : 1,
    };
    for (const id of rng.shuffle(ids.filter((x) => x !== pid))) {
        const n = state.nations[id];
        if (!isActive(n)) continue;
        if (!n.major && !rng.chance(MINOR_ACT_CHANCE)) continue;
        g.tension = state.globalTension;
        const choice = chooseAiAction(state, id, g, rng);
        if (!choice) continue;
        const res = executeInPlace(state, id, choice.def.id, choice.target, { source: 'ai', rngFor, tc });
        if (!res.ok) continue;
        if (choice.target === pid && choice.def.acceptance) {
            proposedToPlayer.add(id);
            g.playerProposalsLeft--;
            state.engine.lastProposalTurn = state.turn;
        }
        tc.aiActions.push({ actorId: id, actionId: res.actionId, targetId: res.targetId, success: res.success, summary: res.summary });
    }
}
