import { useEffect, useState } from 'react';

/**
 * A clock that ticks once a second, for durations that must keep counting.
 *
 * Deriving elapsed time from a render is not enough: the chat panel can sit
 * for minutes with nothing arriving, and a duration frozen at whatever it
 * read when the last message came in is worse than no duration at all —
 * it looks live and is not.
 *
 * Returns `null` when there is nothing to count from, so callers render a
 * dash rather than an hour of uptime that never happened.
 */
export function useElapsed(since: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!since) return;
    // Aligned to the next whole second rather than to mount, so the digits of
    // two separate clocks on the same screen turn over together instead of
    // drifting a few hundred milliseconds apart.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);

  if (!since) return null;
  return Math.max(0, now - since);
}

/**
 * `1:04:22` past an hour, `4:22` below it.
 *
 * Dropping the leading zero hour is what makes a glance work: the common case
 * on a stream panel is under an hour, and `0:04:22` reads as three units to
 * parse where `4:22` reads as one.
 */
export function formatElapsed(ms: number | null): string {
  if (ms === null) return '—';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
