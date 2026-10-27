/**
 * @file tools/build-flags.mjs
 * Dev-only: copies + minifies flag SVGs from the `flag-icons` npm package (MIT, 4x3 variant)
 * into assets/flags/<ID>.svg for every map country id that has a real flag.
 *
 * Ids without an entry (or mapped to null) are skipped; the UI falls back to the emoji.
 * Run: npm run build:flags
 */

import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { optimize } from 'svgo';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(ROOT, 'node_modules/flag-icons/flags/4x3');
const OUT_DIR = join(ROOT, 'assets/flags');
const MAP_FILE = join(ROOT, 'assets/map/world.map.json');
const BUDGET = 2 * 1024 * 1024;

/**
 * Nation id (ISO alpha-3 / custom) -> flag-icons code (ISO alpha-2, lowercase).
 * null = no real flag in flag-icons (Somaliland, Northern Cyprus): UI uses the emoji.
 */
export const ALPHA2 = Object.freeze({
    AFG: 'af', AGO: 'ao', ALB: 'al', ARE: 'ae', ARG: 'ar', ARM: 'am', AUS: 'au', AUT: 'at', AZE: 'az',
    BDI: 'bi', BEL: 'be', BEN: 'bj', BFA: 'bf', BGD: 'bd', BGR: 'bg', BHS: 'bs', BIH: 'ba', BLR: 'by',
    BLZ: 'bz', BOL: 'bo', BRA: 'br', BRN: 'bn', BTN: 'bt', BWA: 'bw', CAF: 'cf', CAN: 'ca', CHE: 'ch',
    CHL: 'cl', CHN: 'cn', CIV: 'ci', CMR: 'cm', COD: 'cd', COG: 'cg', COL: 'co', CRI: 'cr', CUB: 'cu',
    CYN: null, CYP: 'cy', CZE: 'cz', DEU: 'de', DJI: 'dj', DNK: 'dk', DOM: 'do', DZA: 'dz', ECU: 'ec',
    EGY: 'eg', ERI: 'er', ESH: 'eh', ESP: 'es', EST: 'ee', ETH: 'et', FIN: 'fi', FJI: 'fj', FRA: 'fr',
    GAB: 'ga', GBR: 'gb', GEO: 'ge', GHA: 'gh', GIN: 'gn', GMB: 'gm', GNB: 'gw', GNQ: 'gq', GRC: 'gr',
    GTM: 'gt', GUY: 'gy', HND: 'hn', HRV: 'hr', HTI: 'ht', HUN: 'hu', IDN: 'id', IND: 'in', IRL: 'ie',
    IRN: 'ir', IRQ: 'iq', ISL: 'is', ISR: 'il', ITA: 'it', JAM: 'jm', JOR: 'jo', JPN: 'jp', KAZ: 'kz',
    KEN: 'ke', KGZ: 'kg', KHM: 'kh', KOR: 'kr', KOS: 'xk', KWT: 'kw', LAO: 'la', LBN: 'lb', LBR: 'lr',
    LBY: 'ly', LKA: 'lk', LSO: 'ls', LTU: 'lt', LUX: 'lu', LVA: 'lv', MAR: 'ma', MDA: 'md', MDG: 'mg',
    MEX: 'mx', MKD: 'mk', MLI: 'ml', MMR: 'mm', MNE: 'me', MNG: 'mn', MOZ: 'mz', MRT: 'mr', MWI: 'mw',
    MYS: 'my', NAM: 'na', NER: 'ne', NGA: 'ng', NIC: 'ni', NLD: 'nl', NOR: 'no', NPL: 'np', NZL: 'nz',
    OMN: 'om', PAK: 'pk', PAN: 'pa', PER: 'pe', PHL: 'ph', PNG: 'pg', POL: 'pl', PRK: 'kp', PRT: 'pt',
    PRY: 'py', PSE: 'ps', QAT: 'qa', ROU: 'ro', RUS: 'ru', RWA: 'rw', SAU: 'sa', SDN: 'sd', SEN: 'sn',
    SLB: 'sb', SLE: 'sl', SLV: 'sv', SOL: null, SOM: 'so', SRB: 'rs', SSD: 'ss', SUR: 'sr', SVK: 'sk',
    SVN: 'si', SWE: 'se', SWZ: 'sz', SYR: 'sy', TCD: 'td', TGO: 'tg', THA: 'th', TJK: 'tj', TKM: 'tm',
    TLS: 'tl', TTO: 'tt', TUN: 'tn', TUR: 'tr', TWN: 'tw', TZA: 'tz', UGA: 'ug', UKR: 'ua', URY: 'uy',
    USA: 'us', UZB: 'uz', VEN: 've', VNM: 'vn', VUT: 'vu', YEM: 'ye', ZAF: 'za', ZMB: 'zm', ZWE: 'zw',
});

const SVGO_CONFIG = {
    multipass: true,
    floatPrecision: 2,
    // svgo v4: preset-default keeps the viewBox; drop width/height so the <img> box decides.
    plugins: ['preset-default', 'removeDimensions'],
};

async function main() {
    const map = JSON.parse(await readFile(MAP_FILE, 'utf8'));
    const ids = Object.keys(map.countries).sort();
    await mkdir(OUT_DIR, { recursive: true });
    // Remove stale flag files (keep the license file).
    for (const f of await readdir(OUT_DIR)) {
        if (f.endsWith('.svg') && !ids.includes(f.slice(0, -4))) await unlink(join(OUT_DIR, f));
    }
    let total = 0;
    let count = 0;
    const skipped = [];
    for (const id of ids) {
        const code = ALPHA2[id];
        if (code === undefined) throw new Error(`no flag mapping for ${id} (add it to ALPHA2, null to skip)`);
        if (code === null) { skipped.push(id); continue; }
        const svg = await readFile(join(SRC_DIR, `${code}.svg`), 'utf8');
        const { data } = optimize(svg, { ...SVGO_CONFIG, path: `${code}.svg` });
        await writeFile(join(OUT_DIR, `${id}.svg`), data);
        total += (await stat(join(OUT_DIR, `${id}.svg`))).size;
        count++;
    }
    console.log(`flags: ${count} written, ${(total / 1024).toFixed(1)} KB total, skipped: ${skipped.join(', ') || 'none'}`);
    if (total > BUDGET) {
        console.error(`flags exceed the ${BUDGET} byte budget`);
        process.exitCode = 1;
    }
}

await main();
