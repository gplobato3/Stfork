/**
 * @file src/st/generation.js
 * Structured / quiet generation through SillyTavern. Takes a context object so
 * it can be unit-tested with a fake one.
 *
 * Verified against SillyTavern 1.19.0:
 * - ST: public/script.js:4122 generateRaw({ prompt, api, instructOverride, quietToLoud,
 *   systemPrompt, responseLength, trimNames, prefill, jsonSchema }) -> string.
 * - ST: public/script.js:4261 JsonSchema typedef = { name, value, description?, strict?, returnInvalid? }.
 *   The server reads json_schema.name / .value / .description / .strict
 *   (src/endpoints/backends/chat-completions.js:303-318 Claude tool, :917-924 OpenAI).
 * - ST: public/script.js:4102 + :6311-6365 extractJsonFromData(): only main_api 'openai'
 *   is handled; for every Text Completion API it returns JSON.stringify({}) = '{}',
 *   discarding the model output. So jsonSchema is passed ONLY when
 *   ctx.mainApi === 'openai'; Text Completion relies on prompt + prefill + parsing.
 * - ST: public/script.js:3970-3975 createRawPrompt(): for Text Completion the
 *   prefill is appended after the assistant turn and is NOT part of the output.
 * - ST: public/scripts/extensions/shared.js:423 ConnectionManagerRequestService.sendRequest(
 *   profileId, prompt, maxTokens, custom, overridePayload). For Chat Completion
 *   profiles overridePayload is spread into the ChatCompletionService request
 *   (shared.js:460), survives presetToGeneratePayload (custom-request.js:605) and
 *   with `json_schema` the result content is ALREADY PARSED:
 *   `result.content = JSON.parse(extractJsonFromData(...))` (custom-request.js:490-491),
 *   i.e. an object, `{}` when extraction failed. For Text Completion profiles
 *   (shared.js:478) the server ignores json_schema
 *   (src/endpoints/backends/text-completions.js has no json_schema handling), so
 *   none is sent. Messages may be an array of {role, content}; TC profiles format
 *   them with the profile's instruct template (custom-request.js:298-307).
 * - ST: public/scripts/extensions/shared.js:402 allowed profile types: 'openai',
 *   'textgenerationwebui'; CONNECT_API_MAP is on the context (st-context.js, shared.js:614).
 * - ST: public/script.js:3084 generateQuietPrompt({ quietPrompt, quietToLoud, skipWIAN,
 *   quietImage, quietName, responseLength, forceChId, jsonSchema, removeReasoning,
 *   trimToSentence }) -> Promise<string>; runs Generate('quiet', ...) (script.js:3108)
 *   with the user's preset, character and extension prompts.
 */

import { parseJsonLoose, isEmptyObject, stripReasoning } from './json.js';

/**
 * ST JsonSchema wrapper (script.js:4261). `strict:false` because the portable
 * schemas do not list every property as required.
 * @param {string} schemaName
 * @param {object} schema
 * @returns {{name:string, description:string, strict:boolean, value:object, returnInvalid:boolean}}
 */
export function buildJsonSchemaWrapper(schemaName, schema) {
    const name = String(schemaName || 'hoi_output').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'hoi_output';
    const description = (schema && typeof schema.description === 'string' && schema.description) || `HOI structured output: ${name}`;
    return { name, description, strict: false, value: schema, returnInvalid: true };
}

/**
 * Connection profile by id, when Connection Manager is enabled.
 * ST: public/scripts/extensions/shared.js:427 sendRequest throws when 'connection-manager' is disabled.
 * @param {any} ctx
 * @param {string} profileId
 * @returns {?object}
 */
export function findProfile(ctx, profileId) {
    if (!profileId || !ctx?.extensionSettings) return null;
    const disabled = ctx.extensionSettings.disabledExtensions;
    if (Array.isArray(disabled) && disabled.includes('connection-manager')) return null;
    const profiles = ctx.extensionSettings.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return null;
    return profiles.find((p) => p && p.id === profileId) || null;
}

/**
 * Profiles usable by ConnectionManagerRequestService (Chat or Text Completion).
 * @param {any} ctx
 * @returns {Array<{id:string, name:string}>}
 */
