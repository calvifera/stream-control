import { useEffect, useState } from 'react';
import { listKey } from '@streaming/shared';
import { api, type UserSearchResult } from './api.js';

/**
 * Resolves viewer references to their directory entries.
 *
 * Takes whatever a config list happens to hold — a qualified `platform:handle`
 * or a bare handle left over from before platforms existed — and returns a map
 * keyed the canonical way. Look up with `listKey(entry)` and both forms hit the
 * same row.
 *
 * Keying this map on the bare `username` is what made an entire trusted list
 * lose its avatars and display names: the config had moved to qualified keys
 * while the map was still filed under bare ones, so every lookup missed and
 * every row silently fell back to showing the raw key.
 *
 * Anyone the directory has never heard of is simply absent, and the caller
 * falls back to the handle.
 */
export function useKnownUsers(references: string[]): Map<string, UserSearchResult> {
  const [known, setKnown] = useState<Map<string, UserSearchResult>>(new Map());
  // Depend on the joined string so a new array with the same contents — which
  // every config broadcast produces — doesn't refetch on each render.
  const key = references.join(',');

  useEffect(() => {
    const names = key ? key.split(',') : [];
    if (names.length === 0) {
      setKnown(new Map());
      return;
    }

    let cancelled = false;
    void api
      .knownUsers(names)
      .then((users) => {
        if (!cancelled) setKnown(new Map(users.map((user) => [listKey(user.key), user])));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [key]);

  return known;
}
