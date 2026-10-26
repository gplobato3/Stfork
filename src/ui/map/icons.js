/**
 * @file src/ui/map/icons.js
 * SVG path data for map markers, drawn around (0,0) in screen px (marker
 * groups are counter-scaled so they keep a constant on-screen size).
 * Drawn as paths so the markers never depend on installed fonts/emoji.
 */

/** Crossed swords: blades, guards and pommels. */
export const SWORDS_BLADES = 'M-5 5L5-5M5 5L-5-5';
export const SWORDS_GUARDS = 'M-4.7 1.1L-1.1 4.7M1.1 4.7L4.7 1.1';
export const SWORDS_POMMELS = 'M-6.3 6.3L-5.2 5.2M6.3 6.3L5.2 5.2';

/** Warning triangle (fill) + exclamation mark (stroke) + dot. */
export const WARN_TRIANGLE = 'M0-7.6L7.4 5.4Q7.9 6.3 6.9 6.3H-6.9Q-7.9 6.3-7.4 5.4Z';
export const WARN_BANG = 'M0-3.2V1.6';
export const WARN_DOT = { cx: 0, cy: 3.8, r: 0.95 };

/** Five-point capital star (outer r 4.6). */
export const STAR = 'M0-4.6L1.12-1.54L4.38-1.42L1.81 0.59L2.7 3.72L0 1.9L-2.7 3.72L-1.81 0.59L-4.38-1.42L-1.12-1.54Z';
