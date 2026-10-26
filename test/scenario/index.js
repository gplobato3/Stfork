/**
 * Directory entry shim. Node >= 21 treats `node --test test/scenario/` as a module path (not a
 * directory to scan) and resolves it to this index.js. Import the suites only in that case, so a
 * plain `node --test` (whose default globs also match this file) does not run them twice.
 * Node 20 scans the directory itself and runs the *.test.js files directly.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
if (resolve(process.argv[1] || '') === here) {
    await import('./scenario.test.js');
}
