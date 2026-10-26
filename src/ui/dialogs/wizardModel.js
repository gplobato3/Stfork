/**
 * @file src/ui/dialogs/wizardModel.js
 * Pure helpers behind the new-campaign wizard (search, filters, sorting,
 * bookmark overrides, pt-BR summary). No DOM, node-safe, unit-tested.
 */

import { BLOC_LABELS, formatDate } from '../../contract/presentation.js';
import { RESOURCE_KEYS } from '../../contract/constants.js';
import { PACT_TYPE_LABELS } from './effectPreview.js';

export const DIFFICULTY_ORDER = Object.freeze(['facil', 'normal', 'dificil']);

/** Campaign difficulty (player setting). Texts only claim what DESIGN §3.2 defines. */
export const DIFFICULTY_META = Object.freeze({
    facil: {
        label: 'Fácil',
        icon: 'fa-solid fa-feather',
        text: '+1 de Capital Político por mês. Para conhecer o jogo sem pressa e errar sem grandes custos.',
    },
    normal: {
        label: 'Normal',
        icon: 'fa-solid fa-scale-balanced',
        text: 'A campanha como foi pensada: renda de Capital Político padrão e o mundo reagindo à altura.',
    },
    dificil: {
        label: 'Difícil',
        icon: 'fa-solid fa-skull',
        text: '−1 de Capital Político por mês. Cada ordem precisa valer a pena; erros custam caro.',
    },
});

/** Nation difficulty (how hard the nation is to play), shown in the picker. */
export const NATION_DIFFICULTY_LABELS = Object.freeze({ facil: 'Fácil', normal: 'Moderada', dificil: 'Difícil' });

export const SORT_MODES = Object.freeze([
    { id: 'poder', label: 'Poder' },
    { id: 'nome', label: 'Nome' },
    { id: 'dificuldade', label: 'Dificuldade' },
]);

export const NUCLEAR_LABELS = Object.freeze({
    0: 'Sem armas nucleares',
    1: 'Arsenal nuclear limitado',
    2: 'Arsenal nuclear estratégico',
});

