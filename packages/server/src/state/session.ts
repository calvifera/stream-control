import { emptyPlatformStats, viewerKey } from '@streaming/shared';
import type {
  LeaderboardEntry,
  Platform,
  PlatformSessionStats,
  SessionStats,
  StreamEvent,
  StreamUser,
} from '@streaming/shared';

/** Sums only the platforms that reported, so an absent one stays absent. */
function sumViewers(counts: Partial<Record<Platform, number>>): number {
  return Object.values(counts).reduce<number>((total, count) => total + (count ?? 0), 0);
}

function emptyStats(): SessionStats {
  return {
    startedAt: Date.now(),
    viewerCount: 0,
    peakViewerCount: 0,
    viewerCounts: {},
    likes: 0,
    diamonds: 0,
    gifts: 0,
    followers: 0,
    shares: 0,
    comments: 0,
    subscribers: 0,
    joins: 0,
    uniqueChatters: 0,
    platforms: {},
  };
}

/**
 * Per-session aggregates. Everything here resets when you reconnect to a new
 * stream, which is what gates like "must have gifted" and the top-gifter
 * leaderboard are scoped to.
 */
export class SessionState {
  private stats: SessionStats = emptyStats();
  private users = new Map<string, LeaderboardEntry>();
  private chatters = new Set<string>();
  private seen = new Set<string>();

  reset(): void {
    this.stats = emptyStats();
    this.users.clear();
    this.chatters.clear();
    this.seen.clear();
  }

  getStats(): SessionStats {
    // The per-platform map is copied a level deeper than the rest. `getStats`
    // hands out a shallow copy, and every reader would otherwise share one
    // mutable object per platform — so a snapshot taken for the overlay would
    // keep changing under it.
    const platforms: Partial<Record<Platform, PlatformSessionStats>> = {};
    for (const [platform, entry] of Object.entries(this.stats.platforms)) {
      platforms[platform as Platform] = { ...(entry as PlatformSessionStats) };
    }
    return { ...this.stats, platforms };
  }

  /** This platform's slice, created on first sight of it. */
  private platformStats(platform: Platform): PlatformSessionStats {
    const existing = this.stats.platforms[platform];
    if (existing) return existing;
    const created = emptyPlatformStats();
    this.stats.platforms[platform] = created;
    return created;
  }

  /**
   * Forgets one platform's viewer count.
   *
   * Called when a connection drops. The last number it reported is not still
   * true — it is just the last thing we heard — and leaving it in the sum
   * would keep a disconnected platform's audience in the headline figure for
   * the rest of the night.
   */
  clearViewers(platform: Platform): void {
    if (this.stats.viewerCounts[platform] === undefined) return;
    const next = { ...this.stats.viewerCounts };
    delete next[platform];
    this.stats.viewerCounts = next;
    this.stats.viewerCount = sumViewers(next);
    // Peak is deliberately left alone: it is a record of what happened, and a
    // disconnect does not un-happen it.
    const slice = this.stats.platforms[platform];
    if (slice) slice.viewers = null;
  }

  /** True the first time a given user id shows up this session. */
  markSeen(user: StreamUser | null): boolean {
    const userId = user ? viewerKey(user.platform, user.userId) : '';
    if (!userId || this.seen.has(userId)) return false;
    this.seen.add(userId);
    if (user) this.platformStats(user.platform).seen += 1;
    return true;
  }

  private entryFor(user: StreamUser): LeaderboardEntry {
    // Platform-qualified: TikTok and Twitch both mint their own user ids, so
    // the raw id is only unique within one service.
    const key = viewerKey(user.platform, user.userId);
    const existing = this.users.get(key);
    if (existing) {
      // Keep the freshest profile: badges and follow status change mid-stream.
      existing.user = user;
      existing.lastSeen = Date.now();
      return existing;
    }
    const created: LeaderboardEntry = {
      user,
      diamonds: 0,
      gifts: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      lastSeen: Date.now(),
    };
    this.users.set(key, created);
    return created;
  }

