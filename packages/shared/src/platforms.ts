/**
 * Platform identity.
 *
 * Every event, viewer and connection carries one of these. Before it existed
 * the whole system assumed a single source, which was fine while TikTok was
 * the only one — but the moment a second platform arrives, "@bob" stops being
 * a person and starts being a person *on a platform*. Two different humans can
 * hold the same handle on TikTok and Twitch, so anything that identifies a
 * viewer has to be keyed on the pair, never the handle alone.
 */

export const PLATFORMS = ['tiktok', 'youtube', 'twitch'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PlatformInfo {
  id: Platform;
  label: string;
  /** Brand colour, used for the accent bar on each chat line. */
  color: string;
  /** Readable against `color` as a background. */
  contrast: string;
  /**
   * Short glyph for the inline badge.
   *
   * Two letters, not one: "TikTok" and "Twitch" both start with T, so a
   * single initial is ambiguous exactly where it matters most.
   */
  mark: string;
  /** What the connection is addressed by, for form labels and errors. */
  handleLabel: string;
}

export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    color: '#25f4ee',
    contrast: '#04141a',
    mark: 'TT',
    handleLabel: 'username',
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    color: '#ff0033',
    contrast: '#ffffff',
    mark: 'YT',
    handleLabel: 'channel',
  },
  twitch: {
    id: 'twitch',
    label: 'Twitch',
    color: '#a970ff',
    contrast: '#14091f',
    mark: 'TW',
    handleLabel: 'channel',
  },
};

/**
 * The site each platform's public profile pages live on.
 *
 * One table, so the page a profile link is built for and the sites the server
 * agrees to open for one cannot drift apart.
 */
export const PROFILE_HOSTS: Record<Platform, string> = {
  tiktok: 'www.tiktok.com',
  twitch: 'www.twitch.tv',
  youtube: 'www.youtube.com',
};

/**
 * The public profile page for a viewer, or null when there is no way to build
 * one from what is known.
 *
 * YouTube needs the channel id with its original casing, which is why the
 * platform user id is taken as well as the handle: the handle is stored
 * lowercased, and YouTube channel ids are case-sensitive.
 */
export function profileUrl(platform: Platform, handle: string, userId: string): string | null {
  const clean = handle.trim().replace(/^@/, '');
  const base = `https://${PROFILE_HOSTS[platform]}`;
  switch (platform) {
    case 'tiktok':
      return clean ? `${base}/@${encodeURIComponent(clean)}` : null;
    case 'twitch':
      return clean ? `${base}/${encodeURIComponent(clean)}` : null;
    case 'youtube': {
      const id = /^UC[\w-]{22}$/.test(userId) ? userId : '';
      return id ? `${base}/channel/${id}` : null;
    }
    default:
      return null;
  }
}

export const isPlatform = (value: unknown): value is Platform =>
  typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);

/**
 * Decides whether what somebody typed for YouTube names a stream or a channel.
 *
 * One field serves both, because nobody arrives holding "a channel id" — they
 * arrive holding something they copied, and it is a @handle, a channel link or
 * a link to the stream. The string already says which; asking would be asking
 * them to know something it tells us. The two results are mutually exclusive,
 * since holding both leaves which one wins to guesswork.
 *
 * Lives here because the dashboard and the server both route by it, and two
 * copies of a regex are two chances for them to disagree about what a string is.
 */
export function routeYouTubeTarget(input: string): { videoId: string; handle: string } {
  const trimmed = input.trim();
  const looksLikeVideo =
    /(?:v=|youtu\.be\/|\/live\/)[\w-]{11}/.test(trimmed) || /^[\w-]{11}$/.test(trimmed);
  return looksLikeVideo ? { videoId: trimmed, handle: '' } : { videoId: '', handle: trimmed };
}

/**
 * Canonical handle form: lowercase, no leading `@`, trimmed.
 *
 * Shared by every platform. Twitch and YouTube handles are already
 * case-insensitive; TikTok's are too for lookup purposes.
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase().replace(/^@/, '');
}

/**
 * The key that identifies one viewer everywhere: `platform:handle`.
 *
 * Used as the directory key, the leaderboard key, and the stored form in the
 * trusted / penalty / voice lists. Passing a bare handle to any of those is
 * the bug this function exists to prevent.
 */
export function viewerKey(platform: Platform, handle: string): string {
  return `${platform}:${normalizeHandle(handle)}`;
}

/**
 * Splits a `platform:handle` key back apart.
 *
 * Returns `null` for anything that is not a well-formed key — including a bare
 * handle, which is what pre-multiplatform config entries look like. Callers
 * migrating old data should treat `null` as "assume TikTok" explicitly rather
 * than having this guess for them.
 */
export function parseViewerKey(key: string): { platform: Platform; handle: string } | null {
  // Canonicalize *before* splitting, not after. `@tiktok:bob` and `TikTok:BOB`
  // both reach this — from a hand-typed field and from anything that
  // title-cases a name — and splitting first leaves a platform part of
  // "@tiktok" or "TikTok" that fails `isPlatform`. The caller then falls back
  // to "assume TikTok" and treats the whole string as a handle, producing
  // `tiktok:tiktok:bob`: a second, silent identity for a person who already
  // has one, with their own trust, strikes and message count.
  const trimmed = key.trim().toLowerCase().replace(/^@/, '');
  const separator = trimmed.indexOf(':');
  if (separator <= 0) return null;

  const platform = trimmed.slice(0, separator);
  const handle = trimmed.slice(separator + 1);
  if (!isPlatform(platform) || !handle) return null;
  return { platform, handle: normalizeHandle(handle) };
}

/**
 * Reads a stored list entry, tolerating the pre-multiplatform bare-handle form.
 *
 * Everything written before platforms existed came from TikTok, so an
 * unqualified handle is unambiguously a TikTok one. This keeps old config
 * working without a migration pass over every list.
 */
export function readViewerKey(key: string): { platform: Platform; handle: string } {
  return parseViewerKey(key) ?? { platform: 'tiktok', handle: normalizeHandle(key) };
}

/**
 * Canonical comparison key for a stored list entry (trusted, penalty, voice).
 *
 * Use this on *both* sides of any equality check against a viewer. Comparing
 * bare handles is the bug: it makes a Twitch mute silence a TikTok stranger.
 */
export function listKey(entry: string): string {
  const { platform, handle } = readViewerKey(entry);
  return viewerKey(platform, handle);
}

/** Canonical comparison key for a live viewer. */
export function userKey(user: { platform: Platform; uniqueId: string }): string {
  return viewerKey(user.platform, user.uniqueId);
}

/** How a handle is shown to a human: `@handle` with no platform prefix. */
export function displayHandle(key: string): string {
  return `@${readViewerKey(key).handle}`;
}
