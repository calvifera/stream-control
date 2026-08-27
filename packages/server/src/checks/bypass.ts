/**
 * Verifies the filter against evasion techniques seen in the wild.
 *   npm run check:bypass -w @streaming/server
 *
 * Every case here is something that actually reached a live stream, or the
 * generalisation of one. They are grouped by the trick rather than by the
 * term, because the term is never the point — the technique is.
 *
 * Runs against a synthetic config, not yours, so it keeps testing the code
 * rather than whatever the word lists happen to contain today.
 */
import { DEFAULT_FILTERS, type FilterConfig, type SevereTermsConfig } from '@streaming/shared';
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

const config: FilterConfig = {
  ...DEFAULT_FILTERS,
  blockedWords: ['retard'],
  blockedPhrases: ['nigger', 'faggot'],
  blockedRegex: [],
  allowedScripts: ['Latin', 'Hiragana', 'Katakana', 'Arabic', 'Greek'],
  blockDisallowedScripts: true,
  maxLength: 200,
};
const severe: SevereTermsConfig = { words: ['gebeta'], phrases: [], regex: [] };
const engine = new FilterEngine(config, severe);

const blocked = (text: string): boolean => engine.apply(text).text === null;
const tag = (s: string): string =>
  [...s].map((c) => String.fromCodePoint(c.charCodeAt(0) + 0xe0000)).join('');

console.log('invisible separators');
for (const [label, sep] of [
  ['zero-width space', '\u200B'],
  ['zero-width non-joiner', '\u200C'],
  ['zero-width joiner', '\u200D'],
  ['soft hyphen', '\u00AD'],
  ['word joiner', '\u2060'],
  ['combining grapheme joiner', '\u034F'],
  ['byte order mark', '\uFEFF'],
  ['variation selector', '\uFE0F'],
] as Array<[string, string]>) {
  check(label, blocked('nigger'.split('').join(sep)));
}

console.log('\nlookalike and decorative alphabets');
for (const [label, text] of [
  ['fullwidth', '\uFF4E\uFF49\uFF47\uFF47\uFF45\uFF52'],
  ['math sans-serif', '\u{1D5FB}\u{1D5F6}\u{1D5F4}\u{1D5F4}\u{1D5F2}\u{1D5FF}'],
  ['math script', '\u{1D4F7}\u{1D4F2}\u{1D4F0}\u{1D4F0}\u{1D4EE}\u{1D4FB}'],
  ['circled letters', '\u24DD\u24D8\u24D6\u24D6\u24D4\u24E1'],
  ['zalgo combining marks', 'n\u0337i\u0337g\u0337g\u0337e\u0337r'],
  ['fullwidth, other term', '\uFF46\uFF41\uFF47\uFF47\uFF4F\uFF54'],
] as Array<[string, string]>) {
  check(label, blocked(text));
}

console.log('\nhidden and reordered text');
check('right-to-left override', blocked('\u202Ereggin\u202C'));
check('tag characters alone', blocked(tag('nigger')));
check('tag characters after visible text', blocked('hi ' + tag('faggot')));

console.log('\nunknown scripts (the gate must fail closed)');
check('tifinagh', blocked('\u2D4F\u2D49\u2D33\u2D54'), 'a script the detector has no name for');
check('coptic', blocked('\u2C81\u2C93\u2C99'));
check('runic', blocked('\u16A0\u16A2\u16A6'));
check('canadian syllabics', blocked('\u1401\u1403\u1405'));

console.log('\nexpansion bombs');
const bomb = 'x '.repeat(4) + '\u3315\u3316\u3316'.repeat(30);
const bombResult = engine.apply(bomb);
check(
  'squared katakana is expanded before the length cap',
  (bombResult.text?.length ?? 0) <= config.maxLength + 1,
  `${bomb.length} raw -> ${bomb.normalize('NFKC').length} NFKC -> ${bombResult.text?.length ?? 0} out`,
);
check('and the expansion is reported', /normalized|truncated/.test(bombResult.reason ?? ''));

console.log('\nseverity survives the script gate');
const ethiopic = engine.apply('\u1308\u1260\u1273');
check(
  'a severe term in a refused script still reads as severe',
  ethiopic.severity === 'severe',
  `got ${ethiopic.severity} — this is what earns a strike`,
);
check('and is marked as evasion', ethiopic.evasion);

console.log('\nordinary chat is untouched');
for (const [label, text] of [
  ['english', 'good stream tonight mate'],
  ['english with apostrophes', "that's a really nice wallpaper, where'd you get it"],
  ['japanese', '\u3053\u3093\u3070\u3093\u306F\u30B2\u30FC\u30E0\u3059\u3054\u3044'],
  ['arabic', '\u0645\u0631\u062D\u0628\u0627 \u0643\u064A\u0641 \u062D\u0627\u0644\u0643'],
  ['greek', '\u03BA\u03B1\u03BB\u03B7\u03BC\u03AD\u03C1\u03B1'],
  ['accented latin', 'c\u00E9dric said tr\u00E8s bien'],
  ['emoji-adjacent', 'lets go \u2764'],
  ['numbers and punctuation', 'gg 10/10 would watch again!!'],
] as Array<[string, string]>) {
  check(label, !blocked(text), engine.apply(text).reason ?? 'clean');
}

console.log('\nthroughput');
const normal = 'hey everyone how is the stream going tonight, loving the wallpapers';
engine.apply(normal);
const t0 = process.hrtime.bigint();
for (let i = 0; i < 500; i += 1) engine.apply(normal);
const perMsg = Number(process.hrtime.bigint() - t0) / 1e6 / 500;
check(
  'stays well under a millisecond per message',
  perMsg < 1,
  `${perMsg.toFixed(3)}ms -> ~${Math.round(1000 / perMsg)} msgs/sec`,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
