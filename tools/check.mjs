#!/usr/bin/env node
/**
 * tools/check.mjs — repository sanity check (no SillyTavern needed).
 *   1. `node --check` on every .js/.mjs file.
 *   2. JSON.parse of manifest.json and every .json under assets/.
 *   3. Imports the composition root (index.js) under node: nothing may touch
 *      the DOM or SillyTavern at import time.
 *   4. Loads the scenario through the real loader and fails on any data warning.
 * Run: npm run check
 */
import { readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['node_modules', '.git', 'dev']);
const failures = [];

async function walk(dir, exts, out = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, exts, out);
        else if (exts.includes(path.extname(entry.name))) out.push(full);
    }
    return out;
}

const scripts = await walk(ROOT, ['.js', '.mjs']);
await Promise.all(scripts.map(async (file) => {
    try {
        await run(process.execPath, ['--check', file]);
    } catch (error) {
        failures.push(`syntax: ${path.relative(ROOT, file)}\n${error.stderr || error.message}`);
    }
}));

const jsonFiles = [path.join(ROOT, 'manifest.json'), ...(await walk(path.join(ROOT, 'assets'), ['.json']))];
for (const file of jsonFiles) {
    try {
        JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
        failures.push(`json: ${path.relative(ROOT, file)}: ${error.message}`);
    }
}

try {
    await import(pathToFileURL(path.join(ROOT, 'index.js')).href);
} catch (error) {
    failures.push(`import index.js under node failed: ${error.stack || error}`);
}

const warnings = [];
try {
    const { createScenarioLoader } = await import(pathToFileURL(path.join(ROOT, 'src/scenario/index.js')).href);
    const data = await createScenarioLoader({ warn: (msg) => warnings.push(msg) }).load();
    console.log(`scenario: ${Object.keys(data.nations).length} nations, ${data.bookmarks.length} bookmarks`);
} catch (error) {
    failures.push(`scenario load failed: ${error.stack || error}`);
}
for (const w of warnings) failures.push(`scenario warning: ${w}`);

console.log(`checked ${scripts.length} scripts, ${jsonFiles.length} JSON files`);
if (failures.length) {
    console.error(failures.join('\n\n'));
    process.exit(1);
}
console.log('ok');
