/**
 * @file src/game/slashCommands.js
 * Registers the HOI slash commands with SillyTavern's SlashCommandParser.
 *
 * All registration is gated on isLive() so importing this module under node is
 * a safe no-op. Each command is wired to a GameController method and ships a
 * pt-BR helpString. Registration itself is wrapped so a parser-API mismatch in
 * some ST build never crashes extension init.
 *
 *   /hoi          open the HOI panel
 *   /hoi-newgame  start a new game (nation picker)
 *   /hoi-endturn  advance one turn (LLM event + decision)
 *   /hoi-map      open the panel on the map view
 *   /hoi-status   print the current situation report into the chat
 *   /hoi-save     save the current campaign
 *   /hoi-load     load the saved campaign for this chat
 *
 * Command names/helpStrings are pt-BR copy; identifiers/comments are English.
 */

import { getSlashCommandApi, isLive, getContext } from '../core/stContext.js';

/**
 * Register every HOI slash command. No-op unless ST is live.
 *
 * @param {import('./gameLoop.js').createGameController extends (...a:any)=>infer R ? R : any} controller
 *        The assembled GameController (from createGameController).
 * @param {{
 *   log?: (level:'info'|'warn'|'error', ...args:any[]) => void,
 *   postSystem?: (text: string) => (void|Promise<void>),
 * }} [opts]
 * @returns {boolean} true when commands were registered (ST live), else false.
 */
export function registerSlashCommands(controller, opts = {}) {
    if (!isLive()) return false;

    const log =
        typeof opts.log === 'function'
            ? opts.log
            : () => {
                  /* ignore */
              };

    const { SlashCommandParser, SlashCommand } = getSlashCommandApi();
    if (
        !SlashCommandParser ||
        typeof SlashCommandParser.addCommandObject !== 'function' ||
        !SlashCommand ||
        typeof SlashCommand.fromProps !== 'function'
    ) {
        log('warn', 'SlashCommand API unavailable; skipping command registration.');
        return false;
    }

    /** Post a message into the chat via the controller's system-poster. */
    const postSystem =
        typeof opts.postSystem === 'function' ? opts.postSystem : defaultPostSystem;

    /**
     * Wrap a controller action so a thrown error never bubbles into the parser.
     * The callback returns a string (shown in the chat by ST) or empty string.
     * @param {() => (void|Promise<void>)} fn
     * @returns {() => Promise<string>}
     */
    const action = (fn) => async () => {
        try {
            await fn();
        } catch (e) {
            log('error', 'slash command failed:', e);
        }
        return '';
    };

    /** @type {Array<{name:string, aliases?:string[], help:string, cb:()=>Promise<string>}>} */
    const defs = [
        {
            name: 'hoi',
            help: 'Abre o painel do HOI — Grande Estratégia.',
            cb: action(() => controller.openPanel()),
        },
        {
            name: 'hoi-newgame',
            aliases: ['hoi-novojogo'],
            help: 'Inicia um novo jogo: abre o seletor de nação para você assumir a chefia de Estado.',
            cb: action(() => controller.startNewGame()),
        },
        {
            name: 'hoi-endturn',
            aliases: ['hoi-turno'],
            help: 'Avança um turno: processa a manutenção, gera o evento do turno e apresenta suas decisões.',
            cb: action(() => controller.nextTurn()),
        },
        {
            name: 'hoi-map',
            aliases: ['hoi-mapa'],
            help: 'Abre o painel do HOI exibindo o mapa mundial.',
            cb: action(() => controller.openPanel()),
        },
        {
            name: 'hoi-status',
            aliases: ['hoi-situacao'],
            help: 'Imprime o relatório de situação da campanha atual no chat.',
            cb: action(async () => {
                const report = controller.buildSituationReport();
                if (report && report.trim()) {
                    await postSystem(report.trim());
                } else {
                    controller.ui.toast('Nenhuma campanha ativa neste chat. Inicie um Novo Jogo.');
                }
            }),
        },
        {
            name: 'hoi-save',
            aliases: ['hoi-salvar'],
            help: 'Salva a campanha atual nos metadados deste chat.',
            cb: action(() => controller.saveCampaign()),
        },
        {
            name: 'hoi-load',
            aliases: ['hoi-carregar'],
            help: 'Carrega a campanha salva para este chat.',
            cb: action(() => controller.loadCampaign()),
        },
    ];

    let registered = 0;
    for (const def of defs) {
        try {
            SlashCommandParser.addCommandObject(
                SlashCommand.fromProps({
                    name: def.name,
                    aliases: def.aliases || [],
                    callback: def.cb,
                    helpString: def.help,
                    returns: 'string',
                }),
            );
            registered += 1;
        } catch (e) {
            log('warn', `failed to register /${def.name}:`, e);
        }
    }
    log('info', `registered ${registered}/${defs.length} slash commands.`);
    return registered > 0;
}

/**
 * Default "post into chat" implementation: append a system message and refresh
 * the chat view through the ST context. Guarded; silently degrades under node.
 * @param {string} text
 * @returns {Promise<void>}
 */
async function defaultPostSystem(text) {
    try {
        const ctx = getContext();
        if (!ctx) return;
        // Prefer a dedicated helper if the build exposes one.
        if (typeof ctx.sendSystemMessage === 'function') {
            ctx.sendSystemMessage('generic', text);
            return;
        }
        if (Array.isArray(ctx.chat)) {
            ctx.chat.push({
                is_user: false,
                is_system: true,
                name: 'HOI',
                send_date: Date.now(),
                mes: text,
                extra: { hoi: true, type: 'status' },
            });
            if (typeof ctx.addOneMessage === 'function') {
                ctx.addOneMessage(ctx.chat[ctx.chat.length - 1]);
            }
            if (typeof ctx.saveChat === 'function') {
                await ctx.saveChat();
            }
        }
    } catch {
        /* never throw from a slash command */
    }
}

export default registerSlashCommands;
