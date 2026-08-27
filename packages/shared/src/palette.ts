/**
 * Deterministic name colours, banded by platform.
 *
 * Two jobs at once, and they pull against each other. A viewer's colour has to
 * be stable and distinct so you can follow one person down a fast-moving chat,
 * *and* it has to say which platform they came from so a merged chat is
 * readable without reading every badge. Give every name the full colour wheel
 * and the second job is impossible; give each platform one flat colour and the
 * first one is.
 *
 * The compromise: each platform owns a band of hue centred on its brand
 * colour, and a handle's hash picks a position inside its own platform's band
 * plus a lightness and saturation step. So a wall of cyan is TikTok and a wall
 * of purple is Twitch — visible in peripheral vision, before you have read a
 * single character — while two TikTok regulars still look nothing like each
 * other.
 *
 * The bands do not overlap and are separated by a gap wide enough that an
 * edge-of-band TikTok name is never mistaken for an edge-of-band Twitch one.
 */

import { PLATFORM_INFO, normalizeHandle, type Platform } from './platforms.js';

/**
 * Hue centre for each platform, in degrees, taken from the brand colour in
 * `PLATFORM_INFO`. Kept as explicit numbers rather than derived at runtime:
 * these anchor the whole scheme, and a brand-colour tweak should be a
 * deliberate decision to move everyone's name rather than a silent side
 * effect of restyling a button.
 */
export const PLATFORM_HUE: Record<Platform, number> = {
  tiktok: 178, // #25f4ee, cyan
  youtube: 348, // #ff0033, red
  twitch: 264, // #a970ff, purple
};

/**
 * Half-width of each band, in degrees.
 *
 * 30 is the widest value that still leaves clear air between every pair of
 * bands: TikTok runs 148-208, Twitch 234-294 and YouTube 318-18, so the
 * narrowest gap between neighbours is 24 degrees — about four times the step
 * between two adjacent names inside a band, which is what keeps "different
 * platform" a bigger visual jump than "different person".
 */
export const HUE_SPREAD = 30;

/**
 * The second and third axes.
 *
 * Hue alone across a 60-degree band gives neighbours that are too close to
 * tell apart at a glance. Varying lightness and saturation as well turns one
 * axis into three, so two handles that happen to hash to a similar hue are
 * still separated by being visibly paler or more washed out.
 *
 * The lightness floor is 58: everything here has to stay legible as small text
 * over arbitrary gameplay footage, and below about 55 the darker hues start
 * losing to a bright background even with a text stroke behind them.
 */
const LIGHTNESS = [58, 67, 76] as const;
const SATURATION = [70, 85, 100] as const;

/**
 * FNV-1a, 32 bits.
 *
 * The obvious `hash = (hash * 31 + char) % 360` has only 360 states, which is
 * fine when hue is the only thing you need and useless here — three axes want
 * three independent slices of the hash, and a 360-state value cannot supply
 * them without the lightness being a function of the hue.
 *
 * The prime is applied as shifts rather than a multiply because `h * 16777619`
 * exceeds the 53-bit mantissa of a JS number and quietly drops the low bits,
 * which are exactly the bits that make short, similar handles differ.
 */
export function hashHandle(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** HSL to `#rrggbb`. */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * The colour a viewer's name is drawn in.
 *
 * Hashes the handle only, not the platform — the platform decides the band, so
 * folding it into the hash as well would gain nothing and would break the
 * pleasant property that the same handle lands in the same *position* in
 * whichever band it appears in.
 */
export function nameColor(platform: Platform, handle: string): string {
  const hash = hashHandle(normalizeHandle(handle));

  // Independent slices. Byte 0 is the position in the band, and the two
  // nibbles above it choose the lightness and saturation step.
  const position = (hash & 0xff) / 0xff;
  const hue = (PLATFORM_HUE[platform] + (position * 2 - 1) * HUE_SPREAD + 360) % 360;
  // Masked to their own nibble first. Taking `(hash >>> 8) % 3` and
  // `(hash >>> 12) % 3` would look independent and not be: a modulo consumes
  // every bit above the shift, so the two would share all of them.
  const lightness = LIGHTNESS[((hash >>> 8) & 0xf) % LIGHTNESS.length] as number;
  const saturation = SATURATION[((hash >>> 12) & 0xf) % SATURATION.length] as number;

  return legible(hue, saturation, lightness);
}

/**
 * The floor a name colour has to clear to survive being read over gameplay.
 *
 * HSL lightness is not perceptual lightness, and the gap is enormous: blue
 * contributes 7% of luminance where green contributes 72%, so `hsl(240 100% 58%)`
 * and `hsl(120 100% 58%)` are nominally the same lightness and one of them is
 * nearly black. A flat lightness band therefore produces perfectly readable
 * greens and cyans alongside blues you cannot make out at all — which lands
 * squarely in the middle of Twitch's band, where a good third of the hues are
 * blue.
 */
const MIN_LUMINANCE = 0.2;

/**
 * Raises lightness until the colour actually clears the floor.
 *
 * Hue is never touched, so the platform band and the viewer's identity both
 * survive; only the dark end of the wheel moves, and only as far as it has to.
 * The cost is that lightness variety compresses in the blue region — three
 * steps can lift to the same value there — which is a fair trade against a
 * name nobody can read.
 */
function legible(hue: number, saturation: number, lightness: number): string {
  let value = lightness;
  let hex = hslToHex(hue, saturation, value);
  // 92 is the ceiling: past it everything is near-white and the hue stops
  // carrying any platform signal at all. Nothing in the current bands gets
  // anywhere near it.
  while (value < 92 && luminance(hex) < MIN_LUMINANCE) {
    value += 2;
    hex = hslToHex(hue, saturation, value);
  }
  return hex;
}

/**
 * Relative luminance, per WCAG.
 *
 * Used by `legible` above to lift dark hues, and by the checks to prove the
 * result actually clears the floor for every colour the palette can emit —
 * rather than trusting that a nominal lightness band is high enough at hues
 * where it demonstrably is not.
 */
export function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Which band a colour falls in, or `null`. Exists for the checks. */
export function bandOf(hue: number): Platform | null {
  for (const platform of Object.keys(PLATFORM_HUE) as Platform[]) {
    const centre = PLATFORM_HUE[platform];
    // Circular distance: the +540/-180 dance keeps 350 and 10 twenty degrees
    // apart rather than three hundred and forty.
    const delta = Math.abs(((hue - centre + 540) % 360) - 180);
    // The half-degree of slack is quantization, not sloppiness. This reads the
    // hue back out of a colour already rounded to 8 bits per channel, and a
    // hue generated exactly at the band edge reconstructs up to a third of a
    // degree outside it. Without the tolerance it reports strays that are an
    // artefact of the hex encoding rather than of the palette.
    if (delta <= HUE_SPREAD + 0.5) return platform;
  }
  return null;
}

/** The brand colour, for anything that wants the platform rather than a person. */
export const platformColor = (platform: Platform): string => PLATFORM_INFO[platform].color;
