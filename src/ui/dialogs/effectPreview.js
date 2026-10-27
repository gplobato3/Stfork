/**
 * @file src/ui/dialogs/effectPreview.js
 * Pure pt-BR preview of an Effect for chips in event options and action
 * cards. No DOM, node-safe.
 *
 * Contract (DESIGN §6.2):
 *   describeEffect(effect, state[, ctx]) -> { text, tone: 'good'|'bad'|'neutral', icon }
 *
 * `ctx` ({ actorId, targetId }) resolves the SELF / TARGET placeholders of
 * catalog actions; PLAYER resolves to state.player.nationId. Without ctx,
 * SELF means the player (events are always addressed to the player).
 *
 * Tone is always from the PLAYER's point of view: our resources up = good,
 * an enemy's resources down = good, tension up = bad, relation with us up =
 * good, an enemy advancing on our territory = bad, etc.
 */

import {
    BLOC_LABELS,
    PC_ICON,
    PC_LABEL,
    RESOURCE_ICONS,
    RESOURCE_LABELS,
    SEVERITY_LABELS,
    signed,
} from '../../contract/presentation.js';
import { RESOURCE_KEYS } from '../../contract/constants.js';
import { getRelation } from '../../contract/worldState.js';

export const PACT_TYPE_LABELS = Object.freeze({
    alliance: 'Aliança',
    defense: 'Pacto de Defesa',
    trade: 'Acordo Comercial',
    nonAggression: 'Pacto de Não Agressão',
    guarantee: 'Garantia de Independência',
});

export const PEACE_TERM_LABELS = Object.freeze({
    whitePeace: 'Paz Branca',
    reparations: 'Reparações',
    puppet: 'Estado-Fantoche',
    annex: 'Anexação',
});

const ICONS = Object.freeze({
    relationUp: 'fa-solid fa-handshake',
    relationDown: 'fa-solid fa-handshake-slash',
    tensionUp: 'fa-solid fa-temperature-arrow-up',
    tensionDown: 'fa-solid fa-temperature-arrow-down',
    modifier: 'fa-solid fa-hourglass-half',
    crisisUp: 'fa-solid fa-fire',
    crisisDown: 'fa-solid fa-fire-extinguisher',
    pactCreate: 'fa-solid fa-file-signature',
    pactBreak: 'fa-solid fa-file-circle-xmark',
    warDeclare: 'fa-solid fa-burst',
    ceasefire: 'fa-solid fa-flag',
    peace: 'fa-solid fa-dove',
    annex: 'fa-solid fa-map-location-dot',
    front: 'fa-solid fa-person-military-rifle',
    bloc: 'fa-solid fa-flag',
    flag: 'fa-solid fa-bookmark',
    news: 'fa-solid fa-newspaper',
    unknown: 'fa-solid fa-circle-question',
});

const ALIGN = Object.freeze({ self: 2, ally: 1, friend: 1, neutral: 0, unknown: 0, rival: -1, enemy: -1 });

const toneOf = (n) => (n > 0 ? 'good' : n < 0 ? 'bad' : 'neutral');
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function playerId(state) {
    return (state && state.player && state.player.nationId) || null;
}

/**
 * Resolve a target reference (nation id or placeholder).
 * Unresolvable placeholders are kept as sentinels ('SELF' / 'TARGET' / 'PLAYER').
 * @returns {?string}
 */
export function resolveNationRef(ref, state, ctx) {
    if (ref === undefined || ref === null || ref === '') return null;
    const player = playerId(state);
    if (ref === 'PLAYER') return player || 'PLAYER';
    if (ref === 'SELF') return (ctx && ctx.actorId) || player || 'SELF';
    if (ref === 'TARGET') return (ctx && ctx.targetId) || 'TARGET';
    return String(ref);
}

function isPlayer(id, state) {
    if (!id) return false;
    const p = playerId(state);
    if (p) return id === p;
    return id === 'PLAYER' || id === 'SELF';
}

/** pt-BR display name for a resolved id. */
export function nationLabel(id, state) {
    if (!id) return '—';
    if (id === 'TARGET') return 'o alvo';
    if (id === 'SELF' || id === 'PLAYER') return 'nós';
    const n = state && state.nations ? state.nations[id] : null;
    return (n && n.name) || id;
}

function atWarWith(state, a, b) {
    const wars = (state && Array.isArray(state.wars) && state.wars) || [];
    return wars.some((w) => {
        const att = w.attackers || [];
        const def = w.defenders || [];
        return (att.includes(a) && def.includes(b)) || (att.includes(b) && def.includes(a));
    });
}

function alliedWith(state, a, b) {
    const pacts = (state && Array.isArray(state.pacts) && state.pacts) || [];
    return pacts.some((p) => (p.type === 'alliance' || p.type === 'defense') && (p.members || []).includes(a) && (p.members || []).includes(b));
}

