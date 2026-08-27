import fs from 'node:fs';
import path from 'node:path';
import type { Platform } from '@streaming/shared';
import { DATA_DIR, ensureDirs } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('credentials');

/**
 * OAuth tokens on disk.
 *
 * Deliberately NOT in `config.json`. That file is broadcast over the socket to
 * every connected dashboard and overlay, so anything written there is handed
 * to every browser source you have open — including any you ever paste into a
 * tunnel. Tokens live here instead, and this file is never served, never
 * broadcast and never included in a config response.
 *
 * Client ids and secrets are a separate matter again: those come from `.env`,
 * because they are typed once and never rotate at runtime. Refresh tokens do
 * rotate, so they need somewhere writable — hence this file rather than `.env`.
 */

const STORE_PATH = path.join(DATA_DIR, 'credentials.json');

export interface StoredToken {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
  scopes: string[];
  /** Display name of the account that granted this, for the UI. */
  account: string | null;
  /** Platform-native account id. */
  accountId: string | null;
}

interface StoredCredentials {
  version: 1;
  tokens: Partial<Record<Platform, StoredToken>>;
}

export class CredentialStore {
  private tokens: Partial<Record<Platform, StoredToken>> = {};

  constructor() {
    this.load();
  }

  private load(): void {
    ensureDirs();
    if (!fs.existsSync(STORE_PATH)) return;
    try {
      const text = fs.readFileSync(STORE_PATH, 'utf8');
      const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as
        | StoredCredentials
        | undefined;
      this.tokens = raw?.tokens ?? {};
      const names = Object.keys(this.tokens);
      // Count only, never the values — this line ends up in a log file.
      log.info(names.length > 0 ? `Loaded tokens for: ${names.join(', ')}` : 'No stored tokens');
    } catch (error) {
      log.warn(`Could not read stored credentials: ${String(error)}`);
    }
  }

  private persist(): void {
    try {
      ensureDirs();
      const tmp = `${STORE_PATH}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({ version: 1, tokens: this.tokens } satisfies StoredCredentials),
        // 0600 where the platform honours it. Windows ignores the mode, but
        // the file still sits inside the user profile rather than anywhere
        // world-readable, and it is never served over HTTP.
        { encoding: 'utf8', mode: 0o600 },
      );
      fs.renameSync(tmp, STORE_PATH);
    } catch (error) {
      log.warn(`Could not write stored credentials: ${String(error)}`);
    }
  }

  get(platform: Platform): StoredToken | undefined {
    return this.tokens[platform];
  }

  set(platform: Platform, token: StoredToken): void {
    this.tokens[platform] = token;
    this.persist();
    log.info(`Stored ${platform} token for ${token.account ?? 'unknown account'}`);
  }

  clear(platform: Platform): void {
    delete this.tokens[platform];
    this.persist();
    log.info(`Signed out of ${platform}`);
  }

  /** True when a token exists and has not expired. */
  isValid(platform: Platform): boolean {
    const token = this.tokens[platform];
    // A minute of slack: a token that expires while a request is in flight is
    // worse than refreshing one that had a few seconds left.
    return Boolean(token && token.expiresAt > Date.now() + 60_000);
  }
}
