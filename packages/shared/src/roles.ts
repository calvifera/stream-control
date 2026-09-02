import { PLATFORMS, PLATFORM_INFO, type Platform } from './platforms.js';

/**
 * What each platform can actually tell you about a viewer.
 *
 * This exists because of a silent failure that is very hard to spot from the
 * outside. A rule gated on "followers only" works perfectly on TikTok and
 * never fires once on Twitch — not because the viewers aren't followers, but
 * because Twitch's IRC tags carry no follow relationship at all, so the answer
 * is permanently unknown and the gate permanently rejects. The rule sits there
 * enabled, matching the right event type, doing nothing.
 *
 * A signal a platform cannot report is not a signal that is false. It is one
 * nobody knows, and the difference decides whether a gate is strict or
 * unsatisfiable. Nothing in the pipeline can infer this, so it is declared.
 */

/** The viewer signals a gate can be keyed on. */
export const ROLE_SIGNALS = [
  'follower',
  'friend',
  'subscriber',
  'moderator',
  'host',
  'gifter',
  'followerCount',
  'fansClubLevel',
] as const;
export type RoleSignal = (typeof ROLE_SIGNALS)[number];

export interface RoleInfo {
  /** What this is called in the UI. */
  label: string;
  /**
   * The noun phrase for "X does not report ___".
   *
   * Separate from `label` because the label is a thing a person *is* and this
   * is a thing a platform *knows*: "does not report follower" is not English,
   * "does not report who follows you" is.
   */
  phrase: string;
  /** What each platform calls it, when it differs enough to confuse. */
  aliases: Partial<Record<Platform, string>>;
  /** Overrides `phrase` in the "does not report ___" warning, per platform. */
  missingPhrase?: Partial<Record<Platform, string>>;
}

export const ROLE_INFO: Record<RoleSignal, RoleInfo> = {
  follower: {
    label: 'Follower',
    phrase: 'who follows you',
    aliases: { youtube: 'Subscriber (free)' },
    // On YouTube the equivalent relationship exists and is even called
    // subscribing — it just never reaches the chat API, which is a different
    // thing from not existing and worth saying out loud.
    missingPhrase: { youtube: 'who subscribes to you (free subs are not in the chat API)' },
  },
  friend: { label: 'Mutual', phrase: 'mutual follows', aliases: {} },
  subscriber: {
    label: 'Subscriber',
    // Worth spelling out: a YouTube "subscriber" is free and corresponds to a
    // TikTok/Twitch *follower*, while the paid tier is called a member. Using
    // one word for both is how a gate ends up meaning the opposite of what
    // someone intended.
    phrase: 'paid subscriptions',
    aliases: { youtube: 'Member (paid)', twitch: 'Subscriber (paid)', tiktok: 'Subscriber' },
  },
  moderator: { label: 'Moderator', phrase: 'who moderates your chat', aliases: {} },
  host: {
    label: 'Host',
    phrase: 'who owns the channel',
    aliases: { twitch: 'Broadcaster', youtube: 'Channel owner' },
  },
  gifter: { label: 'Gifter', phrase: 'gifts', aliases: { twitch: 'Bits / sub gifter' } },
  followerCount: { label: 'Follower count', phrase: 'follower counts', aliases: {} },
  fansClubLevel: { label: 'Fans club level', phrase: 'fans club levels', aliases: {} },
};

/**
 * Which signals each platform reports, given the credentials it has.
 *
 * `true` means the value is trustworthy when present. `false` means the
 * platform never supplies it, so a gate requiring it can only ever be passed
 * by the host and by moderators, who bypass the social gates.
 */
export const PLATFORM_ROLES: Record<Platform, Record<RoleSignal, boolean>> = {
  tiktok: {
    follower: true,
    friend: true,
    subscriber: true,
    moderator: true,
    host: true,
    gifter: true,
    followerCount: true,
    fansClubLevel: true,
  },
  twitch: {
    // No follow relationship over IRC. Helix can answer it, but only with a
    // moderator:read:followers token and a request per viewer — neither of
    // which the chat path has.
    follower: false,
    // Twitch has no concept of a mutual follow at all.
    friend: false,
    subscriber: true,
    moderator: true,
    host: true,
    // Bits arrive as an event, so gifting is observable within a session.
    gifter: true,
    followerCount: false,
    fansClubLevel: false,
  },
  youtube: {
    follower: false,
    friend: false,
    // Channel membership arrives on the message; free subscription does not.
    subscriber: true,
    moderator: true,
    host: true,
    gifter: true,
    followerCount: false,
    fansClubLevel: false,
  },
};

