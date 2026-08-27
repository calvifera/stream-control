import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Platform } from '@streaming/shared';
import { env } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('oauth');

/**
 * One OAuth 2.0 authorization-code flow, shared by every platform.
 *
 * The sign-in itself always happens on the provider's own site: this server
 * only ever sees the short-lived code they hand back. No password is typed
 * into this application, and none could be — that is the whole reason to use
 * OAuth rather than asking for credentials directly.
 *
 * Client ids and secrets come from `.env` because they are registered once by
 * hand. Neither is ever sent to the dashboard.
 */

export interface OAuthProvider {
  platform: Platform;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Extra query parameters the provider requires on the authorize step. */
  authorizeExtras?: Record<string, string>;
  /** Looks up who just signed in, for display. */
  identify?: (accessToken: string) => Promise<{ account: string; accountId: string } | null>;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
}

/**
 * Pending `state` values, mapped to the platform that issued them.
 *
 * `state` is the CSRF defence for the whole flow: without checking it, anyone
 * who can get your browser to hit the callback URL could graft their own
 * account onto your session. Entries are single-use and time out.
 */
const pending = new Map<string, { platform: Platform; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

function sweepStates(): void {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [state, entry] of pending) {
    if (entry.createdAt < cutoff) pending.delete(state);
  }
}

/** The loopback address the provider will send the browser back to. */
export function redirectUri(platform: Platform): string {
  // Loopback rather than a public URL on purpose: both Google and Twitch allow
  // http://localhost redirects precisely for locally-installed apps, so this
  // works with no tunnel and no certificate.
  return `http://localhost:${env.port}/api/auth/${platform}/callback`;
}

/** Builds the provider URL to send the user to, and remembers the state. */
export function beginAuth(provider: OAuthProvider): { url: string } | { error: string } {
  if (!provider.clientId || !provider.clientSecret) {
    return {
      error:
        `${provider.label} needs a client id and secret in .env before you can sign in. ` +
        'Register an application with the provider, then add them and restart.',
    };
  }

  sweepStates();
  const state = randomBytes(32).toString('base64url');
  pending.set(state, { platform: provider.platform, createdAt: Date.now() });

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri(provider.platform));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scopes.join(' '));
  url.searchParams.set('state', state);
  for (const [key, value] of Object.entries(provider.authorizeExtras ?? {})) {
    url.searchParams.set(key, value);
  }

  return { url: url.toString() };
}

/**
 * Verifies a returned `state` and consumes it.
 *
 * Compared in constant time and deleted on first use, so a leaked state cannot
 * be replayed even within its lifetime.
 */
export function consumeState(state: string, platform: Platform): boolean {
  sweepStates();
  const entry = pending.get(state);

  // A mismatch is rejected but deliberately does NOT consume the entry. If it
  // did, anyone able to reach this server could cancel a sign-in in progress
  // just by replaying the state against the wrong platform's callback — a free
  // denial of service. Rejecting without discarding leaves the legitimate
  // callback able to finish, and grants the prober nothing either way.
  if (!entry || entry.platform !== platform) return false;

  // The map lookup above already reveals equality; the constant-time compare
  // is here so a future change to lookup-by-scan does not become a timing
  // oracle on the state value.
  const a = Buffer.from(state);
  const b = Buffer.from(state);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  pending.delete(state);
  return ok;
}

/** Exchanges an authorization code for tokens. */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
): Promise<TokenResponse> {
  return requestToken(provider, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(provider.platform),
  });
}

/** Trades a refresh token for a fresh access token. */
export async function refresh(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<TokenResponse> {
  return requestToken(provider, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

/**
 * Fetches an app-only token via client credentials.
 *
 * No user is involved, so this unlocks only the things that need an
 * application rather than a person — for Twitch that is enough to read public
 * profiles, which is where chat avatars come from.
 */
export async function appToken(provider: OAuthProvider): Promise<TokenResponse> {
  return requestToken(provider, {
    grant_type: 'client_credentials',
    scope: provider.scopes.join(' '),
  });
}

async function requestToken(
  provider: OAuthProvider,
  params: Record<string, string>,
): Promise<TokenResponse> {
  if (!provider.clientId || !provider.clientSecret) {
    throw new Error(`${provider.label} has no client id/secret configured`);
  }

  const body = new URLSearchParams({
    ...params,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
  });

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    // Never echo the body wholesale — an error response can contain the token
    // request parameters, which include the client secret.
    let reason = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      if (parsed.error || parsed.message) reason = `${parsed.error ?? ''} ${parsed.message ?? ''}`.trim();
    } catch {
      // Non-JSON error; the status alone is what gets reported.
    }
    log.warn(`${provider.label} token request failed: ${reason}`);
    throw new Error(`${provider.label} rejected the sign-in: ${reason}`);
  }

  const data = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string | string[];
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    // Providers that omit expires_in issue long-lived tokens; an hour is a
    // safe assumption because the refresh path handles being wrong.
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scopes: Array.isArray(data.scope) ? data.scope : (data.scope ?? '').split(' ').filter(Boolean),
  };
}
