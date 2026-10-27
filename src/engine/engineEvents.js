/**
 * @file src/engine/engineEvents.js
 * Engine-generated decisions for the player (DESIGN §3.8): calls to arms, peace
 * terms, AI peace offers, surrender demands and AI diplomatic proposals.
 *
 * They are ordinary GameEvents with source 'engine'. Effects use concrete ids or
 * 'PLAYER'. The engine-only field `defaultOption` names the option applied when the
 * decision expires unanswered (see EVENT_EXPIRY_TURNS in turn.js).
 */

import { textFor } from './text.js';

const P = 'PLAYER';

function baseEvent(state, id, category, title, narrative, involved, options, defaultOption) {
    return {
        id,
        source: 'engine',
        category,
        title,
        narrative,
        headlines: [],
        involved: involved.filter(Boolean),
        options,
        turn: state.turn,
        defaultOption,
    };
}

/**
 * "Chamado às Armas": an ally at war asks the player to join.
 * @param {Object} state
 * @param {import('../contract/worldState.js').War} war
 * @param {string} requester ally asking for help
 * @param {string} enemy leader of the opposite side
 * @param {?import('../contract/worldState.js').Pact} pact
 */
export function buildCallToArmsEvent(state, war, requester, enemy, pact) {
    const t = textFor(state);
    const pid = state.player.nationId;
    const treaty = pact ? `o compromisso firmado em "${pact.name}"` : 'os compromissos de defesa entre os dois países';
    const narrative =
        `${t.n(requester)} ${t.v(requester, 'invoca', 'invocam')} ${treaty} e ${t.v(requester, 'pede', 'pedem')} que ` +
        `${t.the(pid)} ${t.v(pid, 'entre', 'entrem')} na ${war.name} contra ${t.the(enemy)}. Os aliados acompanham a resposta com atenção: ` +
        `honrar a palavra reforça a credibilidade do país, mas a guerra cobrará vidas, recursos e estabilidade. ` +
        `Recusar mantém o país em paz, porém abala a confiança ${t.de(requester)} e a influência internacional ` +
        `${t.de(pid)}. O gabinete aguarda a decisão.`;
    return baseEvent(
        state,
        `eng-cta-${war.id}-${pid}`,
        'war',
        'Chamado às Armas',
        narrative,
        [requester, enemy],
        [
            {
                label: 'Honrar a aliança e entrar na guerra',
                rationale: `Entra na guerra ao lado ${t.de(requester)}; o apoio à guerra e a tensão global sobem.`,
                effects: [
                    { type: 'war', action: 'declare', target: P, targetB: enemy },
                    { type: 'relation', target: P, targetB: requester, delta: 10 },
                    { type: 'resource', target: P, resource: 'warSupport', delta: 3 },
                ],
            },
            {
                label: 'Enviar apenas apoio material',
                rationale: 'Ajuda militar sem entrar na guerra; o aliado fica só parcialmente satisfeito.',
                effects: [
                    { type: 'resource', target: P, resource: 'economy', delta: -3 },
                    { type: 'resource', target: requester, resource: 'military', delta: 3 },
                    { type: 'relation', target: P, targetB: requester, delta: -5 },
                    { type: 'resource', target: P, resource: 'influence', delta: -2 },
                ],
            },
            {
                label: 'Recusar o chamado',
                rationale: 'Mantém o país fora da guerra, mas custa relações e influência.',
                effects: [
                    { type: 'relation', target: P, targetB: requester, delta: -20 },
                    { type: 'resource', target: P, resource: 'influence', delta: -5 },
                ],
            },
        ],
        2,
    );
}

/**
 * "Termos de Paz": the player won and dictates the terms to a capitulated nation.
 * @param {Object} state
 * @param {string} loser capitulated nation id
 * @param {string} warName
 */
