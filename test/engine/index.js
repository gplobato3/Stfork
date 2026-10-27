/**
 * @file test/engine/index.js
 * Lets `node --test test/engine/` work on Node versions that treat a directory
 * argument as a module path (Node 22 resolves it to this index.js). When the runner
 * discovers this file by itself (plain `node --test`), it imports nothing, so the
 * suites are not run twice.
 */
import { readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = process.argv[1] || '';
if (basename(entry) !== 'index.js') {
    for (const f of readdirSync(here).filter((x) => x.endsWith('.test.js')).sort()) {
        await import(pathToFileURL(`${here}/${f}`).href);
    }
}
