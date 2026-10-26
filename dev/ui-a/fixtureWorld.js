/**
 * @file dev/ui-a/fixtureWorld.js
 * DEV ONLY (preview harness). Builds a believable WorldState from the real
 * ScenarioData and fakes the engine-backed UiQuery calls (availability,
 * nation views, ranking, a crude monthly tick) so the War Room can be
 * exercised before/without the real engine. Never shipped or imported by src/.
 */

import { RESOURCE_KEYS } from '../../src/contract/constants.js';
import { getRelation, relationKey, addMonths } from '../../src/contract/worldState.js';
import { formatDate, relationTier } from '../../src/contract/presentation.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
    let a = 0;
    for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0);
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * @param {Object} scn ScenarioData
 * @param {{bookmarkId?:string, nationId?:string, leaderName?:string, demo?:boolean}} opts
 */
export function buildFixtureState(scn, opts = {}) {
    const bm = scn.bookmarks.find((b) => b.id === (opts.bookmarkId || 'b2031')) || scn.bookmarks[0];
    const ov = bm.overrides || {};
    const nations = clone(scn.nations);
    for (const [id, patch] of Object.entries(ov.nations || {})) {
        if (!nations[id]) continue;
        const { resources, ...rest } = patch;
        Object.assign(nations[id], rest);
        if (resources) Object.assign(nations[id].resources, resources);
    }
    for (const n of Object.values(nations)) {
        n.status = n.status || 'active';
        n.controller = n.controller || n.id;
        n.overlord = n.overlord || null;
        n.pc = typeof n.pc === 'number' ? n.pc : 4 + Math.round((n.resources.influence || 30) / 12);
        for (const k of RESOURCE_KEYS) if (typeof n.resources[k] !== 'number') n.resources[k] = 30;
    }
    let pacts = clone(ov.pacts || scn.pacts || []);
    if (Array.isArray(ov.pactsRemove)) pacts = pacts.filter((p) => !ov.pactsRemove.includes(p.id));
    if (Array.isArray(ov.pactsAdd)) pacts.push(...clone(ov.pactsAdd));
    const wars = clone(ov.wars || scn.wars || []);
    const crises = clone(ov.crises || scn.crises || []);
    const relations = { ...scn.relations, ...(ov.relations || {}) };

    const nationId = nations[opts.nationId] ? opts.nationId : 'BRA';
    const player = nations[nationId];
    player.pc = 14;

    if (opts.demo !== false) {
        // Showcase states the base data does not have yet: a puppet and an annexation.
        if (nations.BLR && nations.RUS) {
            nations.BLR.status = 'puppet';
            nations.BLR.overlord = 'RUS';
        }
        if (nations.MDA && nations.RUS) {
            nations.MDA.status = 'annexed';
            nations.MDA.controller = 'RUS';
        }
    }

    const turn = 3;
    const date = addMonths(bm.date, turn - 1);
    const state = {
        schemaVersion: 2,
        campaignId: `preview-${bm.id}-${nationId}`,
        seed: 'preview',
        scenarioId: scn.id,
        bookmarkId: bm.id,
        turn,
        date,
        endDate: bm.endDate,
        phase: 'PLAYER_TURN',
        player: { nationId, leaderName: opts.leaderName || 'Helena Duarte', title: player.leaderTitle || 'Presidente' },
        nations,
        relations,
        pacts,
        wars,
        crises,
        modifiers: [
            { id: 'mod-1', nationId, label: 'Programa de Reindustrialização', perTurn: { economy: 1, tech: 1 }, turnsLeft: 5, source: 'eco_industrial_investment' },
            { id: 'mod-2', nationId, label: 'Mobilização parcial', perTurn: { military: 2, economy: -1 }, turnsLeft: 3, source: 'mil_partial_mobilization' },
        ],
        cooldowns: { [nationId]: { eco_stimulus: turn + 2 } },
        globalTension: bm.tension,
        pendingEvent: sampleEvent(nationId, nations, turn),
        eventQueue: [],
        recentActions: [],
        decisions: [],
        news: sampleNews(bm, nations, nationId, date, turn),
        log: [],
        outcome: null,
        flags: {},
    };
    return state;
}

