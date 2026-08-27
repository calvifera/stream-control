/**
 * Shared helpers for the live check scripts.
 *
 * These talk to a *running* server, and some of them reset config to get a
 * known starting state. That once wiped a real TikTok session id and Google
 * API key off a working install — credentials that cannot be regenerated from
 * anything on disk. So mutating checks now snapshot the config first and put
 * it back afterwards, no matter how they exit.
 */

/** Server origin, without the `/api` prefix — socket checks need it bare. */
export const BASE = process.env.CHECK_BASE ?? 'http://localhost:4700';

/** Paths are relative to `/api`, e.g. `call('/config')`. */
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
    ...init,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const post = <T>(path: string, body?: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * Runs `body` with the server's config saved beforehand and restored after,
 * including on failure or Ctrl-C. Returns whatever `body` returns.
 */
export async function withConfigSnapshot<T>(body: () => Promise<T>): Promise<T> {
  const snapshot = await call<unknown>('/config');
  let restored = false;

  const restore = async (): Promise<void> => {
    if (restored) return;
    restored = true;
    try {
      await call('/config', { method: 'PUT', body: JSON.stringify(snapshot) });
      console.log('\n(config restored to its pre-test state)');
    } catch (error) {
      // Loud, because the alternative is the user silently losing settings.
      console.error(
        '\n!! COULD NOT RESTORE THE CONFIG — check data/config.json and the .bak.json files next to it',
      );
      console.error(error instanceof Error ? error.message : error);
    }
  };

  const onSignal = (): void => {
    void restore().then(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    return await body();
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await restore();
  }
}

/** Warns when a check is about to mutate a server holding real credentials. */
export async function warnIfLiveCredentials(): Promise<void> {
  try {
    const config = await call<{
      tts?: { sessionId?: string; google?: { apiKey?: string } };
    }>('/config');

    const hasSecrets = Boolean(
      config.tts?.sessionId?.trim() || config.tts?.google?.apiKey?.trim(),
    );
    if (!hasSecrets) return;

    console.log(
      `NOTE: ${BASE} holds real credentials. They are snapshotted and restored,\n` +
        '      but for full isolation run a separate instance:\n' +
        '        PORT=4799 npm start\n' +
        '        CHECK_BASE=http://localhost:4799 npm run check:api -w @streaming/server\n',
    );
  } catch {
    // If we can't read the config the check itself will fail informatively.
  }
}
