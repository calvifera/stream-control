import type { Platform } from './platforms.js';

/**
 * Viewer trust.
 *
 * A word list can only judge text, and the jokes it keeps missing are built
 * out of ordinary words. What gives a bypasser away is who is typing and how
 * they behave: someone brand new, whose message is spelled oddly, who tries
 * again straight after being blocked. The trust score adds those signals up
 * so the filter can be strict with strangers and relaxed with regulars.
 */

/**
 * Where a score sits, for display.
 *
 *   low      Below the strict threshold because of something they did.
 *   new      Below the strict threshold only because nobody knows them yet.
 *   neutral  Nothing for or against.
 *   regular  Has been around and behaved.
 *   trusted  On your trusted list, a moderator, or the host.
 */
export type TrustBand = 'low' | 'new' | 'neutral' | 'regular' | 'trusted';

export interface TrustFactor {
  /** Short, human-readable reason, for example "Seen on 12 days". */
  label: string;
  /** Points this factor added or removed. */
  delta: number;
}

export interface TrustScore {
  /** 0 to 100. */
  score: number;
  band: TrustBand;
  /** True when strict mode applies to this viewer. */
  strict: boolean;
  /** Every factor that moved the score, largest effect first. */
  factors: TrustFactor[];
}

/** The trust verdict stamped on a chat message as it fans out. */
export interface ChatTrust {
  score: number;
  band: TrustBand;
  /**
   * Why speech skipped this message, or null when trust did not stop it.
   *
   * The message still appears in chat. Only text-to-speech is held.
   */
  held: string | null;
  /** What looked suspicious about this message, if anything. */
  signals: string[];
}

export interface TrustConfig {
  enabled: boolean;
  /**
   * Viewers scoring below this are in strict mode: a message with suspicious
   * spelling, or one that sounds like a severe term, isn't read aloud.
   */
  strictBelow: number;
  /**
   * Give a severe-list strike to a strict-mode viewer who sends a similar
   * message soon after one was blocked. Retrying after a block is the
   * clearest sign of a deliberate bypass.
   */
  strikeOnRetry: boolean;
  /** How long after a block a similar message counts as a retry. */
  retryWindowSeconds: number;
  /**
   * Keep brand-new viewers off text-to-speech until they have sent
   * `holdMessages` messages or been around for `holdMinutes` minutes.
   */
  holdNewViewers: boolean;
  holdMessages: number;
  holdMinutes: number;
}

export const DEFAULT_TRUST: TrustConfig = {
  enabled: true,
  strictBelow: 40,
  strikeOnRetry: true,
  retryWindowSeconds: 90,
  // Off by default: it silences every first-time chatter, which is a real
  // trade-off rather than a free win.
  holdNewViewers: false,
  holdMessages: 3,
  holdMinutes: 5,
};

/** What the chat panel shows when you click someone. */
export interface ViewerProfile {
  key: string;
  platform: Platform;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** Public profile page on the platform, or null when there isn't one. */
  profileUrl: string | null;
  trusted: boolean;
  muted: boolean;
  moderator: boolean;
  subscriber: boolean;
  follower: boolean;
  verified: boolean;
  /** Follower count as the platform reported it; 0 when it doesn't. */
  followerCount: number;
  trust: TrustScore;
  /** This stream only. Resets when a new session starts. */
  session: {
    messages: number;
    gifts: number;
    diamonds: number;
    likes: number;
    shares: number;
    filtered: number;
    held: number;
    /** When they first appeared this session, or null if they haven't. */
    firstSeen: number | null;
  };
  /** Across every stream, or null for someone never recorded. */
  lifetime: {
    firstSeen: number;
    lastSeen: number;
    daysSeen: number;
    messages: number;
    gifts: number;
    diamonds: number;
    follows: number;
    strikes: number;
  } | null;
  /** Their latest messages this session, newest first. */
  recent: Array<{
    ts: number;
    text: string;
    filtered: boolean;
    severity: 'none' | 'normal' | 'severe';
    held: string | null;
  }>;
}

/**
 * The public profile page for a viewer.
 *
 * YouTube needs the channel id with its original casing, which is why the
 * platform user id is taken as well as the handle: the handle is stored
 * lowercased, and YouTube channel ids are case-sensitive.
 */
export function profileUrl(platform: Platform, handle: string, userId: string): string | null {
  const clean = handle.trim().replace(/^@/, '');
  switch (platform) {
    case 'tiktok':
      return clean ? `https://www.tiktok.com/@${encodeURIComponent(clean)}` : null;
    case 'twitch':
      return clean ? `https://www.twitch.tv/${encodeURIComponent(clean)}` : null;
    case 'youtube': {
      const id = /^UC[\w-]{22}$/.test(userId) ? userId : '';
      return id ? `https://www.youtube.com/channel/${id}` : null;
    }
    default:
      return null;
  }
}
