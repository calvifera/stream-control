import { useCallback, useEffect, useState } from 'react';
import { api, type AvatarRefreshResult, type AvatarStatus } from '../lib/api.js';
import { Button, Panel } from './controls.js';

/**
 * Profile-picture cache status and a manual refresh.
 *
 * Chat frames carry an avatar, so anyone who talks gets one for free. Handles
 * added by hand never have, which is why they show as blank circles until this
 * fills them in.
 */
export function AvatarPanel(): JSX.Element {
  const [status, setStatus] = useState<AvatarStatus | null>(null);
  const [result, setResult] = useState<AvatarRefreshResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.avatarStatus().then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = (force: boolean): void => {
    setBusy(true);
    setError(null);
    setResult(null);
    void api
      .refreshAvatars(force)
      .then((r) => {
        setResult(r);
        load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const running = busy || Boolean(status?.running);

  return (
    <Panel
      title="Profile pictures"
      description="Cached locally and served from this server, so overlay sources can use them. TikTok's own avatar links are signed and expire after about two days — a browser source pointed at one would go blank mid-stream, so the image itself is stored here instead."
      actions={
        <div className="button-row">
          <Button variant="primary" disabled={running} onClick={() => refresh(false)}>
            {running ? 'Fetching…' : 'Fetch missing'}
          </Button>
          <Button
            disabled={running}
            title="Re-fetch everyone now, ignoring the usual back-off"
            onClick={() => refresh(true)}
          >
            Refresh all
          </Button>
        </div>
      }
    >
      {error ? <div className="banner banner-error">{error}</div> : null}

      {status ? (
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-value">{status.cached}</span>
            <span className="stat-label">cached</span>
          </div>
          <div className="stat">
            <span className="stat-value">{status.known}</span>
            <span className="stat-label">known users</span>
          </div>
          <div className="stat">
            <span className="stat-value">{status.missing}</span>
            <span className="stat-label">without one</span>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="banner banner-ok">
          Checked {result.checked} · {result.updated} updated · {result.skipped} have no picture set ·{' '}
          {result.failed} could not be reached
        </div>
      ) : null}

      {running ? (
        <p className="muted">
          Looking up profiles about one every two seconds — this is scraping a public page, not an
          API, so it is deliberately unhurried. Up to 25 per pass.
        </p>
      ) : null}

      <p className="field-hint">
        Runs automatically once an hour, trusted and muted users first. Each cached picture is
        available to overlays at <code>/avatars/&lt;handle&gt;.jpg</code>.
        {status?.lastRun ? ` Last pass ${new Date(status.lastRun).toLocaleTimeString()}.` : ''}
      </p>
    </Panel>
  );
}