/** What this signal is called on this platform. */
export function roleLabel(signal: RoleSignal, platform?: Platform): string {
  const info = ROLE_INFO[signal];
  if (!platform) return info.label;
  return info.aliases[platform] ?? info.label;
}

/**
 * Which of the given platforms cannot satisfy this signal.
 *
 * An empty `platforms` list means "every platform", matching how rules treat
 * it — so a gate that no connected platform can satisfy still gets flagged.
 */
export function platformsMissing(signal: RoleSignal, platforms: readonly Platform[]): Platform[] {
  const scope = platforms.length > 0 ? new Set(platforms) : new Set(PLATFORMS);
  // Iterate PLATFORMS rather than the caller's array so the result — and the
  // sentence built from it — is always in the same order. Otherwise the
  // warning text would rearrange itself depending on which order the chips
  // happened to be clicked in, which reads like the message changed meaning.
  return PLATFORMS.filter((platform) => scope.has(platform) && !PLATFORM_ROLES[platform][signal]);
}

/**
 * A human warning for a gate that some platforms cannot satisfy, or null when
 * every platform in scope can.
 *
 * Deliberately says what will still get through rather than only what won't:
 * "nothing will match" is alarming and slightly untrue, because the host and
 * moderators always pass.
 */
export function gateWarning(
  signal: RoleSignal,
  platforms: readonly Platform[],
): string | null {
  const missing = platformsMissing(signal, platforms);
  if (missing.length === 0) return null;

  const names = missing.map((platform) => PLATFORM_INFO[platform].label);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? 'does not report' : 'do not report';

  // A single missing platform can describe itself in its own terms; with
  // several, the shared phrase is the only one that fits them all.
  const phrase =
    (missing.length === 1 && missing[0] && ROLE_INFO[signal].missingPhrase?.[missing[0]]) ||
    ROLE_INFO[signal].phrase;

  return `${list} ${verb} ${phrase}, so on ${
    names.length === 1 ? 'it' : 'those'
  } only you and your moderators get through.`;
}

/**
 * What a gate actually means on each platform it is pointed at.
 *
 * `gateWarning` only speaks up when a platform *cannot* answer. The subtler
 * failure is when they all can and mean different things by it: every
 * platform reports a "subscriber", but on Twitch that is a paid subscription,
 * on YouTube it is a paid membership, and a YouTube viewer who hit subscribe
 * for free — the thing almost everyone means by the word — is none of those,
 * they are a follower. A gate written on the assumption that one word means
 * one thing quietly selects a different audience per platform.
 *
 * Returns null when the platforms in scope agree, so the hint only appears
 * where there is a real difference to explain.
 */
export function gateMeaning(
  signal: RoleSignal,
  platforms: readonly Platform[],
): string | null {
  const scope = platforms.length > 0 ? platforms : PLATFORMS;
  const able = PLATFORMS.filter(
    (platform) => scope.includes(platform) && PLATFORM_ROLES[platform][signal],
  );
  if (able.length < 2) return null;

  const info = ROLE_INFO[signal];
  const named = able.map((platform) => ({
    platform,
    name: info.aliases[platform] ?? info.label,
  }));
  // Nothing to explain when every platform in scope uses the same word.
  if (new Set(named.map((n) => n.name)).size < 2) return null;

  const parts = named.map((n) => `${n.name} on ${PLATFORM_INFO[n.platform].label}`);
  const list = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  // The one that actually bites: a free YouTube subscriber is not caught here.
  const footnote =
    signal === 'subscriber' && able.includes('youtube')
      ? " YouTube's free subscribers are not this — they are the Followers gate."
      : '';

  return `Means ${list}.${footnote}`;
}
