import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('secrets');

/**
 * Credentials entered through the dashboard rather than hand-written into
 * `.env`.
 *
 * `.env` is a perfectly good place for these and keeps working — but it asks
 * someone to find a hidden file, edit it in a text editor, and restart the
 * server before anything happens. That is a reasonable thing to ask of the
 * person who wrote the software and an unreasonable one to ask of a streamer
 * who just wants their chat read aloud.
 *
 * Three rules hold this together, and all three exist because the values are
 * secrets:
 *
 *   1. **Never in `config.json`.** That file is broadcast over the socket to
 *      every connected client, including overlay browser sources. A secret in
 *      there is a secret handed to anything that can load an overlay URL.
 *   2. **Never sent to the browser.** The dashboard is told whether a key is
 *      set, where it came from and how long it is — never the value. There is
 *      no read path, so a compromised dashboard cannot exfiltrate what it was
 *      never given.
 *   3. **Written 0600 where the OS allows it.** Not a real defence on a
 *      single-user desktop, but free.
 */

/** Every credential the dashboard can manage. */
export const SECRET_KEYS = [
  'SIGN_API_KEY',
  'TIKTOK_SESSION_ID',
  'TIKTOK_TARGET_IDC',
  'GOOGLE_TTS_API_KEY',
  'NGROK_AUTHTOKEN',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DASHBOARD_PASSWORD',
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

const isSecretKey = (value: string): value is SecretKey =>
  (SECRET_KEYS as readonly string[]).includes(value);

export interface SecretStatus {
  key: SecretKey;
  configured: boolean;
  /** Where the value in effect came from, or null when there is none. */
  source: 'dashboard' | 'env' | null;
  /**
   * Character count, which is the most a status report is allowed to say.
   *
   * Useless to an attacker and genuinely useful to the person who just pasted
   * something: a Twitch client id is 30 characters and a secret is 30, so
   * "31" means a stray space came along with the copy. That question is
   * otherwise unanswerable without echoing the value back.
   */
  length: number;
}

const SECRETS_PATH = path.join(DATA_DIR, 'secrets.json');

export class SecretStore {
  private values = new Map<SecretKey, string>();
  /**
   * What `.env` held before this store touched anything.
   *
   * Captured up front because `apply()` overwrites `process.env`, which
   * destroys the original. Without this snapshot, clearing a dashboard entry
   * would delete the `.env` value underneath it rather than revealing it —
   * the opposite of what "clear" should mean, and unrecoverable without a
   * restart.
   */
  private readonly baseEnv = new Map<SecretKey, string>();

  constructor() {
    for (const key of SECRET_KEYS) {
      const value = process.env[key]?.trim();
      if (value) this.baseEnv.set(key, value);
    }
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(SECRETS_PATH)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (isSecretKey(key) && typeof value === 'string' && value.trim()) {
          this.values.set(key, value.trim());
        }
      }
      this.apply();
      log.info(`Loaded ${this.values.size} credential(s) from secrets.json`);
    } catch (error) {
      // Never fatal. A corrupt secrets file should cost you the credentials
      // it held, not the ability to start the server and re-enter them.
      log.warn(`Could not read secrets.json, ignoring it: ${String(error)}`);
    }
  }

  private save(): void {
    const body = JSON.stringify(Object.fromEntries(this.values), null, 2);
    fs.writeFileSync(SECRETS_PATH, body, { encoding: 'utf8', mode: 0o600 });
    try {
      // Separately from the write, because an existing file keeps its old
      // mode: `mode` on writeFileSync only applies at creation.
      fs.chmodSync(SECRETS_PATH, 0o600);
    } catch {
      // Windows does not model POSIX permissions; nothing to do and nothing
      // worth reporting.
    }
  }

  /**
   * The value in effect.
   *
   * The dashboard wins over `.env` because it is the more recent, more
   * deliberate act — someone typing into a form and seeing nothing happen
   * because an environment variable silently outranked them is the worse
   * failure. `.env` still works for anyone who prefers it, and the dashboard
   * says which source is in play so the precedence is never a guess.
   */
  get(key: SecretKey): string | undefined {
    const stored = this.values.get(key);
    if (stored) return stored;
    const fromEnv = process.env[key]?.trim();
    return fromEnv || undefined;
  }

  set(key: SecretKey, value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
      this.clear(key);
      return;
    }
    this.values.set(key, trimmed);
    this.save();
    this.apply();
    // Deliberately logs the key and not the value.
    log.info(`Saved ${key} (${trimmed.length} chars)`);
  }

  /** Removes the dashboard's value, revealing whatever `.env` holds. */
  clear(key: SecretKey): void {
    if (!this.values.delete(key)) return;
    this.save();

    // Put back what `.env` had, rather than leaving the overwritten value in
    // place or deleting the variable outright.
    const original = this.baseEnv.get(key);
    if (original) process.env[key] = original;
    else delete process.env[key];

    log.info(`Cleared ${key}`);
  }

  /**
   * Publishes the stored values onto `process.env`.
   *
   * This is how a key typed into the dashboard reaches every reader without a
   * restart: `env`'s getters and the OAuth providers all resolve through
   * `process.env` at access time. Applied after dotenv has run, so a stored
   * value shadows the matching `.env` line rather than the other way round.
   */
  private apply(): void {
    for (const [key, value] of this.values) process.env[key] = value;
  }

  /** What the dashboard is allowed to know. No values, ever. */
  status(): SecretStatus[] {
    return SECRET_KEYS.map((key) => {
      const stored = this.values.get(key);
      // The snapshot, not `process.env` — `apply()` has already overwritten
      // that with the stored value, so reading it back would report every
      // dashboard entry as also coming from the environment.
      const fromEnv = this.baseEnv.get(key);
      const effective = stored || fromEnv || '';
      return {
        key,
        configured: effective.length > 0,
        source: stored ? 'dashboard' : fromEnv ? 'env' : null,
        length: effective.length,
      };
    });
  }
}

/**
 * The one instance.
 *
 * A module singleton because the values it holds are process-wide by nature:
 * it publishes them onto `process.env`, which is where `env` and the OAuth
 * providers read them back from. Two instances would fight over that.
 */
export const secrets = new SecretStore();

export const parseSecretKey = (value: unknown): SecretKey | null =>
  typeof value === 'string' && isSecretKey(value) ? value : null;
