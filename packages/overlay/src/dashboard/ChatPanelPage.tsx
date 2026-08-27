import { useEffect, useMemo } from 'react';
import { DEFAULT_CHAT_PANEL, type ChatPanelConfig } from '@streaming/shared';
import { identify, useLive } from '../lib/store.js';
import { inPanelShell, panelWindow } from '../lib/panelWindow.js';
import { ChatLog } from './ChatLog.js';
import { KillTtsButton, PanelSettingsMenu } from './PanelControls.js';

/**
 * The chat log as a standalone page, for the desktop panel to load.
 *
 * Served at `/panel/chat`. Deliberately not the same thing as an overlay:
 * overlays are built to be captured by OBS and shown to viewers, this is built
 * to sit on top of a game and be read by one person, so it keeps the
 * dashboard's controls (pin, copy a handle, mute) rather than the broadcast
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
  const { config } = useLive();
  const panel: ChatPanelConfig = config?.chatPanel ?? DEFAULT_CHAT_PANEL;
  const shell = inPanelShell();

  /*
   * Never a TTS listener.
   *
   * The dashboard registers itself as a listener of last resort, and an
   * overlay registers as a real one. This page must be neither: it is open for
   * hours while a game runs, and if it took a clip that OBS should have
   * played, the audio would come out of the desktop instead of the stream —
   * silently, and only for the one person who cannot hear the difference.
   */
  useEffect(() => {
    identify({ role: 'dashboard', listener: false });
  }, []);

  useEffect(() => {
    panelWindow.setAlwaysOnTop(panel.alwaysOnTop);
  }, [panel.alwaysOnTop]);

  const style = useMemo(
    () => ({
      // Transparent window plus an explicitly painted background: without the
      // second half the desktop would show through the *text* too.
      background: withAlpha(panel.background, panel.opacity),
      fontSize: `${panel.fontScale}rem`,
    }),
    [panel.background, panel.opacity, panel.fontScale],
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
          if ((event.target as HTMLElement).closest('.panel-btn')) return;
          panelWindow.drag();
        }}
      >
        <span className="chat-panel-title">Chat</span>

        {/* Outside the `shell` guard, unlike the window buttons: stopping
            speech and changing opacity are useful in a plain browser tab too,
            where minimise and close would be meaningless. */}
        <div className="panel-buttons panel-buttons-left">
          <KillTtsButton />
          <PanelSettingsMenu config={config} />
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
