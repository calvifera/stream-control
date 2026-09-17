import type { TrustBand, TrustConfig, TrustFactor, TrustScore } from '@streaming/shared';
import { editDistance, phoneticKey } from '../text/phonetic.js';
import { findMixedScriptWords, stripInvisible } from '../text/unicode.js';
import type { KnownUser } from './directory.js';

/**
 * Viewer trust scoring.
 *
 * Adds up what is known about a viewer into a 0 to 100 score. Lifetime facts
 * come from the directory, and behaviour this stream comes from the memory
 * kept here, which resets with the session.
 *
 * Nothing in this module blocks a message. It reports a score and the
 * suspicious signals in one message, and the hub decides what to do with
 * them.
 */

/** What the tracker needs to know about the speaker right now. */
export interface TrustSubject {
  key: string;
  /** Lifetime record, or undefined for someone never seen before. */
  known: KnownUser | undefined;
  onTrustedList: boolean;
  isHost: boolean;
  isModerator: boolean;
  isSubscriber: boolean;
  isFollower: boolean;
  isVerified: boolean;
  fansClubLevel: number;
}

/** One chat message, as the filter and near-match check saw it. */
export interface TrustObservation {
  text: string;
  /** True when the filter dropped the message. A censored message wasn't. */
  filtered: boolean;
  severity: 'none' | 'normal' | 'severe';
  /** True when the filter only matched after undoing a disguise. */
  evasion: boolean;
  /** True when the message sounds like a severe term. */
  nearMiss: boolean;
}

export interface TrustAssessment {
  /** The score after this message was counted. */
  score: TrustScore;
  /** Suspicious things about this message's spelling. Empty when clean. */
  signals: string[];
  /**
   * True when this message looks like another go at something the filter
   * blocked moments ago.
   */
  retry: boolean;
  /** True when the retry follows a severe-list block, which earns a strike. */
  severeRetry: boolean;
}

interface SessionMemory {
  firstSeen: number;
  messages: number;
  filtered: number;
  severe: number;
  evasions: number;
  oddMessages: number;
  nearMisses: number;
  retries: number;
  held: number;
  lastBlock: { ts: number; key: string; severe: boolean } | null;
}

/** Sessions over this many viewers drop the quietest ones first. */
const MAX_TRACKED = 20_000;

/**
 * Suspicious spellings, each with the label shown to the host.
 *
 * Every pattern here also matches some innocent text, which is why a signal
 * only matters for a strict-mode viewer and only ever holds back speech.
 */
const SIGNALS: Array<{ label: string; test: (text: string) => boolean }> = [
  {
    // "n i g g", "f . u . c . k": four or more lone letters in a row.
    label: 'spaced-out letters',
    test: (text) =>
      /(?<![\p{L}\p{N}])\p{L}(?:[\s._\-*·~]{1,3}\p{L}(?![\p{L}\p{N}])){3,}/u.test(text),
  },
  {
    // "f.u.c.k", "n-i-g": single letters joined by punctuation.
    label: 'letters split by symbols',
    test: (text) =>
      /(?<![\p{L}\p{N}])\p{L}(?:[.\-_*·~|/\\]\p{L}(?![\p{L}\p{N}])){2,}/u.test(text),
  },
  {
    // "n1gg", "f4g": a digit or symbol standing in for a letter mid-word.
    label: 'numbers or symbols in place of letters',
    test: (text) => /\p{L}[013457@$]+\p{L}/u.test(text),
  },
  {
    label: 'hidden characters',
    test: (text) => stripInvisible(text) !== text,
  },
  {
    // Fullwidth and "fancy font" letters that fold to plain ones.
    label: 'styled letters',
    test: (text) => {
      const letters = text.match(/\p{L}/gu) ?? [];
      return letters.some((letter) => letter.normalize('NFKC') !== letter);
    },
  },
  {
    label: 'mixed alphabets in one word',
    test: (text) => findMixedScriptWords(text).length > 0,
  },
];

export function textSignals(text: string): string[] {
  return SIGNALS.filter((signal) => signal.test(text)).map((signal) => signal.label);
}

