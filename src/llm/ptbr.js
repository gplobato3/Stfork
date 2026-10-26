/**
 * @file src/llm/ptbr.js
 * Tiny pt-BR grammar helpers for deterministic text: country names take a
 * definite article in Portuguese ("do Brasil", "da Argentina", "dos Estados
 * Unidos") except a few ("de Portugal", "de Israel"). The scenario data has no
 * gender, so this keeps a map for the nations most likely to appear; unknown
 * ids fall back to the bare name (headline style), never to a wrong article.
 */

/** id -> definite article ('' = none). */
export const COUNTRY_ARTICLES = Object.freeze({
    BRA: 'o', ARG: 'a', VEN: 'a', COL: 'a', CHL: 'o', PER: 'o', BOL: 'a', PRY: 'o', URY: 'o', ECU: 'o', GUY: 'a', SUR: 'o',
    USA: 'os', CAN: 'o', MEX: 'o', CUB: '', GTM: 'a', PAN: 'o', HTI: 'o', NIC: 'a', HND: '', SLV: '',
    GBR: 'o', FRA: 'a', DEU: 'a', ITA: 'a', ESP: 'a', PRT: '', NLD: 'os', BEL: 'a', CHE: 'a', AUT: 'a', IRL: 'a',
    SWE: 'a', NOR: 'a', FIN: 'a', DNK: 'a', ISL: 'a', POL: 'a', CZE: 'a', SVK: 'a', HUN: 'a', ROU: 'a', BGR: 'a',
    GRC: 'a', SRB: 'a', HRV: 'a', BIH: 'a', ALB: 'a', MKD: 'a', MNE: 'o', KOS: 'o', SVN: 'a', EST: 'a', LVA: 'a', LTU: 'a',
    UKR: 'a', BLR: 'a', MDA: 'a', RUS: 'a', GEO: 'a', ARM: 'a', AZE: 'o', TUR: 'a', KAZ: 'o', UZB: 'o', TKM: 'o', KGZ: 'o', TJK: 'o',
    CHN: 'a', TWN: '', JPN: 'o', KOR: 'a', PRK: 'a', MNG: 'a', IND: 'a', PAK: 'o', BGD: 'o', LKA: 'o', NPL: 'o', AFG: 'o', MMR: 'o',
    VNM: 'o', THA: 'a', PHL: 'as', MYS: 'a', IDN: 'a', SGP: '', KHM: 'o', LAO: 'o', AUS: 'a', NZL: 'a', PNG: 'a',
    IRN: 'o', IRQ: 'o', SYR: 'a', ISR: '', PSE: 'a', LBN: 'o', JOR: 'a', SAU: 'a', ARE: 'os', QAT: 'o', KWT: 'o', OMN: 'o', YEM: 'o', BHR: 'o',
    EGY: 'o', LBY: 'a', TUN: 'a', DZA: 'a', MAR: 'o', SDN: 'o', SSD: 'o', ETH: 'a', ERI: 'a', SOM: 'a', KEN: 'o', TZA: 'a', UGA: 'a',
    NGA: 'a', NER: 'o', MLI: 'o', TCD: 'o', CMR: 'os', GHA: 'o', CIV: 'a', SEN: 'o', AGO: '', MOZ: '', ZAF: 'a', ZWE: 'o', COD: 'a', COG: 'o',
});

function articleOf(id) {
    return COUNTRY_ARTICLES[id] || '';
}

const CONTRACT = { de: { o: 'do', a: 'da', os: 'dos', as: 'das' } };

/**
 * 'do Brasil' / 'da Argentina' / 'de Portugal'; unknown: 'de <name>'.
 * @param {string} id
 * @param {string} name
 */
export function deNation(id, name) {
    const a = articleOf(id);
    return a ? `${CONTRACT.de[a]} ${name}` : `de ${name}`;
}

/** Subject form: 'o Brasil', 'a Argentina', 'Portugal' (lowercase article). */
export function theNation(id, name) {
    const a = articleOf(id);
    return a ? `${a} ${name}` : name;
}

/** Sentence-initial subject: 'O Brasil', 'A Argentina', 'Portugal'. */
export function TheNation(id, name) {
    const s = theNation(id, name);
    return s.charAt(0).toUpperCase() + s.slice(1);
}
