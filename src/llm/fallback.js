/**
 * @file src/llm/fallback.js
 * Deterministic pt-BR decision event used when the LLM is off or fails.
 * Built from the live state (player wars, crises, weakest resource) and the
 * last TurnReport, so it still reads like a real briefing and every option has
 * real, engine-valid effects. Pure: same input => same event.
 */

import { EVENT_CATEGORIES, RESOURCE_KEYS } from '../contract/constants.js';
import { formatDate } from '../contract/presentation.js';
import { playerNation, getRelation } from '../contract/worldState.js';
import { deNation, theNation, TheNation } from './ptbr.js';

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const SEVERITY_PLURAL = { critical: 'críticas', high: 'graves', medium: 'preocupantes', low: 'preocupantes' };

function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

const res = (resource, delta, target = 'PLAYER') => ({ type: 'resource', target, resource, delta });
const rel = (targetB, delta, target = 'PLAYER') => ({ type: 'relation', target, targetB, delta });
const tension = (delta) => ({ type: 'tension', delta });
const pc = (delta) => ({ type: 'pc', target: 'PLAYER', delta });

function nm(state, id) {
    return state.nations?.[id]?.name || id;
}
const the = (state, id) => theNation(id, nm(state, id));
const The = (state, id) => TheNation(id, nm(state, id));
const of = (state, id) => deNation(id, nm(state, id));

function headlineHook(report) {
    const h = (report?.headlines || []).find((x) => typeof x === 'string' && x.trim());
    return h ? ` Nas agências internacionais, a manchete do mês resume o clima: "${h.trim().replace(/"/g, '\'')}".` : '';
}

function playerWar(state, playerId) {
    return (state.wars || []).find((w) => !w.ceasefire && ((w.attackers || []).includes(playerId) || (w.defenders || []).includes(playerId))) || null;
}

function warEvent(state, war, ctx) {
    const { playerId, title, leader, report } = ctx;
    const onAttack = (war.attackers || []).includes(playerId);
    const enemies = onAttack ? war.defenders || [] : war.attackers || [];
    const ownFront = (war.fronts || []).find((f) => f.attacker === playerId && enemies.includes(f.defender));
    const threat = (war.fronts || []).find((f) => f.defender === playerId && enemies.includes(f.attacker));
    const enemy = ownFront?.defender || threat?.attacker || enemies[0];
    const offensive = ownFront
        ? { type: 'front', target: 'PLAYER', targetB: enemy, delta: 8 }
        : { type: 'front', target: enemy, targetB: 'PLAYER', delta: -8 };
    const progress = ownFront ? Math.round(ownFront.progress || 0) : threat ? Math.round(threat.progress || 0) : 0;
    const frontPhrase = ownFront
        ? `Nossas forças controlam cerca de ${progress}% do território disputado, mas as linhas de suprimento estão no limite.`
        : threat
            ? `O inimigo ocupa cerca de ${progress}% do nosso território e prepara novos avanços.`
            : 'A frente está estagnada, com escaramuças diárias e pouca movimentação.';
    return {
        category: 'war',
        title: `Conselho de Guerra: a frente contra ${the(state, enemy)}`,
        narrative:
            `${title} ${leader}, o Estado-Maior pede uma definição imediata sobre o rumo da guerra (${war.name}). ${frontPhrase} ` +
            `O Ministro da Defesa defende um esforço concentrado antes que ${the(state, enemy)} reorganize suas reservas; a Ministra da Economia alerta que o custo da guerra já pesa sobre o orçamento e sobre o humor das ruas. ` +
            `O Chanceler lembra que as capitais estrangeiras acompanham cada movimento do governo e que uma janela diplomática ainda existe, embora estreita.${headlineHook(report)} ` +
            'O gabinete aguarda a sua ordem.',
        involved: [playerId, enemy].filter(Boolean),
        options: [
            {
                label: ownFront ? 'Lançar uma ofensiva concentrada' : 'Ordenar uma contraofensiva',
                rationale: 'Pode mudar a frente, ao custo de tropas e equipamento.',
                effects: [offensive, res('military', -3), res('manpower', -4), res('warSupport', -2)],
            },
            {
                label: 'Fortificar posições e adotar economia de guerra',
                rationale: 'Segura a linha e reforça as forças armadas, mas drena a economia.',
                effects: [
                    { type: 'modifier', target: 'PLAYER', label: 'Economia de guerra', perTurn: { military: 1, economy: -1 }, turns: 6 },
                    res('stability', -1),
                ],
            },
            {
                label: 'Abrir um canal discreto com o inimigo',
                rationale: 'Reduz a tensão e melhora a imagem externa; os falcões vão reclamar.',
                effects: [tension(-3), rel(enemy, 8), res('warSupport', -4), res('influence', 2)],
            },
        ],
    };
}

