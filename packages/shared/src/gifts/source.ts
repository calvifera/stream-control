import type { OverlayAnimation } from '../config.js';
import type { Platform } from '../platforms.js';
import type { TextEffect } from '../textEffects.js';
import type { GiftMediaRule } from './media.js';
import { defaultSoundSettings, type GiftSoundSettings } from './sounds.js';

/**
 * Settings for the gift sources.
 *
 * Both gift sources decide what to show in the same way before they draw
 * anything, so that half of their settings is one shape, `GiftFeedSettings`.
 * The interface, the schema and the defaults each build on it, which is what
 * keeps a new source of this kind from restating it a third time.
 */

/** What the gift sources have in common when choosing what to show and play. */
export interface GiftFeedSettings {
  /** Empty shows every platform. */
  platforms: Platform[];
  /**
   * Smallest gift worth showing, per platform, in that platform's own unit:
   * diamonds, bits, cents. One shared number would mean wildly different
   * amounts of money on each.
   */
  minValue: Record<Platform, number>;
  /** Also show gift bombs of subs and memberships. */
  includeGiftedSubs: boolean;
  mediaRules: GiftMediaRule[];
  /** Sounds by price bracket. A media rule's sound still wins. */
  sounds: GiftSoundSettings;
}

/**
 * Anything at all on TikTok and Twitch, and every Super Chat on YouTube,
 * which is already a paid amount: a new source should show that it works on
 * the first gift.
 */
export const DEFAULT_GIFT_MIN_VALUE: Record<Platform, number> = {
  tiktok: 1,
  twitch: 1,
  youtube: 0,
};

export const defaultGiftFeed = (soundsEnabled: boolean): GiftFeedSettings => ({
  platforms: [],
  minValue: { ...DEFAULT_GIFT_MIN_VALUE },
  includeGiftedSubs: true,
  mediaRules: [],
  sounds: defaultSoundSettings(soundsEnabled),
});

/**
 * One big, animated card per gift, drawn the way its platform draws it.
 *
 * Unlike `alerts`, which renders every event type from one text template,
 * this is built only for paid support, and each platform gets its own
 * renderer: a TikTok gift with its combo count, a Twitch cheermote at the
 * right tier, a Super Chat in its colour band with the message on it.
 */
export interface GiftSpotlightOverlaySettings extends GiftFeedSettings {
  durationMs: number;
  /** Let bigger gifts stay on screen longer, up to twice `durationMs`. */
  scaleDuration: boolean;
  showAvatar: boolean;
  showValue: boolean;
  /** The viewer's message, filtered. Super Chats and cheers carry one. */
  showMessage: boolean;
  /** Height of the gift picture, in px. */
  mediaSize: number;
  animation: OverlayAnimation;
  /**
   * Fallback sound, used when bracket sounds are off and no media rule names
   * its own.
   */
  soundUrl: string;
  soundVolume: number;
  /** Cards waiting beyond this many are dropped, oldest first. 0 keeps all. */
  maxQueue: number;
  nameEffect: TextEffect;
  valueEffect: TextEffect;
}

export const GIFT_RAIN_DIRECTIONS = ['fall', 'rise'] as const;
export type GiftRainDirection = (typeof GIFT_RAIN_DIRECTIONS)[number];

/**
 * Gift pictures raining across the source, one per gift in a combo.
 *
 * The ambient counterpart to the spotlight: it never queues, so a busy
 * stream looks busy instead of falling minutes behind. Its sounds are off by
 * default, since a spotlight usually plays them.
 */
export interface GiftRainOverlaySettings extends GiftFeedSettings {
  /** Sprites for one event, so a 99× combo does not bury the stream. */
  maxPerGift: number;
  /** Hard cap on sprites at once, oldest removed first. */
  maxOnScreen: number;
  spriteSize: number;
  /** Time for one sprite to cross the source. */
  fallSeconds: number;
  direction: GiftRainDirection;
}
