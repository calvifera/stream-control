/**
 * Name-palette checks.
 *
 * A hashed palette is the kind of thing that looks right in a screenshot of
 * six names and falls apart at four hundred. The properties worth holding are
 * not visible by reading the function:
 *
 *  - a name's colour never changes, or you cannot follow one person down a
 *    fast chat;
 *  - every colour a platform can produce stays inside that platform's band,
 *    or the band tells you nothing;
 *  - the bands never touch, or an edge-of-band TikTok name reads as Twitch;
 *  - nothing the palette can emit is too dark to read over gameplay;
 *  - and the spread inside a band is actually used, rather than three
 *    hundred handles piling into the same four shades.
 */
import {
  bandOf,
  hashHandle,
  HUE_SPREAD,
  luminance,
  nameColor,
  normalizeHandle,
  PLATFORM_HUE,
  PLATFORMS,
  type Platform,
} from '@streaming/shared';

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

/** A spread of handles wide enough to be worth drawing conclusions from. */
function sampleHandles(count: number): string[] {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  const handles: string[] = [];
  let seed = 7;
  for (let i = 0; i < count; i += 1) {
    let handle = '';
    const length = 3 + (i % 12);
    for (let j = 0; j < length; j += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      handle += alphabet[seed % alphabet.length];
    }
    handles.push(handle);
  }
  return handles;
}

/** Hue of a `#rrggbb`, so a colour can be tested against its band. */
function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

const HANDLES = sampleHandles(400);

console.log('\nName palette\n');

console.log('a colour is a fact about a handle, not about when you asked');
{
  for (const platform of PLATFORMS) {
    const first = nameColor(platform, 'steady_hands');
    const again = nameColor(platform, 'steady_hands');
    check(`${platform} is stable across calls`, first, again);
  }

  // The handle is canonicalized on the way in, so the same person typed three
  // different ways is one colour. Without this a viewer's name would change
  // shade depending on which platform's casing convention reached the widget.
  const base = nameColor('twitch', 'MixedCase_Name');
  check('case does not change the colour', nameColor('twitch', 'mixedcase_name'), base);
  check('a leading @ does not either', nameColor('twitch', '@MixedCase_Name'), base);
  check('nor does surrounding space', nameColor('twitch', '  mixedcase_name '), base);
}

console.log('\nevery colour lands in its own platform band');
{
  for (const platform of PLATFORMS) {
    const strays = HANDLES.filter((handle) => bandOf(hueOf(nameColor(platform, handle))) !== platform);
    check(`${platform}: all 400 handles inside the band`, strays.length, 0);
  }

  // The band is the whole mechanism, so it is worth stating the failure it
  // prevents: the same handle on two platforms must not come out the same
  // colour, because that is exactly the case where you need to tell them
  // apart most.
  const collisions = HANDLES.filter(
    (handle) => nameColor('tiktok', handle) === nameColor('twitch', handle),
  );
  check('no handle is the same colour on two platforms', collisions.length, 0);
}

console.log('\nthe bands do not touch');
{
  // Checked as a property of the constants rather than of the output: this is
  // what stops a future brand-colour tweak from quietly overlapping two
  // platforms and making the whole scheme meaningless.
  const pairs: [Platform, Platform][] = [
    ['tiktok', 'twitch'],
    ['twitch', 'youtube'],
    ['youtube', 'tiktok'],
  ];
  for (const [a, b] of pairs) {
    const centres = Math.abs(((PLATFORM_HUE[a] - PLATFORM_HUE[b] + 540) % 360) - 180);
    const gap = centres - HUE_SPREAD * 2;
    check(`${a} and ${b} have clear air between them`, gap > 0, true);
  }
}

console.log('\nnothing is too dark to read over gameplay');
{
  // 0.18 relative luminance is roughly where light text stops holding up
  // against a bright frame with only a stroke behind it. Every hue has to
  // clear it, not just the ones that happen to be inherently bright — pure
  // blue at the same HSL lightness is far darker than pure yellow.
  let darkest = 1;
  let worst = '';
  for (const platform of PLATFORMS) {
    for (const handle of HANDLES) {
      const hex = nameColor(platform, handle);
      const value = luminance(hex);
      if (value < darkest) {
        darkest = value;
        worst = `${platform}:${handle} ${hex}`;
      }
    }
  }
  console.log(`         darkest of 1200: ${worst} at ${darkest.toFixed(3)}`);
  check('every colour clears the legibility floor', darkest > 0.18, true);
}

console.log('\nthe band is actually used');
{
  for (const platform of PLATFORMS) {
    const seen = new Set(HANDLES.map((handle) => nameColor(platform, handle)));
    // 400 handles into fewer than 150 distinct colours would mean people are
    // piling up on each other and the palette is not doing its first job.
    console.log(`         ${platform}: ${seen.size} distinct colours from 400 handles`);
    check(`${platform} spreads 400 handles widely`, seen.size > 150, true);
  }
}

console.log('\nthe hash gives three independent axes');
{
  // The whole reason for FNV over the old `(h * 31 + c) % 360`: three fields
  // are sliced out of one hash, and if the slices move together then
  // lightness becomes a function of hue and the palette collapses to a ring.
  const hues = new Set<number>();
  const lightnessSteps = new Set<string>();
  for (const handle of HANDLES) {
    const hash = hashHandle(normalizeHandle(handle));
    hues.add(hash & 0xff);
    lightnessSteps.add(`${(hash >>> 8) & 0xf}`);
  }
  check('the low byte varies', hues.size > 180, true);
  check('and the lightness nibble covers its range', lightnessSteps.size, 16);

  // A multiply-based FNV would overflow the mantissa and lose the low bits,
  // which shows up as short similar handles colliding.
  check('short similar handles differ', hashHandle('aa') === hashHandle('ab'), false);
  check('and so do their reversals', hashHandle('ab') === hashHandle('ba'), false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
