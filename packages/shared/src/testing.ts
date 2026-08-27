import type { StreamEventType } from './events.js';
import type { Platform } from './platforms.js';

/**
 * Spoofing an event precisely enough to test a rule.
 *
 * The old test button fired a random fake viewer with random attributes, which
 * is fine for checking that an overlay renders and useless for the question
 * that actually matters: *will my rule fire for this kind of person on this
 * platform?* A gate keyed on "subscribers only" cannot be verified without
 * being able to produce a subscriber, and until now the only way to get one
 * was to wait for a real subscriber to say something.
 *
 * Every field is optional and falls back to the old random behaviour, so the
 * quick "just fire something" path still exists.
 */
export interface TestEventSpec {
  type: StreamEventType;
  platform: Platform;
  /** Chat/question body. Random when absent. */
  text?: string;

  /** Handle to speak as. Random fake name when absent. */
  username?: string;
  displayName?: string;

  /* ---- Who they are ---------------------------------------------------
   * These decide whether a gate lets them through, so they are the point of
   * the whole feature. Note that setting one a platform cannot report is
   * still useful: it tells you what *would* happen if it could, which is a
   * different question from what will happen tonight.
   * ------------------------------------------------------------------- */
  isFollower?: boolean;
  isFriend?: boolean;
  isSubscriber?: boolean;
  isModerator?: boolean;
  isHost?: boolean;
  isVerified?: boolean;
  followerCount?: number;
  fansClubLevel?: number;

  /* ---- Gift shape ---------------------------------------------------- */
  giftName?: string;
  /** Diamond value of a single gift. */
  diamonds?: number;
  /** How many were sent in the streak. */
  repeatCount?: number;
  /** Likes sent, for a like event. */
  likeCount?: number;
  /** Viewers reported, for a roomStats event. */
  viewerCount?: number;

  /* ---- Delivery ------------------------------------------------------- */
  /** Fire this many copies. Useful for cooldowns, queues and scroll. */
  count?: number;
  /** Gap between them in ms. */
  intervalMs?: number;

  /**
   * Write this person into the permanent viewer archive.
   *
   * Off by default, and that default is the whole reason this flag exists: a
   * few hundred test fires previously left invented regulars sitting in the
   * archive for ever, indistinguishable from real viewers and skewing every
   * lifetime total.
   */
  recordToArchive?: boolean;
}

/** What actually happened to a test event, so the loop can be closed. */
export interface TestEventOutcome {
  /** The event as it was built, after filters ran over it. */
  eventId: string;
  /** Filter verdict. */
  filtered: boolean;
  filterReason: string | null;
  /** Rules that fired, by name. */
  spoke: string[];
  /** Rules that matched the event type but declined it, and why. */
  declined: Array<{ rule: string; reason: string }>;
  /** True when nothing was written to the archive. */
  synthetic: boolean;
}

export const DEFAULT_TEST_SPEC: TestEventSpec = {
  type: 'chat',
  platform: 'tiktok',
  count: 1,
  intervalMs: 400,
  recordToArchive: false,
};

/**
 * Common viewer shapes, so the usual cases are one click rather than six
 * toggles.
 *
 * "Stranger" first because it is the one people forget to test — a rule that
 * works for you and your moderators can be completely dead for everybody
 * else, and that failure is invisible from the inside.
 */
export const TEST_PERSONAS = [
  { id: 'stranger', label: 'Stranger', roles: {} },
  { id: 'follower', label: 'Follower', roles: { isFollower: true } },
  { id: 'mutual', label: 'Mutual', roles: { isFollower: true, isFriend: true } },
  { id: 'subscriber', label: 'Subscriber', roles: { isSubscriber: true } },
  { id: 'moderator', label: 'Moderator', roles: { isModerator: true } },
  { id: 'host', label: 'You (host)', roles: { isHost: true } },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  roles: Partial<TestEventSpec>;
}>;

export type TestPersona = (typeof TEST_PERSONAS)[number]['id'];
