import type { StreamUser } from './events.js';
import { PLATFORM_INFO, PLATFORMS, type Platform } from './platforms.js';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface LeaderboardEntry {
  user: StreamUser;
  diamonds: number;
  gifts: number;
  likes: number;
  comments: number;
  shares: number;
  lastSeen: number;
}

/**
 * One platform's slice of the session.
 *
 * Exists because every headline number in `SessionStats` is a sum, and a sum
 * cannot answer the question you actually have while streaming to three
 * places at once — "is anyone watching on Twitch?" is invisible inside a
 * combined viewer count.
 *
 * `viewers` is nullable for the same reason `viewerCounts` omits platforms:
 * a connection that never reports a count has an unknown audience, not an
 * empty one, and a 0 there would be a number you would read and believe.
 */
export interface PlatformSessionStats {
  /** Live right now, or null when this platform does not report it. */
  viewers: number | null;
  /** The highest `viewers` reached this session. */
  peakViewers: number;
  /**
   * Everyone who tuned in at all, as the *platform* counts it.
   *
   * Null where the platform does not report it. Worth having next to `seen`
   * because the two measure different things and the platform's is the larger
   * and more honest one: `seen` can only count people who did something
   * observable, and most of an audience never does.
   */
  reportedTotal: number | null;
  /**
   * Distinct people seen at all this session, by any event.
   *
   * The closest thing to "how many turned up" that a chat connection can
   * answer, and always far larger than `chatters` — most of an audience never
   * types anything.
   */
  seen: number;
  /** Distinct people who sent at least one message. */
  chatters: number;
  messages: number;
  diamonds: number;
  gifts: number;
  followers: number;
  subscribers: number;
  shares: number;
  likes: number;
}

export function emptyPlatformStats(): PlatformSessionStats {
  return {
    viewers: null,
    peakViewers: 0,
    reportedTotal: null,
    seen: 0,
    chatters: 0,
    messages: 0,
    diamonds: 0,
    gifts: 0,
    followers: 0,
    subscribers: 0,
    shares: 0,
    likes: 0,
  };
}

/** Everything overlays need to render without replaying the event log. */
export interface SessionStats {
  startedAt: number;
  /**
   * Live viewers, summed across every platform that reports a number.
   *
   * This used to be written straight from TikTok's `roomStats`, which made it
   * a TikTok-only figure presenting itself as the total: connect Twitch and
   * its audience simply did not exist as far as this number was concerned.
   * Read it together with `viewerCounts` — a platform missing from there is
   * one that never told us, which is not the same as one with no viewers.
   */
  viewerCount: number;
  peakViewerCount: number;
  /**
   * Per-platform live counts, holding only platforms that actually report.
   *
   * Absent is "not measured", never zero. Twitch's IRC connection carries no
   * viewer count at all — that needs a Helix call with app credentials — so
   * showing a 0 there would be inventing a fact.
   */
  viewerCounts: Partial<Record<Platform, number>>;
  likes: number;
  diamonds: number;
  gifts: number;
  followers: number;
  shares: number;
  comments: number;
  subscribers: number;
  joins: number;
  uniqueChatters: number;
  /**
   * The same session, split by platform.
   *
   * Always holds an entry for every platform that has produced any event this
   * session, so a tab can render its own numbers without the caller having to
   * decide what an absent platform means.
   */
  platforms: Partial<Record<Platform, PlatformSessionStats>>;
}

/**
 * A one-line account of where the viewer number came from.
 *
 * Returns null when there is nothing worth saying — a single platform
 * reporting, with nothing else connected, is adequately described by the
 * number itself.
 *
 * The half that matters is `not counted`. A platform that is connected but
 * reports no viewer count is named explicitly, because a total that silently
 * omits an audience is worse than having no total: you would read it, believe
 * it, and be wrong with no way to notice.
 */
