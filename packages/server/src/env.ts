import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — the workspace directory that holds `packages/`. */
export const ROOT_DIR = path.resolve(here, '..', '..', '..');

/**
 * Where config, avatars, media and slideshows live.
 *
 * Overridable so a test can spin up a real server without pointing it at your
 * actual `config.json` — an isolated instance sharing the live data directory
 * is one careless write away from destroying a stream setup.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const OVERLAY_DIST = path.join(ROOT_DIR, 'packages', 'overlay', 'dist');

// .env at the repo root wins; a package-local one is a convenience fallback.
dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config({ path: path.join(here, '..', '.env') });

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  port: num(process.env.PORT, 4700),
  host: process.env.HOST ?? '0.0.0.0',
  /**
   * Euler Stream key used to sign the webcast WebSocket URL. Optional — the
   * connector falls back to a shared, rate-limited quota without one.
   */
  signApiKey: process.env.SIGN_API_KEY?.trim() || undefined,
  /** `sessionid` cookie from tiktok.com, used for TTS and authenticated WS. */
  ttSessionId: process.env.TIKTOK_SESSION_ID?.trim() || undefined,
  /** `tt-target-idc` cookie; only needed alongside an authenticated session. */
  ttTargetIdc: process.env.TIKTOK_TARGET_IDC?.trim() || 'useast2a',
  /** Google Cloud API key with the Text-to-Speech API enabled. */
  googleTtsApiKey: process.env.GOOGLE_TTS_API_KEY?.trim() || undefined,
  ngrokAuthToken: process.env.NGROK_AUTHTOKEN?.trim() || undefined,
  /**
   * OAuth application credentials, registered once by hand.
   *
   * These identify the *application*, not you. They live in .env rather
   * than config.json because config.json is broadcast to every connected
   * client; user tokens live in data/credentials.json because they rotate.
   */
  twitchClientId: process.env.TWITCH_CLIENT_ID?.trim() || undefined,
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET?.trim() || undefined,
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  /**
   * Password for the dashboard and every state-changing API call. Unset means
   * no login is required — the right default for a server bound to loopback,
   * and it means a typo here can never lock you out of your own stream.
   *
   * Kept in .env rather than config.json because config.json is served to
   * every connected client.
   */
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? '',
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, MEDIA_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
