import { PLATFORMS, type AuthOverview, type Platform } from '@streaming/shared';
import { createLogger } from '../logger.js';
import { CredentialStore } from './credentials.js';
import { appToken, beginAuth, consumeState, exchangeCode, refresh } from './oauth.js';
import { authStateFor, PROVIDERS } from './providers.js';

const log = createLogger('auth');

/**
 * Owns sign-in for every platform.
 *
 * One object so the rest of the server can ask "am I allowed to do X on
 * platform Y?" without knowing which OAuth dialect Y speaks, and so token
 * refresh happens in one place rather than at each call site.
 */
export class AuthManager {
  readonly store = new CredentialStore();
  /** App-only tokens, held in memory: they carry no user data and re-fetch cheaply. */
  private appTokens = new Map<Platform, { token: string; expiresAt: number }>();

  overview(): AuthOverview {
    return Object.fromEntries(
      PLATFORMS.map((platform) => [platform, authStateFor(platform, this.store)]),
    ) as AuthOverview;
  }

  /** Returns the provider URL to open, or an error explaining what is missing. */
  start(platform: Platform): { url: string } | { error: string } {
    const provider = PROVIDERS[platform];
    if (!provider) return { error: `${platform} has no sign-in — nothing to authorize.` };
    return beginAuth(provider);
  }

  /** Handles the provider's redirect back. Returns a message for the browser. */
  async complete(platform: Platform, code: string, state: string): Promise<string> {
    const provider = PROVIDERS[platform];
    if (!provider) throw new Error(`${platform} has no sign-in`);

    // Checked before the code is spent: a code that arrives without a state we
    // issued is either a stale tab or a forged callback, and neither should be
    // allowed to attach an account.
    if (!consumeState(state, platform)) {
      throw new Error('Sign-in expired or was not started here. Try again from the dashboard.');
    }

    const tokens = await exchangeCode(provider, code);
    const who = provider.identify ? await provider.identify(tokens.accessToken) : null;

    this.store.set(platform, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      account: who?.account ?? null,
      accountId: who?.accountId ?? null,
    });

    return who?.account ?? 'your account';
  }

  signOut(platform: Platform): void {
    this.store.clear(platform);
    this.appTokens.delete(platform);
  }

  /**
   * A usable user access token, refreshing it if it has expired.
   *
   * Returns null rather than throwing when there is nothing to refresh, so
   * callers can degrade to whatever anonymous access allows instead of failing.
   */
  async userToken(platform: Platform): Promise<string | null> {
    const provider = PROVIDERS[platform];
    const stored = this.store.get(platform);
    if (!provider || !stored) return null;
    if (this.store.isValid(platform)) return stored.accessToken;
    if (!stored.refreshToken) {
      log.warn(`${platform} token expired and there is no refresh token — sign in again`);
      return null;
    }

    try {
      const fresh = await refresh(provider, stored.refreshToken);
      this.store.set(platform, {
        ...stored,
        accessToken: fresh.accessToken,
        // Providers may or may not rotate the refresh token; keeping the old
        // one when none comes back is what the spec expects.
        refreshToken: fresh.refreshToken ?? stored.refreshToken,
        expiresAt: fresh.expiresAt,
        scopes: fresh.scopes.length > 0 ? fresh.scopes : stored.scopes,
      });
      log.info(`Refreshed ${platform} token`);
      return fresh.accessToken;
    } catch (error) {
      log.warn(`Could not refresh ${platform} token: ${String(error)}`);
      return null;
    }
  }

  /**
   * An app-only token, for things that need an application but not a person.
   *
   * Twitch profile lookups are the motivating case: chat avatars need Helix,
   * Helix needs a token, but it does not need *your* token. Registering the
   * app is enough.
   */
  async appAccessToken(platform: Platform): Promise<string | null> {
    const provider = PROVIDERS[platform];
    if (!provider?.clientId || !provider.clientSecret) return null;

    const cached = this.appTokens.get(platform);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    try {
      const token = await appToken(provider);
      this.appTokens.set(platform, { token: token.accessToken, expiresAt: token.expiresAt });
      return token.accessToken;
    } catch (error) {
      log.warn(`Could not get an app token for ${platform}: ${String(error)}`);
      return null;
    }
  }
}
