/**
 * @file src/st/commands.js
 * Slash command definitions (pure data + callbacks) and their registration.
 *
 * ST: public/scripts/slash-commands/SlashCommandParser.js:65 addCommandObject(command)
 * ST: public/scripts/slash-commands/SlashCommand.js:44 SlashCommand.fromProps(props)
 *     -> Object.assign(new SlashCommand(), props): name, callback, helpString,
 *        aliases, returns, namedArgumentList, unnamedArgumentList.
 * ST: public/scripts/slash-commands/SlashCommandArgument.js:35 / :97 fromProps
 *     ({description, typeList, isRequired, acceptsMultiple, defaultValue, enumList, enumProvider, forceEnum})
 *     plus `name` for named arguments.
 * ST: public/scripts/slash-commands/SlashCommandArgument.js:10 ARGUMENT_TYPE.STRING === 'string'.
 * ST: public/scripts/slash-commands/SlashCommandClosure.js:438
 *     `callback(args, value ?? '')` — args holds the named arguments (+ _scope etc.),
 *     the return value becomes the pipe (so /hoi-status | /echo works).
 * ST: public/scripts/slash-commands/SlashCommandEnumValue.js:62 new SlashCommandEnumValue(value, description, ...)
 */

const NO_CAMPAIGN = 'Nenhuma campanha ativa neste chat. Use /hoi-novojogo para começar.';
const ACTION_ID_RE = /^[a-z][a-z0-9_]*$/;
const NATION_ID_RE = /^[A-Z][A-Z0-9]{1,3}$/;

function unnamedText(value) {
    if (Array.isArray(value)) return value.map((v) => String(v ?? '')).join(' ').trim();
    return String(value ?? '').trim();
}

function resultLine(result) {
    if (!result) return 'Ação não executada.';
    const parts = [String(result.summary || '').trim() || (result.ok ? 'Ação executada.' : 'Ação recusada.')];
    if (!result.ok && Array.isArray(result.reasons) && result.reasons.length) {
        parts.push(`Motivo: ${result.reasons.join('; ')}.`);
    } else if (result.ok && Array.isArray(result.details) && result.details.length) {
        parts.push(`(${result.details.join(', ')})`);
    }
    return parts.join(' ');
}

/**
 * Validate /hoi-acao arguments.
 * @param {{acao?: string, alvo?: string}} args
 * @param {{state: any, catalog: ?Array<{id:string, target:string, name?:string}>}} env
 * @returns {{ok: true, actionId: string, targetId: ?string} | {ok: false, message: string}}
 */
export function validateActionArgs(args, { state, catalog }) {
    const actionId = String(args?.acao ?? '').trim().toLowerCase();
    let targetId = String(args?.alvo ?? '').trim().toUpperCase() || null;
    if (!actionId) return { ok: false, message: 'Informe a ação: /hoi-acao acao=<id> [alvo=<ID>].' };
    if (!ACTION_ID_RE.test(actionId)) return { ok: false, message: `Identificador de ação inválido: "${actionId}".` };
    const def = Array.isArray(catalog) ? catalog.find((a) => a.id === actionId) : undefined;
    if (Array.isArray(catalog) && catalog.length && !def) {
        return { ok: false, message: `Ação desconhecida: "${actionId}".` };
    }
    if (targetId) {
        if (!NATION_ID_RE.test(targetId)) return { ok: false, message: `Identificador de nação inválido: "${targetId}".` };
        if (state?.nations && !state.nations[targetId]) return { ok: false, message: `Nação desconhecida: "${targetId}".` };
        if (state?.player?.nationId === targetId) return { ok: false, message: 'O alvo não pode ser a sua própria nação.' };
    }
    if (def && def.target === 'nation' && !targetId) {
        return { ok: false, message: `A ação "${def.name || actionId}" exige um alvo: alvo=<ID da nação>.` };
    }
    if (def && def.target === 'none') targetId = null;
    return { ok: true, actionId, targetId };
}

