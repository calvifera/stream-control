/**
 * Verifies sound-alike detection.
 *   npm run check:phonetic -w @streaming/server
 *
 * Two things matter here and they pull against each other: it has to catch
 * real homophone bypasses, and it must not bury the host in false positives.
 * Both are asserted, the second with a corpus of ordinary chat, because a
 * detector that flags everything is the same as no detector at all.
 */
import { findNearMatches, phoneticKey } from '../text/phonetic.js';
import { FilterEngine } from '../pipeline/filters.js';
import type { FilterConfig, SevereTermsConfig } from '@streaming/shared';

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

const SEVERE = ['dildo', 'nigger', 'nigga', 'faggot', 'pussy', 'gay porn', 'fuck you'];

const hits = (text: string): string[] => findNearMatches(text, SEVERE).map((m) => m.term);

console.log('phonetic folding');
check('silent k is dropped', phoneticKey('knigr') === phoneticKey('nigr'), phoneticKey('knigr'));
check('ough folds to o', phoneticKey('dough') === phoneticKey('doe'), phoneticKey('dough'));
check('ph folds to f', phoneticKey('pho') === phoneticKey('foe'), phoneticKey('pho'));
check('q folds to k', phoneticKey('q') === phoneticKey('k'));
check('doubles collapse', phoneticKey('nigger') === phoneticKey('niger'));
check('vowels collapse to one class', phoneticKey('dildo') === phoneticKey('dildu'));
check('empty input is safe', phoneticKey('!!!') === '');

console.log('\ncatches real bypasses');
for (const [text, expected] of [
  ['deal dough', 'dildo'],
  ['dill dough', 'dildo'],
  ['you are such a deal dough', 'dildo'],
  ['knigr', 'nigger'],
  ['nigr', 'nigger'],
  ['gape horn', 'gay porn'],
  ['fag it', 'faggot'],
] as Array<[string, string]>) {
  check(`"${text}" -> ${expected}`, hits(text).includes(expected), hits(text).join(',') || 'no match');
}

console.log('\nleaves ordinary chat alone');
const INNOCENT = [
  'hello everyone',
  'that was so funny',
  'where are you from',
  'i love dogs',
  'good luck today',
  'the food looks good',
  'happy birthday',
  'what game is this',
  'nice goal',
  'do a backflip',
  'i had a good day',
  'that dog is adorable',
  'wild goose chase',
  'sing a duet',
  'a good egg',
  'my niece is here',
  'i got a new gig',
  'see you tomorrow',
  'i play piano',
  'good game everyone',
  /*
   * Reported from a live stream. "finally" folds to "fanala" and the term to
   * "samala" — two edits apart on a six-character key that holds only three
   * real consonants, f-n-l against s-m-l. The old length-based budget allowed
   * two edits there, so it matched, and it was far from alone: 33 of 52
   * ordinary lines were being flagged.
   */
  'finally',
  'finally got it',
  'did you see that',
  'can you play the other one',
  'im so tired',
  'first time here',
  'love this song',
  'that was insane',
  'not again',
  'he made it',
  'she said that',
  'at a nice pace',
  'so peaceful',
  'pool party',
];

const flagged = INNOCENT.filter((text) => hits(text).length > 0);
// Tightened from 25%. A review feed that fires on a quarter of ordinary chat
// is one nobody reads, which costs the real matches buried in it.
check(
  'false positives stay rare enough to review',
  flagged.length <= INNOCENT.length * 0.1,
  `${flagged.length}/${INNOCENT.length} flagged${flagged.length ? `: ${flagged.join(', ')}` : ''}`,
);

console.log('\nthe review layer never blocks');
const config = {
  enabled: true,
  action: 'skip',
  censorReplacement: '***',
  normalizeLeetspeak: true,
  collapseRepeatedChars: true,
  matchTransliterations: true,
  blockMixedScriptWords: false,
  blockDisallowedScripts: false,
  reviewNearMatches: true,
  allowedScripts: ['Latin'],
  stripUrls: true,
  stripEmoji: false,
  maxLength: 300,
  applyToOverlay: true,
  blockedWords: [],
  blockedPhrases: [],
  blockedRegex: [],
  blockedUsers: [],
} as unknown as FilterConfig;

const severe: SevereTermsConfig = { words: ['dildo', 'nigger'], phrases: [], regex: [] };
const engine = new FilterEngine(config, severe);

const nearMiss = engine.apply('deal dough');
check('a sound-alike still passes the filter', nearMiss.text !== null, JSON.stringify(nearMiss.text));
check('and is not marked as evasion', !nearMiss.evasion);

console.log('\npromoting a phrase makes it enforced');
const promoted = new FilterEngine(config, {
  words: ['dildo', 'nigger'],
  phrases: ['deal dough'],
  regex: [],
});
const blocked = promoted.apply('you are such a deal dough');
check('the promoted phrase now blocks', blocked.text === null, blocked.reason ?? '');
check('and reports as severe', blocked.severity === 'severe', blocked.severity);

console.log('\nthe q-for-g gap is closed');
const gEngine = new FilterEngine(config, { words: ['nigger', 'faggot'], phrases: [], regex: [] });
check('niqqer is blocked', gEngine.apply('niqqer').text === null);
check('faqqot is blocked', gEngine.apply('faqqot').text === null);
check('n1qq3r is blocked', gEngine.apply('n1qq3r').text === null);
check('ordinary words with q are untouched', gEngine.apply('quick question queue').text !== null);

/*
 * Named individually as well as counted in the rate above.
 *
 * A rate can be satisfied while still failing the exact phrase somebody
 * complained about, and "finally" is the one that was actually reported from
 * a live stream.
 */
for (const text of ['finally', 'did you see that', 'can you play the other one']) {
  check(`"${text}" is not reported`, hits(text).length === 0, hits(text).join(', '));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
