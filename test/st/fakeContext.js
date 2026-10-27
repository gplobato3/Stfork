/**
 * Fake SillyTavern context for tests. Every function mirrors the EXACT
 * signature of SillyTavern 1.19.0 (cited per member) and, where it matters,
 * its observable behaviour (e.g. generateRaw returns '{}' for Text Completion
 * when jsonSchema is passed, script.js:6311-6365).
 *
 * Install with installFakeSillyTavern(ctx): sets globalThis.SillyTavern =
 * { getContext, libs } like script.js:293. getContext() returns the same
 * object, but tests may swap ctx.chatMetadata / ctx.chat to emulate a chat
 * change (st-context.js:115 re-reads the bindings on every call).
 */

/** ST: public/scripts/slash-commands/SlashCommandArgument.js:10 */
export const ARGUMENT_TYPE = {
    STRING: 'string',
    NUMBER: 'number',
    RANGE: 'range',
    BOOLEAN: 'bool',
    VARIABLE_NAME: 'varname',
    CLOSURE: 'closure',
    SUBCOMMAND: 'subcommand',
    LIST: 'list',
    DICTIONARY: 'dictionary',
};

/** ST: public/scripts/slash-commands/SlashCommand.js:44-59 */
export class FakeSlashCommand {
    static fromProps(props) {
        return Object.assign(new this(), props);
    }
    name;
    callback;
    helpString;
    splitUnnamedArgument = false;
    rawQuotes = false;
    aliases = [];
    returns;
    namedArgumentList = [];
    unnamedArgumentList = [];
}

/** ST: public/scripts/slash-commands/SlashCommandArgument.js:22-46, :64 */
export class FakeSlashCommandArgument {
    static fromProps(props) {
        return new FakeSlashCommandArgument(
            props.description,
            props.typeList ?? [ARGUMENT_TYPE.STRING],
            props.isRequired ?? false,
            props.acceptsMultiple ?? false,
            props.defaultValue ?? null,
            props.enumList ?? [],
            props.enumProvider ?? null,
            props.forceEnum ?? false,
        );
    }
    constructor(description, types, isRequired = false, acceptsMultiple = false, defaultValue = null, enums = [], enumProvider = null, forceEnum = false) {
        this.description = description;
        this.typeList = types ? Array.isArray(types) ? types : [types] : [];
        this.isRequired = !!isRequired;
        this.acceptsMultiple = !!acceptsMultiple;
        this.defaultValue = defaultValue;
        this.enumList = enums;
        this.enumProvider = enumProvider;
        this.forceEnum = forceEnum;
    }
}

/** ST: public/scripts/slash-commands/SlashCommandArgument.js:97-127 */
export class FakeSlashCommandNamedArgument extends FakeSlashCommandArgument {
    static fromProps(props) {
        return new FakeSlashCommandNamedArgument(
            props.name,
            props.description,
            props.typeList ?? [ARGUMENT_TYPE.STRING],
            props.isRequired ?? false,
            props.acceptsMultiple ?? false,
            props.defaultValue ?? null,
            props.enumList ?? [],
            props.aliasList ?? [],
            props.enumProvider ?? null,
            props.forceEnum ?? false,
        );
    }
    constructor(name, description, types, isRequired = false, acceptsMultiple = false, defaultValue = null, enums = [], aliases = [], enumProvider = null, forceEnum = false) {
        super(description, types, isRequired, acceptsMultiple, defaultValue, enums, enumProvider, forceEnum);
        this.name = name;
        this.aliasList = aliases;
    }
}

/** ST: public/scripts/slash-commands/SlashCommandEnumValue.js:62 */
export class FakeSlashCommandEnumValue {
    constructor(value, description = null, type = 'enum', typeIcon = '◊', matchProvider = null, valueProvider = null, makeSelectable = false) {
        this.value = value;
        this.description = description;
        this.type = type;
        this.typeIcon = typeIcon;
    }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.mainApi] 'openai' (Chat Completion) or 'textgenerationwebui' (Text Completion)
 */