/**
 * @param {import('../contract/interfaces.js').ControllerAPI} controller
 * @param {{buildSitrep: (state:any, opts?:any) => string, getCatalog?: () => any[], toast: (msg:string, kind?:string) => void}} env
 * @returns {Array<{name:string, aliases:string[], helpString:string, returns?:string,
 *   named: Array<{name:string, description:string, isRequired:boolean, enumProvider?: () => Array<{value:string, description:string}>}>,
 *   unnamed: Array<{description:string, isRequired:boolean}>,
 *   callback: (named:any, unnamed:any) => Promise<string>}>}
 */
export function buildCommandDefs(controller, { buildSitrep, getCatalog, toast }) {
    const safeCatalog = () => {
        try {
            return typeof getCatalog === 'function' ? getCatalog() || [] : null;
        } catch {
            return null;
        }
    };
    const guard = (fn) => async (named, unnamed) => {
        try {
            const out = await fn(named || {}, unnamed);
            return out == null ? '' : String(out);
        } catch (error) {
            console.error('[HOI] slash command failed', error);
            toast(`Falha no comando: ${error?.message || error}`, 'error');
            return '';
        }
    };
    const needState = () => controller.getState();

    return [
        {
            name: 'hoi',
            aliases: ['hoi-salaguerra', 'hoi-warroom'],
            helpString: 'Abre a <b>Sala de Guerra</b> da campanha de Grande Estratégia.',
            named: [],
            unnamed: [],
            callback: guard(async () => {
                await controller.openWarRoom();
                return '';
            }),
        },
        {
            name: 'hoi-novojogo',
            aliases: ['hoi-newgame'],
            helpString: 'Inicia uma nova campanha neste chat (período, nação e governante).',
            named: [],
            unnamed: [],
            callback: guard(async () => {
                await controller.newCampaign();
                return '';
            }),
        },
        {
            name: 'hoi-turno',
            aliases: ['hoi-endturn'],
            helpString: 'Encerra o mês: o mundo age, as frentes se movem e surge uma nova decisão.',
            named: [],
            unnamed: [],
            callback: guard(async () => {
                if (!needState()) return NO_CAMPAIGN;
                await controller.endTurn();
                return '';
            }),
        },
        {
            name: 'hoi-ordem',
            aliases: ['hoi-order'],
            helpString: 'Dá uma ordem ao gabinete em linguagem natural. Ex.: <code>/hoi-ordem Mobilizem as tropas na fronteira com a Venezuela</code>. Retorna o resultado das ações executadas.',
            returns: 'resumo das ações executadas (uma por linha)',
            named: [],
            unnamed: [{ description: 'texto da ordem', isRequired: true }],
            callback: guard(async (_named, unnamed) => {
                const text = unnamedText(unnamed);
                if (!text) return 'Escreva a ordem. Ex.: /hoi-ordem Proponham um acordo comercial à Argentina';
                if (!needState()) return NO_CAMPAIGN;
                const results = await controller.handleOrder(text, 'command');
                if (!Array.isArray(results) || !results.length) return 'Nenhuma ordem executável foi reconhecida no texto.';
                return results.map(resultLine).join('\n');
            }),
        },
        {
            name: 'hoi-acao',
            aliases: ['hoi-action'],
            helpString: 'Executa uma ação do catálogo. Ex.: <code>/hoi-acao acao=dip_improve_relations alvo=ARG</code>. Retorna o resumo do resultado.',
            returns: 'resumo do resultado da ação',
            named: [
                {
                    name: 'acao',
                    description: 'id da ação no catálogo',
                    isRequired: true,
                    enumProvider: () => (safeCatalog() || []).map((a) => ({ value: a.id, description: a.name || '' })),
                },
                {
                    name: 'alvo',
                    description: 'id da nação alvo (ex.: ARG), quando a ação exige alvo',
                    isRequired: false,
                    enumProvider: () => {
                        const s = needState();
                        if (!s?.nations) return [];
                        return Object.values(s.nations)
                            .filter((n) => n && n.id !== s.player?.nationId && n.status !== 'annexed')
                            .map((n) => ({ value: n.id, description: n.name || '' }));
                    },
                },
            ],
            unnamed: [],
            callback: guard(async (named) => {
                const state = needState();
                if (!state) return NO_CAMPAIGN;
                const v = validateActionArgs(named, { state, catalog: safeCatalog() });
                if (!v.ok) {
                    toast(v.message, 'warning');
                    return v.message;
                }
                const result = await controller.doAction(v.actionId, v.targetId, 'command');
                return resultLine(result);
            }),
        },
        {
            name: 'hoi-status',
            aliases: ['hoi-sitrep'],
            helpString: 'Retorna o relatório de situação da campanha (texto). Útil em STscript: <code>/hoi-status | /echo</code>.',
            returns: 'relatório de situação em texto',
            named: [],
            unnamed: [],
            callback: guard(async () => {
                const state = needState();
                if (!state) return NO_CAMPAIGN;
                const text = typeof controller.statusText === 'function' ? controller.statusText() : '';
                return text || buildSitrep(state, { detail: 'full' }) || '';
            }),
        },
        {
            name: 'hoi-decisao',
            aliases: ['hoi-decision'],
            helpString: 'Reabre a decisão pendente do mês.',
            named: [],
            unnamed: [],
            callback: guard(async () => {
                const state = needState();
                if (!state) return NO_CAMPAIGN;
                if (!state.pendingEvent) return 'Não há decisão pendente.';
                await controller.openPendingEvent();
                return '';
            }),
        },
        {
            name: 'hoi-salvar',
            aliases: ['hoi-save'],
            helpString: 'Salva a campanha nos metadados deste chat.',
            named: [],
            unnamed: [],
            callback: guard(async () => {
                if (!needState()) return NO_CAMPAIGN;
                await controller.save();
                return 'Campanha salva.';
            }),
        },
        {
            name: 'hoi-apagar',
            aliases: ['hoi-reset', 'hoi-delete'],
            helpString: 'Apaga a campanha deste chat (pede confirmação).',
            named: [],
            unnamed: [],
            callback: guard(async () => {
                if (!needState()) return NO_CAMPAIGN;
                await controller.reset();
                return '';
            }),
        },
    ];
}