/**
 * Stance of a nation towards the player.
 * @returns {'self'|'ally'|'friend'|'neutral'|'rival'|'enemy'|'unknown'}
 */
export function stanceOf(state, id) {
    if (!id || id === 'TARGET') return 'unknown';
    if (isPlayer(id, state)) return 'self';
    const p = playerId(state);
    if (!p || !state || !state.nations || !state.nations[id]) return 'unknown';
    if (atWarWith(state, p, id)) return 'enemy';
    if (alliedWith(state, p, id)) return 'ally';
    const r = getRelation(state, p, id);
    if (r >= 25) return 'friend';
    if (r <= -25) return 'rival';
    return 'neutral';
}

const align = (state, id) => ALIGN[stanceOf(state, id)] || 0;

function result(text, tone, iconCls) {
    return { text, tone, icon: iconCls };
}

/** "Economia +3" for the player, "China: Economia −5" for others. */
function scoped(id, state, label) {
    return isPlayer(id, state) ? label : `${cap(nationLabel(id, state))}: ${label}`;
}

function monthsText(n) {
    const v = Math.max(0, Math.round(num(n)));
    return `${v} ${v === 1 ? 'mês' : 'meses'}`;
}

function crisisTitle(state, crisisId) {
    const list = (state && Array.isArray(state.crises) && state.crises) || [];
    const c = list.find((x) => x && x.id === crisisId);
    return c && c.title ? c.title : '';
}

function describeResource(e, state, ctx) {
    const id = resolveNationRef(e.target || 'SELF', state, ctx);
    const delta = num(e.delta);
    const key = String(e.resource || '');
    const label = RESOURCE_LABELS[key] || 'Recurso';
    return result(
        scoped(id, state, `${label} ${signed(delta)}`),
        toneOf(delta * align(state, id)),
        RESOURCE_ICONS[key] || 'fa-solid fa-chart-simple',
    );
}

function describePc(e, state, ctx) {
    const id = resolveNationRef(e.target || 'SELF', state, ctx);
    const delta = num(e.delta);
    return result(scoped(id, state, `${PC_LABEL} ${signed(delta)}`), toneOf(delta * align(state, id)), PC_ICON);
}

function describeRelation(e, state, ctx) {
    const a = resolveNationRef(e.target || 'SELF', state, ctx);
    const b = resolveNationRef(e.targetB || 'SELF', state, ctx);
    const delta = num(e.delta);
    const iconCls = delta < 0 ? ICONS.relationDown : ICONS.relationUp;
    if (!a || !b || a === b) return result(`Relações ${signed(delta)}`, 'neutral', iconCls);
    if (isPlayer(a, state) || isPlayer(b, state)) {
        const other = isPlayer(a, state) ? b : a;
        return result(`Relação com ${nationLabel(other, state)} ${signed(delta)}`, toneOf(delta), iconCls);
    }
    return result(
        `Relação ${cap(nationLabel(a, state))}–${cap(nationLabel(b, state))} ${signed(delta)}`,
        toneOf(delta * (align(state, a) + align(state, b))),
        iconCls,
    );
}

function describeTension(e) {
    const delta = num(e.delta);
    return result(`Tensão global ${signed(delta)}`, toneOf(-delta), delta < 0 ? ICONS.tensionDown : ICONS.tensionUp);
}

function describeModifier(e, state, ctx) {
    const id = resolveNationRef(e.target || 'SELF', state, ctx);
    const per = e.perTurn && typeof e.perTurn === 'object' ? e.perTurn : {};
    const keys = RESOURCE_KEYS.filter((k) => num(per[k]) !== 0);
    const parts = keys.map((k) => `${RESOURCE_LABELS[k]} ${signed(per[k])}/mês`);
    const label = String(e.label || 'Modificador').trim() || 'Modificador';
    const head = `${label} (${monthsText(e.turns)})`;
    const text = scoped(id, state, parts.length ? `${head}: ${parts.join(', ')}` : head);
    const vals = keys.map((k) => num(per[k]));
    const sign = !vals.length ? 0 : vals.every((v) => v >= 0) ? 1 : vals.every((v) => v <= 0) ? -1 : 0;
    return result(text, toneOf(sign * align(state, id)), ICONS.modifier);
}

