/**
 * @file src/contract/events.js
 * Effect / Option / GameEvent / ActionDef / TurnReport shapes (JSDoc only).
 * Node-safe, no runtime behaviour.
 *
 * EFFECT SHAPES (one per `type`; unknown fields are ignored by the engine).
 * Target fields accept a nation id or a PLACEHOLDER ('SELF' | 'TARGET' | 'PLAYER').
 *
 *   resource  { type, target, resource: ResourceKey, delta }            |delta| <= EFFECT_LIMITS.resource
 *   relation  { type, target, targetB, delta }                          |delta| <= EFFECT_LIMITS.relation
 *   tension   { type, delta }                                           |delta| <= EFFECT_LIMITS.tension
 *   pc        { type, target, delta }                                   political capital
 *   modifier  { type, target, label, perTurn: Partial<Resources>, turns }
 *   crisis    { type, action: 'start', title, description, severity, involved: string[], category? }
 *             { type, action: 'escalate'|'deescalate'|'resolve', crisisId }
 *   pact      { type, action: 'create', pactType, target, targetB, label? }
 *             { type, action: 'break',  pactType, target, targetB }
 *   war       { type, action: 'declare', target (attacker), targetB (defender), label? }
 *             { type, action: 'ceasefire'|'peace', target, targetB, terms?: PEACE_TERMS (peace only) }
 *   front     { type, target (attacker), targetB (defender), delta }   occupation progress change
 *   bloc      { type, target, bloc }
 *   flag      { type, key, value }
 *   news      { type, text }                                            pt-BR headline
 *
 * Every effect may carry `note` (pt-BR) which the engine may log.
 */

/**
 * @typedef {Object} Effect
 * @property {string} type
 * @property {string} [target]
 * @property {string} [targetB]
 * @property {string} [resource]
 * @property {number} [delta]
 * @property {string} [action]
 * @property {string} [pactType]
 * @property {string} [terms]
 * @property {string} [bloc]
 * @property {string} [crisisId]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [severity]
 * @property {string[]} [involved]
 * @property {string} [category]
 * @property {string} [label]
 * @property {Object<string, number>} [perTurn]
 * @property {number} [turns]
 * @property {string} [key]
 * @property {*} [value]
 * @property {string} [text]
 * @property {string} [note]
 */

/**
 * @typedef {Object} Option
 * @property {string} label          pt-BR button text (<= ~60 chars).
 * @property {string} rationale      pt-BR one-line consequence hint.
 * @property {Effect[]} effects
 * @property {string} [aiHint]       Optional internal note (never shown).
 */

/**
 * A decision presented to the player. Produced by the LLM (source 'llm'),
 * by the engine (source 'engine': calls to arms, peace offers, capitulation
 * terms) or locally when the LLM fails (source 'fallback').
 * @typedef {Object} GameEvent
 * @property {string} id
 * @property {'llm'|'engine'|'fallback'} source
 * @property {string} category       One of EVENT_CATEGORIES.
 * @property {string} title          pt-BR
 * @property {string} narrative      pt-BR, 60-180 words.
 * @property {string[]} [headlines]  pt-BR world news lines (0-3), shown under the narrative.
 * @property {string[]} [involved]   Nation ids (map highlight).
 * @property {Option[]} options      OPTION_COUNT.MIN..MAX
 * @property {number} turn           Turn the event was generated for.
 */

/**
 * Success-chance formula inputs. chance = clamp(base + sum(stat * weight) + relationWeight * relation, 5, 95)
 * where stats are the ACTOR's resources (0..100) and relation is actor<->target (-100..100).
 * @typedef {Object} ChanceSpec
 * @property {number} base                  0..100
 * @property {Partial<Record<string, number>>} [stats]   resourceKey -> weight (e.g. { influence: 0.3 })
 * @property {number} [relationWeight]      e.g. 0.2
 * @property {Partial<Record<string, number>>} [targetStats] TARGET resourceKey -> weight (usually negative)
 */

