import { useEffect, useRef, useState } from 'react';
import {
  resolveGiftSound,
  type GiftShowcaseEvent,
  type GiftSpotlightOverlaySettings,
  type ResolvedGiftSound,
} from '@streaming/shared';
import { ANIMATION_CLASS } from '../style.js';
import { resolveMedia, useGiftFeed } from './feed.js';
import { GiftCard } from './renderers.js';
import { playSound } from '../../lib/giftSounds.js';
import '../../styles/gifts.css';

interface Card {
  event: GiftShowcaseEvent;
  mediaUrl: string | null;
  sound: ResolvedGiftSound | null;
  durationMs: number;
}

/**
 * How long a gift stays up.
 *
 * Bigger gifts earn more time, on a log scale so the top end does not hold
 * the queue for a minute: roughly ×1.25 at 10, ×1.5 at 100, ×2 at 10,000 of
 * the platform's unit.
 */
function durationFor(event: GiftShowcaseEvent, settings: GiftSpotlightOverlaySettings): number {
  if (!settings.scaleDuration) return settings.durationMs;
  const amount =
    event.type === 'gift' ? event.totalDiamonds : (event.giftCount ?? 1) * 100;
  const factor = 1 + Math.min(1, Math.log10(Math.max(1, amount)) / 4);
  return Math.round(settings.durationMs * factor);
}

/**
 * One gift at a time, full size, drawn the way its platform draws it.
 *
 * A queue rather than a stack, for the same reason the alerts source uses
 * one — but capped, because a gift train that runs ten minutes behind the
 * stream is worse than one that skips the oldest few.
 */
export function GiftSpotlightWidget({ settings }: { settings: GiftSpotlightOverlaySettings }): JSX.Element {
  const [current, setCurrent] = useState<Card | null>(null);
  const queue = useRef<Card[]>([]);
  const showing = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const showNext = (): void => {
    const next = queue.current.shift();
    if (!next) {
      showing.current = false;
      setCurrent(null);
      return;
    }
    showing.current = true;
    setCurrent(next);

    // Played as the card appears, not as the gift arrives, so the sound
    // lands with the picture even when gifts are queued.
    if (next.sound) playSound(next.sound.sound, next.sound.volume);

    timer.current = window.setTimeout(showNext, next.durationMs);
  };

  useGiftFeed(
    settings,
    (event) => {
      const media = resolveMedia(event, settings.mediaRules);
      queue.current.push({
        event,
        mediaUrl: media.url,
        sound: resolveGiftSound(event, media.soundUrl, settings),
        durationMs: durationFor(event, settings),
      });
      if (settings.maxQueue > 0 && queue.current.length > settings.maxQueue) {
        queue.current.splice(0, queue.current.length - settings.maxQueue);
      }
      if (!showing.current) showNext();
    },
  );

  return (
    <div className="gift-spotlight">
      {current ? (
        <div
          key={current.event.id}
          className={`gs-frame ${ANIMATION_CLASS[settings.animation]}`}
          style={{ ['--gs-duration' as string]: `${current.durationMs}ms` }}
        >
          <GiftCard
            event={current.event}
            mediaUrl={current.mediaUrl}
            options={{
              showAvatar: settings.showAvatar,
              showValue: settings.showValue,
              showMessage: settings.showMessage,
              mediaSize: settings.mediaSize,
              nameEffect: settings.nameEffect,
              valueEffect: settings.valueEffect,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
