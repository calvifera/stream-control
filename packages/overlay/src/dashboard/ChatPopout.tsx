import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatLog } from './ChatLog.js';
import { api, type PanelStatus } from '../lib/api.js';

/**
 * Chat in a floating always-on-top window.
 *
 * Uses the Document Picture-in-Picture API, which is the only way a web page
 * gets a genuinely always-on-top window without shipping a desktop app. Unlike
 * video PiP it holds arbitrary DOM, so this is the real chat log rather than a
 * screenshot of it — clicking to mute or copy a handle still works.
 *
 * It floats above borderless-windowed games, which is the whole point on a
 * single monitor. Exclusive-fullscreen games are a different matter: nothing
 * short of an overlay injector goes above those, so a game has to be in
 * borderless/windowed mode for this to be visible.
 *
 * Requirements and limits worth knowing:
 *   - Chromium only (Chrome/Edge). Firefox and Safari have no equivalent.
 *   - Needs a secure context; `localhost` counts, so no HTTPS setup required.
 *   - Must be opened from a real click — it cannot be launched automatically.
 *   - One PiP window exists per browser at a time.
 *   - It closes when the tab that opened it closes.
 */

interface DocumentPiP {
  requestWindow: (options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
  }) => Promise<Window>;
  window: Window | null;
}

const pipApi = (): DocumentPiP | null =>
  (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture ??
  null;

export const popoutSupported = (): boolean => Boolean(pipApi());

/**
 * Opens the chat in its own window.
 *
 * Two very different windows are possible and the button prefers the better
 * one. The native panel is genuinely transparent, so a game shows through it;
 * the browser's Picture-in-Picture window floats on top but is composited
 * opaquely, and no amount of CSS makes the desktop visible behind it.
 *
 * So: launch the panel when it has been built, and fall back to PiP when it
 * has not. The fallback is not a consolation prize — it needs no Rust
 * toolchain and works on any machine, which is worth keeping for exactly the
 * moment someone is trying this on a laptop.
 */
export function ChatPopoutButton(): JSX.Element {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelStatus | null>(null);
  const [opening, setOpening] = useState(false);
  const supported = popoutSupported();
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    void api
      .panelStatus()
      .then(setPanel)
      .catch(() => setPanel(null));
  }, []);

  const openPip = useCallback(() => {
    const api = pipApi();
    if (!api) return;

    void api
      .requestWindow({ width: 420, height: 760 })
      .then((won) => {
        copyStyles(won);
        won.document.title = 'Chat';
        won.document.body.classList.add('chat-popout-body');
        won.addEventListener('pagehide', () => setPipWindow(null));
        setPipWindow(won);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const openPanel = useCallback(() => {
    setOpening(true);
    setError(null);
    void api
      .openPanel()
      .then(setPanel)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setOpening(false));
  }, []);

  // Closing the opener tab kills the PiP window anyway; this just keeps our
  // own state honest if the component unmounts first. The native panel is a
  // separate process and deliberately survives.
  useEffect(() => () => pipWindow?.close(), [pipWindow]);

  // Only reachable from the machine running the server — the window would open
  // on that desktop, so offering it through the tunnel would be a button that
  // does nothing visible.
  const canOpenPanel = Boolean(panel?.available && panel.local);

  if (!canOpenPanel && !supported) {
    return (
      <span className="muted chatlog-unsupported">
        {panel && !panel.available
          ? 'Build the desktop panel with npm run panel:build, or use Chrome/Edge for the browser pop-out.'
          : 'Pop-out needs Chrome or Edge — this browser has no Picture-in-Picture window API.'}
      </span>
    );
  }

  const label = (): string => {
    if (opening) return 'Opening…';
    if (pipWindow) return 'Close pop-out';
    return canOpenPanel ? '\u29c9 Open chat panel' : '\u29c9 Pop out chat';
  };

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="chip"
        disabled={opening}
        title={
          canOpenPanel
            ? 'Opens the transparent always-on-top panel. Drag it by its title bar to see what is underneath.'
            : 'Opens a floating browser window. It stays on top but is not see-through.'
        }
        onClick={pipWindow ? () => pipWindow.close() : canOpenPanel ? openPanel : openPip}
      >
        {label()}
      </button>

      {/* The panel is the better window, but PiP still works and needs no
          build step, so it stays reachable rather than being replaced. */}
      {canOpenPanel && supported && !pipWindow ? (
        <button type="button" className="chip chip-ghost" onClick={openPip} title="Floating browser window instead — not see-through, but needs no build.">
          Browser pop-out
        </button>
      ) : null}

      {error ? <span className="muted chatlog-unsupported">{error}</span> : null}
      {pipWindow ? createPortal(<ChatLog dense />, pipWindow.document.body) : null}
    </>
  );
}

/**
 * Clones this document's styles into the PiP window.
 *
 * A PiP window starts with an empty document and inherits nothing, so without
 * this the chat renders as unstyled text. Same-origin stylesheets are copied
 * rule by rule; `<link>` elements are re-linked, which also covers the built
 * CSS bundle in production.
 */
function copyStyles(target: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('');
      const style = target.document.createElement('style');
      style.textContent = rules;
      target.document.head.appendChild(style);
    } catch {
      // Cross-origin sheets throw on `cssRules`; re-link them instead so the
      // browser fetches them itself.
      const link = target.document.createElement('link');
      link.rel = 'stylesheet';
      if (sheet.href) {
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  }
}