/**
 * Register command defs with the ST classes taken from the context.
 * @param {any} ctx
 * @param {ReturnType<typeof buildCommandDefs>} defs
 * @returns {string[]} registered command names
 */
export function registerCommandsOn(ctx, defs) {
    const {
        SlashCommandParser,
        SlashCommand,
        SlashCommandArgument,
        SlashCommandNamedArgument,
        SlashCommandEnumValue,
        ARGUMENT_TYPE,
    } = ctx || {};
    if (!SlashCommandParser || !SlashCommand || !SlashCommandArgument || !SlashCommandNamedArgument || !ARGUMENT_TYPE) {
        console.warn('[HOI] slash command API not available');
        return [];
    }
    const toEnum = (provider) => {
        if (typeof provider !== 'function' || typeof SlashCommandEnumValue !== 'function') return undefined;
        return () => {
            try {
                return provider().map((v) => new SlashCommandEnumValue(v.value, v.description || null));
            } catch {
                return [];
            }
        };
    };
    const registered = [];
    for (const def of defs) {
        try {
            const props = {
                name: def.name,
                aliases: def.aliases,
                helpString: def.helpString,
                callback: def.callback,
                namedArgumentList: def.named.map((a) => SlashCommandNamedArgument.fromProps({
                    name: a.name,
                    description: a.description,
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: a.isRequired,
                    enumProvider: toEnum(a.enumProvider),
                    forceEnum: false,
                })),
                unnamedArgumentList: def.unnamed.map((a) => SlashCommandArgument.fromProps({
                    description: a.description,
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: a.isRequired,
                })),
            };
            if (def.returns) props.returns = def.returns;
            SlashCommandParser.addCommandObject(SlashCommand.fromProps(props));
            registered.push(def.name);
        } catch (error) {
            console.warn(`[HOI] failed to register /${def.name}`, error);
        }
    }
    return registered;
}
