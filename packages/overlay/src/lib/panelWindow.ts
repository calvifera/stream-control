/**
 * The bits of the native window the page is allowed to drive.
 *
 * The panel window is undecorated — no system title bar, no minimise, no close
 * button — so the page has to draw those itself and route them back here.
 *
 * Everything degrades to a no-op in an ordinary browser tab. The same page is
 * reachable at `/panel/chat` in Chrome for styling it without launching the
 * shell, and it should render there rather than throwing on a missing global.
 */

interface TauriWindow {
  startDragging(): Promise<void>;
  startResizeDragging(direction: unknown): Promise<void>;
  close(): Promise<void>;
  minimize(): Promise<void>;
  setAlwaysOnTop(value: boolean): Promise<void>;
}

interface TauriBridge {
  window?: {
    getCurrentWindow?: () => TauriWindow;
  };
}

const bridge = (): TauriBridge | undefined =>
  (window as unknown as { __TAURI__?: TauriBridge }).__TAURI__;

/** True when running inside the desktop shell rather than a browser tab. */
export function inPanelShell(): boolean {
  return Boolean(bridge()?.window?.getCurrentWindow);
}

const current = (): TauriWindow | undefined => {
  try {
    return bridge()?.window?.getCurrentWindow?.();
  } catch {
    // A malformed bridge is not worth crashing the chat log over.
    return undefined;
  }
};

/**
 * Swallows failures on purpose.
 *
 * Every one of these is a cosmetic window action. If closing fails there is a
 * taskbar entry to fall back on, and an exception thrown out of a click
 * handler would take the React tree down with it — losing the chat, which is
 * the part that actually matters.
 */
const attempt = (run: (win: TauriWindow) => Promise<unknown>): void => {
  const win = current();
  if (!win) return;
  void Promise.resolve(run(win)).catch(() => undefined);
};

export const panelWindow = {
  /**
   * Starts a native drag.
   *
   * Called from `mousedown` rather than using Tauri's `data-tauri-drag-region`
   * attribute: that attribute is handled by a script Tauri injects into pages
   * it serves, and this page is loaded from the local HTTP server instead.
   * Doing it explicitly works the same either way.
   */
  drag: () => attempt((win) => win.startDragging()),
  resize: (direction: string) => attempt((win) => win.startResizeDragging(direction)),
  close: () => attempt((win) => win.close()),
  minimize: () => attempt((win) => win.minimize()),
  setAlwaysOnTop: (value: boolean) => attempt((win) => win.setAlwaysOnTop(value)),

};
