/**
 * @file src/ui/map/color.js
 * Tiny pure color helpers (hex <-> rgb/hsl, mixing, deterministic jitter).
 * Node-safe; used by the map view-model.
 */

/** '#abc' | '#aabbcc' -> {r,g,b} (0..255). Invalid input -> neutral grey. */
export function hexToRgb(hex) {
    let s = String(hex || '').trim().replace(/^#/, '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s)) return { r: 89, g: 96, b: 90 };
    const n = parseInt(s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear mix: t=0 -> a, t=1 -> b. */
export function mix(a, b, t) {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    const k = Math.max(0, Math.min(1, Number(t) || 0));
    return rgbToHex({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k });
}

export function rgbToHsl({ r, g, b }) {
    const R = r / 255;
    const G = g / 255;
    const B = b / 255;
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
        else if (max === G) h = (B - R) / d + 2;
        else h = (R - G) / d + 4;
        h *= 60;
    }
    return { h, s, l };
}

export function hslToRgb({ h, s, l }) {
    const hh = (((h % 360) + 360) % 360) / 360;
    if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    return { r: f(hh + 1 / 3) * 255, g: f(hh) * 255, b: f(hh - 1 / 3) * 255 };
}

/** Shift hue (deg), saturation and lightness (absolute 0..1 deltas). */
export function adjust(hex, { h = 0, s = 0, l = 0 } = {}) {
    const hsl = rgbToHsl(hexToRgb(hex));
    return rgbToHex(hslToRgb({
        h: hsl.h + h,
        s: Math.max(0, Math.min(1, hsl.s + s)),
        l: Math.max(0, Math.min(1, hsl.l + l)),
    }));
}

/** Stable 32-bit FNV-1a hash of a string. */
export function hashString(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * Deterministic per-nation variation of a base color so neighbours of the same
 * bloc stay distinguishable (HOI-style political map) while reading as one bloc.
 */
export function jitter(hex, seed, amount = 1) {
    const h = hashString(seed);
    const dl = ((h & 0xff) / 255 - 0.5) * 0.14 * amount; // ±7% lightness
    const dh = (((h >> 8) & 0xff) / 255 - 0.5) * 14 * amount; // ±7° hue
    const ds = (((h >> 16) & 0xff) / 255 - 0.5) * 0.12 * amount; // ±6% saturation
    return adjust(hex, { h: dh, s: ds, l: dl });
}

/** Lowercase hex without '#', safe for element ids. */
export function colorKey(hex) {
    return rgbToHex(hexToRgb(hex)).slice(1);
}
