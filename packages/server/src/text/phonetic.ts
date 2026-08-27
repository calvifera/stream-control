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
 * How many edits a key of this length may absorb.
 *
 * Short keys have to be exact. Measured on ordinary chat, a four-character
 * key with one edit allowed matches roughly a third of normal messages —
 * "nice" lands on one slur's key, "did you" on another's.
 */
function editBudget(keyLength: number): number {
  if (keyLength <= 4) return 0;
  if (keyLength === 5) return 1;
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

  const targets = terms
    .map((term) => ({ term, key: phoneticKey(term) }))
    .filter((t) => t.key.length >= 3);
  if (targets.length === 0) return [];

  const found = new Map<string, NearMatch>();

  for (const { term, key } of targets) {
    const budget = editBudget(key.length);

    for (let i = 0; i < words.length; i += 1) {
      for (let span = 1; span <= MAX_SPAN && i + span <= words.length; span += 1) {
        const slice = words.slice(i, i + span);
        const candidate = phoneticKey(slice.join(''));
        // A length gap larger than the budget can't be closed by edits, and
        // skipping early keeps this cheap enough to run on every message.
        if (Math.abs(candidate.length - key.length) > budget) continue;

        const distance = editDistance(candidate, key);
        if (distance > budget) continue;

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
