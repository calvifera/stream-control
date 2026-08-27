import { useEffect, useRef, useState } from 'react';
import { PLATFORM_INFO, PLATFORMS, viewerKey, type Platform } from '@streaming/shared';
import { api, type UserSearchResult } from '../lib/api.js';

interface Props {
  /**
   * Always receives a canonical `platform:handle` key. Callers must send
   * `key` to the API, never `username` — a bare handle is filed under
   * TikTok and would act on a different person on another platform.
   */
  onPick: (user: { key: string; username: string; displayName: string }) => void;
  placeholder?: string;
  /** Label for the button that accepts a handle not in the directory. */
  allowFreeform?: boolean;
}

/**
 * Search-as-you-type over everyone the server has seen in chat.
 *
 * None of the connected platforms offer a usable public user search, so this
 * cannot autocomplete arbitrary accounts — but the people you want to trust or
 * mute are the ones who
 * have actually been in your room, and those are all here, with avatars,
 * message counts and strike history. Handles not in the directory can still be
 * typed in by hand.
 */
export function UserPicker({ onPick, placeholder, allowFreeform = true }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  // Only consulted for a handle typed by hand: search results already know
  // which platform they came from.
  const [freeformPlatform, setFreeformPlatform] = useState<Platform>('tiktok');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);

  // Debounced search; stale responses are discarded by sequence number.
  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    setLoading(true);

    const timer = setTimeout(() => {
      void api
        .searchUsers(query)
        .then((users) => {
          if (requestId.current === id) setResults(users);
        })
        .catch(() => undefined)
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [query, open]);

  // Close when clicking outside.
  useEffect(() => {
    const onDocumentClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const pick = (user: UserSearchResult): void => {
    onPick(user);
    setQuery('');
    setOpen(false);
  };

  const pickFreeform = (): void => {
    const handle = query.trim().toLowerCase().replace(/^@/, '');
    if (!handle) return;
    onPick({ key: viewerKey(freeformPlatform, handle), username: handle, displayName: handle });
    setQuery('');
    setOpen(false);
  };

  const exactExists = results.some(
    (user) => user.username === query.trim().toLowerCase().replace(/^@/, ''),
  );

  return (
    <div className="user-picker" ref={containerRef}>
      <input
        className="input"
        value={query}
        placeholder={placeholder ?? 'Search viewers…'}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (results[0] && !query.trim()) return;
            if (results[0] && exactExists) pick(results[0]);
            else if (allowFreeform) pickFreeform();
            else if (results[0]) pick(results[0]);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
      />

      {open ? (
        <div className="user-picker-menu">
          {loading && results.length === 0 ? <div className="user-picker-empty">Searching…</div> : null}

          {results.map((user) => (
            <button key={user.username} type="button" className="user-picker-row" onClick={() => pick(user)}>
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="user-picker-avatar" />
              ) : (
                <span className="user-picker-avatar user-picker-avatar-blank" />
              )}
              <span className="user-picker-names">
                <strong>{user.displayName}</strong>
                <span className="muted">@{user.username}</span>
              </span>
              <span className="user-picker-meta">
                {user.strikes > 0 ? <span className="chip chip-strike">{user.strikes} strikes</span> : null}
                {user.trusted ? <span className="chip chip-on">trusted</span> : null}
                {user.penalized ? <span className="chip chip-strike">muted</span> : null}
                <span className="muted">{user.messages} msgs</span>
              </span>
            </button>
          ))}

          {!loading && results.length === 0 ? (
            <div className="user-picker-empty">
              No one matching that has been in your chat yet.
            </div>
          ) : null}

          {allowFreeform && query.trim() && !exactExists ? (
            <div className="user-picker-freeform-row">
              <select
                value={freeformPlatform}
                onChange={(event) => setFreeformPlatform(event.target.value as Platform)}
                onClick={(event) => event.stopPropagation()}
                aria-label="Platform"
              >
                {PLATFORMS.map((id) => (
                  <option key={id} value={id}>
                    {PLATFORM_INFO[id].label}
                  </option>
                ))}
              </select>
              <button type="button" className="user-picker-row user-picker-freeform" onClick={pickFreeform}>
                Add <strong>@{query.trim().toLowerCase().replace(/^@/, '')}</strong> anyway
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
