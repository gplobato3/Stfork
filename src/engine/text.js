/**
 * @file src/engine/text.js
 * pt-BR grammar helpers for deterministic headlines: definite articles and their
 * contractions with prepositions ("à Ucrânia", "do Brasil", "nos Estados Unidos",
 * "com Israel") plus verb agreement for plural country names.
 *
 * Nation objects carry no grammatical metadata, so the article is inferred from the
 * pt-BR name with a small exception table. Headlines start with the bare name
 * (journalistic register: "Rússia declara guerra à Ucrânia").
 */

const NO_ARTICLE = new Set([
    'israel', 'portugal', 'cuba', 'taiwan', 'angola', 'moçambique', 'singapura', 'mônaco',
    'malta', 'chipre', 'cabo verde', 'são tomé e príncipe', 'omã', 'madagascar', 'honduras',
    'gana', 'granada', 'andorra', 'san marino', 'djibuti', 'timor-leste', 'uganda', 'ruanda',
    'el salvador', 'belize', 'trinidad e tobago', 'antígua e barbuda', 'santa lúcia',
    'são vicente e granadinas', 'são cristóvão e névis', 'barbados', 'fiji', 'vanuatu', 'samoa',
    'tonga', 'kiribati', 'tuvalu', 'nauru', 'palau', 'hong kong', 'macau', 'porto rico',
    'aruba', 'curaçao', 'jamaica', 'mauricio', 'maurício', 'liechtenstein',
]);

const FEMININE = new Set(['guiné', 'guiné-bissau', 'guiné equatorial', 'belarus', 'bielorrússia']);

const MASCULINE = new Set([
    'quênia', 'camboja', 'sri lanka', 'botsuana', 'burkina faso', 'saara ocidental', 'canadá',
    'panamá', 'congo', 'iêmen', 'catar', 'kosovo', 'haiti',
]);

const PLURAL_MASC_FIRST = new Set(['estados', 'emirados', 'países', 'camarões']);
const PLURAL_FEM_FIRST = new Set(['filipinas', 'ilhas', 'bahamas', 'maldivas', 'seychelles', 'comores']);

/**
 * Definite article for a pt-BR country name: 'o' | 'a' | 'os' | 'as' | ''.
 * @param {string} name
 * @returns {string}
 */
export function articleOf(name) {
    const full = String(name || '').trim().toLowerCase();
    if (!full) return '';
    if (NO_ARTICLE.has(full)) return '';
    if (FEMININE.has(full)) return 'a';
    if (MASCULINE.has(full)) return 'o';
    const first = full.split(/\s+/)[0];
    if (PLURAL_MASC_FIRST.has(first)) return 'os';
    if (PLURAL_FEM_FIRST.has(first)) return 'as';
    if (/[á]$/.test(first)) return 'o';
    if (/a$/.test(first)) return 'a';
    return 'o';
}

const ARTICLES = ['o', 'a', 'os', 'as', ''];

const CONTRACTIONS = {
    de: { o: 'do', a: 'da', os: 'dos', as: 'das', '': 'de' },
    a: { o: 'ao', a: 'à', os: 'aos', as: 'às', '': 'a' },
    em: { o: 'no', a: 'na', os: 'nos', as: 'nas', '': 'em' },
    por: { o: 'pelo', a: 'pela', os: 'pelos', as: 'pelas', '': 'por' },
};

function withPrep(prep, name) {
    const art = articleOf(name);
    return `${CONTRACTIONS[prep][art]} ${name}`;
}

/** 'a Ucrânia' / 'o Brasil' / 'Israel' */
export function theName(name) {
    const art = articleOf(name);
    return art ? `${art} ${name}` : String(name);
}

/** Capitalized article form for sentence starts: 'O Brasil', 'Israel'. */
export function TheName(name) {
    const s = theName(name);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Preposition + article contractions: deName('Rússia') -> 'da Rússia', aName -> 'à Rússia', emName -> 'na Rússia', porName -> 'pela Rússia'. */
export const deName = (name) => withPrep('de', name);
export const aName = (name) => withPrep('a', name);
export const emName = (name) => withPrep('em', name);
export const porName = (name) => withPrep('por', name);
/** 'com a Rússia' / 'contra a Rússia' / 'para a Rússia' (no contraction). */
export const comName = (name) => `com ${theName(name)}`;
export const contraName = (name) => `contra ${theName(name)}`;
export const paraName = (name) => `para ${theName(name)}`;

/** True when the country name takes plural agreement ('Estados Unidos', 'Filipinas'). */
export function isPluralName(name) {
    const art = articleOf(name);
    return art === 'os' || art === 'as';
}

/** Verb agreement: verbFor('Estados Unidos', 'declara', 'declaram') -> 'declaram'. */
export function verbFor(name, singular, plural) {
    return isPluralName(name) ? plural : singular;
}

/**
 * Text helper bound to a state: resolves ids to names and applies the grammar helpers.
 * @param {import('../contract/worldState.js').WorldState} state
 */
export function textFor(state) {
    const nat = (id) => (state && state.nations ? state.nations[id] : null);
    const n = (id) => {
        const x = nat(id);
        return x && x.name ? x.name : String(id || '?');
    };
    // optional Nation.article ('o'|'a'|'os'|'as'|'') overrides the name heuristic
    const art = (id) => {
        const x = nat(id);
        return x && typeof x.article === 'string' && ARTICLES.includes(x.article) ? x.article : articleOf(n(id));
    };
    const prep = (p, id) => `${CONTRACTIONS[p][art(id)]} ${n(id)}`;
    const the = (id) => (art(id) ? `${art(id)} ${n(id)}` : n(id));
    return {
        n,
        article: art,
        the,
        The: (id) => {
            const s = the(id);
            return s.charAt(0).toUpperCase() + s.slice(1);
        },
        de: (id) => prep('de', id),
        a: (id) => prep('a', id),
        em: (id) => prep('em', id),
        por: (id) => prep('por', id),
        com: (id) => `com ${the(id)}`,
        contra: (id) => `contra ${the(id)}`,
        para: (id) => `para ${the(id)}`,
        v: (id, singular, plural) => (art(id) === 'os' || art(id) === 'as' ? plural : singular),
        /** Gender/number agreement: g(id, 'anexado', 'anexada', 'anexados', 'anexadas'). */
        g: (id, masc, fem, mascPl, femPl) => {
            const a = art(id);
            if (a === 'a') return fem;
            if (a === 'os') return mascPl || `${masc}s`;
            if (a === 'as') return femPl || `${fem}s`;
            return masc;
        },
    };
}

/** Integer with the real minus sign for negatives ('−20'), matching presentation.signed(). */
export function fmtNum(n) {
    const v = Math.round(Number(n) || 0);
    return v < 0 ? `\u2212${Math.abs(v)}` : String(v);
}

/** "1 mês" / "3 meses" */
export function monthsLabel(k) {
    return `${k} ${k === 1 ? 'mês' : 'meses'}`;
}

/**
 * Trims a value to a single clean string of at most `max` chars (word boundary + '…').
 * Returns '' for non-strings.
 * @param {*} value
 * @param {number} max
 * @param {{multiline?: boolean}} [opts]
 */
export function cleanText(value, max, opts = {}) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    let s = String(value);
    // eslint-disable-next-line no-control-regex
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    s = opts.multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : s.replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}
