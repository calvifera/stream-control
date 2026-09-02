/**
 * What the host is shown for a filtered message.
 *   npm run check:display -w @streaming/server
 *
 * This covers the seam between two things that must not drift apart: the
 * filter's verdict on a message, and how the host's surfaces present it. The
 * failure it guards against is not a crash — it is a message shown to the
 * wrong eyes, or hidden from the eyes that needed it.
 *
 * Both halves are checked against each other rather than separately, because
 * either alone can be right while the pair is wrong: a filter that stops
 * marking something severe, or a renderer that stops reading the mark, produce
 * the same silent result.
 */
import { messageDisplay, type ChatEvent } from '@streaming/shared';
import { FilterEngine } from '../pipeline/filters.js';
import type { FilterConfig, SevereTermsConfig } from '@streaming/shared';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
    console.log(`         expected ${JSON.stringify(expected)}`);
    console.log(`         actual   ${JSON.stringify(actual)}`);
  }
}

const severe: SevereTermsConfig = { words: ['slurword'], phrases: [], regex: [] };

const config: FilterConfig = {
  enabled: true,
  blockedWords: ['badword'],
  blockedPhrases: [],
  blockedRegex: [],
  blockedUsers: [],
  action: 'skip',
  censorReplacement: '***',
  normalizeLeetspeak: true,
  collapseRepeatedChars: true,
  matchTransliterations: true,
  allowedScripts: ['Latin'],
  blockDisallowedScripts: true,
  blockMixedScriptWords: true,
  reviewNearMatches: false,
  stripUrls: false,
  stripEmoji: false,
  maxLength: 200,
  applyToOverlay: true,
};

const engine = new FilterEngine(config, severe);

/** Runs a message through the filter, then through the display rules. */
function shown(text: string, trusted = false) {
  const verdict = engine.apply(text);
  const event = {
    text,
    displayText: verdict.text,
    filtered: verdict.filtered,
    redacted: verdict.redact,
    filterSeverity: verdict.severity,
  } as Pick<ChatEvent, 'text' | 'displayText' | 'filtered' | 'redacted' | 'filterSeverity'>;
  return messageDisplay(event, { trusted });
}

console.log('\nWhat the host sees\n');

{
  const d = shown('hello everyone');
  check('a clean message is shown as-is', [d.tier, d.text, d.notRead], ['plain', 'hello everyone', false]);
}

{
  const d = shown('you are a badword');
  // The whole point of the redesign: an ordinary hit stays readable, because
  // a false positive cannot be recognised from a placeholder.
  check(
    'an ordinary term is amber and readable',
    [d.tier, d.text],
    ['amber', 'you are a badword'],
  );
}

{
  const d = shown('you are a slurword');
  check(
    'a severe term is red, readable, and marked unspoken',
    [d.tier, d.text, d.notRead],
    ['red', 'you are a slurword', true],
  );
}

{
  const d = shown('you are a slurword', true);
  // Trust is the override the host asked for: someone already vouched for is
  // far likelier to have tripped a bad list entry than to have meant it.
  check(
    'the same severe term from a trusted viewer drops to amber',
    [d.tier, d.text, d.notRead],
    ['amber', 'you are a slurword', false],
  );
}

{
  const d = shown('you are a badword', true);
  check('an ordinary term from a trusted viewer stays amber', d.tier, 'amber');
}

{
  const d = shown('приветствие всем');
  check(
    'a refused script is folded, with nothing to read',
    [d.tier, d.text],
    ['folded', null],
  );
}

{
  const d = shown('приветствие всем', true);
  // Trust cannot unlock this one: there is no readable message underneath.
  check('a refused script stays folded for trusted viewers too', d.tier, 'folded');
}

{
  // Censoring leaves something behind for TTS to say, so "not read" would be
  // false — the message did go out, with the word masked.
  const censoring = new FilterEngine({ ...config, action: 'censor' }, severe);
  const verdict = censoring.apply('you are a badword');
  const d = messageDisplay(
    {
      text: 'you are a badword',
      displayText: verdict.text,
      filtered: verdict.filtered,
      redacted: verdict.redact,
      filterSeverity: verdict.severity,
    },
    {},
  );
  check(
    'a censored message is not marked unread — TTS still spoke it',
    [d.tier, d.notRead, verdict.text],
    ['amber', false, 'you are a ***'],
  );
}

{
  // The invariant that keeps this off the stream: whatever tier the host sees,
  // the text an overlay renders is `displayText` and never the original.
  const verdict = engine.apply('you are a slurword');
  check('the overlay-facing text never carries the original', verdict.text, null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
