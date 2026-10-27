/**
 * @file src/contract/presentation.js
 * Shared pt-BR labels, colors and formatters used by UI, sitrep and prompts so
 * every surface speaks the same language. Pure, node-safe.
 */

import { RESOURCE_KEYS } from './constants.js';

export const MONTHS_PT = Object.freeze([
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]);

/** 'Outubro de 2026' */
export function formatDate(date) {
    if (!date) return '';
    return `${MONTHS_PT[(date.month - 1 + 12) % 12]} de ${date.year}`;
}

/** 'Out/2026' */
export function formatDateShort(date) {
    if (!date) return '';
    return `${MONTHS_PT[(date.month - 1 + 12) % 12].slice(0, 3)}/${date.year}`;
}

export const RESOURCE_LABELS = Object.freeze({
    economy: 'Economia',
    military: 'Força Militar',
    stability: 'Estabilidade',
    influence: 'Influência',
    tech: 'Tecnologia',
    manpower: 'Efetivo',
    warSupport: 'Apoio à Guerra',
});

/** Font Awesome 6 (bundled with SillyTavern). */
export const RESOURCE_ICONS = Object.freeze({
    economy: 'fa-solid fa-coins',
    military: 'fa-solid fa-shield-halved',
    stability: 'fa-solid fa-scale-balanced',
    influence: 'fa-solid fa-globe',
    tech: 'fa-solid fa-microchip',
    manpower: 'fa-solid fa-people-group',
    warSupport: 'fa-solid fa-flag',
});

export const PC_LABEL = 'Capital Político';
export const PC_ICON = 'fa-solid fa-landmark';

export const BLOC_LABELS = Object.freeze({
    NATO: 'OTAN',
    EU: 'União Europeia',
    CSTO: 'OTSC',
    BRICS: 'BRICS',
    NON_ALIGNED: 'Não Alinhado',
});

export const BLOC_COLORS = Object.freeze({
    NATO: '#3d6fa8',
    EU: '#4d8fbf',
    CSTO: '#a8433d',
    BRICS: '#b8873a',
    NON_ALIGNED: '#6f7a6a',
});

export const CATEGORY_LABELS = Object.freeze({
    diplomacy: 'Diplomacia',
    military: 'Militar',
    economy: 'Economia',
    internal: 'Política Interna',
    intel: 'Inteligência',
});

export const CATEGORY_ICONS = Object.freeze({
    diplomacy: 'fa-solid fa-handshake',
    military: 'fa-solid fa-person-rifle',
    economy: 'fa-solid fa-industry',
    internal: 'fa-solid fa-landmark-flag',
    intel: 'fa-solid fa-user-secret',
});

export const SEVERITY_LABELS = Object.freeze({
    low: 'Baixa',
    medium: 'Moderada',
    high: 'Alta',
    critical: 'Crítica',
});

export const SEVERITY_COLORS = Object.freeze({
    low: '#7fa36b',
    medium: '#d1a43f',
    high: '#d9733a',
    critical: '#d0453a',
});

/** Relation tiers, ordered. `min` is inclusive. 'guerra' is assigned by war status, not score. */
export const RELATION_TIERS = Object.freeze([
    { id: 'aliado', label: 'Aliado', min: 60, color: '#3f9b6b' },
    { id: 'amistoso', label: 'Amistoso', min: 25, color: '#7fb069' },
    { id: 'neutro', label: 'Neutro', min: -24, color: '#9aa39a' },
    { id: 'tenso', label: 'Tenso', min: -59, color: '#d1913f' },
    { id: 'hostil', label: 'Hostil', min: -100, color: '#c4513f' },
]);
export const WAR_TIER = Object.freeze({ id: 'guerra', label: 'Em Guerra', color: '#8f1d1d' });

export function relationTier(score, atWar = false) {
    if (atWar) return WAR_TIER;
    for (const t of RELATION_TIERS) if (score >= t.min) return t;
    return RELATION_TIERS[RELATION_TIERS.length - 1];
}

/**
 * Global tension -> DEFCON-style alert level (flavor for the HUD).
 * 0-19 DEFCON 5, 20-39 4, 40-59 3, 60-79 2, 80-100 1.
 */
export function defcon(tension) {
    const t = Number(tension) || 0;
    const level = t >= 80 ? 1 : t >= 60 ? 2 : t >= 40 ? 3 : t >= 20 ? 4 : 5;
    const meta = {
        5: { label: 'Paz Instável', color: '#4f8f6a' },
        4: { label: 'Vigilância', color: '#8fa34f' },
        3: { label: 'Alerta', color: '#d1a43f' },
        2: { label: 'Prontidão Máxima', color: '#d9733a' },
        1: { label: 'Guerra Iminente', color: '#d0453a' },
    }[level];
    return { level, ...meta };
}

/** '+3' / '−2' / '0' (uses the real minus sign). */
export function signed(n) {
    const v = Math.round(Number(n) || 0);
    if (v > 0) return `+${v}`;
    if (v < 0) return `\u2212${Math.abs(v)}`;
    return '0';
}

/** 'Economia −3' style line for an effect detail. */
export function resourceDeltaLine(key, delta) {
    return `${RESOURCE_LABELS[key] || key} ${signed(delta)}`;
}

export function isResourceKey(k) {
    return RESOURCE_KEYS.includes(k);
}
