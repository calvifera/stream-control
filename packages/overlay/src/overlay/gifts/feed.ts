import { useEffect, useRef } from 'react';
import {
  clearsMinimum,
  matchMediaRule,
  giftVisual,
  type GiftFeedSettings,
  type GiftMediaRule,
  type GiftShowcaseEvent,
  type StreamEvent,
} from '@streaming/shared';
import { onStreamEvent } from '../../lib/store.js';

/**
 * Whether a gift source shows this event.
 *
 * Gifts only once a combo is finished, so a 50× Rose streak is one card
 * rather than fifty. Gifted subs only as the bomb announcement or a single
 * gift, never once per recipient on top of it.
 */
export function acceptsShowcase(
  event: StreamEvent,
  options: GiftFeedSettings,
): event is GiftShowcaseEvent {
  if (options.platforms.length > 0 && !options.platforms.includes(event.platform)) return false;

  if (event.type === 'gift') {
    if (!event.repeatEnd) return false;
    return clearsMinimum(event.detail, event.totalDiamonds, options.minValue);
  }

  if (event.type === 'subscribe') {
    return options.includeGiftedSubs && event.isGifted && !event.giftBombMember;
  }

  return false;
}

/**
 * Calls `onGift` for every event this source should show.
 *
 * Subscribes once. The settings and the callback are read from a ref at the
 * moment an event arrives, so a settings change applies to the next gift
 * without a resubscribe, and a callback that closes over this render's state
 * is never a stale one.
 */
export function useGiftFeed(
  settings: GiftFeedSettings,
  onGift: (event: GiftShowcaseEvent) => void,
): void {
  const latest = useRef({ settings, onGift });
  latest.current = { settings, onGift };

  useEffect(
    () =>
      onStreamEvent((event) => {
        const { settings, onGift } = latest.current;
        if (acceptsShowcase(event, settings)) onGift(event);
      }),
    [],
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