export function createFakeContext(opts = {}) {
    const calls = {
        setExtensionPrompt: [],
        generateRaw: [],
        generateQuietPrompt: [],
        addOneMessage: [],
        saveChat: 0,
        saveMetadata: 0,
        saveMetadataDebounced: 0,
        saveSettingsDebounced: 0,
        emit: [],
        macrosRegister: [],
        registerMacro: [],
        commands: [],
        getCharacters: 0,
        sendRequest: [],
        getRequestHeaders: [],
    };
    const listeners = new Map();
    /** Test hooks: what the fake backends answer. */
    const responders = {
        // Receives the model-facing request; returns the model's text.
        model: async () => '{"ok":true}',
        quiet: async () => 'Boletim de teste.',
    };

    const ctx = {
        calls,
        responders,
        chat: [],
        chatMetadata: {},
        chatId: 'chat-1',
        name1: 'Gabriel',
        name2: 'Conselho de Guerra',
        characters: [],
        mainApi: opts.mainApi ?? 'openai',
        extensionPrompts: {},
        extensionSettings: {
            disabledExtensions: [],
            connectionManager: { profiles: [], selectedProfile: null },
        },
        powerUserSettings: { experimental_macro_engine: true },

        /** ST: public/script.js (getCurrentChatId), exposed in st-context.js */
        getCurrentChatId() {
            return ctx.chatId;
        },

        /** ST: public/script.js:8926 */
        setExtensionPrompt(key, value, position, depth, scan = false, role = 0, filter = null) {
            calls.setExtensionPrompt.push({ key, value, position, depth, scan, role, filter });
            ctx.extensionPrompts[key] = { value: String(value), position: Number(position), depth: Number(depth), scan: !!scan, role: Number(role ?? 0), filter };
        },

        /** ST: public/script.js:4122 (+ :4102 / :6311-6365 JSON extraction) */
        async generateRaw({ prompt = '', api = null, instructOverride = false, quietToLoud = false, systemPrompt = '', responseLength = null, trimNames = true, prefill = '', jsonSchema = null } = {}) {
            calls.generateRaw.push({ prompt, api, instructOverride, quietToLoud, systemPrompt, responseLength, trimNames, prefill, jsonSchema });
            const text = await responders.model({ via: 'generateRaw', prompt, systemPrompt, prefill, jsonSchema });
            if (jsonSchema) {
                if ((api ?? ctx.mainApi) !== 'openai') return JSON.stringify({}); // script.js:6365
                try {
                    return JSON.stringify(JSON.parse(text));
                } catch {
                    return jsonSchema.returnInvalid ? text : '{}';
                }
            }
            if (!text) throw new Error('No message generated'); // script.js:4147
            return text;
        },

        /** ST: public/script.js:3084 */
        async generateQuietPrompt({ quietPrompt = '', quietToLoud = false, skipWIAN = false, quietImage = null, quietName = null, responseLength = null, forceChId = null, jsonSchema = null, removeReasoning = true, trimToSentence = false } = {}) {
            calls.generateQuietPrompt.push({ quietPrompt, quietToLoud, skipWIAN, quietImage, quietName, responseLength, forceChId, jsonSchema, removeReasoning, trimToSentence });
            return responders.quiet({ quietPrompt });
        },

        /** ST: public/script.js:2551 */
        addOneMessage(mes, { type = undefined, insertAfter = null, scroll = true, insertBefore = null, forceId = null, showSwipes = true } = {}) {
            calls.addOneMessage.push({ mes, type, insertAfter, scroll, insertBefore, forceId, showSwipes });
        },

        /** ST: st-context.js `saveChat: saveChatConditional` (script.js:9412, no arguments) */
        async saveChat() {
            calls.saveChat++;
        },

        /** ST: public/script.js:9408 */
        async saveMetadata() {
            calls.saveMetadata++;
        },

        /** ST: public/scripts/extensions.js:89 */
        saveMetadataDebounced() {
            calls.saveMetadataDebounced++;
        },

        /** ST: public/script.js:470 */
        saveSettingsDebounced() {
            calls.saveSettingsDebounced++;
        },

        /** ST: public/lib/eventemitter.js:43 on, :114 removeListener, emit (async) */
        eventSource: {
            on(event, listener) {
                if (!listeners.has(event)) listeners.set(event, []);
                listeners.get(event).push(listener);
            },
            removeListener(event, listener) {
                const list = listeners.get(event) || [];
                const i = list.indexOf(listener);
                if (i >= 0) list.splice(i, 1);
            },
            async emit(event, ...args) {
                calls.emit.push({ event, args });
                for (const l of [...(listeners.get(event) || [])]) await l(...args);
            },
            listenerCount(event) {
                return (listeners.get(event) || []).length;
            },
        },

        /** ST: public/scripts/events.js:3 */
        eventTypes: {
            APP_READY: 'app_ready',
            MESSAGE_SENT: 'message_sent',
            MESSAGE_RECEIVED: 'message_received',
            USER_MESSAGE_RENDERED: 'user_message_rendered',
            CHAT_CHANGED: 'chat_id_changed',
        },

        /** ST: public/script.js:647 */
        getRequestHeaders({ omitContentType = false } = {}) {
            calls.getRequestHeaders.push({ omitContentType });
            const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': 'tok' };
            if (omitContentType) delete headers['Content-Type'];
            return headers;
        },

        /** ST: public/script.js:1294 */
        async getCharacters() {
            calls.getCharacters++;
        },

        /** ST: public/scripts/macros/macro-system.js:44-60 */
        macros: {
            category: { MISC: 'misc', UTILITY: 'utility' },
            registry: new Map(),
            register(name, options) {
                calls.macrosRegister.push({ name, options });
                if (typeof options?.handler !== 'function') throw new Error(`Macro "${name}" options.handler must be a function.`); // MacroRegistry.js:505
                ctx.macros.registry.set(name, options);
                return { name, ...options };
            },
        },

        /** ST: public/scripts/macros.js:183 MacrosParser.registerMacro(key, value, description = '') */
        registerMacro(key, value, description = '') {
            calls.registerMacro.push({ key, value, description });
        },

        /** ST: public/scripts/slash-commands/SlashCommandParser.js:65 */
        SlashCommandParser: {
            commands: {},
            addCommandObject(command) {
                calls.commands.push(command);
                ctx.SlashCommandParser.commands[command.name] = command;
                for (const a of command.aliases ?? []) ctx.SlashCommandParser.commands[a] = command;
            },
        },
        SlashCommand: FakeSlashCommand,
        SlashCommandArgument: FakeSlashCommandArgument,
        SlashCommandNamedArgument: FakeSlashCommandNamedArgument,
        SlashCommandEnumValue: FakeSlashCommandEnumValue,
        ARGUMENT_TYPE,

        /** ST: public/scripts/slash-commands.js:142 CONNECT_API_MAP (subset) */
        CONNECT_API_MAP: {
            openai: { selected: 'openai', source: 'openai' },
            claude: { selected: 'openai', source: 'claude' },
            koboldcpp: { selected: 'textgenerationwebui', type: 'koboldcpp' },
        },

        /** ST: public/scripts/extensions/shared.js:392-528 */
        ConnectionManagerRequestService: {
            defaultSendRequestParams: { stream: false, signal: null, extractData: true, includePreset: true, includeInstruct: true, instructSettings: {} },
            async sendRequest(profileId, prompt, maxTokens, custom = { stream: false, extractData: true, includePreset: true }, overridePayload = {}) {
                calls.sendRequest.push({ profileId, prompt, maxTokens, custom, overridePayload });
                if (ctx.extensionSettings.disabledExtensions.includes('connection-manager')) throw new Error('Connection Manager is not available');
                const profile = ctx.extensionSettings.connectionManager.profiles.find((p) => p.id === profileId);
                if (!profile) throw new Error(`Profile not found (ID: ${profileId})`);
                const map = ctx.CONNECT_API_MAP[profile.api];
                const text = await responders.model({ via: 'sendRequest', prompt, overridePayload });
                if (map.selected === 'openai' && overridePayload.json_schema) {
                    // custom-request.js:490-491 content = JSON.parse(extractJsonFromData(...)) — {} when invalid
                    let content = {};
                    try {
                        content = JSON.parse(text);
                    } catch {
                        content = {};
                    }
                    return { content, reasoning: '' };
                }
                return { content: text, reasoning: '' };
            },
            isProfileSupported(profile) {
                if (!profile || !profile.api) return false;
                const apiMap = ctx.CONNECT_API_MAP[profile.api];
                return apiMap.selected === 'openai' ? !!apiMap.source : !!apiMap.type; // throws on unknown api, like shared.js:584
            },
        },
    };
    return ctx;
}

/** Install `globalThis.SillyTavern` (script.js:293). Returns an uninstall function. */
export function installFakeSillyTavern(ctx) {
    const previous = globalThis.SillyTavern;
    globalThis.SillyTavern = { getContext: () => ctx, libs: { seedrandom: null } };
    return () => {
        if (previous === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previous;
    };
}