function sampleEvent(pid, nations, turn) {
    return {
        id: `ev-preview-${turn}`,
        source: 'llm',
        category: 'diplomacy',
        title: 'Washington pede bases no Atlântico Sul',
        narrative: 'O Departamento de Estado envia uma nota reservada: em troca de crédito e tecnologia, os EUA querem acesso temporário a portos e pistas no Nordeste. Pequim já avisou que verá qualquer acordo como alinhamento militar.',
        headlines: ['Itamaraty confirma reunião de emergência com enviados americanos'],
        involved: [pid, 'USA', 'CHN'],
        options: [
            { label: 'Aceitar o acordo com garantias', rationale: 'Aproxima de Washington, irrita Pequim.', effects: [{ type: 'relation', target: pid, targetB: 'USA', delta: 15 }, { type: 'relation', target: pid, targetB: 'CHN', delta: -12 }] },
            { label: 'Recusar e reafirmar a neutralidade', rationale: 'Mantém a autonomia, mas custa influência.', effects: [{ type: 'resource', target: pid, resource: 'influence', delta: -3 }] },
            { label: 'Levar a proposta ao BRICS', rationale: 'Ganha tempo e prestígio regional.', effects: [{ type: 'pc', target: pid, delta: -2 }, { type: 'resource', target: pid, resource: 'influence', delta: 2 }] },
        ],
        turn,
    };
}

function sampleNews(bm, nations, pid, date, turn) {
    const name = (id) => (nations[id] ? nations[id].name : id);
    const lines = [
        ['war', `Tropas russas avançam sobre Tallinn; ${name('EST')} pede socorro imediato à OTAN`],
        ['crisis', 'Bloqueio chinês ao redor de Taiwan entra na terceira semana; preço dos chips dispara'],
        ['diplomacy', `${name('IND')} e ${name('BRA')} propõem cúpula de não alinhados em Nova Délhi`],
        ['economy', 'Petróleo Brent supera US$ 160 após ataques a petroleiros no Golfo'],
        ['player', `Governo de ${name(pid)} anuncia programa de reindustrialização de emergência`],
        ['war', 'Coreia do Norte bombardeia posições ao sul da Zona Desmilitarizada'],
        ['world', 'ONU convoca sessão extraordinária da Assembleia Geral sobre o risco nuclear'],
        ['crisis', 'Fome se alastra pelo Sahel; agências humanitárias pedem corredores seguros'],
        ['diplomacy', `${name('TUR')} fecha o Bósforo a navios de guerra de todas as bandeiras`],
        ['economy', 'Bolsas asiáticas despencam com a interrupção das rotas do Estreito de Malaca'],
        ['war', `${name('FIN')} mobiliza a reserva e reforça a fronteira oriental`],
        ['player', `${name(pid)} declara neutralidade e reforça patrulhas no Atlântico Sul`],
    ];
    return lines.map(([kind, text], i) => ({ turn: Math.max(1, turn - Math.floor((lines.length - i) / 4)), date: addMonths(date, -Math.floor((lines.length - i) / 4)), text, kind, nations: [] }));
}

/* --------------------------------------------------------------- queries */

export function nationPower(n) {
    const r = n.resources || {};
    return Math.round((r.economy * 0.25 + r.military * 0.3 + r.tech * 0.15 + r.influence * 0.15 + r.manpower * 0.1 + r.stability * 0.05) + (n.nuclear || 0) * 4);
}

function enemiesOf(state, id) {
    const out = new Set();
    for (const w of state.wars) {
        if (w.attackers.includes(id)) w.defenders.forEach((d) => out.add(d));
        if (w.defenders.includes(id)) w.attackers.forEach((a) => out.add(a));
    }
    return out;
}

function alliesOf(state, id) {
    const out = new Set();
    for (const p of state.pacts) {
        if ((p.type === 'alliance' || p.type === 'defense') && p.members.includes(id)) p.members.forEach((m) => m !== id && out.add(m));
    }
    return out;
}

