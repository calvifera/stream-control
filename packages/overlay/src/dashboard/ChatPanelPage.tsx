import { useEffect, useMemo } from 'react';
import {
  DEFAULT_CHAT_PANEL,
  type AppConfig,
  type ChatPanelConfig,
  type ConnectionState,
  type Platform,
} from '@streaming/shared';
import { api } from '../lib/api.js';
import { identify, useLiveSelect } from '../lib/store.js';
import { useDraft } from '../lib/useDraft.js';
import { formatElapsed, useElapsed } from '../lib/useElapsed.js';
import { inPanelShell, panelWindow } from '../lib/panelWindow.js';
import { ChatLog } from './ChatLog.js';
import { KillTtsButton, PanelSettingsMenu } from './PanelControls.js';

/**
 * The chat log as a standalone page, for the desktop panel to load.
 *
 * Served at `/panel/chat`. Deliberately not the same thing as an overlay:
 * overlays are built to be captured by streaming software and shown to viewers, this is built
 * to sit on top of a game and be read by one person, so it keeps the
 * dashboard's controls (the profile card, mute, trust) rather than the broadcast
 * styling.
 *
 * The background is painted here rather than by the native window, because a
 * window-level opacity fades the text along with it and chat becomes
 * unreadable long before the background is see-through enough to play behind.
 * Painting `rgba(background, opacity)` in CSS keeps every glyph at full
 * strength over a transparent window.
 *
 * The window has no system title bar, so the strip along the top is the whole
 * of its chrome: drag, minimise, close. It is an ordinary interactive window —
 * to see what is under it, move it.
 */
export function ChatPanelPage(): JSX.Element {
  // Selected piece by piece: this page stays open for hours, and `useLive`
  // would re-render it, and the whole chat log under it, on every stats tick.
  const panel: ChatPanelConfig = useLiveSelect((s) => s.config?.chatPanel) ?? DEFAULT_CHAT_PANEL;
  const ttsEnabled = useLiveSelect((s) => s.config?.tts.enabled ?? null);
  const connections = useLiveSelect((s) => s.snapshot?.connections);
  const shell = inPanelShell();

  // The drag previews on the panel straight away, and saves in the background.
  const [opacity, setOpacity] = useDraft(panel.opacity, (value) => savePanel({ opacity: value }));
  const [fontScale, setFontScale] = useDraft(panel.fontScale, (value) =>
    savePanel({ fontScale: value }),
  );

  /*
   * Never a TTS listener.
   *
   * The dashboard registers itself as a listener of last resort, and an
   * overlay registers as a real one. This page must be neither: it is open for
   * hours while a game runs, and if it took a clip an overlay should have
   * played, the audio would come out of the desktop instead of the stream —
   * silently, and only for the one person who cannot hear the difference.
   */
  useEffect(() => {
    identify({ role: 'dashboard', listener: false, logs: false });
  }, []);

  useEffect(() => {
    panelWindow.setAlwaysOnTop(panel.alwaysOnTop);
  }, [panel.alwaysOnTop]);

  const style = useMemo(
    () => ({
      // Transparent window plus an explicitly painted background: without the
      // second half the desktop would show through the *text* too.
      background: withAlpha(panel.background, opacity),
      fontSize: `${fontScale}rem`,
    }),
    [panel.background, opacity, fontScale],
  );

  useEffect(() => {
    document.documentElement.classList.add('panel-root');
    document.body.classList.add('panel-root');
    return () => {
      document.documentElement.classList.remove('panel-root');
      document.body.classList.remove('panel-root');
    };
  }, []);

  return (
    <div className="chat-panel" style={style}>
      <div
        className="chat-panel-grip"
        // Left button only: a right-click here should not start hauling the
        // window around.
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          // The settings menu hangs from this strip, so a press on one of its
          // sliders lands here too. Starting a window drag from it took the
          // pointer away from the slider, which then refused to move.
          const target = event.target as HTMLElement;
          if (target.closest('.panel-btn, .panel-settings, input, label, button')) return;
          panelWindow.drag();
        }}
      >
        <span className="chat-panel-title">Chat</span>
        <StreamClock connections={connections ?? {}} />

        {/* Outside the `shell` guard, unlike the window buttons: stopping
            speech and changing opacity are useful in a plain browser tab too,
            where minimise and close would be meaningless. */}
        <div className="panel-buttons panel-buttons-left">
          <KillTtsButton />
          <PanelSettingsMenu
            opacity={opacity}
            fontScale={fontScale}
            alwaysOnTop={panel.alwaysOnTop}
            ttsEnabled={ttsEnabled}
            onOpacity={setOpacity}
            onFontScale={setFontScale}
            onAlwaysOnTop={(value) => savePanel({ alwaysOnTop: value })}
            onTtsEnabled={(value) =>
              void api
                .patchConfig({ tts: { enabled: value } } as unknown as Partial<AppConfig>)
                .catch(() => undefined)
            }
          />
        </div>

        {shell ? (
          <div className="panel-buttons">
            <button
              type="button"
              className="panel-btn"
              title="Minimise"
              aria-label="Minimise"
              onClick={panelWindow.minimize}
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
            <button
              type="button"
              className="panel-btn panel-btn-close"
              title="Close the panel"
              aria-label="Close"
              onClick={panelWindow.close}
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      <ChatLog dense />

      {/* Undecorated windows lose the system resize border, so the corner has
          to be drawn and wired up by hand. */}
      {shell ? (
        <div
          className="panel-resize"
          title="Resize"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            panelWindow.resize('SouthEast');
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Saves panel settings.
 *
 * Sends only the changed fields. The server merges them into the stored
 * config, so two sliders saving at once can't overwrite each other with a
 * stale copy of the whole panel section.
 */
function savePanel(over: Partial<ChatPanelConfig>): void {
  void api
    .patchConfig({ chatPanel: over } as unknown as Partial<AppConfig>)
    .catch(() => undefined);
}

/**
 * `#rrggbb` plus an alpha, as `rgba()`.
 *
 * Not `#rrggbbaa`: that form is fine in every browser that matters, but this
 * value is also read by the settings UI, and keeping one representation avoids
 * a class of "works in the page, not in the form" bug.
 */
function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);

  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * How long you have actually been live.
 *
 * Counts from the earliest platform that is *broadcasting*, not from when the
 * server started and not from when a socket opened. Those were the same thing
 * until Twitch arrived, and on Twitch they are barely related: chat is read
 * over IRC, which joins a channel whether or not anyone is streaming to it, so
 * a clock started on connection would run all day on an idle channel and
 * report it as stream time.
 *
 * Earliest rather than latest, because going live on a second platform an hour
 * in does not restart the stream — and nothing at all when no platform is
 * live, which is a truthful blank rather than a zero that looks like a
 * measurement.
 */
function StreamClock({
  connections,
}: {
  connections: Partial<Record<Platform, ConnectionState>>;
}): JSX.Element | null {
  const live = Object.values(connections)
    .map((state) => state?.liveSince)
    .filter((value): value is number => typeof value === 'number');

  const since = live.length > 0 ? Math.min(...live) : null;
  const elapsed = useElapsed(since);
  if (elapsed === null) return null;

  return (
    <span className="chat-panel-clock" title="Time live this session">
      {formatElapsed(elapsed)}
    </span>
  );
}
