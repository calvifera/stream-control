import type { Platform } from './platforms.js';

/**
 * Normalized event model.
 *
 * TikTok's webcast protobufs are wide, deeply nested and change shape between
 * proto revisions. Everything downstream (filters, gates, TTS rules, overlays)
 * speaks these types instead, so a proto change only ever touches
 * `server/src/tiktok/normalize.ts`.
 */

export const STREAM_EVENT_TYPES = [
  'chat',
  'gift',
  'follow',
  'share',
  'like',
  'join',
  'subscribe',
  'envelope',
  'question',
  'emote',
  'roomStats',
  'streamEnd',
  'system',
] as const;

export type StreamEventType = (typeof STREAM_EVENT_TYPES)[number];

/** Human labels for the dashboard UI. */
export const STREAM_EVENT_LABELS: Record<StreamEventType, string> = {
  chat: 'Chat message',
  gift: 'Gift',
  follow: 'New follower',
  share: 'Share',
  like: 'Likes',
  join: 'Viewer joined',
  subscribe: 'Subscription',
  envelope: 'Treasure box',
  question: 'Question',
  emote: 'Emote',
  roomStats: 'Room stats',
  streamEnd: 'Stream ended',
  system: 'System',
};

/**
 * TikTok exposes the viewer's relationship to the host as a status string.
 * 0 = stranger, 1 = follows the host, 2 = mutual ("friends").
 */
export type FollowRole = 0 | 1 | 2;

export interface StreamUser {
  /** Which service this person is speaking from. */
  platform: Platform;
  /** Platform-native user id, stable across a session. */
  userId: string;
  /** The @handle. Empty string if TikTok omitted it from the frame. */
  uniqueId: string;
  /** Display name. Falls back to uniqueId when absent. */
  nickname: string;
  avatarUrl: string | null;
  followRole: FollowRole;
  isFollower: boolean;
  isFriend: boolean;
  isSubscriber: boolean;
  isModerator: boolean;
  /** Host of the room (i.e. you). */
  isHost: boolean;
  isVerified: boolean;
  followerCount: number;
  /** Fans-club / "team member" level, 0 when not a member. */
  fansClubLevel: number;
  /** Names of badges TikTok attached to the message (subscriber, moderator, ...). */
  badges: string[];
}

export interface StreamEventBase {
  /** Server-generated unique id, also used as the React key in overlays. */
  id: string;
  ts: number;
  user: StreamUser | null;
  /**
   * Which connection produced this.
   *
   * Also present on `user`, but events without a user (roomStats, streamEnd,
   * system) still need attributing — otherwise "stream ended" can't say which
   * stream, and the chat pop-out can't route it to the right tab.
   */
  platform: Platform;
  /**
   * Spoofed for testing rather than received from a platform.
   *
   * Overlays, filters and TTS treat it exactly like a real event — that is the
   * point of firing one — but nothing permanent is written for it. Without
   * this, testing a rule a few dozen times invents regulars who then sit in
   * the viewer archive for ever, indistinguishable from people who actually
   * turned up.
   */
  synthetic?: boolean;
  /**
   * How much `user` has given, stamped by the hub as the event fans out.
   *
   * Overlays need this to decide whether someone is notable, and they cannot
   * work it out for themselves: the leaderboard they receive is truncated to
   * the top handful, so a client-side threshold would silently only ever see
   * the biggest gifters and miss everyone just over the line.
   *
   * Not stored on `StreamUser`, because it is not a property of a person — it
   * is a running total that is only true at the instant it is written, and
   * every archived copy of that user would carry a stale one for ever.
   */
  giving?: { session: number; lifetime: number };
}

export interface ChatEvent extends StreamEventBase {
  type: 'chat';
  user: StreamUser;
  /** Original message exactly as received. */
  text: string;
  /** After the filter chain: censored, or null when the message was dropped. */
  displayText: string | null;
  /** True when the filter chain censored or dropped this message. */
  filtered: boolean;
  filterReason: string | null;
  /**
   * Whether `text` must stay hidden from the host too.
   *
   * Only a refused or mixed script, which is unreadable to the host anyway.
   * Everything else the filter catches is shown and marked, because a false
   * positive can only be spotted by reading what was actually said.
   *
   * Viewer-facing overlays ignore this and render `displayText` regardless —
   * it governs what the moderator sees, never what the stream shows.
   */
  redacted: boolean;
  /**
   * How bad the filter judged it: `normal` is an ordinary blocklist hit,
   * `severe` is the zero-tolerance list that auto-penalties are built on.
   *
   * Carried on the event so the host's surfaces can tell the two apart
   * without re-deriving it from `filterReason` text.
   */
  filterSeverity: 'none' | 'normal' | 'severe';
  emotes: string[];
}