/**
 * Declarative requirement checked by engine.getAvailableActions(). All present
 * keys must hold. Reason strings are produced by the engine in pt-BR.
 * @typedef {Object} Requirement
 * @property {number} [minRelation]       actor<->target relation >= n
 * @property {number} [maxRelation]       actor<->target relation <= n
 * @property {boolean} [atWarWithTarget]
 * @property {boolean} [notAtWarWithTarget]
 * @property {boolean} [atWar]            actor is in any war
 * @property {boolean} [targetNeighborOrMajor]  target is a map neighbor, or actor is a major power (power projection)
 * @property {boolean} [alliedWithTarget]
 * @property {boolean} [notAlliedWithTarget]
 * @property {boolean} [nuclear]          actor.nuclear > 0
 * @property {boolean} [notNuclear]
 * @property {Partial<Record<string, number>>} [minResources]  actor resource >= n
 * @property {number} [maxTension]
 * @property {number} [minTension]
 * @property {boolean} [targetActive]     target.status === 'active' (default true for targeted actions)
 */

/**
 * One entry of the action catalog (src/engine/catalog.js). Effects use
 * placeholders SELF / TARGET.
 * @typedef {Object} ActionDef
 * @property {string} id                 snake_case, stable ('dip_improve_relations').
 * @property {string} category           One of ACTION_CATEGORIES.
 * @property {string} name               pt-BR
 * @property {string} description        pt-BR one sentence.
 * @property {string} icon               Font Awesome class ('fa-solid fa-handshake').
 * @property {'none'|'nation'} target    'nation' = needs a target nation (not self).
 * @property {{pc:number, resources?: Partial<Record<string, number>>}} cost  resources are POSITIVE amounts spent.
 * @property {number} cooldown           Turns before the same actor can repeat it.
 * @property {Requirement} [requires]
 * @property {ChanceSpec|null} chance    null = always succeeds.
 * @property {Effect[]} onSuccess
 * @property {Effect[]} [onFailure]
 * @property {string[]} [keywords]       pt-BR synonyms used by the orders arbiter ("mobilizar", "tropas").
 * @property {boolean} [playerOnly]      AI never uses it.
 * @property {boolean} [confirm]         UI asks for confirmation (war, nukes...).
 */

/**
 * Availability of one action for one actor/target pair (engine.getAvailableActions).
 * @typedef {Object} ActionAvailability
 * @property {ActionDef} def
 * @property {boolean} available
 * @property {string[]} reasons          pt-BR reasons when unavailable (empty when available).
 * @property {number} chance             0..100 (100 when def.chance is null).
 * @property {number} cooldownLeft       Turns left (0 = ready).
 */

/**
 * @typedef {Object} ActionResult
 * @property {boolean} ok                false = rejected (unavailable / unknown); state unchanged.
 * @property {boolean} success           Dice outcome (meaningless when ok === false).
 * @property {string} actionId
 * @property {?string} targetId
 * @property {string} summary            pt-BR one-liner for toasts / sitrep.
 * @property {string[]} details          pt-BR effect lines ("Economia −3", "Relação com China +10").
 * @property {string[]} [reasons]        pt-BR rejection reasons when ok === false.
 */

/**
 * Deterministic outcome of engine.endTurn(). Everything pt-BR.
 * @typedef {Object} TurnReport
 * @property {number} turn                       The NEW turn number.
 * @property {{year:number, month:number}} date  The NEW date.
 * @property {number} pcGained
 * @property {Partial<Record<string, number>>} playerDeltas  Player resource changes this upkeep.
 * @property {number} tensionBefore
 * @property {number} tensionAfter
 * @property {Array<{actorId:string, actionId:string, targetId:?string, success:boolean, summary:string}>} aiActions
 * @property {Array<{warId:string, summary:string}>} warUpdates
 * @property {string[]} capitulations            Nation ids that capitulated this turn.
 * @property {string[]} newCrises                Crisis ids.
 * @property {string[]} resolvedCrises           Crisis titles.
 * @property {string[]} headlines                Deterministic pt-BR news lines (also pushed into state.news).
 * @property {GameEvent[]} engineEvents          Decisions the engine needs from the player (also pushed into state.eventQueue).
 * @property {?{kind:'victory'|'defeat', reason:string}} outcome
 */

export {};
