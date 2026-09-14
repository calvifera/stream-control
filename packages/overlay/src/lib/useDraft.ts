import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A local value for a control that saves to the server as it moves.
 *
 * A slider bound straight to the config sends a save on every tick of a drag,
 * and renders whatever the server last echoed back. The echo is always a few
 * ticks behind, so the thumb snaps back under the pointer while you drag it.
 *
 * This hook shows the value being dragged immediately, sends it at most once
 * every `intervalMs`, and hands control back to the server value once the
 * server has caught up with the last value sent.
 *
 * Returns the value to render and a setter.
 */
export function useDraft<T>(
  value: T,
  commit: (next: T) => void,
  intervalMs = 120,
): [T, (next: T) => void] {
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const timer = useRef<number>(0);
  const lastSent = useRef<{ value: T; at: number } | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback((): void => {
    timer.current = 0;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    lastSent.current = { value: next.value, at: Date.now() };
    commitRef.current(next.value);
    // A fresh object re-runs the release check, which a server value that
    // already matched wouldn't otherwise trigger.
    setDraft((current) => (current ? { value: current.value } : current));
  }, []);

  const set = useCallback(
    (next: T): void => {
      setDraft({ value: next });
      pending.current = { value: next };
      if (!timer.current) timer.current = window.setTimeout(flush, intervalMs);
    },
    [flush, intervalMs],
  );

  // Release the draft once the server reports the value that was sent last.
  // A server that clamped or rejected it never matches, so give up after a
  // couple of seconds rather than holding a stale draft for ever.
  useEffect(() => {
    if (!draft || timer.current || pending.current || !lastSent.current) return;
    if (Object.is(value, lastSent.current.value)) {
      setDraft(null);
      return;
    }
    const wait = window.setTimeout(() => {
      if (!timer.current && !pending.current) setDraft(null);
    }, Math.max(0, 2000 - (Date.now() - lastSent.current.at)));
    return () => window.clearTimeout(wait);
  }, [value, draft]);

  // Send anything still waiting when the control goes away, so a quick drag
  // just before closing a menu isn't lost.
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (pending.current) flush();
    },
    [flush],
  );

  return [draft ? draft.value : value, set];
}