export function buildPeaceTermsEvent(state, loser, warName) {
    const t = textFor(state);
    const pid = state.player.nationId;
    const narrative =
        `${t.n(loser)} ${t.v(loser, 'capitulou', 'capitularam')}. Com as linhas de defesa rompidas na ${warName}, ` +
        `os negociadores ${t.de(loser)} aguardam os termos ${t.de(pid)}. As opções vão da anexação total à paz branca. ` +
        `Quanto mais duros os termos, maior o ganho imediato e mais forte a reação internacional; a generosidade, ` +
        `por outro lado, rende prestígio diplomático.`;
    return baseEvent(
        state,
        `eng-terms-${loser}-${state.turn}`,
        'war',
        `Termos de Paz: ${t.n(loser)}`,
        narrative,
        [loser],
        [
            {
                label: 'Anexar o território',
                rationale: 'O território passa ao seu controle; a comunidade internacional reage mal.',
                effects: [
                    { type: 'war', action: 'peace', target: P, targetB: loser, terms: 'annex' },
                    { type: 'tension', delta: 5 },
                    { type: 'resource', target: P, resource: 'influence', delta: -3 },
                ],
            },
            {
                label: 'Instalar um governo-fantoche',
                rationale: 'O país segue formalmente independente, mas sob o seu controle.',
                effects: [
                    { type: 'war', action: 'peace', target: P, targetB: loser, terms: 'puppet' },
                    { type: 'tension', delta: 3 },
                ],
            },
            {
                label: 'Exigir reparações de guerra',
                rationale: `Recursos econômicos como compensação; ${t.the(loser)} preserva a soberania.`,
                effects: [{ type: 'war', action: 'peace', target: P, targetB: loser, terms: 'reparations' }],
            },
            {
                label: 'Oferecer paz branca',
                rationale: 'Encerra o conflito sem exigências e rende prestígio diplomático.',
                effects: [
                    { type: 'war', action: 'peace', target: P, targetB: loser, terms: 'whitePeace' },
                    { type: 'resource', target: P, resource: 'influence', delta: 3 },
                    { type: 'relation', target: P, targetB: loser, delta: 15 },
                ],
            },
        ],
        2,
    );
}

/**
 * AI enemy leader offers peace (white peace, or reparations when it is losing badly).
 * @param {Object} state
 * @param {string} from AI nation offering peace
 * @param {import('../contract/worldState.js').War} war
 * @param {'whitePeace'|'reparations'} terms
 */
export function buildPeaceOfferEvent(state, from, war, terms) {
    const t = textFor(state);
    const pid = state.player.nationId;
    const offer =
        terms === 'reparations'
            ? `encerrar a ${war.name} e pagar reparações de guerra`
            : `encerrar a ${war.name} com uma paz branca, sem anexações nem reparações`;
    const narrative =
        `Emissários ${t.de(from)} procuram discretamente o governo ${t.de(pid)} propondo ${offer}. ` +
        `O desgaste da guerra pesa dos dois lados: aceitar devolve os soldados para casa e alivia a economia; ` +
        `rejeitar mantém a pressão militar na esperança de uma vitória mais completa, ao custo de mais meses de combate.`;
    return baseEvent(
        state,
        `eng-peace-${war.id}-${state.turn}`,
        'diplomacy',
        'Proposta de Paz',
        narrative,
        [from],
        [
            {
                label: terms === 'reparations' ? 'Aceitar a paz com reparações' : 'Aceitar a paz branca',
                rationale: 'A guerra termina e as frentes são desmobilizadas.',
                effects: [{ type: 'war', action: 'peace', target: P, targetB: from, terms }],
            },
            {
                label: 'Aceitar apenas um cessar-fogo',
                rationale: 'Congela as frentes sem encerrar formalmente a guerra.',
                effects: [{ type: 'war', action: 'ceasefire', target: P, targetB: from }],
            },
            {
                label: 'Rejeitar e continuar a guerra',
                rationale: 'Mantém a ofensiva; o apoio à guerra sobe um pouco.',
                effects: [
                    { type: 'resource', target: P, resource: 'warSupport', delta: 2 },
                    { type: 'relation', target: P, targetB: from, delta: -5 },
                ],
            },
        ],
        2,
    );
}

/**
 * The enemy demands the player's surrender when a front against the player is deep.
 * @param {Object} state
 * @param {string} enemy
 * @param {import('../contract/worldState.js').War} war
 * @param {number} occupation current occupation of the player (0..100)
 */
