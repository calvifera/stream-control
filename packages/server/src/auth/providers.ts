import {
  MAX_CAPABILITIES,
  NO_CAPABILITIES,
  type AuthLevel,
  type Platform,
  type PlatformAuthState,
  type PlatformCapabilities,
} from '@streaming/shared';
import { env } from '../env.js';
import type { OAuthProvider } from './oauth.js';
import type { CredentialStore } from './credentials.js';

/**
 * Per-platform OAuth definitions and capability reporting.
 *
 * Capabilities are computed from what is actually configured rather than
 * declared up front, so the dashboard can say "you can read chat but not show
 * avatars, and here is the one thing that would fix it" instead of failing
 * silently at the point of use.
 */

export const TWITCH_PROVIDER: OAuthProvider = {
  platform: 'twitch',
  label: 'Twitch',
  authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
  tokenUrl: 'https://id.twitch.tv/oauth2/token',
  // Read chat and moderate it. Deliberately minimal: no scope here can touch
  // the channel's settings, stream key, or anything monetary.
  scopes: [
    'chat:read',
    'chat:edit',
    'moderator:manage:banned_users',
    'moderator:manage:chat_messages',
    'moderator:read:followers',
  ],
  clientId: env.twitchClientId,
  clientSecret: env.twitchClientSecret,
  identify: async (accessToken) => {
    if (!env.twitchClientId) return null;
    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': env.twitchClientId,
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      data?: Array<{ id: string; login: string; display_name: string }>;
    };
    const user = data.data?.[0];
    return user ? { account: user.display_name || user.login, accountId: user.id } : null;
  },
};

export const YOUTUBE_PROVIDER: OAuthProvider = {
  platform: 'youtube',
  label: 'YouTube',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  // Read-write on live chat, read-only on the channel. `youtube.force-ssl` is
  // what live chat moderation requires; there is no narrower scope for it.
  scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
  clientId: env.googleClientId,
  clientSecret: env.googleClientSecret,
  authorizeExtras: {
    // Google only issues a refresh token when both are present, and without
    // one the sign-in silently stops working after an hour.
    access_type: 'offline',
    prompt: 'consent',
  },
  identify: async (accessToken) => {
    const response = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      items?: Array<{ id: string; snippet?: { title?: string } }>;
    };
    const channel = data.items?.[0];
    return channel ? { account: channel.snippet?.title ?? channel.id, accountId: channel.id } : null;
  },
};

export const PROVIDERS: Partial<Record<Platform, OAuthProvider>> = {
  twitch: TWITCH_PROVIDER,
  youtube: YOUTUBE_PROVIDER,
};

/**
 * What a platform can do right now.
 *
 * The three tiers are real and worth spelling out, because the difference
 * between them is the difference between "chat works" and "chat works with
 * faces and a mute button".
 */
export function capabilitiesFor(
  platform: Platform,
  level: AuthLevel,
  appConfigured: boolean,
): PlatformCapabilities {
  switch (platform) {
    case 'tiktok':
      // Nothing to sign into: the webcast connection is read-only and needs no
      // credentials, so TikTok is always at its ceiling.
      return { ...MAX_CAPABILITIES.tiktok };

    case 'twitch':
      return {
        // Anonymous IRC reads chat with no credentials at all.
        readChat: true,
        // Avatars come from Helix, which needs an application — but not a
        // signed-in user. Registering the app alone is enough.
        avatars: appConfigured,
        viewerCount: appConfigured,
        followEvents: level === 'user',
        sendMessage: level === 'user',
        moderate: level === 'user',
      };

    case 'youtube':
      // Nothing works without sign-in: the Live API requires the request to be
      // authorized by the account that owns the broadcast.
      return level === 'user'
        ? { ...MAX_CAPABILITIES.youtube }
        : { ...NO_CAPABILITIES };

    default:
      return { ...NO_CAPABILITIES };
  }
}

/** The single most useful thing to do next, or null when nothing is missing. */
function nextStepFor(platform: Platform, level: AuthLevel, appConfigured: boolean): string | null {
  if (platform === 'tiktok') return null;

  if (!appConfigured) {
    return platform === 'twitch'
      ? 'Register an app at dev.twitch.tv/console/apps, then put TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env — that alone unlocks avatars.'
      : 'Create OAuth credentials in Google Cloud Console (YouTube Data API v3), then put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.';
  }
  if (level !== 'user') {
    return platform === 'twitch'
      ? 'Sign in to enable sending messages and moderating from here.'
      : 'Sign in with Google — YouTube live chat cannot be read without it.';
  }
  return null;
}

/** Builds the dashboard-facing state for one platform. Never includes tokens. */
export function authStateFor(platform: Platform, store: CredentialStore): PlatformAuthState {
  const provider = PROVIDERS[platform];
  const appConfigured = Boolean(provider?.clientId && provider?.clientSecret);
  const token = store.get(platform);
  const signedIn = Boolean(token && store.isValid(platform) && token.refreshToken !== undefined);

  const level: AuthLevel =
    platform === 'tiktok'
      ? 'anonymous'
      : signedIn
        ? 'user'
        : appConfigured
          ? 'app'
          : 'anonymous';

  return {
    platform,
    level,
    appConfigured,
    account: token?.account ?? null,
    expiresAt: token?.expiresAt ?? null,
    scopes: token?.scopes ?? [],
    capabilities: capabilitiesFor(platform, level, appConfigured),
    nextStep: nextStepFor(platform, level, appConfigured),
    error: null,
  };
}
