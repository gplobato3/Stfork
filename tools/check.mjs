/**
 * @file tools/check.mjs
 * Node validation harness for the HOI extension (no ST runtime available).
 *
 * Does three things and exits non-zero if any fail:
 *   1. Syntax-check every .js file (node --check via child_process).
 *   2. JSON.parse manifest.json + every file under assets/ and i18n/.
 *   3. Import the shared contract and run validateEvent against fixtures.
 *
 * Run:  node tools/check.mjs   (also: npm run check)
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Directories we never walk into. */
const IGNORE_DIRS = new Set(['node_modules', '.git', '.agents', 'coverage']);

/** @type {string[]} */
const failures = [];

/**
 * Recursively collect files under `dir` whose extension is in `exts`.
 * @param {string} dir
 * @param {Set<string>} exts  e.g. new Set(['.js','.mjs'])
 * @returns {Promise<string[]>}
 */
async function collect(dir, exts) {
    /** @type {string[]} */
    const out = [];
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const ent of entries) {
        if (ent.isDirectory()) {
            if (IGNORE_DIRS.has(ent.name)) continue;
            out.push(...(await collect(join(dir, ent.name), exts)));
        } else if (exts.has(extname(ent.name))) {
            out.push(join(dir, ent.name));
        }
    }
    return out;
}

/** 1. Syntax-check all JS files. */
async function checkJsSyntax() {
    const files = await collect(ROOT, new Set(['.js', '.mjs']));
    for (const file of files) {
        try {
            await execFileAsync(process.execPath, ['--check', file]);
            console.log(`  ok  ${relative(ROOT, file)}`);
        } catch (e) {
            failures.push(`syntax: ${relative(ROOT, file)}\n${e && e.stderr ? e.stderr : e}`);
            console.error(`  ERR ${relative(ROOT, file)}`);
        }
    }
    return files.length;
}

/** 2. Parse manifest.json + all JSON under assets/ and i18n/. */
async function checkJson() {
    /** @type {string[]} */
    const jsonFiles = [];
    const manifest = join(ROOT, 'manifest.json');
    if (await exists(manifest)) jsonFiles.push(manifest);
    jsonFiles.push(...(await collect(join(ROOT, 'assets'), new Set(['.json']))));
    jsonFiles.push(...(await collect(join(ROOT, 'i18n'), new Set(['.json']))));

    for (const file of jsonFiles) {
        try {
            JSON.parse(await readFile(file, 'utf8'));
            console.log(`  ok  ${relative(ROOT, file)}`);
        } catch (e) {
            failures.push(`json: ${relative(ROOT, file)}: ${e && e.message}`);
            console.error(`  ERR ${relative(ROOT, file)}`);
        }
    }
    return jsonFiles.length;
}

/** 3. Import the contract and exercise validateEvent on fixtures. */
async function checkContract() {
    const schemasUrl = pathToFileURL(join(ROOT, 'src/contract/schemas.js')).href;
    const worldUrl = pathToFileURL(join(ROOT, 'src/contract/worldState.js')).href;
    const { validateEvent, EVENT_SCHEMA } = await import(schemasUrl);
    const { createEmptyWorldState, isWorldStateShape } = await import(worldUrl);

    // EVENT_SCHEMA must be JSON-serializable.
    try {
        JSON.parse(JSON.stringify(EVENT_SCHEMA));
    } catch (e) {
        failures.push(`EVENT_SCHEMA not JSON-serializable: ${e && e.message}`);
    }

    // World state shape.
    if (!isWorldStateShape(createEmptyWorldState())) {
        failures.push('createEmptyWorldState() did not return a valid WorldState shape');
    }

    const good = {
        title: 'Incidente no Mar do Sul da China',
        narrative: 'Uma manobra naval eleva a tensão regional.',
        options: [
            {
                label: 'Enviar nota diplomática',
                rationale: 'Desescalar sem perder prestígio.',
                effects: [{ type: 'tension', delta: -5 }],
            },
            {
                label: 'Mobilizar a frota',
                rationale: 'Demonstrar força.',
                effects: [
                    { type: 'resource', target: 'BRA', resource: 'warSupport', delta: 10 },
                    { type: 'tension', delta: 8 },
                ],
            },
        ],
    };
    const bad = { title: '', options: [] };

    const okRes = validateEvent(good);
    if (!okRes.ok) failures.push(`validateEvent rejected a good event: ${okRes.errors.join('; ')}`);

    const badRes = validateEvent(bad);
    if (badRes.ok) failures.push('validateEvent accepted a bad event');

    console.log('  ok  contract: validateEvent fixtures + world-state shape');
}

/** @param {string} p */
async function exists(p) {
    try {
        await stat(p);
        return true;
    } catch {
        return false;
    }
}

async function main() {
    console.log('== HOI check: JS syntax ==');
    const js = await checkJsSyntax();
    console.log(`== HOI check: JSON (${'manifest + assets + i18n'}) ==`);
    const json = await checkJson();
    console.log('== HOI check: contract fixtures ==');
    await checkContract();

    console.log(`\nChecked ${js} JS file(s), ${json} JSON file(s).`);
    if (failures.length) {
        console.error(`\nFAILED (${failures.length}):`);
        for (const f of failures) console.error(' - ' + f);
        process.exit(1);
    }
    console.log('\nAll checks passed.');
}

main().catch((e) => {
    console.error('check.mjs crashed:', e);
    process.exit(1);
});
