/**
 * Makes `node --test test/ui-a/` work on Node ≥ 21, where a directory argument
 * is no longer expanded: Node runs this directory's index.js, which loads every
 * *.test.js here. When the runner instead picks this file up by glob (e.g. a
 * root-level `node --test`), argv[1] points at index.js itself and nothing is
 * imported, so the suites are not executed twice.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const invokedAsDirectory = !/index\.js$/.test(process.argv[1] || '');

if (invokedAsDirectory) {
    for (const f of readdirSync(here).filter((n) => n.endsWith('.test.js')).sort()) {
        await import(pathToFileURL(join(here, f)).href);
    }
}
