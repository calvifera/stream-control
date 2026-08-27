import fs from 'node:fs';
import path from 'node:path';
import type {
  ArchiveCapacity,
  PlatformBreakdown,
  RetentionCurve,
  ArchiveAnalytics,
  ArchiveEntry,
  ArchiveFilter,
  ArchivePage,
  ArchiveQuery,
  Platform,
  StreamEvent,
  StreamUser,
} from '@streaming/shared';
import { PLATFORMS, emptyCurve, readViewerKey, viewerKey } from '@streaming/shared';
import { DATA_DIR, ensureDirs } from '../env.js';
import { createLogger } from '../logger.js';

/**
 * The parts of an archive row that live outside the directory.
 *
 * Trusted, penalized and voice status are config; avatars are a separate
 * cache. Passing them in keeps this module free of both.
 */
export interface ArchiveContext {
  trusted: Set<string>;
  penalized: Set<string>;
  voiced: Set<string>;
  avatarPath: (username: string) => string | null;
  /**
   * Per-platform retention, which lives in its own store because it is about
   * visits rather than people and so cannot be derived from these records.
   * Absent in checks that do not exercise it; the curves read as empty.
   */
  retention?: (platform: Platform) => RetentionCurve;
}

const log = createLogger('directory');

const STORE_PATH = path.join(DATA_DIR, 'users.json');

/**
 * How many people the archive holds before it starts discarding the least
 * interesting ones.
 *
 * This was 5,000, which sounds generous until you watch the numbers: a single
 * stream adds ~500-800 first-time viewers, so the cap was days away from
 * quietly eating history the archive exists to show. At ~420 bytes a head this
 * is roughly a 10 MB file, which measures at ~35 ms to serialise and write —
 * paid at most once every 5 seconds, off the back of a debounce.
 */
const MAX_USERS = 25_000;
const MAX_EVIDENCE = 5;

export interface KnownUser {
  /**
   * Which service this handle belongs to.
   *
   * Absent on records written before multi-platform support; those are all
   * TikTok, and `load()` fills them in.
   */
  platform: Platform;
  /** Bare handle, no platform prefix — this is what gets displayed. */
  username: string;
  displayName: string;
  avatarUrl: string | null;
  userId: string;
  firstSeen: number;
  lastSeen: number;
  messages: number;
  /** Confirmed filter-evasion attempts on a severe term. */
  strikes: number;
  /** The offending messages, newest first, kept for review. */
  evidence: Array<{ ts: number; text: string; reason: string }>;
  /**
   * Added by hand rather than seen in chat. Pinned users are never trimmed:
   * someone on your trusted list must stay findable even if they never speak.
   */
  pinned?: boolean;
  /** When the profile was last looked up, successful or not. */
  avatarCheckedAt?: number;
  /** Whether that last lookup worked, for reporting rather than logic. */
  avatarOk?: boolean;

  /* ---- Lifetime totals -------------------------------------------------
   * `SessionState` already counts all of this, but it resets on every
   * reconnect, so before this existed nothing survived the night. These are
   * the cross-stream copies. Anyone recorded before they were added reads
   * zero rather than wrong — an absent count is not a count of nothing, and
   * the dashboard says so rather than implying these people never gifted.
   * -------------------------------------------------------------------- */
  diamonds?: number;
  gifts?: number;
  likes?: number;
  follows?: number;
  shares?: number;
  /** Distinct local calendar days seen, the cheapest honest loyalty signal. */
  daysSeen?: number;
  /** `YYYY-MM-DD` of the last appearance, so `daysSeen` counts days not visits. */
  lastDay?: string;
}

interface StoredDirectory {
  version: number;
  users: KnownUser[];
}

/**
 * Everyone the server has ever seen, persisted across restarts.
 *
 * This is what powers the username autocomplete. TikTok has no public user
 * search endpoint, so rather than guess at handles this offers the people who
 * have actually been in your chat — which is who you want to trust or mute
 * anyway.
 */