export interface GiftEvent extends StreamEventBase {
  type: 'gift';
  user: StreamUser;
  giftId: string;
  giftName: string;
  giftImageUrl: string | null;
  diamondCount: number;
  /** Number of gifts in this (possibly still-running) combo. */
  repeatCount: number;
  /** Combo has finished — this is the event you want to alert on. */
  repeatEnd: boolean;
  /** True for streakable gifts. Non-streakable gifts fire once with repeatEnd. */
  streakable: boolean;
  /** diamondCount * repeatCount. */
  totalDiamonds: number;
}

export interface FollowEvent extends StreamEventBase {
  type: 'follow';
  user: StreamUser;
  totalFollowCount: number;
}

export interface ShareEvent extends StreamEventBase {
  type: 'share';
  user: StreamUser;
  shareCount: number;
}

export interface LikeEvent extends StreamEventBase {
  type: 'like';
  user: StreamUser;
  likeCount: number;
  totalLikeCount: number;
}

export interface JoinEvent extends StreamEventBase {
  type: 'join';
  user: StreamUser;
  memberCount: number;
  /** First time we have seen this user in the current session. */
  isFirstJoin: boolean;
}

export interface SubscribeEvent extends StreamEventBase {
  type: 'subscribe';
  user: StreamUser;
  subMonths: number;
  /** Subscription was gifted by someone else. */
  isGifted: boolean;
}

export interface EnvelopeEvent extends StreamEventBase {
  type: 'envelope';
  user: StreamUser;
  coins: number;
  peopleCount: number;
}

export interface QuestionEvent extends StreamEventBase {
  type: 'question';
  user: StreamUser;
  text: string;
}

export interface EmoteEvent extends StreamEventBase {
  type: 'emote';
  user: StreamUser;
  emoteUrls: string[];
}

export interface RoomStatsEvent extends StreamEventBase {
  type: 'roomStats';
  user: null;
  /** People watching right now. */
  viewerCount: number;
  /**
   * Everyone who has tuned in at any point this stream, as the platform
   * counts it — cumulative, so it only rises.
   *
   * Null where the platform does not report it, which is everywhere except
   * TikTok. Kept apart from `viewerCount` because conflating the two is
   * exactly the bug this field was added to fix: the cumulative figure is
   * always larger, never falls, and matches nothing the streamer sees in
   * their own dashboard.
   */
  totalViewers: number | null;
  topViewers: Array<{ user: StreamUser; coinCount: number; rank: number }>;
}

export interface StreamEndEvent extends StreamEventBase {
  type: 'streamEnd';
  user: null;
  reason: string;
}

/** Locally generated notices (connect/disconnect/errors/test events). */
export interface SystemEvent extends StreamEventBase {
  type: 'system';
  user: null;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export type StreamEvent =
  | ChatEvent
  | GiftEvent
  | FollowEvent
  | ShareEvent
  | LikeEvent
  | JoinEvent
  | SubscribeEvent
  | EnvelopeEvent
  | QuestionEvent
  | EmoteEvent
  | RoomStatsEvent
  | StreamEndEvent
  | SystemEvent;

export type StreamEventOfType<T extends StreamEventType> = Extract<StreamEvent, { type: T }>;

/**
 * Placeholder for an event whose sender the platform did not identify.
 *
 * A function rather than a shared constant: a stray `ANONYMOUS_USER` baked to
 * one platform would silently mis-attribute every anonymous event on the other
 * two, and mis-attribution is the exact failure this whole change exists to
 * prevent.
 */
export const anonymousUser = (platform: Platform): StreamUser => ({
  platform,
  userId: '0',
  uniqueId: 'unknown',
  nickname: 'Unknown',
  avatarUrl: null,
  followRole: 0,
  isFollower: false,
  isFriend: false,
  isSubscriber: false,
  isModerator: false,
  isHost: false,
  isVerified: false,
  followerCount: 0,
  fansClubLevel: 0,
  badges: [],
});
