/**
 * @file src/core/stContext.js
 * Safe access to the SillyTavern runtime. Nothing here touches ST or the DOM at
 * import time, and nothing throws: under node (tests) every accessor returns
 * null / false.
 *
 * ST: public/script.js:293 defines `globalThis.SillyTavern = { libs, getContext }`.
 * ST: public/scripts/st-context.js:115 `getContext()` builds a NEW object on every
 * call from the current module bindings. `chatMetadata`, `chat`, `extensionPrompts`
 * and `mainApi` are re-bound on chat change / API switch, so callers must call
 * getContext() again every time instead of caching the returned object.
 */

/**
 * Fresh SillyTavern context, or null when ST is not available.
 * @returns {?object}
 */
export function getContext() {
    try {
        const st = globalThis.SillyTavern;
        if (st && typeof st.getContext === 'function') {
            return st.getContext() || null;
        }
    } catch (error) {
        console.warn('[HOI] SillyTavern.getContext() failed', error);
    }
    return null;
}

/**
 * Shared libraries bundled with ST (lodash, DOMPurify, seedrandom, moment...).
 * ST: public/lib.js:84 (default export) exposed as SillyTavern.libs.
 * @returns {?object}
 */
export function getLibs() {
    try {
        const libs = globalThis.SillyTavern?.libs;
        return libs && typeof libs === 'object' ? libs : null;
    } catch {
        return null;
    }
}

/**
 * True when running inside a real (or faked) SillyTavern page.
 * @returns {boolean}
 */
export function isLive() {
    try {
        return typeof globalThis.SillyTavern?.getContext === 'function';
    } catch {
        return false;
    }
}

/**
 * Absolute URL of the extension root folder, always ending with '/'.
 * Derived from this module's own URL (src/core/stContext.js -> ../../), so the
 * folder name under scripts/extensions/third-party/ never matters (AUDIT §4).
 * @returns {string}
 */
export function extensionBaseUrl() {
    return new URL('../../', import.meta.url).href;
}

/**
 * Absolute URL of a file inside the extension folder.
 * @param {string} path e.g. 'assets/character/conselho.json'
 * @returns {string}
 */
export function extensionAssetUrl(path) {
    const clean = String(path || '').replace(/^\/+/, '');
    return new URL(clean, extensionBaseUrl()).href;
}

/**
 * Folder name of the extension when installed as a third-party extension
 * ('Stfork' for .../scripts/extensions/third-party/Stfork/), else ''.
 * @returns {string}
 */
export function extensionFolderName() {
    const match = /\/scripts\/extensions\/third-party\/([^/]+)\/$/.exec(new URL(extensionBaseUrl()).pathname);
    return match ? decodeURIComponent(match[1]) : '';
}
