/**
 * Verifies the curated starter word lists.
 *   npm run check:wordlist -w @streaming/server
 *
 * Two opposite failures matter here:
 *
 *   1. A term in a pack that the filter does not actually catch — a list entry
 *      that silently does nothing is worse than no entry, because you believe
 *      you are covered.
 *   2. A term that fires on ordinary chat. The action is `skip`, so a false
 *      positive drops a real viewer's message with no trace in the overlay.
 *
 * The second is asserted against a corpus of innocent sentences deliberately
 * built out of near-misses: "a chink of light", "the raccoon", "suspicious",
 * "flame retardant", "morning greetings", "it's a trap".
 */
import {
  DEFAULT_FILTERS,
  WORDLIST_PACKS,
  mergeTerms,
  packSize,
  removeTerms,
  type FilterConfig,
} from '@streaming/shared';
import { FilterEngine } from '../pipeline/filters.js';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const safePacks = WORDLIST_PACKS.filter((p) => !p.risky);
const riskyPacks = WORDLIST_PACKS.filter((p) => p.risky);

function engineFor(packs: typeof WORDLIST_PACKS): FilterEngine {
  let words: string[] = [];
  let phrases: string[] = [];
  for (const pack of packs) {
    words = mergeTerms(words, pack.words);
    phrases = mergeTerms(phrases, pack.phrases);
  }
  const config: FilterConfig = { ...DEFAULT_FILTERS, blockedWords: words, blockedPhrases: phrases };
  return new FilterEngine(config);
}

const blocked = (engine: FilterEngine, text: string): boolean => engine.apply(text).text === null;

/* ------------------------------------------------------------------ *
 * 1. Every listed term is actually caught
 * ------------------------------------------------------------------ */

const engine = engineFor(safePacks);
const misses: string[] = [];

for (const pack of safePacks) {
  for (const term of [...pack.words, ...pack.phrases]) {
    // In a sentence, not alone: that is how it will really arrive, and it
    // exercises the word anchors rather than matching the whole message.
    if (!blocked(engine, `you are a ${term} honestly`)) misses.push(`${pack.id}: ${term}`);
  }
}

console.log('every listed term is caught');
check(
  `all ${safePacks.reduce((n, p) => n + packSize(p), 0)} terms across ${safePacks.length} packs`,
  misses.length === 0,
  misses.length ? `missed ${misses.join(', ')}` : '',
);

/* ------------------------------------------------------------------ *
 * 2. Disguised spellings are caught by the existing folding
 * ------------------------------------------------------------------ */

console.log('\ndisguised spellings');
for (const text of [
  'n1gg3r',
  'f-a-g-g-o-t',
  'n i g g a',
  'r3t4rd',
  'f@g',
  'niqqa', // q-for-g, the substitution the leet table was extended for
  'ni99er', // 9-for-g
  'sandnigger', // stem fires inside a longer token
  'FAGGOTS', // and past the end of one
]) {
  check(`blocks "${text}"`, blocked(engine, text));
}

/* ------------------------------------------------------------------ *
 * 3. Ordinary chat survives
 * ------------------------------------------------------------------ */

const INNOCENT = [
  'a raccoon got into the bins again',
  'that sounds really suspicious to me',
  'this jacket is flame retardant',
  'good morning greetings from brazil',
  'lol it is a trap dont go in there',
  'i love this trap beat',
  'as a queer person i really appreciate this stream',
  'she is trans and she is killing it',
  'my classmate is from japan',
  'the japanese keyboard layout is confusing',
  'i went to guinea last year',
  'pass me the crackers please',
  'homogeneous mixtures are boring',
  'that was a homerun',
  'the dyke held back the flood water',
  'running gear for the marathon',
  'cleaning gear is in the cupboard',
  'i am learning spanish and negro means black',
  'niggle is a weird english word',
  'that is niggling at me',
  'we were spitballing ideas',
  'the spice must flow',
  'specification says otherwise',
  'she is a spicy cook',
  'assassin creed is underrated',
  'class was cancelled today',
  'i need to grab my badge',
  'mick jagger is a legend',
  'paddy went to the shop',
  'the mongolian throat singing video',
  'amongst friends here',
  'a bastard sword is two handed',
  'retardation of the reaction rate',
  'the fire spread fast',
  'my midterm is tomorrow',
  'oriental rugs are expensive',
  'let me nip out for a second',
];

console.log('\nordinary chat is untouched');
const falsePositives: string[] = [];
for (const text of INNOCENT) {
  const result = engine.apply(text);
  if (result.text === null) falsePositives.push(`"${text}" — ${result.reason ?? '?'}`);
}
check(
  `${INNOCENT.length} innocent sentences pass`,
  falsePositives.length === 0,
  falsePositives.length ? `\n      ${falsePositives.join('\n      ')}` : '',
);

/* ------------------------------------------------------------------ *
 * 4. Collisions we accept knowingly
 *
 * Not every term is clean, and pretending otherwise by leaving the awkward
 * sentence out of the corpus would just hide the cost. These are the readings
 * the main packs will misfire on. They stay in the main packs because the
 * idiom is rare in a live chat and the slur is not — but the cost is asserted
 * so it cannot quietly grow.
 * ------------------------------------------------------------------ */

console.log('\nknown collisions, accepted deliberately');
for (const [text, term] of [
  ['there was a chink of light under the door', 'chink'],
  ['a chink in the armour', 'chink'],
  ['the sauerkraut was excellent', 'kraut'], // only as a standalone word
] as const) {
  const hit = blocked(engine, text);
  check(
    `"${text}"`,
    term === 'kraut' ? !hit : hit,
    term === 'kraut' ? 'not affected — anchoring saves it' : `drops on "${term}" as documented`,
  );
}

/* ------------------------------------------------------------------ *
 * 5. The risky pack really is risky
 * ------------------------------------------------------------------ */

console.log('\nthe "collides with ordinary words" pack is correctly separated');
const riskyEngine = engineFor([...safePacks, ...riskyPacks]);
const collisions = INNOCENT.filter((text) => riskyEngine.apply(text).text === null);
check(
  'turning it on does drop innocent messages',
  collisions.length > 0,
  `${collisions.length} of ${INNOCENT.length}: ${collisions.map((c) => `"${c}"`).join(', ')}`,
);

/* ------------------------------------------------------------------ *
 * 6. Merging and removing are non-destructive
 * ------------------------------------------------------------------ */

console.log('\nadd and remove leave your own entries alone');
const mine = ['fiddlesticks', 'Coon'];
const pack = safePacks[0]!;
const merged = mergeTerms(mine, pack.words);
check('existing entries survive a merge', merged[0] === 'fiddlesticks' && merged[1] === 'Coon');
check(
  'a term already present is not duplicated',
  merged.filter((t) => t.toLowerCase() === 'coon').length === 1,
  `${merged.length} entries for a ${pack.words.length}-term pack over ${mine.length} existing`,
);
const pruned = removeTerms(merged, pack.words);
check(
  'removing the pack leaves unrelated entries alone',
  pruned.length === 1 && pruned[0] === 'fiddlesticks',
  // Note "Coon" is gone: removal is case-insensitive, so an entry you happened
  // to have written that the pack also contains goes with it. Acceptable —
  // the alternative is leaving a term behind that the UI then reports as
  // still-applied.
  JSON.stringify(pruned),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