export class UserDirectory {
  /**
   * Keyed by `platform:handle`, never by handle alone.
   *
   * A bare handle is not an identity: TikTok's @bob and Twitch's @bob are two
   * unrelated people, and keying on the handle would sum their message counts,
   * share their strikes, and let muting one silence the other.
   */
  private users = new Map<string, KnownUser>();
  private writeTimer: NodeJS.Timeout | null = null;

  /**
   * Canonical map key for anything a caller might pass.
   *
   * Accepts a qualified `platform:handle` or a bare handle left over from
   * before platforms existed — the latter resolves to TikTok, since that is
   * the only place old data could have come from.
   */
  private static keyOf(value: string): string {
    const { platform, handle } = readViewerKey(value);
    return viewerKey(platform, handle);
  }

  private static keyOfUser(user: StreamUser): string {
    return viewerKey(user.platform, user.uniqueId);
  }

  constructor() {
    this.load();
  }

  private load(): void {
    ensureDirs();
    if (!fs.existsSync(STORE_PATH)) return;

    try {
      const raw = JSON.parse(readJsonText(STORE_PATH)) as StoredDirectory;
      let backfilled = 0;
      let migrated = 0;
      for (const user of raw.users ?? []) {
        if (typeof user?.username === 'string' && user.username) {
          if (user.daysSeen === undefined) {
            backfilled += 1;
            this.backfillDays(user);
          }
          // Records written before platforms existed carry no platform and
          // were all TikTok.
          if (!user.platform) {
            user.platform = 'tiktok';
            migrated += 1;
          }
          this.users.set(viewerKey(user.platform, user.username), user);
        }
      }
      log.info(`Loaded ${this.users.size} known user(s)`);
      if (backfilled > 0) log.info(`Estimated days-seen for ${backfilled} pre-archive user(s)`);
      if (migrated > 0) log.info(`Tagged ${migrated} pre-multiplatform record(s) as TikTok`);
    } catch (error) {
      log.warn(`Could not read ${STORE_PATH}, starting with an empty directory: ${String(error)}`);
    }
  }

  /**
   * Gives a pre-archive user a defensible `daysSeen`.
   *
   * Only `firstSeen` and `lastSeen` were ever stored, so the true number of
   * distinct days is unrecoverable. But two different calendar dates prove at
   * least two appearances, so that is what this claims — a floor, never a
   * guess. Someone who came to five streams reads as 2 until their next visit
   * starts counting properly, which undercounts loyalty rather than inventing
   * it.
   */
  private backfillDays(user: KnownUser): void {
    const first = localDay(user.firstSeen);
    const last = localDay(user.lastSeen);
    user.daysSeen = first === last ? 1 : 2;
    user.lastDay = last;
  }

