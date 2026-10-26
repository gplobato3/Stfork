/**
 * @file src/ui/settings.js
 * Extension settings panel (Module D), appended to #extensions_settings2.
 *
 * Exposes:
 *   - extension on/off toggle,
 *   - difficulty / tension-aggressiveness slider (0..3),
 *   - "injetar Situation Report no chat" toggle,
 *   - reset-campaign button,
 *   - an OPTIONAL, clearly-labeled future image-generation section whose
 *     Replicate token is read ONLY from a runtime config the user supplies and
 *     is NEVER hardcoded or persisted to settings/disk. The section is disabled
 *     ("em breve") for v1.
 *
 * Settings persist under ctx.extensionSettings[MODULE_NAME] via
 * saveSettingsDebounced(). Node-safe: DOM/ST usage is guarded.
 */

import { getContext } from '../core/stContext.js';
import { MODULE_NAME } from '../contract/interfaces.js';
import { t } from '../i18n/i18n.js';
import { renderTemplate, el, isElement } from './render.js';

/** Difficulty levels (index = slider value). */
export const DIFFICULTY_LEVELS = Object.freeze([
    { key: 'relaxed', labelKey: 'hoi_settings_diff_relaxed' },
    { key: 'normal', labelKey: 'hoi_settings_diff_normal' },
    { key: 'hard', labelKey: 'hoi_settings_diff_hard' },
    { key: 'brutal', labelKey: 'hoi_settings_diff_brutal' },
]);

/** Default persisted settings for the module. NEVER contains a secret/token. */
export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    difficulty: 1, // 'normal'
    injectSitrep: true,
});

/**
 * Read (and lazily initialize) this module's settings object from ctx.
 * @returns {{enabled:boolean,difficulty:number,injectSitrep:boolean}}
 */
export function getSettings() {
    const ctx = getContext();
    if (!ctx.extensionSettings || typeof ctx.extensionSettings !== 'object') {
        ctx.extensionSettings = {};
    }
    const existing = ctx.extensionSettings[MODULE_NAME];
    const merged = { ...DEFAULT_SETTINGS, ...(existing && typeof existing === 'object' ? existing : {}) };
    // Sanitize: coerce types + clamp difficulty; strip any stray token field so
    // a secret can never be persisted even if some other code wrote one.
    merged.enabled = !!merged.enabled;
    merged.injectSitrep = !!merged.injectSitrep;
    merged.difficulty = clampInt(merged.difficulty, 0, DIFFICULTY_LEVELS.length - 1);
    delete merged.replicateToken;
    delete merged.replicateTokenRuntime;
    ctx.extensionSettings[MODULE_NAME] = merged;
    return merged;
}

/**
 * Persist a partial settings patch and trigger ST's debounced save.
 * Any token-like field is dropped: secrets are runtime-only.
 * @param {Partial<{enabled:boolean,difficulty:number,injectSitrep:boolean}>} patch
 * @returns {object} the updated settings
 */
export function saveSettings(patch) {
    const ctx = getContext();
    const current = getSettings();
    const next = { ...current, ...(patch || {}) };
    delete next.replicateToken;
    delete next.replicateTokenRuntime;
    next.enabled = !!next.enabled;
    next.injectSitrep = !!next.injectSitrep;
    next.difficulty = clampInt(next.difficulty, 0, DIFFICULTY_LEVELS.length - 1);
    ctx.extensionSettings[MODULE_NAME] = next;
    if (typeof ctx.saveSettingsDebounced === 'function') {
        try { ctx.saveSettingsDebounced(); } catch { /* ignore under node */ }
    }
    return next;
}

/**
 * Build pt-BR template data for the settings panel.
 * @returns {Object}
 */
export function buildSettingsTemplateData() {
    const s = getSettings();
    const diff = DIFFICULTY_LEVELS[s.difficulty] || DIFFICULTY_LEVELS[1];
    return {
        title: t('hoi_settings_title'),
        enabled: s.enabled,
        enabledLabel: t('hoi_settings_enabled_label'),
        difficulty: s.difficulty,
        difficultyName: t(diff.labelKey),
        difficultyLabel: t('hoi_settings_difficulty_label'),
        difficultyHint: t('hoi_settings_difficulty_hint'),
        injectSitrep: s.injectSitrep,
        injectSitrepLabel: t('hoi_settings_inject_sitrep_label'),
        injectSitrepHint: t('hoi_settings_inject_sitrep_hint'),
        resetLabel: t('hoi_settings_reset_label'),
        resetHint: t('hoi_settings_reset_hint'),
        imagegenTitle: t('hoi_settings_imagegen_title'),
        imagegenHint: t('hoi_settings_imagegen_hint'),
        imagegenTokenLabel: t('hoi_settings_imagegen_token_label'),
        imagegenTokenPlaceholder: t('hoi_settings_imagegen_token_placeholder'),
        comingSoon: t('hoi_settings_coming_soon'),
    };
}

/**
 * Render the settings panel into `container` (typically #extensions_settings2)
 * and wire the controls to persistence.
 * @param {HTMLElement} container
 * @param {Object} [opts]
 * @param {()=>void} [opts.onReset] Called when the user confirms reset.
 * @param {(settings:object)=>void} [opts.onChange] Called after any change.
 * @returns {Promise<void>}
 */
export async function renderSettings(container, opts = {}) {
    if (!isElement(container)) return;
    const doc = container.ownerDocument;

    const data = buildSettingsTemplateData();
    const html = await renderTemplate('settings', data);

    const panel = doc.createElement('div');
    panel.className = 'hoi-settings-host hoi-root';
    if (html) {
        panel.innerHTML = html;
    } else {
        panel.appendChild(buildSettingsDom(doc, data));
    }
    container.appendChild(panel);

    wireSettings(panel, opts);
}

