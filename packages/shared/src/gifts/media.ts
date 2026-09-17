import type { GiftEvent, SubscribeEvent } from '../events.js';
import type { Platform } from '../platforms.js';
import type { GiftKind } from './model.js';
import { subscriptionWeight } from './describe.js';

/**
 * Your own GIFs and sounds, chosen per gift.
 *
 * The platforms' own art is the default, and for plenty of gifts there is
 * none — a TikTok Rose is a still image, and bits spent on a message effect
 * have no picture at all. Rules put something of the streamer's choosing on
 * screen instead: a specific GIF for a Galaxy, a clip for any cheer over
 * 1,000 bits, a sound for every Super Chat.
 *
 * First enabled match wins, so order is priority and a catch-all belongs at
 * the bottom.
 */

/** Gift kinds, plus gifted subscriptions, which the gift sources also show. */
export type GiftMediaKind = GiftKind | 'gifted-subs';

export const GIFT_MEDIA_KINDS: readonly GiftMediaKind[] = [
  'tiktok-gift',
  'twitch-cheer',
  'twitch-power-up',
  'youtube-super-chat',
  'youtube-super-sticker',
  'youtube-jewels',
  'gifted-subs',
];

export interface GiftMediaRule {
  id: string;
  enabled: boolean;
  /** `any`, or only gifts from this platform. */
  platform: Platform | 'any';
  /** Only these kinds. Empty matches every kind. */
  kinds: GiftMediaKind[];
  /**
   * Gift name contains this, ignoring case — "rose", "galaxy", "super
   * sticker". Empty matches every name.
   */
  giftName: string;
  /** Minimum total in the platform's own unit (diamonds, bits, cents). */
  minValue: number;
  /** Image, GIF, WebP or video to show. Empty keeps the platform's own. */
  mediaUrl: string;
  /** Sound to play. Empty falls back to the source's default sound. */
  soundUrl: string;
}

export type GiftShowcaseEvent = GiftEvent | SubscribeEvent;

/** Values a rule is matched against, for either event kind. */
export function showcaseFacts(event: GiftShowcaseEvent): {
  kind: GiftMediaKind;
  name: string;
  total: number;
  valueKnown: boolean;
} {
  if (event.type === 'subscribe') {
    return {
      kind: 'gifted-subs',
      name: event.platform === 'youtube' ? 'membership' : 'sub',
      total: subscriptionWeight(event),
      valueKnown: true,
    };
  }
  return {
    kind: event.detail.kind,
    name: event.giftName,
    total: event.totalDiamonds,
    valueKnown: event.detail.value.known,
  };
}

export function matchMediaRule(
  event: GiftShowcaseEvent,
  rules: readonly GiftMediaRule[],
): GiftMediaRule | null {
  const facts = showcaseFacts(event);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.platform !== 'any' && rule.platform !== event.platform) continue;
    if (rule.kinds.length > 0 && !rule.kinds.includes(facts.kind)) continue;
    const wanted = rule.giftName.trim().toLowerCase();
    if (wanted && !facts.name.toLowerCase().includes(wanted)) continue;
    if (facts.valueKnown && facts.total < rule.minValue) continue;
    return rule;
  }
  return null;
}

/** True for a video file, which needs `<video>` rather than `<img>`. */
export const isVideoUrl = (url: string): boolean => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
