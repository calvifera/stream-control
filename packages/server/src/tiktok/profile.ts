import { createLogger } from '../logger.js';

const log = createLogger('profile');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const REHYDRATION =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s;

export interface TikTokProfile {
  username: string;
  nickname: string;
  avatarUrl: string | null;
  userId: string;
  verified: boolean;
  followerCount: number;
  privateAccount: boolean;
}

/**
 * Reads a public profile for a handle that has not necessarily spoken.
 *
 * TikTok has no public user API — the documented-looking `/api/user/detail`
 * route answers 200 with an empty body unless the request is signed. What does
 * work is the profile page itself: the server renders a
 * `__UNIVERSAL_DATA_FOR_REHYDRATION__` blob containing the same user object the
 * web app hydrates from. That is what this reads.
 *
 * Being page scraping, it is inherently fragile — treat a null return as
 * "unknown", never as "no such user".
 */
export async function fetchProfile(handle: string, timeoutMs = 8000): Promise<TikTokProfile | null> {
  const username = handle.trim().toLowerCase().replace(/^@/, '');
  if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      log.debug(`@${username}: profile page returned ${response.status}`);
      return null;
    }

    const html = await response.text();
    const blob = REHYDRATION.exec(html);
    if (!blob?.[1]) {
      log.debug(`@${username}: no rehydration blob — the page shape may have changed`);
      return null;
    }

    const data = JSON.parse(blob[1]) as Record<string, unknown>;
    const scope = (data['__DEFAULT_SCOPE__'] ?? {}) as Record<string, { userInfo?: RawUserInfo }>;
    const info = scope['webapp.user-detail']?.userInfo;
    // A handle that does not exist still renders the scope, just without a
    // user object — so this is the "no such account" signal too.
    if (!info?.user) return null;

    return {
      username,
      nickname: info.user.nickname || username,
      avatarUrl: info.user.avatarLarger || info.user.avatarMedium || null,
      userId: info.user.id ?? '',
      verified: Boolean(info.user.verified),
      followerCount: info.stats?.followerCount ?? 0,
      privateAccount: Boolean(info.user.privateAccount),
    };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      log.debug(`@${username}: profile lookup timed out`);
    } else {
      log.debug(`@${username}: profile lookup failed — ${String(error).slice(0, 120)}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface RawUserInfo {
  user?: {
    id?: string;
    nickname?: string;
    avatarLarger?: string;
    avatarMedium?: string;
    verified?: boolean;
    privateAccount?: boolean;
  };
  stats?: { followerCount?: number };
}