function wireSettings(panel, opts) {
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

    const enabled = panel.querySelector('[data-setting="enabled"]');
    if (enabled) {
        enabled.addEventListener('change', () => onChange(saveSettings({ enabled: enabled.checked })));
    }

    const inject = panel.querySelector('[data-setting="injectSitrep"]');
    if (inject) {
        inject.addEventListener('change', () => onChange(saveSettings({ injectSitrep: inject.checked })));
    }

    const diff = panel.querySelector('[data-setting="difficulty"]');
    const diffVal = panel.querySelector('[data-role="difficulty-value"]');
    if (diff) {
        diff.addEventListener('input', () => {
            const idx = clampInt(diff.value, 0, DIFFICULTY_LEVELS.length - 1);
            const next = saveSettings({ difficulty: idx });
            if (diffVal) diffVal.textContent = t(DIFFICULTY_LEVELS[idx].labelKey);
            onChange(next);
        });
    }

    const reset = panel.querySelector('[data-action="reset-campaign"]');
    if (reset) {
        reset.addEventListener('click', () => {
            const ok = typeof confirm === 'function' ? confirm(t('hoi_settings_reset_confirm')) : true;
            if (ok && typeof opts.onReset === 'function') opts.onReset();
        });
    }

    // The Replicate token input is runtime-only: never persisted. It is kept on
    // a transient in-memory field the (future) image-gen module would read.
    const token = panel.querySelector('[data-setting="replicateTokenRuntime"]');
    if (token) {
        token.addEventListener('input', () => {
            // Intentionally NOT saved to settings. The section is disabled for v1.
            panel.__hoiReplicateTokenRuntime = token.value || '';
        });
    }
}

/**
 * Programmatic DOM fallback mirroring templates/settings.html.
 * @param {Document} doc
 * @param {Object} data
 * @returns {HTMLElement}
 */
function buildSettingsDom(doc, data) {
    const root = el(doc, 'div', { className: 'hoi-settings' });

    root.appendChild(el(doc, 'div', { className: 'hoi-settings__title-bar', text: data.title }));

    // enabled
    const enRow = el(doc, 'label', { className: 'hoi-settings__row checkbox_label' });
    const enInput = el(doc, 'input', { attrs: { type: 'checkbox', 'data-setting': 'enabled' } });
    enInput.checked = data.enabled;
    enRow.appendChild(enInput);
    enRow.appendChild(el(doc, 'span', { text: data.enabledLabel }));
    root.appendChild(enRow);

    // difficulty
    const dRow = el(doc, 'div', { className: 'hoi-settings__row' });
    dRow.appendChild(el(doc, 'label', { className: 'hoi-settings__label', text: data.difficultyLabel }));
    const slider = el(doc, 'input', {
        className: 'hoi-settings__slider',
        attrs: { type: 'range', min: '0', max: '3', step: '1', 'data-setting': 'difficulty' },
    });
    slider.value = String(data.difficulty);
    dRow.appendChild(slider);
    dRow.appendChild(el(doc, 'span', { className: 'hoi-settings__slider-value', attrs: { 'data-role': 'difficulty-value' }, text: data.difficultyName }));
    dRow.appendChild(el(doc, 'small', { className: 'hoi-settings__hint', text: data.difficultyHint }));
    root.appendChild(dRow);

    // inject sitrep
    const iRow = el(doc, 'label', { className: 'hoi-settings__row checkbox_label' });
    const iInput = el(doc, 'input', { attrs: { type: 'checkbox', 'data-setting': 'injectSitrep' } });
    iInput.checked = data.injectSitrep;
    iRow.appendChild(iInput);
    iRow.appendChild(el(doc, 'span', { text: data.injectSitrepLabel }));
    root.appendChild(iRow);
    root.appendChild(el(doc, 'small', { className: 'hoi-settings__hint', text: data.injectSitrepHint }));

    // reset
    const rRow = el(doc, 'div', { className: 'hoi-settings__row' });
    rRow.appendChild(el(doc, 'button', {
        className: 'hoi-btn hoi-btn--danger',
        attrs: { type: 'button', 'data-action': 'reset-campaign' },
        text: data.resetLabel,
    }));
    rRow.appendChild(el(doc, 'small', { className: 'hoi-settings__hint', text: data.resetHint }));
    root.appendChild(rRow);

    // image-gen (disabled / future)
    const fs = el(doc, 'fieldset', { className: 'hoi-settings__imagegen' });
    fs.disabled = true;
    const legend = el(doc, 'legend', { className: 'hoi-settings__imagegen-title', text: data.imagegenTitle + ' ' });
    legend.appendChild(el(doc, 'span', { className: 'hoi-badge hoi-badge--soon', text: data.comingSoon }));
    fs.appendChild(legend);
    fs.appendChild(el(doc, 'small', { className: 'hoi-settings__hint', text: data.imagegenHint }));
    const tRow = el(doc, 'div', { className: 'hoi-settings__row' });
    tRow.appendChild(el(doc, 'label', { className: 'hoi-settings__label', text: data.imagegenTokenLabel }));
    tRow.appendChild(el(doc, 'input', {
        className: 'hoi-settings__input',
        attrs: {
            type: 'password',
            'data-setting': 'replicateTokenRuntime',
            placeholder: data.imagegenTokenPlaceholder,
            autocomplete: 'off',
        },
    }));
    fs.appendChild(tRow);
    root.appendChild(fs);

    return root;
}

function clampInt(n, min, max) {
    const v = Math.round(Number(n));
    if (Number.isNaN(v)) return min;
    return Math.min(max, Math.max(min, v));
}