function crisisEvent(state, crisis, ctx) {
    const { playerId, title, leader, report } = ctx;
    const mine = (crisis.involved || []).includes(playerId);
    const others = (crisis.involved || []).filter((id) => id !== playerId && state.nations?.[id]);
    const a = others[0];
    const b = others[1];
    const category = EVENT_CATEGORIES.includes(crisis.category) ? crisis.category : 'diplomacy';
    const desc = String(crisis.description || '').trim();
    const sevWord = { critical: 'crítica', high: 'grave', medium: 'preocupante', low: 'ainda contida' }[crisis.severity] || 'preocupante';

    if (mine) {
        return {
            category,
            title: `Pressão sobre o governo: ${crisis.title}`,
            narrative:
                `${title} ${leader}, a crise "${crisis.title}" chegou à sua mesa e a avaliação do Diretor de Inteligência é ${sevWord}. ${desc ? `${desc} ` : ''}` +
                `${a ? `${The(state, a)} cobra uma resposta pública e testa a firmeza do governo. ` : ''}` +
                'O Chanceler propõe assumir a liderança das negociações; o Ministro do Interior teme que qualquer sinal de fraqueza seja explorado pela oposição; ' +
                `a Ministra da Economia lembra que mercados e parceiros comerciais reagem mal à incerteza.${headlineHook(report)} A decisão é sua.`,
            involved: [playerId, ...others.slice(0, 3)],
            options: [
                {
                    label: 'Liderar uma mediação internacional',
                    rationale: 'Ganha prestígio e esfria a crise, mas consome capital político.',
                    effects: [{ type: 'crisis', action: 'deescalate', crisisId: crisis.id }, res('influence', 3), pc(-2), tension(-2)],
                },
                {
                    label: 'Endurecer a posição do governo',
                    rationale: 'Une o país em torno da bandeira, às custas das relações externas.',
                    effects: [...(a ? [rel(a, -10)] : []), res('warSupport', 4), res('stability', 2), tension(3)],
                },
                {
                    label: 'Negociar concessões discretas',
                    rationale: 'Desarma a crise, mas soa como recuo.',
                    effects: [{ type: 'crisis', action: 'deescalate', crisisId: crisis.id }, ...(a ? [rel(a, 6)] : []), res('stability', -2), res('influence', -2)],
                },
            ],
        };
    }

    return {
        category,
        title: `${crisis.title}: o mundo espera a nossa posição`,
        narrative:
            `${title} ${leader}, a crise "${crisis.title}" ganhou proporções ${SEVERITY_PLURAL[crisis.severity] || 'preocupantes'} e já domina as reuniões das chancelarias. ${desc ? `${desc} ` : ''}` +
            `${a && b ? `${The(state, a)} e ${the(state, b)} trocam acusações e buscam apoio internacional. ` : ''}` +
            'O Chanceler acredita que o país pode se apresentar como mediador; o Diretor de Inteligência lembra que tomar partido traria ganhos, mas também inimigos.' +
            `${headlineHook(report)} Qual será a posição oficial do governo?`,
        involved: others.slice(0, 4),
        options: [
            {
                label: 'Oferecer mediação',
                rationale: 'Prestígio internacional e menos tensão; custa capital político.',
                effects: [{ type: 'crisis', action: 'deescalate', crisisId: crisis.id }, res('influence', 3), pc(-2), tension(-2)],
            },
            ...(a
                ? [{
                    label: `Apoiar ${the(state, a)}`.slice(0, 60),
                    rationale: b ? `Aproxima o país ${of(state, a)} e o afasta ${of(state, b)}.` : `Aproxima o país ${of(state, a)}.`,
                    effects: [rel(a, 10), ...(b ? [rel(b, -8)] : []), res('influence', 1), tension(1)],
                }]
                : []),
            {
                label: 'Manter neutralidade',
                rationale: 'Evita riscos, mas o país perde voz no cenário global.',
                effects: [res('stability', 1), res('influence', -2)],
            },
        ],
    };
}

