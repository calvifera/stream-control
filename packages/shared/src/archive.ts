import type { Platform } from './platforms.js';

/**
 * Types for the viewer archive: the long-lived record of everyone who has
 * ever shown up, as opposed to `SessionStats` which resets on every reconnect.
 *
 * The split matters. Session numbers answer "how is tonight going"; these
 * answer "who are my regulars" — and only the second survives a restart.
 */

/** One row in the archive list. */
export interface ArchiveEntry {
  platform: Platform;
  /**
   * Canonical `platform:handle`. Send this to any endpoint that writes to a
   * list — passing the bare username would file a Twitch viewer under TikTok
   * and act on an unrelated person.
   */
  key: string;
  /** Bare handle for display. */
  username: string;
  displayName: string;
  avatarUrl: string | null;
  userId: string;
  firstSeen: number;
  lastSeen: number;
  /** Distinct calendar days this person has appeared on. */
  daysSeen: number;
  messages: number;
  strikes: number;
  /** Lifetime totals. Collection started when the archive shipped, so these
   *  read zero for anyone whose activity predates it. */
  diamonds: number;
  gifts: number;
  likes: number;
  follows: number;
  shares: number;
  /** Added by hand rather than seen in chat, and so never trimmed. */
  pinned: boolean;
  trusted: boolean;
  penalized: boolean;
  hasVoice: boolean;
}

export const ARCHIVE_SORTS = [
  'lastSeen',
  'firstSeen',
  'daysSeen',
  'messages',
  'diamonds',
  'strikes',
  'username',
] as const;
export type ArchiveSort = (typeof ARCHIVE_SORTS)[number];

export const ARCHIVE_FILTERS = [
  'all',
  'chatters',
  'lurkers',
  'regulars',
  'gifters',
  'trusted',
  'penalized',
  'flagged',
] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

export interface ArchiveQuery {
  q?: string;
  /**
   * Restrict to one service. Absent means every platform.
   *
   * A separate axis from `filter` on purpose: "Twitch regulars" is a question
   * you actually ask, and folding platforms into the filter list would make
   * every combination its own entry.
   */
  platform?: Platform;
  sort?: ArchiveSort;
  filter?: ArchiveFilter;
  /** Newest/largest first when true, which is the useful default for every
   *  sort except username. */
  desc?: boolean;
  offset?: number;
  limit?: number;
}

export interface ArchivePage {
  entries: ArchiveEntry[];
  /** How many rows match the current query, not how many were returned. */
  total: number;
  offset: number;
  limit: number;
}

export interface ArchiveCapacity {
  size: number;
  max: number;
  /** Users added per day, averaged over the days we have records for. */
  perDay: number;
  /** Days until trimming starts discarding people; null when not on track to. */
  daysUntilFull: number | null;
}

export interface DayCount {
  /** `YYYY-MM-DD`, local time — the day the streamer would recognise. */
  day: string;
  count: number;
}

/**
 * How long a visit has to last to count at each step of the retention curve,
 * in minutes.
 *
 * Chosen around the shape of a stream rather than a product funnel: the first
 * minute separates a drive-by from a look, five minutes is "gave it a chance",
 * and an hour is someone who is actually watching.
 */
export const RETENTION_BUCKETS = [1, 5, 15, 30, 60, 120] as const;
export type RetentionBucket = (typeof RETENTION_BUCKETS)[number];

/**
 * A retention curve over some scope (one platform, one day, or everything).
 *
 * Counts *visits*, not people: someone who turns up on six nights contributes
 * six visits, which is the honest denominator for "how long do people stay".
 *
 * Only viewers who produce at least one event can be measured — a chat
 * message, a like, a gift, or a join. Silent lurkers are invisible to every
 * platform's API in a way this cannot work around, so read these as retention
 * among *active* viewers, not among everyone in the room.
 */
export interface RetentionCurve {
  /** Visits started within this scope. The denominator for `reached`. */
  visits: number;
  /**
   * How many of those visits lasted at least `RETENTION_BUCKETS[i]` minutes.
   * Same length and order as `RETENTION_BUCKETS`, and monotonically
   * non-increasing — reaching 30 minutes implies having reached 15.
   */
  reached: number[];
  /** Summed duration of every completed visit, for the mean. */
  totalMs: number;
  /** The single longest visit seen in this scope. */
  longestMs: number;
  /** Visits still open right now, already counted in `visits`. */
  open: number;
}

export function emptyCurve(): RetentionCurve {
  return {
    visits: 0,
    reached: RETENTION_BUCKETS.map(() => 0),
    totalMs: 0,
    longestMs: 0,
    open: 0,
  };
}

/** The share of visits that made it to each bucket, 0-1. */
export function retentionRates(curve: RetentionCurve): number[] {
  if (curve.visits === 0) return RETENTION_BUCKETS.map(() => 0);
  return curve.reached.map((count) => count / curve.visits);
}

/** Mean visit length in ms, or 0 when nothing has been recorded. */
export function meanVisitMs(curve: RetentionCurve): number {
  return curve.visits === 0 ? 0 : Math.round(curve.totalMs / curve.visits);
}

/** Everything the analytics page shows, narrowed to one service. */
export interface PlatformBreakdown {
  platform: Platform;
  viewers: number;
  chatters: number;
  lurkers: number;
  regulars: number;
  messages: number;
  diamonds: number;
  strikes: number;
  /** People with at least one strike, matching the global `flagged`. */
  flagged: number;
  trusted: number;
  penalized: number;
  /** Mean messages per person who spoke, matching the global figure. */
  messagesPerChatter: number;
  firstRecordAt: number | null;
  lastRecordAt: number | null;
  /** New viewers first recorded on this platform in the last 14 days. */
  newPerDay: DayCount[];
  retention: RetentionCurve;
  /**
   * Leaderboards for this service alone.
   *
   * Not derivable by filtering the global lists: the global top ten can be
   * entirely TikTok, which would leave a Twitch panel showing either nothing
   * or, worse, TikTok names under a Twitch heading.
   */
  topChatters: ArchiveEntry[];
  topGifters: ArchiveEntry[];
  mostFlagged: ArchiveEntry[];
}

export interface ArchiveAnalytics {
  totalViewers: number;
  /** Anyone who has ever sent a message that got through the filter. */
  chatters: number;
  /** Seen in the room but never spoke. */
  lurkers: number;
  /** Seen on more than one day. */
  regulars: number;
  totalMessages: number;
  totalDiamonds: number;
  totalStrikes: number;
  trusted: number;
  penalized: number;
  flagged: number;
  withVoice: number;
  firstRecordAt: number | null;
  lastRecordAt: number | null;
  /** Mean messages per person, counting only people who actually spoke. */
  messagesPerChatter: number;
  newPerDay: DayCount[];
  /** Local-hour histogram of when people first turned up, length 24. */
  arrivalsByHour: number[];
  /** Per-service split of everything above, in PLATFORMS order. */
  platforms: PlatformBreakdown[];
  /** Retention across every platform at once. */
  retention: RetentionCurve;
  topChatters: ArchiveEntry[];
  topGifters: ArchiveEntry[];
  mostFlagged: ArchiveEntry[];
  capacity: ArchiveCapacity;
}
