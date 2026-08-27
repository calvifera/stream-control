import { useCallback, useEffect, useState } from 'react';
import { api, type ReviewState } from '../lib/api.js';
import { Button, Panel } from './controls.js';

/**
 * Near misses: things that sounded like a severe term but were not blocked.
 *
 * Grouped by phrase rather than by message, because the raw flag rate on
 * ordinary chat is roughly one message in six and it is overwhelmingly the
 * same handful of phrases. Grouped, that is a few one-time decisions —
 * "peace" is not an attack, "deal dough" is — and an ignored phrase never
 * comes back.
 */
export function ReviewPanel(): JSX.Element {
  const [state, setState] = useState<ReviewState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);

  const load = useCallback(() => {
    void api.review().then(setState).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    // Near misses arrive with chat, so poll while the tab is open.
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const act = (phrase: string, action: () => Promise<ReviewState>): void => {
    setBusy(phrase);
    setError(null);
    void action()
      .then(setState)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  };

  const entries = state?.entries ?? [];
  const ignored = state?.ignored ?? [];

  return (
    <Panel
      title="Sound-alike review"
      description="Messages that sounded like a severe term without being spelled like one — “deal dough”, “pool sea”, “gape horn”. Nothing here was blocked. Phonetic matching cannot be blocked on safely (“peace” and “no gear” genuinely collide with slurs), so it reports and you decide."
      actions={
        entries.length > 0 ? (
          <Button variant="ghost" onClick={() => act('*', () => api.reviewClear())}>
            Clear list
          </Button>
        ) : undefined
      }
    >
      {error ? <div className="banner banner-error">{error}</div> : null}

      {entries.length === 0 ? (
        <p className="muted">
          Nothing flagged yet. Anything that sounds like a term on your severe list will show up
          here, with the message it came from.
        </p>
      ) : (
        <div className="people-list">
          {entries.map((entry) => (
            <div key={entry.phrase} className="person-row person-row-penalty">
              <div className="person-detail">
                <span className="person-name">
                  “{entry.phrase}”{' '}
                  <span className="muted">
                    sounds like “{entry.term}”
                    {entry.distance === 0 ? ' (identical)' : ''}
                  </span>
                </span>
                <span className="muted">
                  seen {entry.count}× · last {new Date(entry.lastSeen).toLocaleString()}
                </span>
                {entry.samples[0] ? (
                  <span className="person-evidence mono">
                    @{entry.samples[0].username}: “{entry.samples[0].text}”
                  </span>
                ) : null}
              </div>
              <div className="button-row">
                <Button
                  variant="danger"
                  disabled={busy === entry.phrase}
                  title="Add to the severe phrase list, where it is enforced exactly"
                  onClick={() => act(entry.phrase, () => api.reviewBlock(entry.phrase))}
                >
                  Block it
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy === entry.phrase}
                  title="Innocent collision — never report this phrase again"
                  onClick={() => act(entry.phrase, () => api.reviewIgnore(entry.phrase))}
                >
                  Not a bypass
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {ignored.length > 0 ? (
        <>
          <button type="button" className="btn btn-ghost" onClick={() => setShowIgnored(!showIgnored)}>
            {showIgnored ? 'Hide' : 'Show'} {ignored.length} ignored phrase
            {ignored.length === 1 ? '' : 's'}
          </button>
          {showIgnored ? (
            <div className="chips">
              {ignored.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  className="chip"
                  title="Start reporting this again"
                  onClick={() => act(phrase, () => api.reviewUnignore(phrase))}
                >
                  {phrase} ✕
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}