function describeCrisis(e, state, ctx) {
    const action = e.action || 'start';
    if (action === 'start') {
        const sev = String(e.severity || '');
        const title = String(e.title || 'Nova crise').trim();
        const involved = (Array.isArray(e.involved) ? e.involved : []).map((x) => resolveNationRef(x, state, ctx));
        const touchesUs = involved.some((x) => isPlayer(x, state));
        const severe = sev === 'high' || sev === 'critical';
        const text = `Nova crise: ${title}${SEVERITY_LABELS[sev] ? ` (${SEVERITY_LABELS[sev]})` : ''}`;
        return result(text, touchesUs || severe ? 'bad' : 'neutral', ICONS.crisisUp);
    }
    const title = crisisTitle(state, e.crisisId);
    if (action === 'escalate') return result(title ? `Crise se agrava: ${title}` : 'Crise se agrava', 'bad', ICONS.crisisUp);
    if (action === 'deescalate') return result(title ? `Crise arrefece: ${title}` : 'Crise arrefece', 'good', ICONS.crisisDown);
    if (action === 'resolve') return result(title ? `Crise resolvida: ${title}` : 'Crise resolvida', 'good', ICONS.crisisDown);
    return result('Crise', 'neutral', ICONS.crisisUp);
}

function describePact(e, state, ctx) {
    const a = resolveNationRef(e.target || 'SELF', state, ctx);
    const b = resolveNationRef(e.targetB, state, ctx);
    const type = PACT_TYPE_LABELS[e.pactType] ? e.pactType : 'alliance';
    const typeLabel = PACT_TYPE_LABELS[type];
    const nameA = nationLabel(a, state);
    const nameB = nationLabel(b, state);
    const suffix = e.label ? ` (${String(e.label).trim()})` : '';
    const usA = isPlayer(a, state);
    const usB = isPlayer(b, state);
    const sum = align(state, a) + align(state, b);

    if (e.action === 'break') {
        if (usA || usB) {
            const other = usA ? b : a;
            const st = stanceOf(state, other);
            return result(`Ruptura: ${typeLabel} com ${nationLabel(other, state)}`, st === 'enemy' || st === 'rival' ? 'neutral' : 'bad', ICONS.pactBreak);
        }
        return result(`Ruptura: ${typeLabel} ${cap(nameA)}–${cap(nameB)}`, toneOf(-sum), ICONS.pactBreak);
    }

    if (type === 'guarantee') {
        if (usA) return result(`Garantir a independência de ${nameB}${suffix}`, 'neutral', ICONS.pactCreate);
        if (usB) return result(`${cap(nameA)} garante nossa independência${suffix}`, 'good', ICONS.pactCreate);
        return result(`${cap(nameA)} garante a independência de ${nameB}${suffix}`, toneOf(sum), ICONS.pactCreate);
    }
    if (usA || usB) {
        const other = usA ? b : a;
        return result(`${typeLabel} com ${nationLabel(other, state)}${suffix}`, 'good', ICONS.pactCreate);
    }
    return result(`${typeLabel}: ${cap(nameA)} e ${nameB}${suffix}`, toneOf(sum), ICONS.pactCreate);
}

function describePeace(a, b, terms, state) {
    const usA = isPlayer(a, state);
    const usB = isPlayer(b, state);
    const nameA = nationLabel(a, state);
    const nameB = nationLabel(b, state);
    const harsh = terms === 'annex' || terms === 'puppet' || terms === 'reparations';
    const iconCls = terms === 'annex' || terms === 'puppet' ? ICONS.annex : ICONS.peace;

    let text;
    if (terms === 'whitePeace') {
        text = usA || usB ? `Paz branca com ${nationLabel(usA ? b : a, state)}` : `Paz branca: ${cap(nameA)} e ${nameB}`;
    } else if (terms === 'reparations') {
        if (usA) text = `Paz com ${nameB}: reparações a nosso favor`;
        else if (usB) text = `Paz com ${nameA}: pagamos reparações`;
        else text = `Paz: ${cap(nameB)} paga reparações a ${nameA}`;
    } else if (terms === 'puppet') {
        if (usA) text = `Tornar ${nameB} um Estado-fantoche`;
        else if (usB) text = `Viramos Estado-fantoche de ${nameA}`;
        else text = `${cap(nameB)} vira Estado-fantoche de ${nameA}`;
    } else if (terms === 'annex') {
        if (usA) text = `Anexar ${nameB}`;
        else if (usB) text = `Anexação por ${nameA}`;
        else text = `${cap(nameA)} anexa ${nameB}`;
    } else {
        text = usA || usB ? `Paz com ${nationLabel(usA ? b : a, state)}` : `Paz: ${cap(nameA)} e ${nameB}`;
    }

    let tone;
    if (usA) tone = 'good';
    else if (usB) tone = harsh ? 'bad' : 'good';
    else if (harsh) tone = toneOf(align(state, a) - align(state, b));
    else tone = 'neutral';
    return result(text, tone, iconCls);
}

