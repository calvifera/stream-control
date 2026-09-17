import type { GiftColors } from './model.js';

/**
 * YouTube's paid-message vocabulary: Super Chat colour bands.
 *
 * YouTube paints a Super Chat in one of seven colours by how much was paid.
 * The watch page states the colour outright, and that is preferred — it is
 * already correct for the viewer's currency. The Data API gives a tier
 * number. Only when neither is present is the band guessed from the amount,
 * using US-dollar boundaries.
 */

export interface SuperChatBand {
  tier: number;
  /** Lowest amount in the band, in cents, for the dollar fallback. */
  minCents: number;
  name: string;
  colors: GiftColors;
}

export const SUPER_CHAT_BANDS: readonly SuperChatBand[] = [
  { tier: 1, minCents: 0, name: 'blue', colors: { primary: '#1565c0', secondary: '#1565c0', text: '#ffffff' } },
  { tier: 2, minCents: 200, name: 'light blue', colors: { primary: '#00b8d4', secondary: '#00e5ff', text: '#000000' } },
  { tier: 3, minCents: 500, name: 'green', colors: { primary: '#00bfa5', secondary: '#1de9b6', text: '#000000' } },
  { tier: 4, minCents: 1000, name: 'yellow', colors: { primary: '#ffb300', secondary: '#ffca28', text: '#000000' } },
  { tier: 5, minCents: 2000, name: 'orange', colors: { primary: '#e65100', secondary: '#f57c00', text: '#ffffff' } },
  { tier: 6, minCents: 5000, name: 'magenta', colors: { primary: '#c2185b', secondary: '#e91e63', text: '#ffffff' } },
  { tier: 7, minCents: 10000, name: 'red', colors: { primary: '#d00000', secondary: '#e62117', text: '#ffffff' } },
];

export function bandForTier(tier: number): SuperChatBand {
  const clamped = Math.min(Math.max(Math.round(tier), 1), SUPER_CHAT_BANDS.length);
  return SUPER_CHAT_BANDS[clamped - 1] as SuperChatBand;
}

export function bandForCents(cents: number): SuperChatBand {
  let band = SUPER_CHAT_BANDS[0] as SuperChatBand;
  for (const candidate of SUPER_CHAT_BANDS) {
    if (cents >= candidate.minCents) band = candidate;
  }
  return band;
}

/**
 * An ARGB integer from the watch page, as a CSS colour.
 *
 * YouTube sends colours as unsigned 32-bit numbers with alpha in the top
 * byte — `4278239141` is opaque `#00bfa5`.
 */
export function argbToCss(value: unknown): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  const rgb = (n >>> 0) & 0xffffff;
  const alpha = ((n >>> 0) >>> 24) & 0xff;
  const hex = `#${rgb.toString(16).padStart(6, '0')}`;
  return alpha === 0xff || alpha === 0 ? hex : `${hex}${alpha.toString(16).padStart(2, '0')}`;
}

/**
 * The band whose body colour matches, so the tier is known exactly rather
 * than guessed from an amount in an unknown currency.
 */
export function bandForColor(css: string | null): SuperChatBand | null {
  if (!css) return null;
  const hex = css.slice(0, 7).toLowerCase();
  return (
    SUPER_CHAT_BANDS.find(
      (band) => band.colors.secondary === hex || band.colors.primary === hex,
    ) ?? null
  );
}

/** Protocol-relative URLs (`//lh3.googleusercontent.com/...`) made absolute. */
export function absoluteUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
}