function domesticEvent(state, ctx) {
    const { playerId, title, leader, report, resources } = ctx;
    const weakest = ['economy', 'stability'].sort((x, y) => (resources[x] ?? 50) - (resources[y] ?? 50) || x.localeCompare(y))[0];
    if (weakest === 'economy') {
        return {
            category: 'economy',
            title: 'Contas públicas sob pressão',
            narrative:
                `${title} ${leader}, a Ministra da Economia chega ao gabinete com notícias ruins: arrecadação em queda, investidores cautelosos e pressão por gastos em todas as pastas. ` +
                'Os jornais do país já falam em crise, e a oposição prepara uma ofensiva no Parlamento. ' +
                'Ela apresenta dois caminhos: um pacote de estímulo que reaqueça a atividade agora e deixe a conta para depois, ou um ajuste duro que recupere a confiança dos mercados à custa da popularidade. ' +
                `O Ministro do Interior lembra que a paciência das ruas tem limite.${headlineHook(report)}`,
            involved: [playerId],
            options: [
                {
                    label: 'Lançar um pacote de estímulo',
                    rationale: 'Alívio imediato; a dívida cobra o preço nos meses seguintes.',
                    effects: [res('economy', 5), res('stability', 2), { type: 'modifier', target: 'PLAYER', label: 'Dívida pública crescente', perTurn: { economy: -1 }, turns: 4 }],
                },
                {
                    label: 'Aprovar um ajuste fiscal',
                    rationale: 'Recupera a confiança aos poucos, mas gera protestos.',
                    effects: [res('stability', -4), { type: 'modifier', target: 'PLAYER', label: 'Ajuste fiscal', perTurn: { economy: 1 }, turns: 6 }],
                },
                {
                    label: 'Culpar o cenário internacional',
                    rationale: 'Ganha tempo internamente; parceiros externos não gostam.',
                    effects: [res('stability', 2), res('influence', -3)],
                },
            ],
        };
    }
    return {
        category: 'unrest',
        title: 'Protestos tomam as ruas do país',
        narrative:
            `${title} ${leader}, manifestações se espalharam pelas principais cidades do país. O que começou como um protesto contra o custo de vida virou uma pauta difusa contra o governo, ` +
            'amplificada pelas redes sociais. O Ministro do Interior pede autorização para endurecer; o Diretor de Inteligência suspeita de financiamento externo; ' +
            `o Chanceler alerta que imagens de repressão correriam o mundo em minutos.${headlineHook(report)} O país espera um pronunciamento.`,
        involved: [playerId],
        options: [
            {
                label: 'Abrir diálogo com os manifestantes',
                rationale: 'Acalma as ruas, mas consome capital político.',
                effects: [res('stability', 4), pc(-2), res('warSupport', -1)],
            },
            {
                label: 'Reprimir as manifestações',
                rationale: 'Ordem imediata, desgaste internacional e ressentimento.',
                effects: [res('stability', 2), res('influence', -4), { type: 'modifier', target: 'PLAYER', label: 'Ressentimento popular', perTurn: { stability: -1 }, turns: 3 }],
            },
            {
                label: 'Anunciar uma reforma ministerial',
                rationale: 'Renova o governo; custa capital político.',
                effects: [res('stability', 3), pc(-3)],
            },
        ],
    };
}