  private schedulePersist(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persist();
    }, 5000);
  }

  persist(): void {
    try {
      ensureDirs();
      const users = this.trim([...this.users.values()]);

      const tmp = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, users } satisfies StoredDirectory), 'utf8');
      fs.renameSync(tmp, STORE_PATH);
    } catch (error) {
      log.warn(`Could not write ${STORE_PATH}: ${String(error)}`);
    }
  }

  /**
   * Chooses who survives when the archive is over capacity.
   *
   * Sorting the whole set by recency — what this used to do — throws away
   * exactly the wrong people. A regular who chatted for weeks and then took a
   * month off would be discarded before a lurker who wandered through last
   * night and never spoke. So drop in bands, least interesting first, and only
   * order by recency to break ties inside a band.
   */
  private trim(all: KnownUser[]): KnownUser[] {
    if (all.length <= MAX_USERS) return all;

    const byRecency = (a: KnownUser, b: KnownUser): number => b.lastSeen - a.lastSeen;
    // Deliberately ordered: each band is only reached once the ones above it
    // have been taken in full.
    const bands = [
      all.filter((u) => u.pinned),
      all.filter((u) => !u.pinned && u.strikes > 0),
      all.filter((u) => !u.pinned && u.strikes === 0 && u.messages > 0),
      all.filter((u) => !u.pinned && u.strikes === 0 && u.messages === 0),
    ];

    const kept: KnownUser[] = [];
    for (const band of bands) {
      if (kept.length >= MAX_USERS) break;
      kept.push(...band.sort(byRecency).slice(0, MAX_USERS - kept.length));
    }

    const dropped = all.length - kept.length;
    if (dropped > 0) log.info(`Archive at capacity — trimmed ${dropped} inactive lurker(s)`);
    return kept;
  }

  /** Records that a user was seen, refreshing their cached profile. */
  observe(user: StreamUser, counted = false): KnownUser | null {
    const username = normalize(user.uniqueId);
    if (!username) return null;
    const key = UserDirectory.keyOfUser(user);

    const now = Date.now();
    const existing = this.users.get(key);

    const entry: KnownUser = existing ?? {
      platform: user.platform,
      username,
      displayName: user.nickname,
      avatarUrl: user.avatarUrl,
      userId: user.userId,
      firstSeen: now,
      lastSeen: now,
      messages: 0,
      strikes: 0,
      evidence: [],
    };

    entry.displayName = user.nickname || entry.displayName;
    entry.avatarUrl = user.avatarUrl ?? entry.avatarUrl;
    entry.userId = user.userId || entry.userId;
    entry.lastSeen = now;
    if (counted) entry.messages += 1;

    // Counting days rather than visits: someone who joins, drops out and
    // rejoins four times in an evening is one day of loyalty, not four.
    const today = localDay(now);
    if (entry.lastDay !== today) {
      entry.lastDay = today;
      entry.daysSeen = (entry.daysSeen ?? 0) + 1;
    }

    this.users.set(key, entry);
    this.schedulePersist();
    return entry;
  }

  /**
   * Folds an event into a user's lifetime totals.
   *
   * Mirrors `SessionState.ingest`, but survives reconnects. Gift streaks are
   * skipped until the combo ends for the same reason they are there: a streak
   * emits on every tick and banking each one multiplies the total.
   */
  /**
   * Lifetime diamonds for one viewer, or 0 for someone never seen before.
   *
   * Separate from `lookup` because highlights ask this for every single chat
   * message: it has to be a map hit and nothing else.
   */
  lifetimeGiven(user: StreamUser): number {
    return this.users.get(UserDirectory.keyOfUser(user))?.diamonds ?? 0;
  }

  record(event: StreamEvent): void {
    if (!event.user) return;
    const entry = this.users.get(UserDirectory.keyOfUser(event.user));
    if (!entry) return;

    switch (event.type) {
      case 'gift': {
        if (event.streakable && !event.repeatEnd) return;
        entry.diamonds = (entry.diamonds ?? 0) + event.totalDiamonds;
        entry.gifts = (entry.gifts ?? 0) + event.repeatCount;
        break;
      }
      case 'like':
        entry.likes = (entry.likes ?? 0) + event.likeCount;
        break;
      case 'follow':
        entry.follows = (entry.follows ?? 0) + 1;
        break;
      case 'share':
        entry.shares = (entry.shares ?? 0) + 1;
        break;
      default:
        return;
    }
    this.schedulePersist();
  }

  get(username: string): KnownUser | undefined {
    return this.users.get(UserDirectory.keyOf(username));
  }

  /**
   * Registers someone added by hand — trusted, muted, or given a voice —
   * rather than seen in chat.
   *
   * Without this a manually added handle lived only inside the config list, so
   * the picker could never find them again and every list showed a bare
   * handle with no display name. Now anyone you list is a first-class member
   * of the directory whether or not they have ever spoken.
   */
  remember(username: string, displayName?: string): KnownUser | null {
    // Accepts a qualified `platform:handle` or a bare handle from older config,
    // which can only have come from TikTok.
    const { platform, handle } = readViewerKey(username);
    if (!handle) return null;

    const existing = this.users.get(viewerKey(platform, handle));
    if (existing) {
      existing.pinned = true;
      // Only fill in a name we don't have; never overwrite one TikTok gave us.
      if (displayName?.trim() && existing.displayName === existing.username) {
        existing.displayName = displayName.trim();
      }
      this.schedulePersist();
      return existing;
    }

    const now = Date.now();
    const entry: KnownUser = {
      platform,
      username: handle,
      displayName: displayName?.trim() || handle,
      avatarUrl: null,
      userId: '',
      firstSeen: now,
      lastSeen: now,
      messages: 0,
      strikes: 0,
      evidence: [],
      pinned: true,
    };

    this.users.set(viewerKey(platform, handle), entry);
    this.schedulePersist();
    return entry;
  }

  /**
   * Merges what a profile lookup found. Only fills fields the lookup actually
   * returned, so a partial result never blanks something chat already gave us.
   */
  applyProfile(
    username: string,
    profile: { nickname?: string; avatarUrl?: string; userId?: string },
  ): void {
    const entry = this.users.get(UserDirectory.keyOf(username));
    if (!entry) return;

    if (hasVisibleText(profile.nickname)) entry.displayName = profile.nickname!.trim();
    if (profile.avatarUrl) entry.avatarUrl = profile.avatarUrl;
    if (profile.userId && !entry.userId) entry.userId = profile.userId;
    this.schedulePersist();
  }

  /** Records that we looked, so the poller can back off appropriately. */
  markAvatarChecked(username: string, ok: boolean): void {
    const entry = this.users.get(UserDirectory.keyOf(username));
    if (!entry) return;
    entry.avatarCheckedAt = Date.now();
    entry.avatarOk = ok;
    this.schedulePersist();
  }

  /** Most recently active users first. */
  recent(limit = 100): KnownUser[] {
    return [...this.users.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
  }

  /** Everyone, for counting and reporting. */
  all(): KnownUser[] {
    return [...this.users.values()];
  }

  /** Directory entries for a specific set of handles, for rendering lists. */
  lookup(usernames: string[]): KnownUser[] {
    const seen = new Set<string>();
    const found: KnownUser[] = [];
    for (const name of usernames) {
      // `keyOf`, not `normalize`. The map is keyed `platform:handle`, so a
      // bare handle from a pre-platform config list missed every time — which
      // is what made a whole trusted list lose its avatars and display names
      // the moment platform keys arrived.
      const key = UserDirectory.keyOf(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = this.users.get(key);
      if (entry) found.push(entry);
    }
    return found;
  }

  /** Adds a strike and returns the new total. */
  recordStrike(user: StreamUser, text: string, reason: string): number {
    const entry = this.observe(user) ?? null;
    if (!entry) return 0;

    entry.strikes += 1;
    entry.evidence.unshift({ ts: Date.now(), text: text.slice(0, 280), reason });
    entry.evidence = entry.evidence.slice(0, MAX_EVIDENCE);

    this.schedulePersist();
    return entry.strikes;
  }

  /**
   * Removes someone from the archive entirely.
   *
   * The archive is otherwise append-only, which is right for a record of who
   * turned up — but not everything in it turned up. Test fires that were
   * deliberately recorded, and the invented names left by the old test button,
   * are indistinguishable from real viewers once written and skew every
   * lifetime total until they can be taken out again.
   *
   * Returns whether anyone was actually removed, so a caller can 404 rather
   * than silently claim success.
   */
  forget(username: string): boolean {
    const removed = this.users.delete(UserDirectory.keyOf(username));
    if (removed) this.schedulePersist();
    return removed;
  }

  clearStrikes(username: string): void {
    const entry = this.users.get(UserDirectory.keyOf(username));
    if (!entry) return;
    entry.strikes = 0;
    entry.evidence = [];
    this.schedulePersist();
  }

  /**
   * Prefix-and-substring search over handles and display names, ranked so
   * exact and prefix matches surface before mid-string ones, then by recency.
   */
  search(query: string, limit = 12): KnownUser[] {
    const needle = normalize(query);
    const all = [...this.users.values()];

    if (!needle) {
      return all.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
    }

    const scored: Array<{ user: KnownUser; score: number }> = [];
    for (const user of all) {
      const handle = user.username;
      const display = user.displayName.toLowerCase();

      let score = -1;
      if (handle === needle) score = 100;
      else if (handle.startsWith(needle)) score = 80;
      else if (display.startsWith(needle)) score = 70;
      else if (handle.includes(needle)) score = 50;
      else if (display.includes(needle)) score = 40;

      if (score >= 0) scored.push({ user, score });
    }

    return scored
      .sort((a, b) => b.score - a.score || b.user.lastSeen - a.user.lastSeen)
      .slice(0, limit)
      .map((entry) => entry.user);
  }

  size(): number {
    return this.users.size;
  }

  /* ------------------------------------------------------------------ *
   * Archive
   *
   * Everything below reads the same Map the rest of the class maintains;
   * none of it stores anything new. Trusted/penalized/voice status lives in
   * the config rather than here, so it arrives as context — that keeps the
   * directory from having to know what a config is.
   * ------------------------------------------------------------------ */

  private toEntry(user: KnownUser, ctx: ArchiveContext): ArchiveEntry {
    const key = viewerKey(user.platform, user.username);
    return {
      platform: user.platform,
      key,
      username: user.username,
      displayName: user.displayName,
      // Same reasoning as the people picker: TikTok's avatar URLs expire in
      // ~48h, so the cached copy is the only one worth handing out.
      avatarUrl: ctx.avatarPath(user.username) ?? user.avatarUrl,
      userId: user.userId,
      firstSeen: user.firstSeen,
      lastSeen: user.lastSeen,
      daysSeen: user.daysSeen ?? 1,
      messages: user.messages,
      strikes: user.strikes,
      diamonds: user.diamonds ?? 0,
      gifts: user.gifts ?? 0,
      likes: user.likes ?? 0,
      follows: user.follows ?? 0,
      shares: user.shares ?? 0,
      pinned: Boolean(user.pinned),
      // These sets are keyed `platform:handle`; looking up a bare username
      // here would silently never match and every badge would vanish.
      trusted: ctx.trusted.has(key),
      penalized: ctx.penalized.has(key),
      hasVoice: ctx.voiced.has(key),
    };
  }

  private matches(entry: ArchiveEntry, filter: ArchiveFilter): boolean {
    switch (filter) {
      case 'chatters':
        return entry.messages > 0;
      case 'lurkers':
        return entry.messages === 0;
      case 'regulars':
        return entry.daysSeen > 1;
      case 'gifters':
        return entry.gifts > 0 || entry.diamonds > 0;
      case 'trusted':
        return entry.trusted;
      case 'penalized':
        return entry.penalized;
      case 'flagged':
        return entry.strikes > 0;
      default:
        return true;
    }
  }

  /** One page of the archive, filtered, searched and sorted. */
  archive(query: ArchiveQuery, ctx: ArchiveContext): ArchivePage {
    const filter = query.filter ?? 'all';
    const sort = query.sort ?? 'lastSeen';
    const desc = query.desc ?? true;
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const needle = normalize(query.q ?? '');

    const rows: ArchiveEntry[] = [];
    for (const user of this.users.values()) {
      if (query.platform && user.platform !== query.platform) continue;
      if (
        needle &&
        !user.username.includes(needle) &&
        !user.displayName.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const entry = this.toEntry(user, ctx);
      if (this.matches(entry, filter)) rows.push(entry);
    }

    rows.sort((a, b) => {
      const cmp =
        sort === 'username'
          ? a.username.localeCompare(b.username)
          : // Ties on a zero-heavy column (strikes, diamonds) would otherwise
            // come out in Map insertion order, which looks random on screen.
            (a[sort] as number) - (b[sort] as number) || a.lastSeen - b.lastSeen;
      return desc ? -cmp : cmp;
    });

    return { entries: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
  }

  /** How close the archive is to discarding people. */
  capacity(): ArchiveCapacity {
    const all = [...this.users.values()];
    const size = all.length;
    if (size === 0) return { size, max: MAX_USERS, perDay: 0, daysUntilFull: null };

    const days = new Set(all.map((user) => localDay(user.firstSeen)));
    const perDay = size / Math.max(1, days.size);
    const remaining = MAX_USERS - size;
    return {
      size,
      max: MAX_USERS,
      perDay: Math.round(perDay),
      daysUntilFull: perDay > 0 && remaining > 0 ? Math.round(remaining / perDay) : null,
    };
  }

  /**
   * The same aggregates as `analytics`, narrowed to one service.
   *
   * Computed by filtering rather than by a second pass over the map: three
   * filters over 25,000 rows is well under a millisecond, and one definition
   * of "chatter" is worth more than the saved iterations.
   */
  private static breakdown(
    platform: Platform,
    entries: ArchiveEntry[],
    ctx: ArchiveContext,
  ): PlatformBreakdown {
    const newPerDay = new Map<string, number>();
    let messages = 0;
    let diamonds = 0;
    let strikes = 0;
    let firstRecordAt: number | null = null;
    let lastRecordAt: number | null = null;

    for (const entry of entries) {
      messages += entry.messages;
      diamonds += entry.diamonds;
      strikes += entry.strikes;
      const day = localDay(entry.firstSeen);
      newPerDay.set(day, (newPerDay.get(day) ?? 0) + 1);
      if (firstRecordAt === null || entry.firstSeen < firstRecordAt) firstRecordAt = entry.firstSeen;
      if (lastRecordAt === null || entry.lastSeen > lastRecordAt) lastRecordAt = entry.lastSeen;
    }

    const chatters = entries.filter((entry) => entry.messages > 0).length;
    const top = (pick: (entry: ArchiveEntry) => number, count: number): ArchiveEntry[] =>
      entries
        .filter((entry) => pick(entry) > 0)
        .sort((a, b) => pick(b) - pick(a))
        .slice(0, count);

    return {
      platform,
      viewers: entries.length,
      chatters,
      lurkers: entries.length - chatters,
      regulars: entries.filter((entry) => entry.daysSeen > 1).length,
      messages,
      diamonds,
      strikes,
      flagged: entries.filter((entry) => entry.strikes > 0).length,
      trusted: entries.filter((entry) => entry.trusted).length,
      penalized: entries.filter((entry) => entry.penalized).length,
      messagesPerChatter: chatters === 0 ? 0 : Math.round((messages / chatters) * 10) / 10,
      firstRecordAt,
      lastRecordAt,
      newPerDay: [...newPerDay.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day))
        .slice(-14),
      retention: ctx.retention?.(platform) ?? emptyCurve(),
      topChatters: top((entry) => entry.messages, 10),
      topGifters: top((entry) => entry.diamonds, 10),
      mostFlagged: top((entry) => entry.strikes, 5),
    };
  }

  /** Aggregates across the whole archive. */
  analytics(ctx: ArchiveContext): ArchiveAnalytics {
    const entries = [...this.users.values()].map((user) => this.toEntry(user, ctx));

    const newPerDay = new Map<string, number>();
    const arrivalsByHour = new Array<number>(24).fill(0);
    let totalMessages = 0;
    let totalDiamonds = 0;
    let totalStrikes = 0;
    let firstRecordAt: number | null = null;
    let lastRecordAt: number | null = null;

    for (const entry of entries) {
      totalMessages += entry.messages;
      totalDiamonds += entry.diamonds;
      totalStrikes += entry.strikes;

      const day = localDay(entry.firstSeen);
      newPerDay.set(day, (newPerDay.get(day) ?? 0) + 1);
      const hour = new Date(entry.firstSeen).getHours();
      arrivalsByHour[hour] = (arrivalsByHour[hour] ?? 0) + 1;

      if (firstRecordAt === null || entry.firstSeen < firstRecordAt) firstRecordAt = entry.firstSeen;
      if (lastRecordAt === null || entry.lastSeen > lastRecordAt) lastRecordAt = entry.lastSeen;
    }

    const chatters = entries.filter((e) => e.messages > 0).length;
    const top = (
      pick: (entry: ArchiveEntry) => number,
      count = 10,
    ): ArchiveEntry[] =>
      entries
        .filter((entry) => pick(entry) > 0)
        .sort((a, b) => pick(b) - pick(a))
        .slice(0, count);

    return {
      totalViewers: entries.length,
      chatters,
      lurkers: entries.length - chatters,
      regulars: entries.filter((e) => e.daysSeen > 1).length,
      totalMessages,
      totalDiamonds,
      totalStrikes,
      trusted: entries.filter((e) => e.trusted).length,
      penalized: entries.filter((e) => e.penalized).length,
      flagged: entries.filter((e) => e.strikes > 0).length,
      withVoice: entries.filter((e) => e.hasVoice).length,
      firstRecordAt,
      lastRecordAt,
      // Averaged over people who spoke, not over everyone: including thousands
      // of silent lurkers would drag this to ~2 and say nothing useful.
      messagesPerChatter: chatters === 0 ? 0 : Math.round((totalMessages / chatters) * 10) / 10,
      newPerDay: [...newPerDay.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      arrivalsByHour,
      platforms: PLATFORMS.map((platform) =>
        UserDirectory.breakdown(
          platform,
          entries.filter((entry) => entry.platform === platform),
          ctx,
        ),
      ),
      retention: PLATFORMS.reduce<RetentionCurve>((total, platform) => {
        const curve = ctx.retention?.(platform) ?? emptyCurve();
        total.visits += curve.visits;
        total.open += curve.open;
        total.totalMs += curve.totalMs;
        total.longestMs = Math.max(total.longestMs, curve.longestMs);
        curve.reached.forEach((count, index) => {
          total.reached[index] = (total.reached[index] ?? 0) + count;
        });
        return total;
      }, emptyCurve()),
      topChatters: top((e) => e.messages),
      topGifters: top((e) => e.diamonds),
      mostFlagged: top((e) => e.strikes, 5),
      capacity: this.capacity(),
    };
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.persist();
  }
}

/**
 * Reads a JSON file, tolerating a UTF-8 byte-order mark.
 *
 * `JSON.parse` rejects a leading BOM, and anything that writes this file from
 * Windows — Notepad, PowerShell's `Set-Content -Encoding utf8` — adds one. The
 * failure mode is silent and expensive: the directory loads empty and the next
 * save overwrites the real data with nothing.
 */
function readJsonText(file: string): string {
  const text = fs.readFileSync(file, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * `YYYY-MM-DD` in local time.
 *
 * Deliberately not UTC. A stream that runs past midnight UTC is still one
 * evening to the person running it, and a "new viewers today" number that
 * rolls over mid-stream is worse than useless.
 */
export function localDay(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function normalize(username: string): string {
  return username.trim().toLowerCase().replace(/^@/, '');
}

/**
 * Whether a display name would actually show up on screen.
 *
 * Some people set a nickname made entirely of blanks — braille blank (U+2800)
 * is the popular one, and `.trim()` does not touch it because it is not
 * whitespace. Taking such a name would leave an overlay rendering an empty
 * space where a name should be, which looks like a bug in the overlay. Falling
 * back to the handle is the honest thing to show.
 */
export function hasVisibleText(value: string | undefined | null): boolean {
  if (!value) return false;
  return (
    value
      // Blanks that are not whitespace: braille blank, Hangul filler, and the
      // zero-width / invisible formatting characters.
      .replace(/[⠀ㅤᅟᅠ​-‏⁠﻿᠎]/g, '')
      .trim().length > 0
  );
}
