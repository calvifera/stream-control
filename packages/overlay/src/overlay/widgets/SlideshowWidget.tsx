import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlideshowOverlaySettings } from '@streaming/shared';
import { isDemoMode } from '../../lib/store.js';

/** Placeholder tiles so the source previews without anything uploaded. */
const DEMO_SLIDES = ['Slide one', 'Slide two', 'Slide three', 'Slide four'];

function shuffled<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/**
 * Cycles the images in a folder.
 *
 * Two layers are always mounted — the outgoing image stays until its
 * transition finishes, which is what makes a crossfade actually cross rather
 * than blink through the background.
 */
export function SlideshowWidget({ settings }: { settings: SlideshowOverlaySettings }): JSX.Element {
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const demo = isDemoMode();

  // Reload whenever the folder changes. Polled slowly as well, so images
  // dropped in while the source is live appear without touching the source.
  // The gallery preview loads the real folder too. Listing images is a plain
  // HTTP call with no socket behind it, so this still honours the rule that a
  // preview never competes with a live source — and a slideshow preview that
  // showed invented captions instead of your own pictures was not much of a
  // preview. Only a folder that isn't set yet falls back to placeholders.
  useEffect(() => {
    if (!settings.folder) {
      setImages([]);
      return undefined;
    }

    let cancelled = false;
    const load = (): void => {
      void fetch(`/api/slideshows/${encodeURIComponent(settings.folder)}`)
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('missing'))))
        .then((folder: { images: string[] }) => {
          if (cancelled) return;
          setError(null);
          setImages((current) =>
            current.length === folder.images.length &&
            current.every((name, i) => name === folder.images[i])
              ? current
              : folder.images,
          );
        })
        .catch(() => {
          if (!cancelled) setError(`No folder called “${settings.folder}”`);
        });
    };

    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [settings.folder]);

  /**
   * Captioned stand-ins, used only when a preview has no real folder to show
   * — otherwise an unconfigured source would render as an empty black box in
   * the gallery and look broken rather than unfinished.
   */
  const usePlaceholders = demo && images.length === 0;

  // The order images are shown in. Reshuffled whenever the list changes.
  const order = useMemo(() => {
    const source = usePlaceholders ? DEMO_SLIDES : images;
    const positions = source.map((_, i) => i);
    return settings.shuffle ? shuffled(positions) : positions;
  }, [images, settings.shuffle, usePlaceholders]);

  const count = order.length;
  const step = useRef(0);

  useEffect(() => {
    setIndex(0);
    setPrevious(null);
    setDone(false);
    step.current = 0;
  }, [count, settings.folder]);

  useEffect(() => {
    if (count <= 1 || done) return undefined;

    const timer = setInterval(() => {
      step.current += 1;
      if (settings.once && step.current >= count) {
        setDone(true);
        return;
      }
      setIndex((current) => {
        setPrevious(current);
        return (current + 1) % count;
      });
    }, Math.max(500, settings.intervalSeconds * 1000));

    return () => clearInterval(timer);
  }, [count, settings.intervalSeconds, settings.once, done]);

  // Drop the outgoing layer once its transition has played out.
  useEffect(() => {
    if (previous === null) return undefined;
    const timer = setTimeout(() => setPrevious(null), settings.transitionMs + 60);
    return () => clearTimeout(timer);
  }, [previous, settings.transitionMs]);

  if (error) return <div className="slideshow-empty">{error}</div>;
  if (count === 0) {
    return (
      <div className="slideshow-empty">
        {settings.folder ? 'No images in this folder yet' : 'Pick a folder in the dashboard'}
      </div>
    );
  }

  const nameFor = (position: number): string =>
    usePlaceholders ? (DEMO_SLIDES[position] ?? '') : (images[position] ?? '');

  const srcFor = (position: number): string =>
    `/media/slideshows/${encodeURIComponent(settings.folder)}/${encodeURIComponent(nameFor(position))}`;

  const caption = nameFor(order[index] as number).replace(/\.[a-z0-9]+$/i, '');

  const layer = (position: number, role: 'in' | 'out'): JSX.Element => {
    const slot = order[position] as number;
    const key = `${role}-${slot}-${position}`;
    const style: React.CSSProperties = {
      animationDuration: `${settings.transitionMs}ms`,
      borderRadius: settings.cornerRadius,
      objectFit: settings.fit,
    };

    if (usePlaceholders) {
      return (
        <div
          key={key}
          className={`slideshow-layer slideshow-demo tx-${settings.transition}-${role}`}
          style={{ ...style, animationDuration: `${settings.transitionMs}ms` }}
        >
          {DEMO_SLIDES[slot]}
        </div>
      );
    }

    return (
      <img
        key={key}
        className={`slideshow-layer tx-${settings.transition}-${role}`}
        style={style}
        src={srcFor(slot)}
        alt=""
      />
    );
  };

  return (
    <div className="slideshow">
      <div className="slideshow-stage">
        {previous !== null && settings.transition !== 'none' ? layer(previous, 'out') : null}
        {layer(index, 'in')}
      </div>
      {settings.showCaption ? <div className="slideshow-caption">{caption}</div> : null}
    </div>
  );
}
