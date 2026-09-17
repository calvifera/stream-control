import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  PLATFORM_INFO,
  subscriptionWeight,
  type GiftRainOverlaySettings,
  type GiftShowcaseEvent,
} from '@streaming/shared';
import { GiftMedia } from './GiftMedia.js';
import { bracketSound, playSound } from '../../lib/giftSounds.js';
import { resolveMedia, useGiftFeed } from './feed.js';
import '../../styles/gifts.css';

interface Sprite {
  id: string;
  url: string | null;
  /** Shown when there is no picture: a Super Chat has none of its own. */
  fallback: { color: string; glyph: string };
  left: number;
  delayMs: number;
  drift: number;
  spin: number;
  scale: number;
  expiresAt: number;
}

/**
 * How many sprites a gift is worth.
 *
 * A combo rains one per gift and a gift bomb one per sub. Things with no
 * count of their own scale with value instead, gently: a 100-bit cheer is a
 * handful, a 10,000-bit one a downpour, both capped by `maxPerGift`.
 */
function spriteCount(event: GiftShowcaseEvent, max: number): number {
  let count: number;
  if (event.type === 'subscribe') count = subscriptionWeight(event);
  else if (event.detail.kind === 'tiktok-gift') count = event.repeatCount;
  else count = Math.round(1 + Math.log10(Math.max(1, event.totalDiamonds)) * 3);
  return Math.max(1, Math.min(max, count));
}

function fallbackFor(event: GiftShowcaseEvent): Sprite['fallback'] {
  if (event.type === 'subscribe') return { color: PLATFORM_INFO[event.platform].color, glyph: '🎁' };
  const color = event.detail.colors?.secondary ?? PLATFORM_INFO[event.platform].color;
  return { color, glyph: event.detail.kind.startsWith('youtube') ? '$' : '✦' };
}

/**
 * Gift pictures falling (or rising) across the whole source.
 *
 * Never queues. Every gift adds its sprites immediately with staggered start
 * times, and the oldest are removed past `maxOnScreen`, so a busy stream
 * looks busy in real time rather than replaying last minute's gifts.
 */
export function GiftRainWidget({ settings }: { settings: GiftRainOverlaySettings }): JSX.Element {
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const seq = useRef(0);

  useGiftFeed(
    settings,
    (event) => {
      const media = resolveMedia(event, settings.mediaRules);
      if (settings.sounds.enabled) {
        const bracket = bracketSound(event, settings.sounds);
        if (media.soundUrl) playSound(media.soundUrl, settings.sounds.volume);
        else if (bracket) playSound(bracket.sound, bracket.volume);
      }
      const count = spriteCount(event, settings.maxPerGift);
      const fallMs = settings.fallSeconds * 1000;
      const now = Date.now();
      const added: Sprite[] = Array.from({ length: count }, (_, i) => {
        const delayMs = Math.min(i * 90 + Math.random() * 120, fallMs);
        return {
          id: `${event.id}-${seq.current++}`,
          url: media.url,
          fallback: fallbackFor(event),
          left: Math.random() * 100,
          delayMs,
          drift: (Math.random() - 0.5) * 30,
          spin: (Math.random() - 0.5) * 540,
          scale: 0.75 + Math.random() * 0.5,
          expiresAt: now + delayMs + fallMs + 200,
        };
      });
      setSprites((current) => [...current, ...added].slice(-settings.maxOnScreen));
    },
    [settings],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setSprites((current) =>
        current.some((s) => s.expiresAt <= now) ? current.filter((s) => s.expiresAt > now) : current,
      );
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`gift-rain gift-rain-${settings.direction}`}>
      {sprites.map((sprite) => {
        const size = settings.spriteSize * sprite.scale;
        const style = {
          left: `${sprite.left}%`,
          width: size,
          height: size,
          animationDuration: `${settings.fallSeconds}s`,
          animationDelay: `${sprite.delayMs}ms`,
          '--drift': `${sprite.drift}vw`,
          '--spin': `${sprite.spin}deg`,
        } as CSSProperties;
        return (
          <div key={sprite.id} className="gift-sprite" style={style}>
            {sprite.url ? (
              <GiftMedia url={sprite.url} className="gift-sprite-media" />
            ) : (
              <span
                className="gift-sprite-coin"
                style={{ background: sprite.fallback.color, fontSize: size * 0.5 }}
              >
                {sprite.fallback.glyph}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
