/**
 * Phonetic near-match detection, for spotting sound-alike bypasses.
 *
 * The filter proper is a character-level matcher: it catches anything done to
 * the *letters* of a term (leetspeak, separators, homoglyphs, cross-script)
 * but nothing done to its *sound*. "deal dough", "pool sea", "gape horn" and
 * "pho q" share almost no letters with what they stand for.
 *
 * Catching those needs phonetics, and phonetics cannot be made safe to block
 * on. Measured against ordinary chat, "peace" and "pace" fold to exactly the
 * same key as one slur, and "no gear" folds to exactly the same key as
 * another. Those are not tuning artefacts — homophone attacks work *because*
 * real collisions exist, so any matcher sharp enough to catch them will also
 * catch innocent speech.
 *
 * So nothing here ever blocks. It reports, the host decides, and a decision
 * once made is remembered. See ReviewFeed.
 */

const VOWELS = /[aeiouy]/g;

/**
 * Folds English spelling toward how it sounds.
 *
 * All vowels collapse to one class, because the vowel is the easiest thing to
 * swap while keeping the sound recognisable ("dill"/"deal", "poo"/"pu").
 * Consonant structure is what survives.
 */
export function phoneticKey(input: string): string {
  let s = input.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';

  s = s
    .replace(/^kn/, 'n') // knife, and "knigr"
    .replace(/^wr/, 'r')
    .replace(/ough/g, 'o') // dough -> do
    .replace(/augh/g, 'a')
    .replace(/ph/g, 'f') // pho -> fo
    .replace(/gh/g, '')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'kw')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/c([eiy])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/h/g, ''); // weak enough to drop: "gape horn" -> "gape orn"

  s = s.replace(/(.)\1+/g, '$1'); // doubled letters
  s = s.replace(VOWELS, 'a');
  return s.replace(/(.)\1+/g, '$1'); // runs the vowel fold created
}

/** Standard Levenshtein, two rows. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

/**
 * How much of a key is actually information.
 *
 * `phoneticKey` collapses every vowel to `a`, so a key's length badly
 * overstates what it knows. "samala" looks like six characters of evidence
 * and is really three — s, m, l — with filler between them.
 */
function skeleton(key: string): string {
  return key.replace(/a/g, '');
}

function consonants(key: string): number {
  return skeleton(key).length;
}

/**
 * How many edits a key may absorb.
 *
 * Budgeted against consonants rather than length, because budgeting against
 * length was measurably broken: a six-character key got two edits, which for
 * "samala" meant two of its three real characters could change. "finally"
 * folds to "fanala", two edits away, and was reported as a slur. Measured
 * over ordinary stream chat, the length-based rule flagged 33 of 52 innocent
 * lines.
 *
 * Requiring an exact fold up to four consonants took that to 0 of 52 while
 * catching exactly the same real bypasses. Allowing even one edit at three
 * consonants puts it back to 22 of 52 — there is no gentle middle, because a
 * three-consonant key with one substitution is barely a constraint at all.
 */
function editBudget(key: string): number {
  const informative = consonants(key);
  if (informative <= 4) return 0;
  if (informative <= 6) return 1;
  return 2;
}

export interface NearMatch {
  /** The severe term this sounds like. */
  term: string;
  /** The words in the message that sounded like it. */
  phrase: string;
  /** 0 means it folds to exactly the same sound. */
  distance: number;
}

/** Longest span of words considered as one candidate. */
const MAX_SPAN = 4;

/**
 * Finds spans of the message that sound like one of `terms`.
 *
 * Candidate spans are aligned to word boundaries. Every bypass of this kind
 * is built out of whole words, so windows starting mid-word only ever produce
 * noise — aligning them cut the false-positive rate by a factor of five in
 * testing.
 */
export function findNearMatches(text: string, terms: string[]): NearMatch[] {
  const words = text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  if (words.length === 0) return [];

  /*
   * Terms whose fold carries fewer than three consonants are dropped, not
   * matched loosely.
   *
   * A key like "asa" or "kan" is one or two real sounds, and ordinary speech
   * produces those constantly — "you see" and "can" were both landing on
   * severe terms at distance 0. There is no threshold that separates them,
   * because there is nothing to separate: the key genuinely does not identify
   * a word.
   *
   * Those terms keep their character-level coverage, which is exact and
   * unaffected. What they lose is sound-alike detection, which for a term
   * this short was never functioning — it was reporting everything.
   */
  const targets = terms
    .map((term) => ({ term, key: phoneticKey(term) }))
    .filter((t) => consonants(t.key) >= 3);
  if (targets.length === 0) return [];

  const found = new Map<string, NearMatch>();

  for (const { term, key } of targets) {
    const budget = editBudget(key);

    for (let i = 0; i < words.length; i += 1) {
      for (let span = 1; span <= MAX_SPAN && i + span <= words.length; span += 1) {
        const slice = words.slice(i, i + span);
        const candidate = phoneticKey(slice.join(''));
        // A length gap larger than the budget can't be closed by edits, and
        // skipping early keeps this cheap enough to run on every message.
        if (Math.abs(candidate.length - key.length) > Math.max(budget, 1)) continue;

        /*
         * A dropped vowel is its own case, and the budget cannot express it.
         *
         * "nigr" and the real spelling share every consonant in order and
         * differ only by a missing vowel — a one-character edit on a key
         * whose budget is zero, so the distance rule rejects it. That is the
         * single most common way this kind of term gets typed, so it has to
         * survive.
         *
         * Identical skeletons plus near-identical length is what a dropped
         * vowel looks like and what nothing else does: "did you" and "dildo"
         * fold to different skeletons, "finally" and "she male" differ in two
         * consonants of three. Measured, the escape costs three innocent
         * lines in fifty-six and recovers both.
         */
        const sameSkeleton =
          consonants(candidate) >= 3 &&
          skeleton(candidate) === skeleton(key) &&
          Math.abs(candidate.length - key.length) <= 1;

        const distance = editDistance(candidate, key);
        if (!sameSkeleton && distance > budget) continue;

        const phrase = slice.join(' ');
        const existing = found.get(term);
        if (!existing || distance < existing.distance) {
          found.set(term, { term, phrase, distance });
        }
      }
    }
  }

  return [...found.values()].sort((a, b) => a.distance - b.distance);
}
