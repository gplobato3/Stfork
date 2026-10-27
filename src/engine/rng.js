/**
 * @file src/engine/rng.js
 * Deterministic pseudo-random numbers for the engine.
 *
 * Every random decision derives from `seedrandom(state.seed + ':' + state.turn + ':' + salt)`
 * (DESIGN §3.1). SillyTavern ships `SillyTavern.libs.seedrandom` (public/lib.js:18,99); the
 * engine accepts it through createEngine({ seedrandom }) but defaults to the local
 * implementation below so node tests are reproducible without ST.
 */

/** 128-bit string hash (cyrb128). Returns four 32-bit unsigned ints. */
function cyrb128(str) {
    let h1 = 1779033703;
    let h2 = 3144134277;
    let h3 = 1013904242;
    let h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
        const k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4;
    h2 ^= h1;
    h3 ^= h1;
    h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Small fast counter PRNG (sfc32). Returns floats in [0, 1). */
function sfc32(a, b, c, d) {
    return function next() {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

/**
 * Local drop-in for `seedrandom(seed)`: returns a function producing floats in [0, 1).
 * @param {string} seed
 * @returns {() => number}
 */
export function localSeedrandom(seed) {
    const s = cyrb128(String(seed));
    const prng = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 12; i++) prng(); // warm up
    return prng;
}

/**
 * Short stable hash of a string (base 36), used for deterministic ids.
 * @param {string} str
 * @returns {string}
 */
export function hashString(str) {
    const h = cyrb128(String(str));
    return h[0].toString(36) + h[1].toString(36).slice(0, 3);
}

/**
 * Wraps a raw prng with convenience helpers.
 * @param {() => number} prng
 */
export function createRng(prng) {
    const next = () => {
        const v = Number(prng());
        return Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.9999999999) : 0.5;
    };
    return {
        next,
        /** Uniform float in [min, max). */
        float(min, max) {
            return min + (max - min) * next();
        },
        /** Uniform integer in [min, max] (inclusive). */
        int(min, max) {
            return min + Math.floor(next() * (max - min + 1));
        },
        /** True with probability p (0..1). */
        chance(p) {
            return next() < p;
        },
        /** Symmetric noise in [-amp, amp). */
        noise(amp) {
            return (next() * 2 - 1) * amp;
        },
        /** Stochastic rounding: 1.3 -> 1 (70%) or 2 (30%). Keeps expected value. */
        round(x) {
            const f = Math.floor(x);
            return f + (next() < x - f ? 1 : 0);
        },
        pick(arr) {
            return arr.length ? arr[Math.floor(next() * arr.length)] : undefined;
        },
        /** Returns a shuffled copy (Fisher-Yates). */
        shuffle(arr) {
            const out = arr.slice();
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1));
                const t = out[i];
                out[i] = out[j];
                out[j] = t;
            }
            return out;
        },
    };
}

/**
 * Builds `rngFor(state, salt)` using an injectable seedrandom implementation.
 * @param {Function} [seedrandom] SillyTavern.libs.seedrandom or compatible (seed => () => float).
 * @returns {(state: {seed:string, turn:number}, salt: string) => ReturnType<typeof createRng>}
 */
export function createRngFactory(seedrandom) {
    const impl = typeof seedrandom === 'function' ? seedrandom : localSeedrandom;
    return function rngFor(state, salt) {
        const seedStr = `${state && state.seed}:${state && state.turn}:${salt}`;
        let prng;
        try {
            prng = impl(seedStr);
        } catch {
            prng = null;
        }
        if (typeof prng !== 'function') prng = localSeedrandom(seedStr);
        return createRng(prng);
    };
}
