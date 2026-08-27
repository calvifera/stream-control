import { useEffect, useState } from 'react';

const PREFIX = 'streaming.ui.';

/**
 * `useState` that survives a reload.
 *
 * This is for dashboard scratch state — the test phrase, which rule is open,
 * which tab you were on. None of it belongs in the server config: it is per
 * browser, not per stream, and two dashboards open at once should be allowed
 * to sit on different tabs. Anything the *stream* depends on still goes
 * through `patch()` to the server.
 *
 * `accept` rejects a stored value that no longer makes sense — a selected rule
 * that has since been deleted, say — so a stale id can't leave the UI pointing
 * at nothing after a reload.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
  accept?: (stored: T) => boolean,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = read<T>(key);
    if (stored === undefined) return initial;
    if (accept && !accept(stored)) return initial;
    return stored;
  });

  useEffect(() => {
    write(key, value);
  }, [key, value]);

  return [value, setValue];
}

/**
 * Storage can throw rather than merely be empty: Chrome raises on
 * `localStorage` access when third-party cookies are blocked, and a browser
 * source running from a file:// origin has no usable store at all. A dashboard
 * that forgets its test phrase is a nuisance; one that fails to render is not
 * acceptable, so every access here swallows.
 */
function read<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — the value just won't persist */
  }
}
