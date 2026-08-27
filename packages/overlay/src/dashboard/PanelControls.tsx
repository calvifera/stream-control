import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CHAT_PANEL, type AppConfig, type ChatPanelConfig } from '@streaming/shared';
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

/**
 * Settings, in a popover anchored to the panel's own header.
 *
 * The dashboard has the same controls and always will — but adjusting opacity
 * from there means looking at the slider instead of at the thing it changes.
 * Here the panel is directly underneath, over the game, so the value can be
 * set by eye in one pass.
 */
export function PanelSettingsMenu({ config }: { config: AppConfig | null }): JSX.Element {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);
  const panel: ChatPanelConfig = config?.chatPanel ?? DEFAULT_CHAT_PANEL;

  // Click anywhere else to dismiss. Registered only while open, so the panel
  // is not paying for a document listener for the hours it is not.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent): void => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const set = (over: Partial<ChatPanelConfig>): void => {
    void api.patchConfig({ chatPanel: { ...panel, ...over } }).catch(() => undefined);
  };

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
              Opacity <em>{Math.round(panel.opacity * 100)}%</em>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={panel.opacity}
              onChange={(event) => set({ opacity: Number(event.target.value) })}
            />
          </label>

          <label className="panel-menu-row">
            <span>
              Text size <em>{Math.round(panel.fontScale * 100)}%</em>
            </span>
            <input
              type="range"
              min={0.6}
              max={2.5}
              step={0.05}
              value={panel.fontScale}
              onChange={(event) => set({ fontScale: Number(event.target.value) })}
            />
          </label>

          <label className="panel-menu-check">
            <input
              type="checkbox"
              checked={panel.alwaysOnTop}
              onChange={(event) => set({ alwaysOnTop: event.target.checked })}
            />
            <span>Always on top</span>
          </label>

          <TtsSwitch config={config} />

          <p className="panel-menu-note">
            Opacity applies to the background only — text stays fully solid at every setting.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The sustained counterpart to the kill button.
 *
 * Kept in the menu rather than the header on purpose: turning TTS off is a
 * decision you have to remember to undo, and it should not share a row with
 * the button you hit in a hurry.
 */
function TtsSwitch({ config }: { config: AppConfig | null }): JSX.Element | null {
  if (!config) return null;
  const enabled = config.tts.enabled;

  return (
    <label className="panel-menu-check">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => {
          void api
            .patchConfig({ tts: { ...config.tts, enabled: event.target.checked } })
            .catch(() => undefined);
        }}
      />
      <span>{enabled ? 'Speech on' : 'Speech off'}</span>
    </label>
  );
}
