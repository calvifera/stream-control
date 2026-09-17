/**
 * Moving text: a name that waves, hops or shimmers through colours.
 *
 * Two independent choices, because they combine: `motion` moves each letter,
 * `fill` colours each letter. Both are drawn per letter with staggered
 * timing, which is what turns "the name bobs" into "a wave runs through the
 * name".
 *
 * Per-letter colour rather than one gradient clipped to the whole word is
 * deliberate. A clipped gradient (what highlight tiers use) cannot follow
 * letters that move on their own — the browser paints nothing at all — and it
 * also hides text outlines and shadows. Cycling each letter through the
 * palette with an offset gives the same flowing gradient and keeps both.
 */

export const TEXT_MOTIONS = ['none', 'wave', 'bounce'] as const;
export type TextMotion = (typeof TEXT_MOTIONS)[number];

export const TEXT_FILLS = ['solid', 'gradient', 'rainbow'] as const;
export type TextFill = (typeof TEXT_FILLS)[number];

export const TEXT_MOTION_LABELS: Record<TextMotion, string> = {
  none: 'Still',
  wave: 'Wave',
  bounce: 'Hop',
};

export const TEXT_FILL_LABELS: Record<TextFill, string> = {
  solid: 'Solid',
  gradient: 'Gradient',
  rainbow: 'Rainbow',
};

export interface TextEffect {
  motion: TextMotion;
  fill: TextFill;
  /** Gradient stops, for `gradient`. Two or more. */
  colors: string[];
  /**
   * How far letters travel, in em. Around 0.08 is a gentle ripple; past 0.25
   * the name stops being readable at a glance.
   */
  amplitude: number;
  /** Seconds for one full cycle of the motion and the colours. */
  speed: number;
}

export const NO_TEXT_EFFECT: TextEffect = {
  motion: 'none',
  fill: 'solid',
  colors: ['#25f4ee', '#fe2c55'],
  amplitude: 0.08,
  speed: 1.8,
};

/** The subtle waving gradient the gift sources start with. */
export const WAVE_GRADIENT_EFFECT: TextEffect = {
  motion: 'wave',
  fill: 'gradient',
  colors: ['#ffd84d', '#ff6fb1', '#8f7bff'],
  amplitude: 0.08,
  speed: 1.8,
};

/** A gentle hop running along the text, for amounts. */
export const HOP_EFFECT: TextEffect = {
  ...NO_TEXT_EFFECT,
  motion: 'bounce',
  amplitude: 0.12,
  speed: 2.4,
};

export const isTextEffectActive = (effect: TextEffect | undefined): boolean =>
  Boolean(effect && (effect.motion !== 'none' || effect.fill !== 'solid'));
