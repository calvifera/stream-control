import fs from 'node:fs';
import path from 'node:path';
import {
  PLATFORMS,
  RETENTION_BUCKETS,
  emptyCurve,
  type Platform,
  type RetentionCurve,
} from '@streaming/shared';
import { DATA_DIR } from '../env.js';
import { createLogger } from '../logger.js';
import { localDay } from './directory.js';

const log = createLogger('retention');

const STORE_PATH = path.join(DATA_DIR, 'retention.json');

/**
 * How long a viewer can go without producing a single event before their visit
 * is treated as over.
 *
 * A judgement call, and the number that decides what "stayed" means. Too short
 * and one quiet stretch splits a two-hour watch into six visits, flattering
 * every bucket; too long and someone who left an hour ago is still counted as
 * present. Fifteen minutes is longer than any gap a viewer who is actually
 * watching TikTok tends to produce — likes alone fire far more often than
 * that — while being short enough that a closed tab shows up in the numbers
 * before the stream ends.
 */
const IDLE_MS = 15 * 60 * 1000;

/** How often to look for visits that have gone quiet. */
const SWEEP_MS = 60 * 1000;

/** Days of per-day history kept. Three months of streams is plenty of trend. */
const MAX_DAYS = 90;

const BUCKET_MS = RETENTION_BUCKETS.map((minutes) => minutes * 60 * 1000);

/**
 * A curve as it is stored on disk.
 *
 * Only *completed* visits are ever written here. Anything still open lives in
 * memory and is folded in when the numbers are read, which is what makes this
 * file safe across a restart: a crash mid-stream loses the visits that were in
 * flight rather than leaving them permanently open and dragging every
 * subsequent average toward infinity.
 */
interface StoredCurve {
  visits: number;
  reached: number[];
  totalMs: number;
  longestMs: number;
}

interface StoredRetention {
  version: number;
  platforms: Partial<Record<Platform, StoredCurve>>;
  /** `YYYY-MM-DD` → per-platform curve, attributed by the day a visit began. */
  days: Record<string, Partial<Record<Platform, StoredCurve>>>;
}

/** One viewer's current, still-running visit. */
interface OpenVisit {
  platform: Platform;
  startedAt: number;
  /** Timestamp of their most recent event; the visit's duration ends here. */
  lastAt: number;
  /** The day the visit began, so it lands in one bucket rather than two. */
  day: string;
}

function blankStored(): StoredCurve {
  return { visits: 0, reached: BUCKET_MS.map(() => 0), totalMs: 0, longestMs: 0 };
}

/** Which buckets a visit of this length has reached. */
function bucketsFor(durationMs: number): boolean[] {
  return BUCKET_MS.map((threshold) => durationMs >= threshold);
}

/**
 * How long viewers actually stay.
 *
 * Retention is measured in *visits*, not people: someone who shows up on six
 * nights contributes six visits, because "how long does a viewer stay" is a
 * question about a sitting, not about a lifetime.
 *
 * The hard limit on all of this is that a platform only tells you about
 * viewers who do something. A chat message, a like, a gift and a join are all
 * visible; sitting silently is not, on any of the three services. So this
 * measures retention among viewers who interact at least once, and the
 * dashboard says so rather than implying it counts the room.
 */
