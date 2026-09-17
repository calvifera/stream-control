import type { Platform } from '../platforms.js';

/**
 * What a gift actually was, per platform.
 *
 * `GiftEvent` has always flattened every kind of paid support into one shape
 * — a name, an image and a `diamondCount` — so that thresholds, leaderboards
 * and totals work everywhere. That flattening stays; it is what lets a
 * leaderboard exist at all. But it threw away everything that makes each
 * platform's gift *look* like itself: a Twitch cheer's tier and animated
 * cheermote, a Super Chat's colour band and the message the viewer paid to
 * pin, a gift bomb's size.
 *
 * `GiftDetail` keeps it. Each platform owns one or more `kind`s, built by that
 * platform's normalizer and drawn by that platform's renderer, so a change to
 * how Twitch cheers work touches `gifts/twitch.ts` and nothing else.
 */

/**
 * The unit a gift's value is counted in.
 *
 * Deliberately not converted to money. Diamonds, bits and cents are all
 * roughly a cent each but not exactly, and a conversion would put a precise
 * looking number on something that is not — see `centsFrom` in the YouTube
 * normalizer for the longer version of this argument.
 */
export type GiftUnit = 'diamonds' | 'bits' | 'cents' | 'jewels';

export interface GiftValue {
  /** In `unit`. Zero with `known: false` when the platform did not say. */
  amount: number;
  unit: GiftUnit;
  /**
   * False when a gift certainly cost something but the platform does not
   * report how much — Twitch Power-ups are the case. Thresholds let these
   * through rather than treating an unreported price as free.
   */
  known: boolean;
  /** As a viewer would say it: "$5.00", "500 bits", "30 diamonds". */
  label: string;
}

export interface GiftMedia {
  /** A still image. Always safe to show small. */
  imageUrl: string | null;
  /**
   * Something that moves — a GIF, animated WebP, or video. Preferred by the
   * gift sources when present; null when the platform has nothing animated.
   */
  animationUrl: string | null;
}

/** Colours a platform itself paints this gift in, as CSS colours. */
export interface GiftColors {
  primary: string;
  secondary: string;
  text: string;
}

interface DetailBase {
  platform: Platform;
  value: GiftValue;
  media: GiftMedia;
  /** What the viewer typed with it, exactly as received. */
  message: string | null;
  /**
   * `message` after the filter chain. Set by the hub before anything renders
   * it; null when the filter dropped it. Overlays read only this.
   */
  displayMessage: string | null;
  colors: GiftColors | null;
}

/** An ordinary TikTok gift, possibly one step of a combo. */
export interface TikTokGiftDetail extends DetailBase {
  kind: 'tiktok-gift';
  platform: 'tiktok';
}

/** Bits cheered in a Twitch chat message. */
export interface TwitchCheerDetail extends DetailBase {
  kind: 'twitch-cheer';
  platform: 'twitch';
  /** Cheermote prefix used, lowercased: `cheer`, or a channel's own. */
  prefix: string;
  /** The cheermote tier the amount falls in: 1, 100, 1000, 5000 or 10000. */
  tier: number;
}

/** Bits spent on a Power-up: a gigantified emote or a message effect. */
export interface TwitchPowerUpDetail extends DetailBase {
  kind: 'twitch-power-up';
  platform: 'twitch';
  effect: 'gigantify' | 'message-effect';
  /** Twitch's name for the effect, e.g. `rainbow-eclipse`. */
  animationId: string | null;
}

/** A paid, highlighted YouTube chat message. */
export interface YouTubeSuperChatDetail extends DetailBase {
  kind: 'youtube-super-chat';
  platform: 'youtube';
  /** YouTube's colour band, 1 (blue) to 7 (red). */
  tier: number;
}

/** A paid YouTube sticker. */
export interface YouTubeSuperStickerDetail extends DetailBase {
  kind: 'youtube-super-sticker';
  platform: 'youtube';
  tier: number;
  /** YouTube's description of the sticker, for alt text. */
  stickerLabel: string | null;
}

/** A gift bought with Jewels, on vertical YouTube streams. */
export interface YouTubeJewelsDetail extends DetailBase {
  kind: 'youtube-jewels';
  platform: 'youtube';
}

export type GiftDetail =
  | TikTokGiftDetail
  | TwitchCheerDetail
  | TwitchPowerUpDetail
  | YouTubeSuperChatDetail
  | YouTubeSuperStickerDetail
  | YouTubeJewelsDetail;

export type GiftKind = GiftDetail['kind'];

export const GIFT_KIND_LABELS: Record<GiftKind, string> = {
  'tiktok-gift': 'TikTok gift',
  'twitch-cheer': 'Twitch cheer',
  'twitch-power-up': 'Twitch Power-up',
  'youtube-super-chat': 'Super Chat',
  'youtube-super-sticker': 'Super Sticker',
  'youtube-jewels': 'YouTube Jewels gift',
};

/** Unit each platform's gifts are counted in, for threshold labels. */
export const PLATFORM_GIFT_UNIT: Record<Platform, GiftUnit> = {
  tiktok: 'diamonds',
  twitch: 'bits',
  youtube: 'cents',
};

/**
 * Subscription tier, where the platform has one.
 *
 * Twitch reports `Prime`, `1000`, `2000` or `3000`; YouTube reports a
 * membership level *name* the channel chose, which is kept as `levelName`
 * because it has no numeric order anyone outside the channel could rely on.
 */
export type SubTier = 'prime' | '1' | '2' | '3';

export const SUB_TIER_LABELS: Record<SubTier, string> = {
  prime: 'Prime',
  '1': 'Tier 1',
  '2': 'Tier 2',
  '3': 'Tier 3',
};

export function formatUnit(amount: number, unit: GiftUnit): string {
  const n = Math.round(amount);
  switch (unit) {
    case 'cents':
      // No currency symbol: the amount is whatever currency the viewer paid
      // in, and printing "$" in front of yen would be a lie.
      return (n / 100).toFixed(2);
    case 'bits':
      return `${n.toLocaleString('en-US')} ${n === 1 ? 'bit' : 'bits'}`;
    case 'diamonds':
      return `${n.toLocaleString('en-US')} ${n === 1 ? 'diamond' : 'diamonds'}`;
    case 'jewels':
      return `${n.toLocaleString('en-US')} ${n === 1 ? 'Jewel' : 'Jewels'}`;
  }
}

/**
 * Whether a gift clears a per-platform minimum.
 *
 * The minimum is in the platform's own unit, which is the whole reason it is
 * per platform: "100" means a dollar of bits and a dollar of Super Chat, but
 * a single threshold box shared by all three silently meant 100 bits, 100
 * diamonds *and* one dollar.
 */
export function clearsMinimum(
  detail: Pick<DetailBase, 'value' | 'platform'>,
  total: number,
  minimum: Partial<Record<Platform, number>>,
): boolean {
  if (!detail.value.known) return true;
  return total >= (minimum[detail.platform] ?? 0);
}