  /** Folds one normalized event into the aggregates. */
  ingest(event: StreamEvent): void {
    switch (event.type) {
      case 'chat': {
        this.stats.comments += 1;
        this.entryFor(event.user).comments += 1;
        const slice = this.platformStats(event.user.platform);
        slice.messages += 1;
        if (!this.chatters.has(viewerKey(event.user.platform, event.user.userId))) {
          this.chatters.add(viewerKey(event.user.platform, event.user.userId));
          this.stats.uniqueChatters = this.chatters.size;
          slice.chatters += 1;
        }
        break;
      }
      case 'gift': {
        // Streaks emit repeatedly; only bank the totals once the combo ends.
        if (event.streakable && !event.repeatEnd) break;
        const entry = this.entryFor(event.user);
        entry.diamonds += event.totalDiamonds;
        entry.gifts += event.repeatCount;
        this.stats.diamonds += event.totalDiamonds;
        this.stats.gifts += event.repeatCount;
        const slice = this.platformStats(event.user.platform);
        slice.diamonds += event.totalDiamonds;
        slice.gifts += event.repeatCount;
        break;
      }
      case 'like': {
        this.entryFor(event.user).likes += event.likeCount;
        // `totalLikeCount` is the room total and only ever grows.
        this.stats.likes = Math.max(this.stats.likes, event.totalLikeCount);
        const slice = this.platformStats(event.user.platform);
        slice.likes = Math.max(slice.likes, event.totalLikeCount);
        break;
      }
      case 'follow': {
        this.stats.followers += 1;
        this.entryFor(event.user);
        this.platformStats(event.user.platform).followers += 1;
        break;
      }
      case 'share': {
        this.stats.shares += 1;
        this.entryFor(event.user).shares += 1;
        this.platformStats(event.user.platform).shares += 1;
        break;
      }
      case 'subscribe': {
        this.stats.subscribers += 1;
        this.entryFor(event.user);
        this.platformStats(event.user.platform).subscribers += 1;
        break;
      }
      case 'join': {
        this.stats.joins += 1;
        break;
      }
      case 'roomStats': {
        // Replaced rather than mutated: `getStats` hands out a shallow copy,
        // so a mutated nested object would be seen by every reader that is
        // still holding an older snapshot.
        this.stats.viewerCounts = {
          ...this.stats.viewerCounts,
          [event.platform]: event.viewerCount,
        };
        this.stats.viewerCount = sumViewers(this.stats.viewerCounts);
        this.stats.peakViewerCount = Math.max(
          this.stats.peakViewerCount,
          this.stats.viewerCount,
        );
        const slice = this.platformStats(event.platform);
        slice.viewers = event.viewerCount;
        slice.peakViewers = Math.max(slice.peakViewers, event.viewerCount);
        // Monotonic by nature, but taken as a max anyway: a late or duplicated
        // frame carrying a smaller number should not walk the total back.
        if (event.totalViewers !== null) {
          slice.reportedTotal = Math.max(slice.reportedTotal ?? 0, event.totalViewers);
        }
        break;
      }
      default:
        break;
    }
  }

  sessionDiamonds(user: StreamUser): number {
    return this.users.get(viewerKey(user.platform, user.userId))?.diamonds ?? 0;
  }

  hasGifted(user: StreamUser): boolean {
    return (this.users.get(viewerKey(user.platform, user.userId))?.gifts ?? 0) > 0;
  }

  leaderboard(limit = 25): LeaderboardEntry[] {
    return [...this.users.values()]
      .filter((e) => e.diamonds > 0 || e.gifts > 0 || e.likes > 0 || e.comments > 0)
      .sort((a, b) => b.diamonds - a.diamonds || b.gifts - a.gifts || b.likes - a.likes)
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }
}