export function buildSurrenderDemandEvent(state, enemy, war, occupation) {
    const t = textFor(state);
    const pid = state.player.nationId;
    const narrative =
        `As tropas ${t.de(enemy)} já ocupam ${occupation}% do território ${t.de(pid)}. Pelos canais diplomáticos, ` +
        `o inimigo exige o fim imediato da resistência e o pagamento de reparações de guerra. Os generais admitem ` +
        `que as linhas podem ceder a qualquer momento; se o país capitular, o governo cairá. Aceitar os termos ` +
        `preserva o Estado, mas a humilhação terá preço político.`;
    return baseEvent(
        state,
        `eng-surrender-${war.id}-${state.turn}`,
        'war',
        'Exigência de Rendição',
        narrative,
        [enemy],
        [
            {
                label: 'Aceitar os termos e pagar reparações',
                rationale: 'A guerra termina; a economia e a estabilidade sofrem.',
                effects: [
                    { type: 'war', action: 'peace', target: enemy, targetB: P, terms: 'reparations' },
                    { type: 'resource', target: P, resource: 'stability', delta: -5 },
                ],
            },
            {
                label: 'Lutar até o fim',
                rationale: 'A resistência continua; o apoio à guerra sobe, a estabilidade cai.',
                effects: [
                    { type: 'resource', target: P, resource: 'warSupport', delta: 3 },
                    { type: 'resource', target: P, resource: 'stability', delta: -2 },
                ],
            },
        ],
        1,
    );
}

const PROPOSAL_TEXT = {
    dip_trade_agreement: {
        title: 'Proposta de Acordo Comercial',
        what: 'um acordo comercial que reduz tarifas e amplia as exportações dos dois países',
        accept: 'Assinar o acordo comercial',
    },
    eco_energy_deal: {
        title: 'Proposta de Acordo Energético',
        what: 'um acordo de fornecimento de energia de longo prazo',
        accept: 'Assinar o acordo energético',
    },
    dip_propose_alliance: {
        title: 'Proposta de Aliança',
        what: 'uma aliança militar formal, que obriga cada país a entrar nas guerras do outro',
        accept: 'Aceitar a aliança',
    },
    dip_defense_pact: {
        title: 'Proposta de Pacto de Defesa',
        what: 'um pacto de defesa mútua em caso de agressão estrangeira',
        accept: 'Assinar o pacto de defesa',
    },
    dip_propose_ceasefire: {
        title: 'Proposta de Cessar-Fogo',
        what: 'um cessar-fogo imediato que congela as frentes de batalha',
        accept: 'Aceitar o cessar-fogo',
    },
    dip_propose_peace: {
        title: 'Proposta de Paz',
        what: 'o fim da guerra com uma paz branca, sem anexações nem reparações',
        accept: 'Aceitar a paz',
    },
};

/**
 * An AI nation proposes a deal to the player (trade, energy, alliance, defense, ceasefire, peace).
 * @param {Object} state
 * @param {string} from AI proposer
 * @param {string} actionId catalog id
 * @param {import('../contract/events.js').Effect[]} acceptEffects concrete effects if accepted
 */
export function buildProposalEvent(state, from, actionId, acceptEffects) {
    const t = textFor(state);
    const pid = state.player.nationId;
    const spec = PROPOSAL_TEXT[actionId] || { title: 'Proposta Diplomática', what: 'um acordo bilateral', accept: 'Aceitar a proposta' };
    const narrative =
        `O governo ${t.de(from)} apresenta ${t.a(pid)} ${spec.what}. ` +
        `Os diplomatas avaliam que a proposta é séria e que a resposta será lida como um sinal da orientação ` +
        `externa do país. Aceitar aproxima os dois governos; recusar preserva a liberdade de ação, ` +
        `com algum custo nas relações bilaterais.`;
    const isWar = actionId === 'dip_propose_ceasefire' || actionId === 'dip_propose_peace';
    return baseEvent(
        state,
        `eng-prop-${actionId}-${from}-${state.turn}`,
        isWar ? 'war' : actionId === 'eco_energy_deal' ? 'energy' : 'diplomacy',
        spec.title,
        narrative,
        [from],
        [
            { label: spec.accept, rationale: `Fortalece os laços ${t.com(from)}.`, effects: acceptEffects },
            {
                label: 'Recusar a proposta',
                rationale: 'Mantém a liberdade de ação; as relações esfriam um pouco.',
                effects: [{ type: 'relation', target: P, targetB: from, delta: isWar ? -3 : -5 }],
            },
        ],
        1,
    );
}