export function viewerSourceNote(
  counts: Partial<Record<Platform, number>> | undefined,
  connected: readonly Platform[],
): string | null {
  const reporting = PLATFORMS.filter((platform) => counts?.[platform] !== undefined);
  const silent = PLATFORMS.filter(
    (platform) => counts?.[platform] === undefined && connected.includes(platform),
  );

  if (reporting.length === 0 && silent.length === 0) return null;

  const parts: string[] = [];
  // A lone platform with nothing else connected needs no attribution.
  if (reporting.length > 1 || (reporting.length === 1 && silent.length > 0)) {
    parts.push(
      reporting
        .map((platform) => `${PLATFORM_INFO[platform].label} ${counts?.[platform] ?? 0}`)
        .join(' · '),
    );
  }
  if (silent.length > 0) {
    parts.push(`${silent.map((p) => PLATFORM_INFO[p].label).join(' and ')} not counted`);
  }

  return parts.length > 0 ? parts.join(' — ') : null;
}

export interface ConnectionState {
  status: ConnectionStatus;
  username: string;
  roomId: string | null;
  /** Populated once connected; used for the dashboard header. */
  hostNickname: string | null;
  hostAvatarUrl: string | null;
  connectedAt: number | null;
  /**
   * When the broadcast itself went live, or null when it is not.
   *
   * Deliberately separate from `connectedAt`, because being connected is not
   * the same as being live and on Twitch the two are barely related: chat is
   * read over IRC, which joins a channel whether or not anyone is streaming
   * to it. A timer counting from `connectedAt` there measures how long the
   * socket has been open, which on a channel that has been idle all day is a
   * number with no meaning.
   *
   * TikTok and YouTube cannot connect to a room that is not live, so for
   * those the two coincide. Twitch has to be asked separately.
   */
  liveSince: number | null;
  lastError: string | null;
  reconnectAttempts: number;
}

export interface TtsQueueItem {
  id: string;
  ruleId: string;
  ruleName: string;
  text: string;
  voice: string;
  provider: 'tiktok' | 'google' | 'google-legacy' | 'browser';
  priority: number;
  volume: number;
  /** Speed multiplier; playback preserves pitch. */
  rate: number;
  /** Pitch multiplier; playback preserves duration. */
  pitch: number;
  createdAt: number;
  /** Present for the `tiktok` provider once synthesis succeeded. */
  audioUrl: string | null;
  /** Milliseconds, when the provider reported it. */
  durationMs: number | null;
  username: string;
}

export interface TtsState {
  enabled: boolean;
  speaking: TtsQueueItem | null;
  queue: TtsQueueItem[];
  /** Every client able to play audio, including fallback ones. */
  listeners: number;
  /**
   * Just the real TTS browser sources. When this is 0 but `listeners` isn't,
   * audio is coming out of the dashboard rather than into your stream.
   */
  overlayListeners: number;
  lastError: string | null;
}

export interface TunnelState {
  enabled: boolean;
  url: string | null;
  error: string | null;
  /**
   * True when the URL comes from an ngrok agent that was already running on
   * this machine rather than one this server started. Stopping the tunnel
   * then only detaches — killing someone else's agent would be rude.
   */
  external?: boolean;
  /**
   * Set when an agent is running but forwarding somewhere other than this
   * server, which looks like a working tunnel right up until nothing loads.
   */
  mismatch?: string | null;
}

/**
 * Result of verifying `sources.host` still points at this server.
 *
 * `reachable` is the one that matters: it means a request to that hostname
 * came back from this exact process, not merely that something answered.
 */
export interface SourceHostCheck {
  host: string;
  /** False when no source hostname is set, in which case nothing else applies. */
  configured: boolean;
  addresses: string[];
  /** Every resolved address is loopback — the safest possible answer. */
  loopbackOnly: boolean;
  /** Resolved somewhere that is neither loopback nor one of this machine's NICs. */
  offMachine: boolean;
  reachable: boolean;
  checkedAt: number;
  error: string | null;
}

export interface ServerSnapshot {
  /**
   * TikTok connection, kept under its original name so every existing
   * overlay keeps working. Identical to `connections.tiktok`.
   */
  connection: ConnectionState;
  /** Every configured platform, whether or not it is currently connected. */
  connections: Partial<Record<Platform, ConnectionState>>;
  stats: SessionStats;
  leaderboard: LeaderboardEntry[];
  tts: TtsState;
  tunnel: TunnelState;
  localUrl: string;
}
