import type { Platform } from './platforms.js';

/**
 * Sign-in and capability model.
 *
 * The point of this module is that "what can I do here?" has one answer shape
 * for every platform. Each service exposes a different slice of the same ideas
 * — read chat, show a face next to a name, count viewers, talk back, time
 * someone out — and how much of that slice you get depends on how far you have
 * signed in. Rather than scattering `if (platform === 'twitch')` through the
 * UI, every platform reports the same `PlatformCapabilities` and the interface
 * renders whatever is true.
 */

/** How far a platform has been authenticated. */
export type AuthLevel =
  /** No credentials at all. Some platforms still allow read-only access. */
  | 'anonymous'
  /** App credentials only (client id + secret). No user consent involved. */
  | 'app'
  /** A user signed in and granted scopes. */
  | 'user';

export interface PlatformCapabilities {
  /** Read live chat messages. */
  readChat: boolean;
  /** Profile pictures for chatters. */
  avatars: boolean;
  /** Live viewer count. */
  viewerCount: boolean;
  /** Follow/subscribe events as they happen. */
  followEvents: boolean;
  /** Post a message into chat as you. */
  sendMessage: boolean;
  /** Time out, ban or delete messages. */
  moderate: boolean;
}

export const CAPABILITY_LABELS: Record<keyof PlatformCapabilities, string> = {
  readChat: 'Read chat',
  avatars: 'Avatars',
  viewerCount: 'Viewer count',
  followEvents: 'Follow events',
  sendMessage: 'Send messages',
  moderate: 'Moderate',
};

export const NO_CAPABILITIES: PlatformCapabilities = {
  readChat: false,
  avatars: false,
  viewerCount: false,
  followEvents: false,
  sendMessage: false,
  moderate: false,
};

/**
 * What one platform's sign-in looks like right now.
 *
 * Deliberately carries no token, secret or key — this object is sent to every
 * connected dashboard. It says whether credentials exist and what they unlock,
 * never what they are.
 */
export interface PlatformAuthState {
  platform: Platform;
  level: AuthLevel;
  /** Whether a client id/secret pair is configured for this platform. */
  appConfigured: boolean;
  /** Display name of the signed-in account, when there is one. */
  account: string | null;
  /** Epoch ms the user token expires; null when there is no user token. */
  expiresAt: number | null;
  /** Scopes actually granted, for showing why something is unavailable. */
  scopes: string[];
  capabilities: PlatformCapabilities;
  /** One line explaining the next step to unlock more, or null when maxed. */
  nextStep: string | null;
  /** Last auth error, surfaced rather than swallowed. */
  error: string | null;
}

/** Everything the sign-in screen needs, for every platform at once. */
export type AuthOverview = Record<Platform, PlatformAuthState>;

/**
 * Ceiling for each platform: what it could do if fully signed in.
 *
 * Used to explain the gap between what you have and what is possible, and to
 * stop the UI offering a sign-in that would not actually unlock anything.
 */
export const MAX_CAPABILITIES: Record<Platform, PlatformCapabilities> = {
  tiktok: {
    // TikTok has no public API here; everything comes from the reverse
    // engineered webcast connection, which is read-only by nature.
    readChat: true,
    avatars: true,
    viewerCount: true,
    followEvents: true,
    sendMessage: false,
    moderate: false,
  },
  twitch: {
    readChat: true,
    avatars: true,
    viewerCount: true,
    followEvents: true,
    sendMessage: true,
    moderate: true,
  },
  youtube: {
    readChat: true,
    avatars: true,
    viewerCount: true,
    // YouTube reports subscriber events only in aggregate, not per-user, so
    // per-viewer follow events are not achievable.
    followEvents: false,
    sendMessage: true,
    moderate: true,
  },
};