function describeWar(e, state, ctx) {
    const a = resolveNationRef(e.target || 'SELF', state, ctx);
    const b = resolveNationRef(e.targetB, state, ctx);
    const usA = isPlayer(a, state);
    const usB = isPlayer(b, state);
    const nameA = nationLabel(a, state);
    const nameB = nationLabel(b, state);
    const action = e.action || 'declare';

    if (action === 'ceasefire') {
        if (usA || usB) return result(`Cessar-fogo com ${nationLabel(usA ? b : a, state)}`, 'good', ICONS.ceasefire);
        return result(`Cessar-fogo: ${cap(nameA)} e ${nameB}`, 'neutral', ICONS.ceasefire);
    }
    if (action === 'peace') return describePeace(a, b, e.terms, state);

    const label = e.label ? ` (${String(e.label).trim()})` : '';
    if (usA) return result(`Declarar guerra a ${nameB}${label}`, 'bad', ICONS.warDeclare);
    if (usB) return result(`${cap(nameA)} declara guerra contra nós${label}`, 'bad', ICONS.warDeclare);
    return result(`Guerra: ${cap(nameA)} ataca ${nameB}${label}`, align(state, b) > 0 ? 'bad' : 'neutral', ICONS.warDeclare);
}

function describeFront(e, state, ctx) {
    const a = resolveNationRef(e.target || 'SELF', state, ctx);
    const b = resolveNationRef(e.targetB, state, ctx);
    const delta = num(e.delta);
    const amount = `${signed(delta)}%`;
    const nameA = nationLabel(a, state);
    const nameB = nationLabel(b, state);
    let text;
    if (isPlayer(a, state)) text = delta >= 0 ? `Avanço sobre ${nameB} ${amount}` : `Recuo em ${nameB} ${amount}`;
    else if (isPlayer(b, state)) text = delta >= 0 ? `Avanço de ${nameA} em nosso território ${amount}` : `Recuo de ${nameA} em nosso território ${amount}`;
    else text = delta >= 0 ? `Frente: ${cap(nameA)} avança sobre ${nameB} ${amount}` : `Frente: ${cap(nameA)} recua em ${nameB} ${amount}`;
    return result(text, toneOf(delta * (align(state, a) - align(state, b))), ICONS.front);
}

function describeBloc(e, state, ctx) {
    const id = resolveNationRef(e.target || 'SELF', state, ctx);
    const bloc = String(e.bloc || '');
    const blocLabel = BLOC_LABELS[bloc] || bloc || '—';
    if (isPlayer(id, state)) {
        return result(bloc === 'NON_ALIGNED' ? 'Adotar o não alinhamento' : `Alinhar ao bloco ${blocLabel}`, 'neutral', ICONS.bloc);
    }
    const name = cap(nationLabel(id, state));
    const text = bloc === 'NON_ALIGNED' ? `${name} adota o não alinhamento` : `${name} adere ao bloco ${blocLabel}`;
    const p = playerId(state);
    const nations = (state && state.nations) || {};
    const ourBloc = p && nations[p] ? nations[p].bloc : null;
    const theirBloc = nations[id] ? nations[id].bloc : null;
    let tone = 'neutral';
    if (ourBloc && bloc === ourBloc && theirBloc !== ourBloc) tone = 'good';
    else if (ourBloc && theirBloc === ourBloc && bloc !== ourBloc) tone = 'bad';
    return result(text, tone, ICONS.bloc);
}

/**
 * Describe one effect for the player.
 * @param {import('../../contract/events.js').Effect} effect
 * @param {?import('../../contract/worldState.js').WorldState} state
 * @param {{actorId?: string, targetId?: string}} [ctx]
 * @returns {{text: string, tone: 'good'|'bad'|'neutral', icon: string}}
 */
export function describeEffect(effect, state, ctx) {
    const e = effect && typeof effect === 'object' ? effect : {};
    try {
        switch (e.type) {
            case 'resource': return describeResource(e, state, ctx);
            case 'relation': return describeRelation(e, state, ctx);
            case 'tension': return describeTension(e);
            case 'pc': return describePc(e, state, ctx);
            case 'modifier': return describeModifier(e, state, ctx);
            case 'crisis': return describeCrisis(e, state, ctx);
            case 'pact': return describePact(e, state, ctx);
            case 'war': return describeWar(e, state, ctx);
            case 'front': return describeFront(e, state, ctx);
            case 'bloc': return describeBloc(e, state, ctx);
            case 'flag': return result('Marco da campanha', 'neutral', ICONS.flag);
            case 'news': {
                const t = String(e.text || '').trim();
                return result(t ? `Manchete: “${truncate(t, 110)}”` : 'Manchete', 'neutral', ICONS.news);
            }
            default: return result('Efeito desconhecido', 'neutral', ICONS.unknown);
        }
    } catch {
        return result('Efeito desconhecido', 'neutral', ICONS.unknown);
    }
}

/** Convenience: describe a list (skips non-objects). */
export function describeEffects(effects, state, ctx) {
    return (Array.isArray(effects) ? effects : []).filter((e) => e && typeof e === 'object').map((e) => describeEffect(e, state, ctx));
}