export class RetentionTracker {
  private store: StoredRetention = { version: 1, platforms: {}, days: {} };
  /** Keyed by `platform:handle`, matching the directory. */
  private open = new Map<string, OpenVisit>();
  private writeTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.load();
  }

  /** Starts the idle sweep. Separate from the constructor so checks can skip it. */
  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /**
   * Records that this viewer did something.
   *
   * Called for every event carrying a user, which is deliberately broad: a
   * like counts as being present just as much as a message does, and for the
   * quieter half of an audience it is the only signal there is.
   */
  observe(key: string, platform: Platform, at = Date.now()): void {
    const visit = this.open.get(key);
    if (!visit) {
      this.open.set(key, { platform, startedAt: at, lastAt: at, day: localDay(at) });
      return;
    }

    // A gap longer than the idle window means the previous sitting ended and
    // this is a new one — the sweep may not have run yet.
    if (at - visit.lastAt > IDLE_MS) {
      this.close(key, visit);
      this.open.set(key, { platform, startedAt: at, lastAt: at, day: localDay(at) });
      return;
    }

    visit.lastAt = at;
  }

  /** Closes anything that has gone quiet. */
  sweep(now = Date.now()): void {
    for (const [key, visit] of this.open) {
      if (now - visit.lastAt > IDLE_MS) this.close(key, visit);
    }
  }

  /**
   * Ends every open visit on one platform.
   *
   * Called when a connection drops: the viewers did not necessarily leave, but
   * we stopped being able to see them, and counting an unobservable stretch as
   * watch time would be inventing data.
   */
  closePlatform(platform: Platform): void {
    for (const [key, visit] of this.open) {
      if (visit.platform === platform) this.close(key, visit);
    }
  }

  private close(key: string, visit: OpenVisit): void {
    this.open.delete(key);
    const duration = visit.lastAt - visit.startedAt;

    this.commit(this.platformCurve(visit.platform), duration);
    this.commit(this.dayCurve(visit.day, visit.platform), duration);
    this.trimDays();
    this.schedulePersist();
  }

  private commit(curve: StoredCurve, durationMs: number): void {
    curve.visits += 1;
    curve.totalMs += durationMs;
    if (durationMs > curve.longestMs) curve.longestMs = durationMs;
    bucketsFor(durationMs).forEach((reached, index) => {
      if (reached) curve.reached[index] = (curve.reached[index] ?? 0) + 1;
    });
  }

  private platformCurve(platform: Platform): StoredCurve {
    const existing = this.store.platforms[platform];
    if (existing) return existing;
    const fresh = blankStored();
    this.store.platforms[platform] = fresh;
    return fresh;
  }

  private dayCurve(day: string, platform: Platform): StoredCurve {
    const bucket = (this.store.days[day] ??= {});
    const existing = bucket[platform];
    if (existing) return existing;
    const fresh = blankStored();
    bucket[platform] = fresh;
    return fresh;
  }

  private trimDays(): void {
    const days = Object.keys(this.store.days);
    if (days.length <= MAX_DAYS) return;
    for (const day of days.sort().slice(0, days.length - MAX_DAYS)) {
      delete this.store.days[day];
    }
  }

  /* ------------------------------------------------------------------ *
   * Reading
   * ------------------------------------------------------------------ */

  /** The lifetime curve for one platform, including visits still in progress. */
  curve(platform: Platform): RetentionCurve {
    const result = fromStored(this.store.platforms[platform]);
    for (const visit of this.open.values()) {
      if (visit.platform === platform) foldOpen(result, visit);
    }
    return result;
  }

  /** Every platform's curve summed. */
  overall(): RetentionCurve {
    const result = emptyCurve();
    for (const platform of PLATFORMS) merge(result, this.curve(platform));
    return result;
  }

  /** How many visits are open right now, across everything. */
  liveVisits(): number {
    return this.open.size;
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */

  private load(): void {
    if (!fs.existsSync(STORE_PATH)) return;
    try {
      const text = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(
        text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
      ) as StoredRetention;
      if (!parsed || typeof parsed !== 'object') return;

      this.store = {
        version: 1,
        platforms: parsed.platforms ?? {},
        days: parsed.days ?? {},
      };
      // A bucket list written by an older build with a different set of
      // thresholds would silently misalign every rate, so pad or trim it to
      // the current shape rather than trusting the length.
      for (const curve of this.allStored()) {
        curve.reached = BUCKET_MS.map((_, index) => curve.reached?.[index] ?? 0);
      }
    } catch (error) {
      log.warn(`Could not read ${STORE_PATH}: ${String(error)}`);
    }
  }

  private *allStored(): Generator<StoredCurve> {
    for (const curve of Object.values(this.store.platforms)) if (curve) yield curve;
    for (const day of Object.values(this.store.days)) {
      for (const curve of Object.values(day)) if (curve) yield curve;
    }
  }

  private schedulePersist(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persist();
    }, 5000);
    this.writeTimer.unref?.();
  }

  /**
   * Writes what has been committed, without touching visits still in progress.
   *
   * Public because it is the durability contract worth stating out loud: the
   * file only ever holds completed visits, so whatever happens to the process,
   * what comes back is a smaller true record rather than a larger false one.
   */
  save(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.persist();
  }

  private persist(): void {
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.store), 'utf8');
    } catch (error) {
      log.warn(`Could not write ${STORE_PATH}: ${String(error)}`);
    }
  }

  /** Closes everything and writes immediately. For an orderly shutdown. */
  flush(): void {
    for (const [key, visit] of this.open) this.close(key, visit);
    this.save();
  }
}

function fromStored(stored: StoredCurve | undefined): RetentionCurve {
  const curve = emptyCurve();
  if (!stored) return curve;
  curve.visits = stored.visits;
  curve.reached = BUCKET_MS.map((_, index) => stored.reached?.[index] ?? 0);
  curve.totalMs = stored.totalMs;
  curve.longestMs = stored.longestMs;
  return curve;
}

/** Adds a visit that has not finished yet, using the time it has run so far. */
function foldOpen(curve: RetentionCurve, visit: OpenVisit): void {
  // Measured to the viewer's last event rather than to now: someone who went
  // quiet ten minutes ago has not been watching for those ten minutes, and
  // counting them would inflate every bucket for as long as the stream runs.
  const duration = visit.lastAt - visit.startedAt;
  curve.visits += 1;
  curve.open += 1;
  curve.totalMs += duration;
  if (duration > curve.longestMs) curve.longestMs = duration;
  bucketsFor(duration).forEach((reached, index) => {
    if (reached) curve.reached[index] = (curve.reached[index] ?? 0) + 1;
  });
}

function merge(into: RetentionCurve, from: RetentionCurve): void {
  into.visits += from.visits;
  into.open += from.open;
  into.totalMs += from.totalMs;
  if (from.longestMs > into.longestMs) into.longestMs = from.longestMs;
  from.reached.forEach((count, index) => {
    into.reached[index] = (into.reached[index] ?? 0) + count;
  });
}