/** Lowercase, accent-free, collapsed whitespace ("Rússia " -> "russia"). */
export function normalizeSearch(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function mergeNation(base, override) {
    if (!override || typeof override !== 'object') return base;
    const merged = { ...base, ...override };
    if (base.resources || override.resources) merged.resources = { ...(base.resources || {}), ...(override.resources || {}) };
    if (base.personality || override.personality) merged.personality = { ...(base.personality || {}), ...(override.personality || {}) };
    return merged;
}

/**
 * The world as it looks at a bookmark: nation overrides are merged (deep for
 * resources/personality), relations merged, and pacts/wars/crises REPLACE the
 * base lists when the bookmark provides them (interfaces.js Bookmark).
 * Never mutates the scenario.
 * @param {import('../../contract/interfaces.js').ScenarioData} scenario
 * @param {?import('../../contract/interfaces.js').Bookmark} bookmark
 */
export function applyBookmark(scenario, bookmark) {
    const s = scenario || {};
    const ov = (bookmark && bookmark.overrides) || {};
    const nations = {};
    const baseNations = s.nations || {};
    const nationOv = ov.nations || {};
    for (const [id, n] of Object.entries(baseNations)) {
        nations[id] = mergeNation({ ...n, id: n.id || id }, nationOv[id]);
    }
    return {
        nations,
        relations: { ...(s.relations || {}), ...(ov.relations || {}) },
        pacts: Array.isArray(ov.pacts) ? ov.pacts : Array.isArray(s.pacts) ? s.pacts : [],
        wars: Array.isArray(ov.wars) ? ov.wars : Array.isArray(s.wars) ? s.wars : [],
        crises: Array.isArray(ov.crises) ? ov.crises : Array.isArray(s.crises) ? s.crises : [],
    };
}

/** Composite 0..100 power used for sorting / the picker (engine has its own ranking). */
export function nationPower(nation) {
    const r = (nation && nation.resources) || {};
    const v = (k) => (Number.isFinite(Number(r[k])) ? Number(r[k]) : 0);
    const raw = v('economy') * 0.25 + v('military') * 0.25 + v('tech') * 0.15 + v('influence') * 0.15
        + v('manpower') * 0.1 + v('stability') * 0.1 + (Number(nation && nation.nuclear) || 0) * 4;
    return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Difficulty of playing a nation (authored, or derived from power). */
export function nationDifficulty(nation) {
    const d = nation && nation.difficulty;
    if (DIFFICULTY_ORDER.includes(d)) return d;
    const p = nationPower(nation);
    return p >= 68 ? 'facil' : p >= 45 ? 'normal' : 'dificil';
}

/**
 * Nations the player may pick in this world. Uses `playable`; legacy data
 * without the flag falls back to every authored nation with resources.
 */
export function playableNations(world) {
    const all = Object.values((world && world.nations) || {}).filter((n) => n && n.status !== 'annexed');
    const flagged = all.filter((n) => n.playable === true);
    return flagged.length ? flagged : all.filter((n) => n.resources && n.playable !== false);
}

/**
 * @param {Object[]} nations
 * @param {{query?: string, bloc?: string, recommended?: string[]}} [opts]
 *   bloc: 'all' | 'recommended' | one of BLOCS
 */
export function filterNations(nations, { query = '', bloc = 'all', recommended = [] } = {}) {
    const q = normalizeSearch(query);
    const rec = new Set(recommended || []);
    return (nations || []).filter((n) => {
        if (bloc === 'recommended') {
            if (!rec.has(n.id)) return false;
        } else if (bloc && bloc !== 'all' && n.bloc !== bloc) {
            return false;
        }
        if (!q) return true;
        const hay = normalizeSearch([
            n.name, n.id, n.capital, n.government, n.leaderTitle, BLOC_LABELS[n.bloc], ...(n.traits || []),
        ].filter(Boolean).join(' | '));
        return q.split(' ').every((tok) => hay.includes(tok));
    });
}

/**
 * Sort a copy. 'poder' = power desc, 'nome' = pt-BR alphabetical,
 * 'dificuldade' = fácil -> difícil (then power desc). Ties by name.
 */
export function sortNations(nations, mode = 'poder') {
    const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'pt-BR', { sensitivity: 'base' });
    const list = [...(nations || [])];
    if (mode === 'nome') return list.sort(byName);
    if (mode === 'dificuldade') {
        return list.sort((a, b) => (DIFFICULTY_ORDER.indexOf(nationDifficulty(a)) - DIFFICULTY_ORDER.indexOf(nationDifficulty(b)))
            || (nationPower(b) - nationPower(a)) || byName(a, b));
    }
    return list.sort((a, b) => (nationPower(b) - nationPower(a)) || byName(a, b));
}

/** Blocs present in a nation list, in BLOCS order of BLOC_LABELS. */
export function blocsIn(nations) {
    const present = new Set((nations || []).map((n) => n.bloc));
    return Object.keys(BLOC_LABELS).filter((b) => present.has(b));
}

/**
 * Pacts, wars and crises of one nation in a bookmark world (detail panel).
 * @returns {{pacts: Array<{id:string, name:string, type:string, typeLabel:string, partners:string[]}>,
 *            wars: Array<{id:string, name:string, side:'attacker'|'defender', enemies:string[], allies:string[]}>,
 *            crises: Array<{id:string, title:string, severity:string}>}}
 */
export function nationDiplomacy(world, nationId) {
    const w = world || {};
    const pacts = (w.pacts || [])
        .filter((p) => p && (p.members || []).includes(nationId))
        .map((p) => ({
            id: p.id,
            name: p.name || PACT_TYPE_LABELS[p.type] || 'Pacto',
            type: p.type,
            typeLabel: PACT_TYPE_LABELS[p.type] || 'Pacto',
            partners: (p.members || []).filter((m) => m !== nationId),
        }));
    const wars = (w.wars || [])
        .filter((x) => x && ((x.attackers || []).includes(nationId) || (x.defenders || []).includes(nationId)))
        .map((x) => {
            const attacker = (x.attackers || []).includes(nationId);
            return {
                id: x.id,
                name: x.name || 'Guerra',
                side: attacker ? 'attacker' : 'defender',
                enemies: attacker ? [...(x.defenders || [])] : [...(x.attackers || [])],
                allies: (attacker ? x.attackers || [] : x.defenders || []).filter((m) => m !== nationId),
            };
        });
    const crises = (w.crises || [])
        .filter((c) => c && (c.involved || []).includes(nationId))
        .map((c) => ({ id: c.id, title: c.title, severity: c.severity }));
    return { pacts, wars, crises };
}

/** Resources in RESOURCE_KEYS order, clamped to 0..100. */
export function resourceRows(nation) {
    const r = (nation && nation.resources) || {};
    return RESOURCE_KEYS.map((k) => ({ key: k, value: Math.max(0, Math.min(100, Math.round(Number(r[k]) || 0))) }));
}

/* ------------------------------------------------------- pt-BR grammar */

// Definite article of country names (pt-BR) for "do Brasil" / "da China" /
// "dos Estados Unidos" / "de Portugal". Keyed by normalized name.
const ARTICLE_O = ['brasil', 'canada', 'reino unido', 'japao', 'ira', 'iraque', 'egito', 'mexico', 'paquistao', 'vietna', 'chile',
    'peru', 'equador', 'uruguai', 'paraguai', 'panama', 'sudao', 'sudao do sul', 'marrocos', 'libano', 'iemen', 'catar', 'qatar',
    'kuwait', 'afeganistao', 'cazaquistao', 'uzbequistao', 'turcomenistao', 'quirguistao', 'tajiquistao', 'azerbaijao', 'nepal',
    'butao', 'camboja', 'laos', 'sri lanka', 'bangladesh', 'congo', 'gabao', 'quenia', 'niger', 'chade', 'mali', 'senegal',
    'togo', 'benim', 'malawi', 'zimbabue', 'oma', 'bahrein', 'barein', 'haiti', 'suriname', 'belize', 'vaticano', 'kosovo',
    'montenegro', 'luxemburgo', 'saara ocidental', 'burundi', 'ruanda', 'lesoto', 'essuatini', 'botsuana', 'turquemenistao'];
const ARTICLE_OS = ['estados unidos', 'emirados arabes unidos', 'paises baixos', 'camaroes'];
const ARTICLE_AS = ['filipinas', 'bahamas', 'ilhas salomao', 'ilhas malvinas', 'ilhas falkland', 'maldivas'];
const NO_ARTICLE = ['israel', 'portugal', 'cuba', 'angola', 'mocambique', 'taiwan', 'singapura', 'cingapura', 'honduras',
    'el salvador', 'madagascar', 'chipre', 'malta', 'monaco', 'andorra', 'san marino', 'timor-leste', 'cabo verde',
    'sao tome e principe', 'mianmar', 'myanmar', 'gana', 'djibuti', 'jibuti', 'fiji', 'vanuatu', 'samoa', 'tonga', 'nauru',
    'palau', 'kiribati', 'tuvalu', 'granada', 'barbados', 'trinidad e tobago', 'dominica', 'santa lucia', 'brunei', 'liechtenstein',
    'hong kong', 'macau', 'aruba', 'curacao', 'porto rico', 'groenlandia', 'belarus'];

/** Definite article for a pt-BR country name: 'o' | 'a' | 'os' | 'as' | ''. */
export function countryArticle(name) {
    const n = normalizeSearch(name);
    if (!n) return '';
    if (NO_ARTICLE.includes(n)) return '';
    if (ARTICLE_OS.includes(n) || /^(estados|emirados|paises) /.test(n)) return 'os';
    if (ARTICLE_AS.includes(n) || /^ilhas /.test(n)) return 'as';
    if (ARTICLE_O.includes(n)) return 'o';
    if (/^(republica|federacao|uniao|coreia|guine|africa|arabia|nova |costa |macedonia|bosnia|papua|guiana)/.test(n)) return 'a';
    if (/a$/.test(n)) return 'a';
    if (/(ao|ão)$/.test(n)) return 'o';
    return '';
}

/** "do Brasil", "da China", "dos Estados Unidos", "de Portugal". */
export function ofCountry(name) {
    const art = countryArticle(name);
    const prep = { o: 'do', a: 'da', os: 'dos', as: 'das' }[art] || 'de';
    return `${prep} ${name}`;
}

/**
 * Summary line of step 3:
 * "Você será Presidente Ana Souza do Brasil em Janeiro de 2026."
 */
export function summaryLine({ leaderTitle, leaderName, nationName, date }) {
    const who = [leaderTitle, leaderName].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
    const where = nationName ? ` ${ofCountry(nationName)}` : '';
    const when = date ? ` em ${formatDate(date)}` : '';
    return `Você será ${who || 'Governante'}${where}${when}.`;
}

/** Max ruler name length accepted by the wizard. */
export const LEADER_NAME_MAX = 48;

/** Trim / collapse whitespace / cap length of the ruler name ('' when blank). */
export function cleanLeaderName(name) {
    return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, LEADER_NAME_MAX);
}
