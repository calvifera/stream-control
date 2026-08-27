/**
 * Curated starter blocklists.
 *
 * These exist so a new install isn't moderated by an empty word list. They are
 * offered as packs rather than baked into the defaults: what counts as
 * unacceptable in your room is your call, and a list you can't see the contents
 * of is a list you can't trust.
 *
 * How the terms are written matters, because the filter compiles each entry
 * into a tolerant pattern (see `buildTermPattern` in the server):
 *
 * - `words` are anchored at both ends, so `fag` cannot fire inside `faggot`,
 *   and — more to the point — `spic` cannot fire inside `suspicious`.
 *   Multi-word entries stay anchored too, which is why `porch monkey` lives
 *   here rather than in `phrases`.
 * - `phrases` match anywhere, including inside a longer token. Reserved for
 *   stems whose inflections are unbounded (`nigger` → `niggers`,
 *   `sandnigger`) and which do not occur inside any ordinary English word.
 *
 * Leetspeak folding already covers `f4g`, `n1gg3r` and `f-a-g-g-o-t`, so
 * spelling variants are deliberately NOT enumerated here. Turning on
 * "collapse repeated letters" additionally covers `niiigger`.
 *
 * Deliberately absent: `queer`, `trap`, `twink`, `lame`, `autistic`. Each is
 * either reclaimed, ordinary vocabulary, or both, and blocking them silences
 * the people the rest of this list is meant to protect.
 */
export interface WordlistPack {
  id: string;
  label: string;
  description: string;
  /** Anchored entries — cannot fire inside a longer word. */
  words: string[];
  /** Unanchored stems — fire inside longer tokens too. */
  phrases: string[];
  /**
   * True when the pack's entries also occur in ordinary English. These are
   * offered separately and left off by default: with the action set to "skip",
   * a false positive silently drops a real viewer's message.
   */
  risky?: boolean;
}

export const WORDLIST_PACKS: WordlistPack[] = [
  {
    id: 'racial',
    label: 'Racial and ethnic slurs',
    description:
      'The main pack. A few entries (chink, coon, kraut) do have innocent English readings; they are included anyway because the slur reading is overwhelmingly the likely one in a live chat.',
    phrases: ['nigger', 'nigga', 'jigaboo', 'pickaninny', 'spearchucker'],
    words: [
      // anti-Black
      'coon',
      'coons',
      'sambo',
      'porch monkey',
      'jungle bunny',
      'tar baby',
      'cotton picker',
      'spear chucker',
      'groid',
      'negroid',
      'kaffir',
      'kaffer',
      // anti-East and Southeast Asian
      'chink',
      'chinks',
      'gook',
      'gooks',
      'ching chong',
      'slant eye',
      'slant eyes',
      'zipperhead',
      'jap',
      'japs',
      // anti-Hispanic
      'spic',
      'spics',
      'wetback',
      'wetbacks',
      'beaner',
      'beaners',
      // anti-South Asian, Arab and Muslim
      'paki',
      'pakis',
      'towelhead',
      'towel head',
      'raghead',
      'rag head',
      'camel jockey',
      'curry muncher',
      'dothead',
      'dot head',
      // anti-Indigenous
      'injun',
      'squaw',
      'wagon burner',
      'prairie nigger',
      // European
      'wop',
      'wops',
      'dago',
      'dagos',
      'polack',
      'kraut',
      'pikey',
      // anti-white, included for symmetry
      'honky',
      'honkey',
      'wigger',
      'wiggers',
      // general
      'half breed',
      'halfbreed',
      'coolie',
    ],
  },
  {
    id: 'antisemitic',
    label: 'Antisemitic slurs',
    description: 'Kept separate from the racial pack so it can be reviewed on its own.',
    phrases: ['kike'],
    words: ['heeb', 'hymie', 'jewboy', 'jew boy', 'christ killer', 'oven dodger', 'gas the jews'],
  },
  {
    id: 'homophobic',
    label: 'Homophobic slurs',
    description:
      '“queer” is deliberately not here — it is an ordinary self-description for a lot of people, and blocking it would filter your own viewers.',
    phrases: ['faggot'],
    words: [
      'fag',
      'fags',
      'fudgepacker',
      'fudge packer',
      'poof',
      'poofter',
      'batty boy',
      'battyman',
      'batty man',
      'carpet muncher',
      'rug muncher',
      'ass bandit',
      'arse bandit',
      'butt pirate',
      'pillow biter',
      'shirt lifter',
      'sodomite',
      'gaylord',
      'gayboy',
      'gay boy',
      'lesbo',
      'lezbo',
      'lezzo',
    ],
  },
  {
    id: 'transphobic',
    label: 'Transphobic slurs',
    description:
      '“trap” is deliberately not here: it is far more often a music genre or the meme than the slur, and it would fire constantly.',
    phrases: ['shemale', 'troon'],
    words: [
      'tranny',
      'trannie',
      'trannies',
      'she male',
      'he she',
      'heshe',
      'ladyboy',
      'lady boy',
      'dickgirl',
      'chick with a dick',
      'chicks with dicks',
    ],
  },
  {
    id: 'ableist',
    label: 'Ableist slurs',
    description:
      '“retard” is listed with its inflections rather than as a stem, so “flame retardant” and “retardation” stay clear.',
    phrases: ['mongoloid'],
    words: [
      'retard',
      'retards',
      'retarded',
      'tard',
      'tards',
      'spaz',
      'spazz',
      'spastic',
      'mong',
      'sperg',
      'spergs',
      'window licker',
      'midget',
      'midgets',
      'downie',
    ],
  },
  {
    id: 'ambiguous',
    label: 'Collides with ordinary words',
    description:
      'Real slurs whose spelling is also an everyday word, a given name, or a term the group itself uses. Add these only if you are actually being targeted with them — each one will occasionally drop an innocent message.',
    risky: true,
    phrases: [],
    words: [
      'cracker',
      'crackers',
      'homo',
      'dyke',
      'negro',
      'mick',
      'paddy',
      'guinea',
      'redskin',
      'redskins',
      'oriental',
      'gyp',
      'gypped',
      'gypsy',
      'cripple',
      'spade',
      'abo',
    ],
  },
];

/** Case- and whitespace-insensitive key for comparing list entries. */
const key = (term: string): string => term.trim().toLowerCase().replace(/\s+/g, ' ');

/** Adds `incoming` to `existing`, skipping anything already there. */
export function mergeTerms(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map(key));
  const added = incoming.filter((term) => !seen.has(key(term)));
  return [...existing, ...added];
}

/** Removes exactly the terms in `outgoing`, leaving your own entries alone. */
export function removeTerms(existing: string[], outgoing: string[]): string[] {
  const drop = new Set(outgoing.map(key));
  return existing.filter((term) => !drop.has(key(term)));
}

/** How many of a pack's terms are not yet in the list. 0 means fully applied. */
export function countMissing(existing: string[], candidate: string[]): number {
  const seen = new Set(existing.map(key));
  return candidate.filter((term) => !seen.has(key(term))).length;
}

export function packSize(pack: WordlistPack): number {
  return pack.words.length + pack.phrases.length;
}