/**
 * Whether two messages are close enough to be the same thing said twice.
 *
 * Compared by sound rather than by spelling, because a retry changes the
 * spelling and keeps the sound: "knee grow" after a blocked slur has almost
 * no letters in common with it.
 */
export function soundsSimilar(a: string, b: string): boolean {
  const left = phoneticKey(a);
  const right = phoneticKey(b);
  if (left.length < 3 || right.length < 3) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const longest = Math.max(left.length, right.length);
  return editDistance(left, right) / longest <= 0.4;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export class TrustTracker {
  private memory = new Map<string, SessionMemory>();

  /** Forgets this stream's behaviour. Lifetime facts are untouched. */
  reset(): void {
    this.memory.clear();
  }

  private memoryFor(key: string, now: number): SessionMemory {
    const existing = this.memory.get(key);
    if (existing) return existing;

    if (this.memory.size >= MAX_TRACKED) this.prune();
    const created: SessionMemory = {
      firstSeen: now,
      messages: 0,
      filtered: 0,
      severe: 0,
      evasions: 0,
      oddMessages: 0,
      nearMisses: 0,
      retries: 0,
      held: 0,
      lastBlock: null,
    };
    this.memory.set(key, created);
    return created;
  }

  /** Drops the viewers with nothing against them, oldest first. */
  private prune(): void {
    for (const [key, entry] of this.memory) {
      const clean = entry.filtered + entry.nearMisses + entry.oddMessages + entry.retries === 0;
      if (clean) this.memory.delete(key);
      if (this.memory.size < MAX_TRACKED * 0.8) return;
    }
  }

  /**
   * Counts one chat message and returns the viewer's score after it.
   *
   * `record: false` scores a message without remembering it, for test events
   * that should behave like real ones without leaving a mark.
   */
  observe(
    subject: TrustSubject,
    message: TrustObservation,
    config: TrustConfig,
    record = true,
  ): TrustAssessment {
    const now = Date.now();
    const spelling = textSignals(message.text);
    // The filter's own evasion finding is reported alongside, but counted on
    // its own line in the score so one message isn't charged twice.
    const signals = message.evasion ? [...spelling, 'disguised spelling'] : spelling;

    const previous = this.memory.get(subject.key);
    const block = previous?.lastBlock ?? null;
    const withinWindow = block !== null && now - block.ts <= config.retryWindowSeconds * 1000;
    const retry =
      withinWindow &&
      (message.filtered ||
        message.nearMiss ||
        spelling.length > 0 ||
        soundsSimilar(block.key, message.text));

    if (record) {
      const memory = this.memoryFor(subject.key, now);
      memory.messages += 1;
      if (message.filtered) memory.filtered += 1;
      if (message.severity === 'severe') memory.severe += 1;
      if (message.evasion) memory.evasions += 1;
      if (spelling.length > 0) memory.oddMessages += 1;
      if (message.nearMiss) memory.nearMisses += 1;
      if (retry) memory.retries += 1;
      // Only a dropped message counts as a block to retry. A censored one was
      // still delivered, so there is nothing to have another go at.
      if (message.filtered) {
        memory.lastBlock = { ts: now, key: message.text, severe: message.severity === 'severe' };
      }
    }

    return {
      score: this.score(subject, config, record ? undefined : message),
      signals,
      retry,
      severeRetry: retry && Boolean(block?.severe),
    };
  }

  /** Counts a message that trust held back from speech. */
  markHeld(key: string): void {
    const memory = this.memory.get(key);
    if (memory) memory.held += 1;
  }

  /** This stream's counts for one viewer, for the profile card. */
  sessionFor(key: string): { firstSeen: number | null; filtered: number; held: number } {
    const memory = this.memory.get(key);
    return {
      firstSeen: memory?.firstSeen ?? null,
      filtered: memory?.filtered ?? 0,
      held: memory?.held ?? 0,
    };
  }

  /**
   * The score, with every factor that moved it.
   *
   * Starts at 50, which is "nothing known either way". `pending` folds in a
   * message that was not recorded, so a test event still shows the score it
   * would have caused.
   */
  score(subject: TrustSubject, config: TrustConfig, pending?: TrustObservation): TrustScore {
    const factors: TrustFactor[] = [];
    const add = (label: string, delta: number): void => {
      if (delta !== 0) factors.push({ label, delta });
    };

    const vouched = subject.onTrustedList || subject.isHost || subject.isModerator;
    if (vouched) {
      add(
        subject.isHost ? 'Host' : subject.onTrustedList ? 'On your trusted list' : 'Moderator',
        50,
      );
      return { score: 100, band: 'trusted', strict: false, factors };
    }

    const known = subject.known;
    const days = known?.daysSeen ?? 0;
    const lifetimeMessages = known?.messages ?? 0;
    const isNew = days <= 1 && lifetimeMessages <= 3;

    if (isNew) add('New here', -20);
    else if (days >= 10) add(`Seen on ${days} days`, 30);
    else if (days >= 4) add(`Seen on ${days} days`, 20);
    else if (days >= 2) add(`Seen on ${days} days`, 10);

    if (lifetimeMessages >= 100) add(`${lifetimeMessages} messages sent`, 10);
    else if (lifetimeMessages >= 20) add(`${lifetimeMessages} messages sent`, 5);

    if (subject.isSubscriber) add('Subscriber', 15);
    if (subject.isVerified) add('Verified account', 10);
    if (subject.isFollower) add('Follows you', 5);
    if (subject.fansClubLevel > 0) add('Fan club member', 5);

    const diamonds = known?.diamonds ?? 0;
    if (diamonds >= 1000) add('Big gifter', 15);
    else if (diamonds > 0 || (known?.gifts ?? 0) > 0) add('Has gifted', 10);

    const strikes = known?.strikes ?? 0;
    if (strikes > 0) add(`${strikes} past strike${strikes === 1 ? '' : 's'}`, -Math.min(40, strikes * 20));

    const memory = this.memory.get(subject.key);
    const counts = {
      filtered: (memory?.filtered ?? 0) + (pending?.filtered ? 1 : 0),
      severe: (memory?.severe ?? 0) + (pending?.severity === 'severe' ? 1 : 0),
      evasions: (memory?.evasions ?? 0) + (pending?.evasion ? 1 : 0),
      odd: (memory?.oddMessages ?? 0) + (pending && textSignals(pending.text).length > 0 ? 1 : 0),
      nearMisses: (memory?.nearMisses ?? 0) + (pending?.nearMiss ? 1 : 0),
      retries: memory?.retries ?? 0,
    };

    const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
    // Severe hits are counted on their own line, so they come out of the
    // ordinary filtered count to avoid charging for the same message twice.
    const ordinary = counts.filtered - counts.severe;
    if (ordinary > 0) add(`${plural(ordinary, 'filtered message')} this stream`, -Math.min(15, ordinary * 5));
    if (counts.severe > 0) add(`${plural(counts.severe, 'severe-list hit')} this stream`, -Math.min(50, counts.severe * 25));
    if (counts.evasions > 0) add(`${plural(counts.evasions, 'disguised spelling')} this stream`, -Math.min(30, counts.evasions * 15));
    if (counts.retries > 0) {
      const retries = counts.retries === 1 ? '1 retry' : `${counts.retries} retries`;
      add(`${retries} after a block`, -Math.min(50, counts.retries * 25));
    }
    if (counts.nearMisses > 0) add(`${plural(counts.nearMisses, 'sound-alike')} of a severe term`, -Math.min(20, counts.nearMisses * 10));
    if (counts.odd > 0) add(`${plural(counts.odd, 'oddly spelled message')}`, -Math.min(15, counts.odd * 5));

    const total = clamp(Math.round(50 + factors.reduce((sum, f) => sum + f.delta, 0)), 0, 100);
    factors.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const strict = config.enabled && total < config.strictBelow;
    // "Low" means they did something. One oddly spelled message on its own
    // isn't enough to call a newcomer that, so it takes at least 10 points.
    const earned = factors
      .filter((f) => f.delta < 0 && f.label !== 'New here')
      .reduce((sum, f) => sum + f.delta, 0);
    const penalised = earned <= -10;
    let band: TrustBand;
    if (strict) band = penalised ? 'low' : 'new';
    else if (total >= 70) band = 'regular';
    else band = 'neutral';

    return { score: total, band, strict, factors };
  }
}