function diplomaticEvent(state, ctx) {
    const { playerId, title, leader, report } = ctx;
    const candidates = Object.values(state.nations || {})
        .filter((n) => n && n.id !== playerId && n.status === 'active' && (n.major || n.playable))
        .map((n) => ({ id: n.id, rel: getRelation(state, playerId, n.id), major: n.major ? 1 : 0 }))
        .sort((a, b) => b.major - a.major || b.rel - a.rel || a.id.localeCompare(b.id));
    const partner = candidates[0]?.id;
    const rival = candidates.slice().sort((a, b) => a.rel - b.rel || a.id.localeCompare(b.id))[0]?.id;
    if (!partner) {
        return {
            category: 'politics',
            title: 'Reunião extraordinária do gabinete',
            narrative:
                `${title} ${leader}, o gabinete se reúne para definir as prioridades do mês. A Ministra da Economia quer foco na produção; o Ministro da Defesa pede investimento nas forças armadas; ` +
                `o Chanceler defende ampliar a presença do país nos fóruns internacionais. Não há recursos para tudo, e cada pasta disputa a sua atenção.${headlineHook(report)}`,
            involved: [playerId],
            options: [
                { label: 'Priorizar a economia', rationale: 'Mais crescimento, menos defesa.', effects: [res('economy', 3), res('military', -2)] },
                { label: 'Priorizar a defesa', rationale: 'Forças armadas mais fortes, orçamento apertado.', effects: [res('military', 3), res('economy', -2)] },
                { label: 'Priorizar a diplomacia', rationale: 'Mais influência, custa capital político.', effects: [res('influence', 3), pc(-1)] },
            ],
        };
    }
    const hasRival = rival && rival !== partner;
    return {
        category: 'diplomacy',
        title: `Proposta de parceria estratégica ${of(state, partner)}`,
        narrative:
            `${title} ${leader}, o embaixador ${of(state, partner)} pediu uma audiência urgente: seu governo quer ampliar a cooperação conosco em comércio, tecnologia e segurança. ` +
            `O Chanceler vê uma oportunidade rara de projeção; o Diretor de Inteligência adverte que ${hasRival ? `${the(state, rival)} acompanhará a aproximação com desconfiança` : 'toda parceria traz dependência'}. ` +
            `A Ministra da Economia calcula ganhos concretos, mas pede cautela com as contrapartidas.${headlineHook(report)} Qual será a resposta do governo?`,
        involved: [playerId, partner, ...(hasRival ? [rival] : [])],
        options: [
            {
                label: 'Aceitar a parceria estratégica',
                rationale: hasRival ? `Ganhos econômicos e um parceiro mais próximo, mas irrita ${the(state, rival)}.` : 'Ganhos econômicos e um parceiro mais próximo.',
                effects: [rel(partner, 10), res('economy', 2), ...(hasRival ? [rel(rival, -5)] : [])],
            },
            {
                label: 'Negociar termos melhores',
                rationale: 'Aproximação gradual; exige capital político.',
                effects: [rel(partner, 4), res('influence', 2), pc(-1)],
            },
            {
                label: 'Recusar e preservar a autonomia',
                rationale: 'Agrada os nacionalistas, esfria a relação.',
                effects: [rel(partner, -6), res('stability', 1), res('influence', 1)],
            },
        ],
    };
}

/**
 * @param {import('../contract/worldState.js').WorldState} state
 * @param {import('../contract/events.js').TurnReport} [report]
 * @returns {import('../contract/events.js').GameEvent}
 */
export function buildFallbackEvent(state, report) {
    const playerId = state.player.nationId;
    const n = playerNation(state) || {};
    const ctx = {
        playerId,
        title: state.player.title || n.leaderTitle || 'Chefe de Estado',
        leader: state.player.leaderName || 'Governante',
        report,
        resources: n.resources || Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 50])),
    };

    let core;
    const war = playerWar(state, playerId);
    const crises = (state.crises || []).slice().sort((a, b) =>
        (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || String(a.id).localeCompare(String(b.id)));
    const myCrisis = crises.find((c) => (c.involved || []).includes(playerId));
    const bigCrisis = crises.find((c) => (SEVERITY_RANK[c.severity] || 0) >= 2 && (c.involved || []).some((id) => state.nations?.[id]));
    if (war) core = warEvent(state, war, ctx);
    else if (myCrisis) core = crisisEvent(state, myCrisis, ctx);
    else if (Math.min(ctx.resources.economy ?? 50, ctx.resources.stability ?? 50) <= 35) core = domesticEvent(state, ctx);
    else if (bigCrisis) core = crisisEvent(state, bigCrisis, ctx);
    else core = diplomaticEvent(state, ctx);

    const headlines = (report?.headlines || []).filter((h) => typeof h === 'string' && h.trim()).slice(0, 2);
    const turn = Number(state.turn) || 0;
    return {
        id: `fallback-${turn}-${hash(`${core.title}|${formatDate(state.date)}`)}`,
        source: 'fallback',
        category: core.category,
        title: core.title.slice(0, 90),
        narrative: core.narrative,
        headlines,
        involved: [...new Set(core.involved.filter(Boolean))],
        options: core.options.slice(0, 3).map((o) => ({ label: o.label.slice(0, 60), rationale: o.rationale, effects: o.effects })),
        turn,
    };
}
