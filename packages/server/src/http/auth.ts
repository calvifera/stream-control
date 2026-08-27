import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth');

const COOKIE = 'stream_session';
/** Long-lived on purpose: this is your own machine, not a bank. */
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/** Failed attempts before a client has to wait, and how long it waits. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

interface Attempts {
  count: number;
  blockedUntil: number;
}

/** token -> expiry. In memory, so a restart signs you out. That is fine. */
const sessions = new Map<string, number>();
const attempts = new Map<string, Attempts>();

export const authEnabled = (): boolean => env.dashboardPassword.length > 0;

/**
 * Constant-time password comparison.
 *
 * Hashed first so both sides are always 32 bytes — `timingSafeEqual` throws on
 * a length mismatch, and that throw would itself leak the password's length.
 */
function passwordMatches(candidate: string): boolean {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(env.dashboardPassword).digest();
  return timingSafeEqual(a, b);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function sweep(): void {
  const now = Date.now();
  for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
}

export function isAuthenticated(req: Request): boolean {
  if (!authEnabled()) return true;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires || expires <= Date.now()) {
    if (expires) sessions.delete(token);
    return false;
  }
  return true;
}

export interface LoginResult {
  ok: boolean;
  /** Seconds the caller must wait before trying again. */
  retryAfter?: number;
}

export function login(req: Request, res: Response, password: string): LoginResult {
  const who = req.ip ?? 'unknown';
  const now = Date.now();
  const record = attempts.get(who) ?? { count: 0, blockedUntil: 0 };

  if (record.blockedUntil > now) {
    return { ok: false, retryAfter: Math.ceil((record.blockedUntil - now) / 1000) };
  }

  if (!password || !passwordMatches(password)) {
    record.count += 1;
    if (record.count >= MAX_ATTEMPTS) {
      record.count = 0;
      record.blockedUntil = now + LOCKOUT_MS;
      log.warn(`Too many failed logins from ${who} — locked out for ${LOCKOUT_MS / 1000}s`);
    }
    attempts.set(who, record);
    return { ok: false };
  }

  attempts.delete(who);
  sweep();

  const token = randomBytes(32).toString('base64url');
  sessions.set(token, now + SESSION_MS);

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MS,
    // No `secure` flag: this server speaks plain HTTP, and setting it would
    // make the cookie silently never come back.
    path: '/',
  });
  log.info(`Dashboard login from ${who}`);
  return { ok: true };
}

export function logout(req: Request, res: Response): void {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(COOKIE, { path: '/' });
}

/**
 * Routes that stay open when a password is set.
 *
 * Kept deliberately short. `/ping` is the identity probe used by the source
 * host check, and `/slideshows/:folder` is the one API call a browser source
 * makes — streaming software cannot log in, so gating it would break the overlay it serves.
 */
/**
 * The few paths that must work before you are signed in.
 *
 * Named individually rather than by prefix. A blanket `/auth/*` rule used to
 * live here, which was fine while the only things under it were the login form
 * — but the moment platform sign-in routes moved in alongside it, that prefix
 * silently exposed `/auth/twitch/signout` and friends to anyone who could
 * reach the port. Enumerating the exceptions means adding a route can never
 * quietly widen this again.
 */
const PUBLIC_PATHS = new Set(['/ping', '/auth/status', '/auth/login', '/auth/logout']);

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  // The OAuth provider redirects a browser here, and the sign-in must survive
  // an expired dashboard session or the authorization code is lost.
  if (/^\/auth\/[a-z]+\/callback$/.test(path)) return true;
  return path.startsWith('/slideshows/');
}

/** Blocks unauthenticated access to everything that can read or change state. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!authEnabled() || isPublicPath(req.path) || isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Not signed in' });
}
