/**
 * Run with: npm run check:filters
 *
 * Deliberately uses innocuous stand-in words. The point is that a blocklist
 * entry written in plain latin still catches the same word typed in another
 * script, which is how the real bypass works.
 */
import assert from 'node:assert/strict';
import { DEFAULT_FILTERS, type Platform } from '@streaming/shared';
import { FilterEngine } from '../pipeline/filters.js';
import { detectScripts, findMixedScriptWords, foldHomoglyphs, transliterate } from '../text/unicode.js';

let passed = 0;
function check(label: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${label}`);
  } catch (error) {
    console.error(`FAIL  ${label}`);
    console.error(`      ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

console.log('transliteration');

check('ethiopic syllables romanize', () => {
  // ገበታ -> "gebeta"
  assert.equal(transliterate('ገበታ'), 'gebeta');
});

check('hangul syllables romanize', () => {
  // 바보 -> "babo"
  assert.equal(transliterate('바보'), 'babo');
});

check('standalone hangul jamo romanize', () => {
  assert.equal(transliterate('ㅂㅏㅂㅗ'), 'babo');
});

check('katakana romanizes', () => {
  assert.equal(transliterate('バカ'), 'baka');
});

check('cyrillic romanizes', () => {
  assert.equal(transliterate('дурак'), 'durak');
});

check('greek romanizes', () => {
  assert.equal(transliterate('κακο'), 'kako');
});

check('cyrillic homoglyphs fold to latin', () => {
  // "сorn" with a Cyrillic с
  assert.equal(foldHomoglyphs('сorn'), 'corn');
});

check('mathematical alphanumerics fold to latin', () => {
  assert.equal(foldHomoglyphs('𝐜𝐨𝐫𝐧'), 'corn');
});

check('fullwidth folds to latin', () => {
  assert.equal(foldHomoglyphs('ｃｏｒｎ'), 'corn');
});

check('script detection reports every script present', () => {
  const scripts = detectScripts('hello ገበታ 바보');
  assert.ok(scripts.includes('Latin'));
  assert.ok(scripts.includes('Ethiopic'));
  assert.ok(scripts.includes('Hangul'));
});

console.log('\nfilter engine');

const engine = new FilterEngine({
  ...DEFAULT_FILTERS,
  blockedWords: ['gebeta', 'babo', 'baka', 'durak', 'corn'],
  action: 'skip',
});

check('plain latin blocklist hit is dropped', () => {
  assert.equal(engine.apply('you are a babo').text, null);
});

check('ethiopic spelling of a blocked word is dropped', () => {
  assert.equal(engine.apply('ገበታ').text, null);
});

check('hangul spelling of a blocked word is dropped', () => {
  assert.equal(engine.apply('바보').text, null);
});

check('katakana spelling of a blocked word is dropped', () => {
  assert.equal(engine.apply('バカ').text, null);
});

check('cyrillic spelling of a blocked word is dropped', () => {
  assert.equal(engine.apply('дурак').text, null);
});

check('cyrillic homoglyph spelling is dropped', () => {
  assert.equal(engine.apply('сorn').text, null); // Cyrillic с
});

check('leetspeak and separators are still caught', () => {
  assert.equal(engine.apply('b-a-b-0').text, null);
  assert.equal(engine.apply('baaabo').text, null);
});

check('mixed script spelling is caught', () => {
  // "ba" in latin + "bo" in hangul
  assert.equal(engine.apply('ba보').text, null);
});

check('mixed Cherokee + Greek homoglyph spoof is caught', () => {
  // U+13E3 Ꮳ + U+039F Ο + U+13D2 Ꮢ + U+039D Ν, visually spelling "corn"
  assert.equal(engine.apply('ᏣΟᏒΝ').text, null);
});

check('lowercase Cherokee folds too', () => {
  assert.equal(foldHomoglyphs('ꮳΟꮢΝ'), 'corn');
});

check('a mixed-script word is reported as evasion', () => {
  const result = engine.apply('ᏣΟᏒΝ');
  assert.equal(result.evasion, true);
});

check('plain latin hits are not treated as evasion', () => {
  const result = engine.apply('babo');
  assert.equal(result.evasion, false);
});

check('mixed-script detection flags the spoofed word', () => {
  assert.deepEqual(findMixedScriptWords('hello ᏣΟᏒΝ world'), ['ᏣΟᏒΝ']);
});

check('latin mixed with Japanese is not flagged', () => {
  // Real viewers genuinely write like this; flagging it would punish them.
  assert.deepEqual(findMixedScriptWords('ゲームstream'), []);
});

check('severe-list hits are reported with severity', () => {
  const severe = new FilterEngine(
    { ...DEFAULT_FILTERS, blockedWords: [] },
    { words: ['gebeta'], phrases: [], regex: [] },
  );
  const plain = severe.apply('gebeta');
  assert.equal(plain.severity, 'severe');
  assert.equal(plain.evasion, false);

  const disguised = severe.apply('ገበታ');
  assert.equal(disguised.severity, 'severe');
  assert.equal(disguised.evasion, true);
});

check('blockMixedScriptWords drops the message when enabled', () => {
  const strict = new FilterEngine({
    ...DEFAULT_FILTERS,
    blockedWords: [],
    blockMixedScriptWords: true,
  });
  assert.equal(strict.apply('ᏣΟᏒΝ').text, null);
  assert.equal(strict.apply('normal message').text, 'normal message');
});

check('clean messages pass through untouched', () => {
  const result = engine.apply('good stream today');
  assert.equal(result.text, 'good stream today');
  assert.equal(result.filtered, false);
});

check('whole-word matching does not eat innocent words', () => {
  const narrow = new FilterEngine({ ...DEFAULT_FILTERS, blockedWords: ['ass'] });
  assert.equal(narrow.apply('what a classy stream').text, 'what a classy stream');
  assert.equal(narrow.apply('ass').text, null);
});

check('censor mode replaces in place for latin hits', () => {
  const censor = new FilterEngine({
    ...DEFAULT_FILTERS,
    blockedWords: ['corn'],
    action: 'censor',
    censorReplacement: '***',
  });
  assert.equal(censor.apply('i like corn a lot').text, 'i like *** a lot');
});

check('censor mode drops the message when the hit is only in a romanization', () => {
  const censor = new FilterEngine({
    ...DEFAULT_FILTERS,
    blockedWords: ['babo'],
    action: 'censor',
  });
  assert.equal(censor.apply('바보').text, null);
});

check('script gate refuses scripts outside the allowlist', () => {
  const gated = new FilterEngine({
    ...DEFAULT_FILTERS,
    blockedWords: [],
    allowedScripts: ['Latin'],
    blockDisallowedScripts: true,
  });
  assert.equal(gated.apply('hello').text, 'hello');
  assert.equal(gated.apply('ገበታ').text, null);
});

check('urls are stripped before speaking', () => {
  const result = engine.apply('check out https://spam.example/x now');
  assert.equal(result.text, 'check out now');
  assert.equal(result.filtered, true);
});

console.log('blocked users');

/*
 * A blocked event is dropped before the directory, the overlays, the stats and
 * TTS — the person leaves no trace at all. That makes both mistakes here
 * expensive and invisible: blocking a stranger who happens to share a handle
 * shows up as nothing, and failing to block someone shows up as nothing until
 * they say something.
 */
const blocklist = new FilterEngine({
  ...DEFAULT_FILTERS,
  blockedWords: [],
  blockedUsers: ['spambot123', 'tiktok:sharedname', '@Loud_Person'],
});

const speaker = (platform: Platform, uniqueId: string) => ({ platform, uniqueId });

check('a bare handle blocks on the platform it was seen on', () => {
  assert.equal(blocklist.isUserBlocked('tiktok', 'spambot123'), true);
});

check('and on every other platform too', () => {
  assert.equal(blocklist.isUserBlocked('twitch', 'spambot123'), true);
  assert.equal(blocklist.isUserBlocked('youtube', 'spambot123'), true);
});

check('a qualified entry blocks only that platform', () => {
  assert.equal(blocklist.isUserBlocked('tiktok', 'sharedname'), true);
  // The whole point: a different person who happens to hold the same handle
  // somewhere else must still get through.
  assert.equal(blocklist.isUserBlocked('twitch', 'sharedname'), false);
  assert.equal(blocklist.isUserBlocked('youtube', 'sharedname'), false);
});

check('an @ prefix and mixed case in the list still match', () => {
  assert.equal(blocklist.isUserBlocked('tiktok', 'loud_person'), true);
  assert.equal(blocklist.isUserBlocked('twitch', '@LOUD_PERSON'), true);
});

check('nobody else is caught', () => {
  assert.equal(blocklist.isUserBlocked('tiktok', 'someone_else'), false);
  assert.equal(blocklist.isUserBlocked('tiktok', ''), false);
});

check('a blocked speaker has their message dropped', () => {
  assert.equal(blocklist.apply('hello', speaker('twitch', 'spambot123')).text, null);
  assert.equal(
    blocklist.apply('hello', speaker('twitch', 'spambot123')).reason,
    'user is blocked',
  );
});

check('the same handle on an unblocked platform still speaks', () => {
  assert.equal(blocklist.apply('hello', speaker('twitch', 'sharedname')).text, 'hello');
});

check('text with no speaker skips the block check entirely', () => {
  // TTS previews and template tests have no author to check.
  assert.equal(blocklist.apply('hello').text, 'hello');
});

check('disabling the filter engine disables blocking too', () => {
  const off = new FilterEngine({
    ...DEFAULT_FILTERS,
    enabled: false,
    blockedUsers: ['spambot123'],
  });
  assert.equal(off.isUserBlocked('tiktok', 'spambot123'), false);
});

console.log(`\n${passed} checks passed`);
