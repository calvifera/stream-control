import { useEffect } from 'react';
import {
  clearsMinimum,
  matchMediaRule,
  giftVisual,
  type GiftMediaRule,
  type GiftShowcaseEvent,
  type Platform,
  type StreamEvent,
} from '@streaming/shared';
import { onStreamEvent } from '../../lib/store.js';

/** What the gift sources have in common when deciding what to show. */
export interface GiftFeedOptions {
  platforms: Platform[];
  minValue: Record<Platform, number>;
  includeGiftedSubs: boolean;
}

/**
 * Whether a gift source shows this event.
 *
 * Gifts only once a combo is finished, so a 50× Rose streak is one card
 * rather than fifty. Gifted subs only as the bomb announcement or a single
 * gift, never once per recipient on top of it.
 */
export function acceptsShowcase(
  event: StreamEvent,
  options: GiftFeedOptions,
): event is GiftShowcaseEvent {
  if (options.platforms.length > 0 && !options.platforms.includes(event.platform)) return false;

  if (event.type === 'gift') {
    // An event from an older server has no detail and nothing to draw.
    if (!event.detail) return false;
    if (!event.repeatEnd) return false;
    return clearsMinimum(event.detail, event.totalDiamonds, options.minValue);
  }

  if (event.type === 'subscribe') {
    return options.includeGiftedSubs && event.isGifted && !event.giftBombMember;
  }

  return false;
}

export function useGiftFeed(
  options: GiftFeedOptions,
  onGift: (event: GiftShowcaseEvent) => void,
  deps: unknown[],
): void {
  useEffect(
    () =>
      onStreamEvent((event) => {
        if (acceptsShowcase(event, options)) onGift(event);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
}

export interface ResolvedMedia {
  /** Picture or video to show, or null when there is nothing. */
  url: string | null;
  /** The matching rule's own sound, which beats bracket sounds. Null for none. */
  soundUrl: string | null;
  /** True when a rule chose the picture, which then replaces the platform's own. */
  custom: boolean;
}

/** The platform's own art, unless a media rule says otherwise. */
export function resolveMedia(
  event: GiftShowcaseEvent,
  rules: readonly GiftMediaRule[],
): ResolvedMedia {
  const rule = matchMediaRule(event, rules);
  const own = event.type === 'gift' ? giftVisual(event.detail.media) : null;
  return {
    url: rule?.mediaUrl || own,
    soundUrl: rule?.soundUrl || null,
    custom: Boolean(rule?.mediaUrl),
  };
}