export function listProfiles(ctx) {
    const settings = ctx?.extensionSettings;
    if (!settings) return [];
    if (Array.isArray(settings.disabledExtensions) && settings.disabledExtensions.includes('connection-manager')) return [];
    const profiles = settings.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    const svc = ctx.ConnectionManagerRequestService;
    return profiles
        .filter((p) => {
            if (!p || !p.id) return false;
            if (!svc || typeof svc.isProfileSupported !== 'function') return true;
            try {
                // ST: shared.js:579 (reads CONNECT_API_MAP[profile.api].selected; throws on unknown api)
                return svc.isProfileSupported(p);
            } catch {
                return false;
            }
        })
        .map((p) => ({ id: String(p.id), name: String(p.name || p.id) }));
}

function toRaw(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value ?? '');
    } catch {
        return String(value);
    }
}

/**
 * Parse whatever ST returned. `prefilled` = the request used prefill '{'
 * (Text Completion), so the output may lack the opening brace.
 */
function interpret(output, { prefilled }) {
    const raw = toRaw(output);
    let parsed = { ok: false, error: '' };
    if (prefilled && typeof output === 'string') {
        // The model continued after "{": restore it BEFORE loose parsing, which
        // would otherwise pick a nested object (e.g. the first effect).
        const body = stripReasoning(output).trim();
        if (body && !/^[{[`]/.test(body)) parsed = parseJsonLoose(`{${body}`);
    }
    if (!parsed.ok) parsed = parseJsonLoose(output);
    if (!parsed.ok) return { ok: false, raw, error: parsed.error };
    if (isEmptyObject(parsed.value)) {
        return { ok: false, raw, error: 'O modelo devolveu um objeto vazio (saída estruturada não suportada ou recusada).' };
    }
    return { ok: true, value: parsed.value, raw };
}

/**
 * @param {any} ctx Fresh ST context.
 * @param {{engineProfileId?: string}} settings
 * @param {{systemPrompt: string, prompt: string, schemaName: string, schema?: ?object, maxTokens?: number}} req
 *        `schema: null` = do not request structured output (prompt-only, used by repair retries).
 * @returns {Promise<{ok: boolean, value?: any, raw?: string, error?: string}>}
 */
export async function generateStructuredWith(ctx, settings, req) {
    if (!ctx) return { ok: false, error: 'SillyTavern indisponível.' };
    const systemPrompt = String(req.systemPrompt || '');
    const prompt = String(req.prompt || '');
    const maxTokens = Number.isFinite(Number(req.maxTokens)) && Number(req.maxTokens) > 0 ? Math.round(Number(req.maxTokens)) : 1000;
    const schema = req.schema && typeof req.schema === 'object' ? req.schema : null;
    const wrapper = schema ? buildJsonSchemaWrapper(req.schemaName, schema) : null;

    try {
        const profile = findProfile(ctx, settings?.engineProfileId);
        const svc = ctx.ConnectionManagerRequestService;
        if (profile && svc && typeof svc.sendRequest === 'function') {
            const apiMap = ctx.CONNECT_API_MAP?.[profile.api];
            const isChat = apiMap?.selected === 'openai';
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
            ];
            const overridePayload = isChat && wrapper ? { json_schema: wrapper } : {};
            const response = await svc.sendRequest(
                profile.id,
                messages,
                maxTokens,
                { stream: false, extractData: true, includePreset: true, includeInstruct: true },
                overridePayload,
            );
            const content = response && typeof response === 'object' && 'content' in response ? response.content : response;
            return interpret(content, { prefilled: false });
        }

        const isChat = ctx.mainApi === 'openai';
        if (typeof ctx.generateRaw !== 'function') return { ok: false, error: 'generateRaw indisponível.' };
        /** @type {Record<string, any>} */
        const params = { systemPrompt, prompt, responseLength: maxTokens };
        if (isChat && wrapper) params.jsonSchema = wrapper;
        if (!isChat) params.prefill = '{';
        const output = await ctx.generateRaw(params);
        return interpret(output, { prefilled: !isChat });
    } catch (error) {
        const cause = error?.cause?.message ? ` (${error.cause.message})` : '';
        return { ok: false, error: `${error?.message || String(error)}${cause}` };
    }
}

/**
 * @param {any} ctx
 * @param {string} quietPrompt
 * @returns {Promise<string>} '' on failure.
 */
export async function generateQuietWith(ctx, quietPrompt) {
    if (!ctx || typeof ctx.generateQuietPrompt !== 'function') return '';
    try {
        const out = await ctx.generateQuietPrompt({ quietPrompt: String(quietPrompt || ''), removeReasoning: true });
        return typeof out === 'string' ? out : '';
    } catch (error) {
        console.warn('[HOI] generateQuietPrompt failed', error);
        return '';
    }
}