export function nationView(state, id) {
    const n = state.nations[id];
    const pid = state.player.nationId;
    const enemies = enemiesOf(state, id);
    const atWarWithPlayer = enemies.has(pid);
    const score = getRelation(state, pid, id);
    let occupation = 0;
    let occupier = null;
    for (const w of state.wars) for (const f of w.fronts) if (f.defender === id && f.progress > occupation) {
        occupation = f.progress;
        occupier = f.attacker;
    }
    return {
        nation: n,
        power: nationPower(n),
        relationToPlayer: score,
        relationTier: relationTier(score, atWarWithPlayer).id,
        atWarWith: [...enemies],
        allies: [...alliesOf(state, id)],
        pacts: state.pacts.filter((p) => p.members.includes(id)),
        controller: n.controller || id,
        occupation,
        occupier,
        crises: state.crises.filter((c) => c.involved.includes(id)),
    };
}

export function ranking(state) {
    return Object.values(state.nations)
        .filter((n) => n.status !== 'annexed')
        .map((n) => ({ id: n.id, name: n.name, power: nationPower(n) }))
        .sort((a, b) => b.power - a.power);
}

/** Simplified availability (mirrors the Requirement typedef closely enough for the preview). */
export function availability(state, catalog, targetId) {
    const pid = state.player.nationId;
    const me = state.nations[pid];
    const enemies = enemiesOf(state, pid);
    const allies = alliesOf(state, pid);
    const target = targetId ? state.nations[targetId] : null;
    return catalog.map((def) => {
        const reasons = [];
        if (def.target === 'nation') {
            if (!target) reasons.push('Selecione um alvo');
            else if (targetId === pid) reasons.push('Não pode ter a própria nação como alvo');
        }
        if ((def.cost.pc || 0) > me.pc) reasons.push(`Capital Político insuficiente (${me.pc}/${def.cost.pc})`);
        for (const [k, v] of Object.entries(def.cost.resources || {})) if (me.resources[k] < v) reasons.push(`Recurso insuficiente: ${k}`);
        const req = def.requires || {};
        const rel = target ? getRelation(state, pid, targetId) : 0;
        if (target) {
            if (req.atWarWithTarget && !enemies.has(targetId)) reasons.push('Exige estar em guerra com o alvo');
            if (req.notAtWarWithTarget && enemies.has(targetId)) reasons.push('Impossível durante a guerra com o alvo');
            if (req.minRelation != null && rel < req.minRelation) reasons.push(`Relação mínima ${req.minRelation} (atual ${rel})`);
            if (req.maxRelation != null && rel > req.maxRelation) reasons.push(`Relação deve ser no máximo ${req.maxRelation} (atual ${rel})`);
            if (req.alliedWithTarget && !allies.has(targetId)) reasons.push('Exige aliança com o alvo');
            if (req.notAlliedWithTarget && allies.has(targetId)) reasons.push('Já são aliados');
        }
        if (req.atWar && enemies.size === 0) reasons.push('Exige estar em guerra');
        if (req.nuclear && !(me.nuclear > 0)) reasons.push('Exige arsenal nuclear');
        if (req.notNuclear && me.nuclear > 0) reasons.push('Já possui arsenal nuclear');
        if (req.maxTension != null && state.globalTension > req.maxTension) reasons.push(`Tensão global acima de ${req.maxTension}`);
        if (req.minTension != null && state.globalTension < req.minTension) reasons.push(`Tensão global abaixo de ${req.minTension}`);
        for (const [k, v] of Object.entries(req.minResources || {})) if (me.resources[k] < v) reasons.push(`Exige ${k} ≥ ${v}`);
        const cdUntil = (state.cooldowns[pid] || {})[def.id] || 0;
        const cooldownLeft = Math.max(0, cdUntil - state.turn);
        if (cooldownLeft > 0) reasons.push(`Em recarga por mais ${cooldownLeft} ${cooldownLeft === 1 ? 'mês' : 'meses'}`);
        let chance = 100;
        if (def.chance) {
            let c = def.chance.base || 50;
            for (const [k, w] of Object.entries(def.chance.stats || {})) c += (me.resources[k] || 0) * w;
            if (def.chance.relationWeight) c += def.chance.relationWeight * rel;
            for (const [k, w] of Object.entries(def.chance.targetStats || {})) c += ((target && target.resources[k]) || 0) * w;
            chance = Math.round(clamp(c, 5, 95));
        }
        return { def, available: reasons.length === 0, reasons, chance, cooldownLeft };
    });
}

/* ------------------------------------------------------------------ tick */

