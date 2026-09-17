import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * The panel's own controls: an emergency TTS stop, and a settings popover.
 *
 * These live in the panel rather than only in the dashboard because of when
 * they are needed. The dashboard is behind a full-screen game; by the time it
 * is in front of you, the thing you wanted to stop has finished being read
 * aloud to everyone watching. A control that is only reachable in ten seconds
 * is not an emergency control.
 */

/**
 * Kills whatever TTS is doing, immediately.
 *
 * One click, one effect: stop the clip that is playing and drop everything
 * queued behind it. Deliberately *not* also disabling TTS — a panicked click
 * should not silently turn the feature off for the rest of the stream, which
 * is the kind of thing nobody notices until they wonder why chat has gone
 * quiet. The sustained version of that is a toggle in the settings menu, one
 * deliberate step away.
 */
export function KillTtsButton(): JSX.Element {
  const [killed, setKilled] = useState(false);

  const kill = (): void => {
    void api.clearTts().catch(() => undefined);
    setKilled(true);
    window.setTimeout(() => setKilled(false), 1400);
  };

  return (
    <button
      type="button"
      className={killed ? 'panel-btn panel-btn-kill panel-btn-kill-on' : 'panel-btn panel-btn-kill'}
      title="Stop speech and clear the queue"
      aria-label="Stop speech and clear the queue"
      onClick={kill}
    >
      {killed ? (
        <span className="panel-kill-done">stopped</span>
      ) : (
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          {/* A speaker with a slash: "silence this", not "mute the app". */}
          <path d="M1 4.5h2L5.5 2v8L3 7.5H1z" fill="currentColor" />
          <path d="M7.5 4l3 4M10.5 4l-3 4" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      )}
    </button>
  );
}

export interface PanelSettingsProps {
  opacity: number;
  fontScale: number;
  alwaysOnTop: boolean;
  /** Null while the config hasn't loaded, which hides the speech switch. */
  ttsEnabled: boolean | null;
  onOpacity: (value: number) => void;
  onFontScale: (value: number) => void;
  onAlwaysOnTop: (value: boolean) => void;
  onTtsEnabled: (value: boolean) => void;
}

/**
 * Settings, in a popover anchored to the panel's own header.
 *
 * The dashboard has the same controls and always will — but adjusting opacity
 * from there means looking at the slider instead of at the thing it changes.
 * Here the panel is directly underneath, over the game, so the value can be
 * set by eye in one pass.
 *
 * The values arrive from the page rather than from the config, because the
 * page previews a drag before the server has saved it. See `useDraft`.
 */
export function PanelSettingsMenu(props: PanelSettingsProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);

  // Click anywhere else to dismiss. Registered only while open, so the panel
  // is not paying for a document listener for the hours it is not.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="panel-settings" ref={holder}>
      <button
        type="button"
        className={open ? 'panel-btn panel-btn-on' : 'panel-btn'}
        title="Panel settings"
        aria-label="Panel settings"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path
            d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.5 2.5l1 1M8.5 8.5l1 1M9.5 2.5l-1 1M3.5 8.5l-1 1"
            stroke="currentColor"
            strokeWidth="1.1"
            fill="none"
          />
        </svg>
      </button>

      {open ? (
        <div className="panel-menu" role="dialog" aria-label="Panel settings">
          <label className="panel-menu-row">
            <span>
              Opacity <em>{Math.round(props.opacity * 100)}%</em>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={props.opacity}
              onChange={(event) => props.onOpacity(Number(event.target.value))}
            />
          </label>

          <label className="panel-menu-row">
            <span>
              Text size <em>{Math.round(props.fontScale * 100)}%</em>
            </span>
            <input
              type="range"
              min={0.6}
              max={2.5}
              step={0.05}
              value={props.fontScale}
              onChange={(event) => props.onFontScale(Number(event.target.value))}
            />
          </label>

          <label className="panel-menu-check">
            <input
              type="checkbox"
              checked={props.alwaysOnTop}
              onChange={(event) => props.onAlwaysOnTop(event.target.checked)}
            />
            <span>Always on top</span>
          </label>

          {/* Kept in the menu rather than the header on purpose: turning TTS
              off is a decision you have to remember to undo, and it should
              not share a row with the button you press in a hurry. */}
          {props.ttsEnabled !== null ? (
            <label className="panel-menu-check">
              <input
                type="checkbox"
                checked={props.ttsEnabled}
                onChange={(event) => props.onTtsEnabled(event.target.checked)}
              />
              <span>{props.ttsEnabled ? 'Speech on' : 'Speech off'}</span>
            </label>
          ) : null}

          <p className="panel-menu-note">
            Opacity applies to the background only — text stays fully solid at every setting.
          </p>
        </div>
      ) : null}
    </div>
  );
}
