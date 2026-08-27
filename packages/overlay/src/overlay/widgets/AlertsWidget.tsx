import { useEffect, useRef, useState } from 'react';
import {
  buildTemplateVars,
  renderTemplate,
  type AlertsOverlaySettings,
  type StreamEvent,
} from '@streaming/shared';
import { onStreamEvent } from '../../lib/store.js';
import { ANIMATION_CLASS } from '../style.js';

interface Props {
  settings: AlertsOverlaySettings;
}

interface Alert {
  id: string;
  text: string;
  avatarUrl: string | null;
  imageUrl: string | null;
}

/**
 * Alerts are shown one at a time from a queue: two overlapping cards is worse
 * than a slightly delayed one, and a gift train would otherwise stack them.
 */
export function AlertsWidget({ settings }: Props): JSX.Element {
  const [current, setCurrent] = useState<Alert | null>(null);
  const queue = useRef<Alert[]>([]);
  const showing = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const showNext = (): void => {
      const next = queue.current.shift();
      if (!next) {
        showing.current = false;
        setCurrent(null);
        return;
      }

      showing.current = true;
      setCurrent(next);

      if (settings.soundUrl && audioRef.current) {
        audioRef.current.volume = settings.soundVolume;
        audioRef.current.currentTime = 0;
        // Autoplay is blocked until the page has been interacted with in a
        // normal browser; browser sources allow it by default.
        void audioRef.current.play().catch(() => undefined);
      }

      setTimeout(showNext, settings.durationMs);
    };

    return onStreamEvent((event) => {
      const alert = toAlert(event, settings);
      if (!alert) return;

      queue.current.push(alert);
      if (!showing.current) showNext();
    });
  }, [settings]);

  const animation = ANIMATION_CLASS[settings.animation];

  return (
    <div className="alerts-widget">
      {settings.soundUrl ? <audio ref={audioRef} src={settings.soundUrl} preload="auto" /> : null}
      {current ? (
        <div key={current.id} className={`alert-card ${animation}`}>
          {settings.showAvatar && current.avatarUrl ? (
            <img className="alert-avatar" src={current.avatarUrl} alt="" />
          ) : null}
          <span className="alert-text">{current.text}</span>
          {settings.showGiftImage && current.imageUrl ? (
            <img className="alert-gift" src={current.imageUrl} alt="" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function toAlert(event: StreamEvent, settings: AlertsOverlaySettings): Alert | null {
  if (!settings.eventTypes.includes(event.type)) return null;

  if (event.type === 'gift') {
    // Wait for the streak to finish, then apply the diamond threshold.
    if (!event.repeatEnd) return null;
    if (event.totalDiamonds < settings.minDiamonds) return null;
  }

  const template = settings.templates[event.type];
  if (!template) return null;

  const text = renderTemplate(template, buildTemplateVars(event)).trim();
  if (!text) return null;

  return {
    id: event.id,
    text,
    avatarUrl: event.user?.avatarUrl ?? null,
    imageUrl: event.type === 'gift' ? event.giftImageUrl : null,
  };
}
