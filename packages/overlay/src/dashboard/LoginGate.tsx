import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api.js';

interface Props {
  children: JSX.Element;
}

type Status = 'checking' | 'open' | 'locked';

/**
 * Sits in front of the dashboard when `DASHBOARD_PASSWORD` is set.
 *
 * The gate is drawn here, but it is not the security boundary — the server
 * refuses every state-changing call without a session regardless of what this
 * component renders. Hiding the UI is only so an unauthenticated visitor gets
 * a login box instead of a dashboard full of failed requests.
 */
export function LoginGate({ children }: Props): JSX.Element {
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .authStatus()
      .then(({ required, authenticated }) =>
        setStatus(!required || authenticated ? 'open' : 'locked'),
      )
      // A server that cannot answer at all is not a locked one; let the app
      // load and show its own connection error rather than a login box.
      .catch(() => setStatus('open'));
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void api
      .login(password)
      .then(() => {
        setPassword('');
        setStatus('open');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  if (status === 'checking') return <div className="app-loading">Checking access…</div>;
  if (status === 'open') return children;

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-title">Stream Control</h1>
        <p className="muted">This dashboard is password protected.</p>

        <input
          className="input login-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
        />

        {error ? <div className="banner banner-error">{error}</div> : null}

        <button className="btn btn-primary login-submit" type="submit" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="muted login-hint">
          Set in <code>DASHBOARD_PASSWORD</code> in your <code>.env</code>. Overlay browser sources
          keep working without it.
        </p>
      </form>
    </div>
  );
}
