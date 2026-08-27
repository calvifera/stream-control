import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDirs } from '../env.js';
import { createLogger } from '../logger.js';
import { findNearMatches } from '../text/phonetic.js';

const log = createLogger('review');

const STORE_PATH = path.join(DATA_DIR, 'review.json');
const MAX_ENTRIES = 300;
const MAX_SAMPLES = 4;

export interface ReviewEntry {
  /** Lowercased words that sounded like a severe term — the grouping key. */
  phrase: string;
  /** Which severe term it sounded like. */
  term: string;
  /** 0 means it folds to exactly the same sound. */
  distance: number;
  /** How many times it has been seen. */
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** A few whole messages it appeared in, for context. */
  samples: Array<{ ts: number; username: string; text: string }>;
}

interface StoredReview {
  version: number;
  entries: ReviewEntry[];
  ignored: string[];
}

/**
 * Near-miss feed: things that sounded like a severe term but were not blocked.
 *
 * Entries are grouped by the offending phrase rather than by message. That is
 * what makes the feature usable — the raw flag rate on ordinary chat is around
 * one message in six, but they are overwhelmingly the *same* few phrases
 * ("peace", "pace", "no gear"). Grouped, that is a handful of one-time
 * decisions rather than a stream of noise, and an ignored phrase never comes
 * back.
 *
 * Nothing here ever blocks a message. It exists so the host can see what is
 * being attempted and promote a real bypass into the severe phrase list, where
 * the ordinary character-level matcher will then catch it exactly.
 */
export class ReviewFeed {
  private entries = new Map<string, ReviewEntry>();
  private ignored = new Set<string>();
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.load();
  }

  private load(): void {
    ensureDirs();
    if (!fs.existsSync(STORE_PATH)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as StoredReview;
      for (const entry of raw.entries ?? []) {
        if (entry?.phrase) this.entries.set(entry.phrase, entry);
      }
      for (const phrase of raw.ignored ?? []) this.ignored.add(phrase);
      log.info(`Loaded ${this.entries.size} near-miss entr(ies), ${this.ignored.size} ignored`);
    } catch (error) {
      log.warn(`Could not read ${STORE_PATH}: ${String(error)}`);
    }
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
      const entries = [...this.entries.values()]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, MAX_ENTRIES);
      const payload: StoredReview = { version: 1, entries, ignored: [...this.ignored] };
      const tmp = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
      fs.renameSync(tmp, STORE_PATH);
    } catch (error) {
      log.warn(`Could not write ${STORE_PATH}: ${String(error)}`);
    }
  }

  /**
   * Checks one message. Returns the near-matches recorded, if any.
   * Purely observational — the caller does not act on the return value.
   */
  observe(text: string, username: string, severeTerms: string[]): ReviewEntry[] {
    const matches = findNearMatches(text, severeTerms);
    if (matches.length === 0) return [];

    const now = Date.now();
    const recorded: ReviewEntry[] = [];

    for (const match of matches) {
      if (this.ignored.has(match.phrase)) continue;
      // An exact spelling of the term is not a near miss — the real filter
      // already handled it, and re-reporting it here would just be noise.
      if (match.phrase === match.term.toLowerCase()) continue;

      const existing = this.entries.get(match.phrase);
      const entry: ReviewEntry = existing ?? {
        phrase: match.phrase,
        term: match.term,
        distance: match.distance,
        count: 0,
        firstSeen: now,
        lastSeen: now,
        samples: [],
      };

      entry.count += 1;
      entry.lastSeen = now;
      entry.distance = Math.min(entry.distance, match.distance);
      entry.samples.unshift({ ts: now, username, text: text.slice(0, 200) });
      entry.samples = entry.samples.slice(0, MAX_SAMPLES);

      this.entries.set(match.phrase, entry);
      recorded.push(entry);
    }

    if (recorded.length > 0) this.schedulePersist();
    return recorded;
  }

  /** Newest first, so the dashboard shows what is being tried right now. */
  list(): ReviewEntry[] {
    return [...this.entries.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  ignoredPhrases(): string[] {
    return [...this.ignored].sort();
  }

  /** Never report this phrase again. */
  ignore(phrase: string): void {
    const key = phrase.trim().toLowerCase();
    if (!key) return;
    this.ignored.add(key);
    this.entries.delete(key);
    this.schedulePersist();
  }

  unignore(phrase: string): void {
    this.ignored.delete(phrase.trim().toLowerCase());
    this.schedulePersist();
  }

  /** Drops an entry without ignoring it, so it can resurface. */
  dismiss(phrase: string): void {
    this.entries.delete(phrase.trim().toLowerCase());
    this.schedulePersist();
  }

  clear(): void {
    this.entries.clear();
    this.schedulePersist();
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.persist();
  }
}
