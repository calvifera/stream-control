import { createLogger } from '../logger.js';
import { fetchProfile } from '../tiktok/profile.js';
import type { AvatarStore } from './avatars.js';
import type { UserDirectory } from './directory.js';

const log = createLogger('avatars');

/** Gap between profile lookups. Deliberately unhurried — this is scraping. */
const REQUEST_GAP_MS = 2000;
/** Most lookups in one pass, so a big directory can't turn into a crawl. */
const BATCH_LIMIT = 25;
/** Re-check a known profile at most this often. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** Wait this long before retrying a handle that failed. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

export interface PollResult {
  checked: number;
  updated: number;
  failed: number;
  skipped: number;
}

/**
 * Fills in profile pictures for people the directory knows about.
 *
 * Chat frames carry an avatar, so anyone who talks gets one for free — but
 * people added by hand never have, and their rows show a blank circle. This
 * fetches those, and refreshes stale ones.
 *
 * Everything here is best-effort and rate limited. A failure means "could not
 * check", never "no such user", so a handle is retried later rather than
 * marked bad.
 */
export class AvatarPoller {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private lastRun = 0;

  constructor(
    private readonly directory: UserDirectory,
    private readonly avatars: AvatarStore,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  getLastRun(): number {
    return this.lastRun;
  }

  /** Runs a pass in the background on an interval. */
  start(intervalMs: number, priority: () => string[]): void {
    this.stop();
    // A first pass shortly after boot, so a fresh install fills in quickly.
    this.timer = setInterval(() => void this.run(priority()), intervalMs);
    setTimeout(() => void this.run(priority()), 15_000).unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass. `priorityHandles` (trusted, muted, anyone with a voice profile)
   * are considered first — they are the ones actually shown in the dashboard
   * and in overlays.
   */
  async run(priorityHandles: string[] = [], force = false): Promise<PollResult> {
    if (this.running) return { checked: 0, updated: 0, failed: 0, skipped: 0 };
    this.running = true;

    const result: PollResult = { checked: 0, updated: 0, failed: 0, skipped: 0 };
    const now = Date.now();

    try {
      const candidates = this.pick(priorityHandles, now, force);
      if (candidates.length === 0) return result;

      log.info(`Checking ${candidates.length} profile picture(s)`);

      for (const username of candidates) {
        if (result.checked > 0) await sleep(REQUEST_GAP_MS);
        result.checked += 1;

        const profile = await fetchProfile(username);
        if (!profile) {
          this.directory.markAvatarChecked(username, false);
          result.failed += 1;
          continue;
        }

        // The nickname is worth taking even when the picture fails: a
        // hand-added handle otherwise has no display name at all.
        this.directory.applyProfile(username, {
          nickname: profile.nickname,
          userId: profile.userId,
        });

        if (!profile.avatarUrl) {
          this.directory.markAvatarChecked(username, true);
          result.skipped += 1;
          continue;
        }

        const stored = await this.avatars.store(username, profile.avatarUrl);
        if (stored) {
          this.directory.applyProfile(username, { avatarUrl: stored });
          this.directory.markAvatarChecked(username, true);
          result.updated += 1;
        } else {
          this.directory.markAvatarChecked(username, false);
          result.failed += 1;
        }
      }

      this.lastRun = Date.now();
      log.info(
        `Profile pass done — ${result.updated} updated, ${result.failed} failed, ${result.skipped} without a picture`,
      );
      this.directory.flush();
      return result;
    } finally {
      this.running = false;
    }
  }

  /** Who is worth checking this pass, most useful first. */
  private pick(priorityHandles: string[], now: number, force: boolean): string[] {
    const wanted: string[] = [];
    const seen = new Set<string>();

    const consider = (username: string): void => {
      if (!username || seen.has(username)) return;
      seen.add(username);

      const entry = this.directory.get(username);
      if (!entry) return;

      if (!force) {
        const checked = entry.avatarCheckedAt ?? 0;
        const cached = this.avatars.has(username);
        // Back off differently depending on whether we have anything at all.
        const wait = cached ? REFRESH_AFTER_MS : RETRY_AFTER_MS;
        if (checked && now - checked < wait) return;
      }

      wanted.push(username);
    };

    for (const handle of priorityHandles) consider(handle);

    // Then anyone else the directory knows, most recently active first.
    for (const entry of this.directory.recent(200)) consider(entry.username);

    return wanted.slice(0, BATCH_LIMIT);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
