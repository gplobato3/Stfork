/**
 * @file src/llm/schemas.js
 * JSON schemas for structured LLM output, restricted to the portable subset
 * every ST backend accepts (OpenAI json_schema, Claude tool input_schema,
 * Gemini responseSchema — see chat-completions.js:303-318, :500, :917-924):
 * type, properties, required, enum, items, description. No oneOf / anyOf /
 * additionalProperties / min / max.
 *
 * Text Completion backends do not enforce schemas, so the prompts in
 * prompts.js also spell out the format with a compact example.
 */

import {
    EVENT_CATEGORIES,
    EFFECT_TYPES,
    RESOURCE_KEYS,
    CRISIS_SEVERITIES,
    CRISIS_ACTIONS,
    WAR_ACTIONS,
    PEACE_TERMS,
    PACT_TYPES,
    PACT_ACTIONS,
    BLOCS,
} from '../contract/constants.js';

const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const strEnum = (values, description) => ({ type: 'string', enum: [...values], description });

const perTurnProperties = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, int(`${k} change per month`)]));

export const EFFECT_SCHEMA = Object.freeze({
    type: 'object',
    description: 'One game effect. Only the fields relevant to its type are needed.',
    properties: {
        type: strEnum(EFFECT_TYPES, 'Effect type'),
        target: str('Nation id or PLAYER'),
        targetB: str('Second nation id (relation, pact, war, front)'),
        resource: strEnum(RESOURCE_KEYS, 'Resource for type=resource'),
        delta: int('Signed change'),
        action: str('Sub-action for crisis/pact/war'),
        pactType: strEnum(PACT_TYPES, 'Pact type for type=pact'),
        terms: strEnum(PEACE_TERMS, 'Peace terms for war peace'),
        bloc: strEnum(BLOCS, 'Bloc for type=bloc'),
        crisisId: str('Existing crisis id for escalate/deescalate/resolve'),
        title: str('pt-BR crisis title for crisis start'),
        description: str('pt-BR crisis description for crisis start'),
        severity: strEnum(CRISIS_SEVERITIES, 'Crisis severity'),
        involved: { type: 'array', items: { type: 'string' }, description: 'Nation ids involved in a new crisis' },
        category: strEnum(EVENT_CATEGORIES, 'Crisis category'),
        label: str('pt-BR label for modifier/pact/war'),
        perTurn: { type: 'object', properties: perTurnProperties, description: 'Monthly resource change for type=modifier' },
        turns: int('Duration in months for type=modifier'),
        key: str('Flag key for type=flag'),
        value: str('Flag value for type=flag'),
        text: str('pt-BR headline for type=news'),
        note: str('Optional pt-BR note'),
    },
    required: ['type'],
});

export const EVENT_SCHEMA = Object.freeze({
    type: 'object',
    description: 'A monthly decision event for the player (all text in Brazilian Portuguese).',
    properties: {
        category: strEnum(EVENT_CATEGORIES, 'Event category'),
        title: str('pt-BR title, max ~70 characters'),
        narrative: str('pt-BR narrative, 60-180 words'),
        headlines: { type: 'array', items: { type: 'string' }, description: '0-3 pt-BR world news lines' },
        involved: { type: 'array', items: { type: 'string' }, description: 'Nation ids involved' },
        options: {
            type: 'array',
            description: '2-4 options',
            items: {
                type: 'object',
                properties: {
                    label: str('pt-BR button text, max ~60 characters'),
                    rationale: str('pt-BR one-line consequence hint'),
                    effects: { type: 'array', items: EFFECT_SCHEMA, description: '1-4 effects' },
                },
                required: ['label', 'rationale', 'effects'],
            },
        },
    },
    required: ['category', 'title', 'narrative', 'options'],
});

export const ORDERS_SCHEMA = Object.freeze({
    type: 'object',
    description: 'Catalog actions ordered by the player in a chat message (empty list when none).',
    properties: {
        orders: {
            type: 'array',
            description: 'At most 3 orders',
            items: {
                type: 'object',
                properties: {
                    actionId: str('Action id from the catalog'),
                    targetId: str('Target nation id, or empty string when the action has no target'),
                    quote: str('Exact fragment of the message that contains the order'),
                },
                required: ['actionId', 'targetId', 'quote'],
            },
        },
    },
    required: ['orders'],
});

/** Small re-export so prompts can list the sub-action vocabulary. */
export const SUB_ACTIONS = Object.freeze({
    crisis: CRISIS_ACTIONS,
    war: WAR_ACTIONS,
    pact: PACT_ACTIONS,
});