/** Crude monthly tick for the preview: moves fronts, nudges resources, writes news. */
export function simulateTurn(state) {
    const s = clone(state);
    const r = rng(`${s.seed}:${s.turn}`);
    const pid = s.player.nationId;
    const me = s.nations[pid];
    const before = { ...me.resources };
    const tensionBefore = s.globalTension;
    s.turn += 1;
    s.date = addMonths(s.date, 1);
    const warUpdates = [];
    for (const w of s.wars) {
        if (w.ceasefire) continue;
        for (const f of w.fronts) {
            const d = Math.round((r() - 0.35) * 9);
            f.progress = clamp(f.progress + d, 0, 100);
        }
        const top = w.fronts.slice().sort((a, b) => b.progress - a.progress)[0];
        if (top) warUpdates.push({ warId: w.id, summary: `${w.name}: ${s.nations[top.attacker].name} controla ${top.progress}% de ${s.nations[top.defender].name}` });
    }
    const playerDeltas = {};
    for (const k of RESOURCE_KEYS) {
        const d = Math.round((r() - 0.5) * 5);
        me.resources[k] = clamp(me.resources[k] + d, 0, 100);
        if (d) playerDeltas[k] = d;
    }
    for (const m of s.modifiers) m.turnsLeft = Math.max(0, m.turnsLeft - 1);
    s.modifiers = s.modifiers.filter((m) => m.turnsLeft > 0);
    const pcGained = 3;
    me.pc = clamp(me.pc + pcGained, 0, 30);
    s.globalTension = clamp(s.globalTension + Math.round((r() - 0.4) * 4), 0, 100);
    const headlines = [
        `${formatDate(s.date)}: frentes se movem no Báltico enquanto a OTAN reforça a Polônia`,
        'Conselho de Segurança da ONU volta a falhar em aprovar resolução de cessar-fogo',
        `${me.name} registra protestos contra a alta dos combustíveis`,
    ];
    for (const t of headlines) s.news.push({ turn: s.turn, date: s.date, text: t, kind: 'world', nations: [] });
    if (s.news.length > 80) s.news = s.news.slice(-80);
    const aiActions = [
        { actorId: 'USA', actionId: 'dip_improve_relations', targetId: pid, success: true, summary: `Estados Unidos enviam missão diplomática a ${me.name} (sucesso).` },
        { actorId: 'CHN', actionId: 'eco_trade_agreement', targetId: pid, success: false, summary: `China propõe acordo comercial a ${me.name} (recusado).` },
    ];
    void before;
    const report = {
        turn: s.turn,
        date: s.date,
        pcGained,
        playerDeltas,
        tensionBefore,
        tensionAfter: s.globalTension,
        aiActions,
        warUpdates,
        capitulations: [],
        newCrises: [],
        resolvedCrises: [],
        headlines,
        engineEvents: [],
        outcome: null,
    };
    return { state: s, report };
}

/** Apply a preview action: spend PC, set cooldown, news, roll success. */
export function applyAction(state, def, targetId) {
    const s = clone(state);
    const pid = s.player.nationId;
    const me = s.nations[pid];
    me.pc = Math.max(0, me.pc - (def.cost.pc || 0));
    for (const [k, v] of Object.entries(def.cost.resources || {})) me.resources[k] = Math.max(0, me.resources[k] - v);
    s.cooldowns[pid] = { ...(s.cooldowns[pid] || {}), [def.id]: s.turn + (def.cooldown || 0) };
    const success = rng(`${s.turn}:${def.id}:${targetId}`)() < 0.7;
    if (targetId && def.category === 'diplomacy') {
        const k = relationKey(pid, targetId);
        s.relations[k] = clamp((s.relations[k] || 0) + (success ? 10 : -3), -100, 100);
    }
    const tname = targetId && s.nations[targetId] ? ` (${s.nations[targetId].name})` : '';
    const summary = `${def.name}${tname}: ${success ? 'sucesso' : 'fracasso'}.`;
    s.news.push({ turn: s.turn, date: s.date, text: `${me.name}: ${summary}`, kind: 'player', nations: [pid] });
    return {
        state: s,
        result: { ok: true, success, actionId: def.id, targetId: targetId || null, summary, details: [`Capital Político −${def.cost.pc || 0}`] },
    };
}
