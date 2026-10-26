#!/usr/bin/env node
/**
 * tools/gen-art.mjs — dev-only: generates the bundled illustrations in
 * assets/art/*.webp with Replicate. The token is read from the environment
 * (REPLICATE_API_TOKEN) and is never written anywhere.
 *
 *   REPLICATE_API_TOKEN=... node tools/gen-art.mjs [--force] [key ...]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MODEL = process.env.HOI_ART_MODEL || 'black-forest-labs/flux-2-pro';
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'art');

const STYLE =
    'Cinematic concept art for a modern geopolitical grand strategy video game. Painterly digital ' +
    'illustration, dramatic chiaroscuro lighting, desaturated steel-blue and olive palette with ' +
    'brass-gold highlights, subtle film grain, wide establishing shot, highly detailed. ' +
    'No text, no letters, no captions, no logos, no readable flags, no recognizable real people.';

const PROMPTS = {
    title: 'A dim underground military command center: a huge glowing holographic world map table in the center, silhouetted generals and ministers standing around it, walls of radar and satellite screens, haze and cold light.',
    'bookmark-b2026': 'A tense modern world at dusk: a megacity skyline with giant news screens, a busy container port, grey warships on the distant horizon, a line of riot police facing protesters in the foreground, heavy overcast sky.',
    'bookmark-b2028': 'A naval blockade on a stormy ocean: a line of grey destroyers and an aircraft carrier cutting through rough waves, fighter jets streaking overhead, red warning lights, lightning in dark clouds.',
    'bookmark-b2031': 'World War Three at night: a burning modern city skyline, a column of main battle tanks crossing a damaged bridge, many missile trails arcing across the sky, distant explosions lighting the horizon.',
    'event-diplomacy': 'A high-stakes summit in an ornate hall: diplomats in dark suits around a long polished table under chandeliers, tense handshake in the middle, camera flashes from the press pool.',
    'event-military': 'A modern armored division mobilizing at dawn: tanks and infantry fighting vehicles rolling along a highway, soldiers loading equipment onto trucks, floodlights and dust.',
    'event-naval': 'Two modern warships shadowing each other dangerously close in a grey fog-bound sea, a navy helicopter hovering above, sea spray, tense standoff.',
    'event-nuclear': 'A nuclear ballistic missile rising from an open silo at night, steam venting, red alert lights on a snowy military base, ominous sky.',
    'event-economy': 'A stock exchange trading floor in panic: huge screens of red falling charts, traders with hands on their heads, scattered papers, cold fluorescent light.',
    'event-unrest': 'A massive street protest at night in a modern capital: crowds with red smoke flares, a burning barricade, a wall of riot police shields, tear gas haze.',
    'event-cyber': 'A dark server room under cyberattack: cascading code and red error alerts across dozens of monitors, a hooded operator lit by blue glow, cables everywhere.',
    'event-intel': 'Espionage at a rainy night train station: an agent in a long coat handing over a briefcase, a surveillance camera on a pillar, neon reflections in puddles.',
    'event-humanitarian': 'A refugee camp at dusk: rows of white tents, aid trucks arriving, families carrying belongings, relief workers distributing supplies, dusty golden light.',
    'event-tech': 'A secret research hangar: a sleek hypersonic missile prototype on a cradle, scientists in lab coats, holographic schematics, satellite components on display.',
    'event-politics': 'A head of state seen from behind at a podium addressing a packed parliament chamber, journalists and cameras, dramatic spotlight beams, national emblems blurred.',
    'event-energy': 'A gas pipeline junction and refinery on a frozen winter night, tall flare stacks burning, snow on the steel pipes, tanker ships in the distant harbor.',
    'event-war': 'A modern front line: soldiers in winter camouflage in a muddy trench, drones in the smoky sky, artillery explosions on the horizon, shattered trees.',
    victory: 'A victory parade along a grand avenue at sunrise: cheering crowds, soldiers marching, fighter jets in formation trailing smoke, triumphant golden light.',
    defeat: 'A ruined government palace at dusk: a toppled statue in an empty square, ash falling, abandoned military vehicles, broken windows, somber red sky.',
};

const token = process.env.REPLICATE_API_TOKEN;
if (!token) {
    console.error('REPLICATE_API_TOKEN is not set.');
    process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const keys = (only.length ? only : Object.keys(PROMPTS)).filter((k) => PROMPTS[k]);

async function exists(p) {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

async function api(url, init = {}) {
    // Replicate throttles low-credit accounts (6 predictions/min, burst 1): honor retry_after.
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
            ...init,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 429 && attempt < 8) {
            const wait = (Number(body.retry_after) || 10) + 1;
            await new Promise((r) => setTimeout(r, wait * 1000));
            continue;
        }
        if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 300)}`);
        return body;
    }
}

async function generate(key) {
    const out = path.join(OUT_DIR, `${key}.webp`);
    if (!force && (await exists(out))) return `${key}: skipped (exists)`;
    let pred = await api(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
        method: 'POST',
        headers: { Prefer: 'wait=60' },
        body: JSON.stringify({
            input: {
                prompt: `${PROMPTS[key]} ${STYLE}`,
                aspect_ratio: '16:9',
                resolution: '1 MP',
                output_format: 'webp',
                output_quality: 74,
                safety_tolerance: 2,
            },
        }),
    });
    const started = Date.now();
    while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
        if (Date.now() - started > 240000) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 2500));
        pred = await api(pred.urls.get);
    }
    if (pred.status !== 'succeeded') throw new Error(`prediction ${pred.status}: ${pred.error || ''}`);
    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    const img = await fetch(url);
    if (!img.ok) throw new Error(`download ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    await writeFile(out, buf);
    return `${key}: ${(buf.length / 1024).toFixed(0)} KB (${((Date.now() - started) / 1000).toFixed(0)}s)`;
}

await mkdir(OUT_DIR, { recursive: true });
const queue = [...keys];
const results = [];
async function worker() {
    while (queue.length) {
        const key = queue.shift();
        try {
            results.push(await generate(key));
        } catch (e) {
            results.push(`${key}: FAILED ${e.message}`);
        }
        console.log(results[results.length - 1]);
    }
}
const WORKERS = Math.max(1, Number(process.env.HOI_ART_WORKERS) || 1);
await Promise.all(Array.from({ length: WORKERS }, () => worker()));
const failed = results.filter((r) => r.includes('FAILED')).length;
console.log(`done: ${results.length - failed} ok, ${failed} failed`);
process.exit(failed ? 2 : 0);
