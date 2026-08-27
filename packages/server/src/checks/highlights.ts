/**
 * Highlight-tier checks.
 *
 * The failure mode this guards against is not a crash, it is a highlight that
 * marks the wrong people — and that is close to invisible, because a gradient
 * name looks correct whoever it lands on. The things worth pinning down:
 *
 *  - a tier scoped to one platform never fires on another, which is the whole
 *    reason the same handle on TikTok and Twitch are different people;
 *  - a threshold means at-least, not more-than, so the person who gives
 *    exactly the advertised amount qualifies;
 *  - an unconfigured threshold marks nobody rather than everybody;
 *  - the biggest tier wins when several match, without depending on the order
 *    they happen to sit in the config;
 *  - and the generated CSS is a seamless loop, since a gradient that jumps at
 *    the wrap is worse than one that never moves.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_HIGHLIGHTS,
  matchesTier,
  tierFor,
  tierStyle,
  type HighlightSubject,
  type HighlightTier,
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

const tier = (over: Partial<HighlightTier> = {}): HighlightTier => ({
  id: 'test',
  label: 'Test',
  enabled: true,
  platforms: [],
  condition: 'given',
  threshold: 100,
  scope: 'session',
  colors: ['#000000', '#ffffff'],
  speed: 4,
  priority: 0,
  ...over,
});

const viewer = (over: Partial<HighlightSubject> = {}): HighlightSubject => ({
  platform: 'tiktok',
  isSubscriber: false,
  isModerator: false,
  isHost: false,
  sessionGiven: 0,
  lifetimeGiven: 0,
  ...over,
});

console.log('\nHighlight tiers\n');

console.log('a threshold means at least, not more than');
{
  const t = tier({ threshold: 500 });
  check('under the line does not qualify', matchesTier(t, viewer({ sessionGiven: 499 })), false);
  // The off-by-one that would otherwise go unnoticed for months: someone who
  // gives exactly the advertised amount has met the advertised bar.
  check('exactly on the line does', matchesTier(t, viewer({ sessionGiven: 500 })), true);
  check('over the line does', matchesTier(t, viewer({ sessionGiven: 501 })), true);
  check('nothing given does not', matchesTier(t, viewer()), false);
}

console.log('\nan unconfigured threshold marks nobody, not everybody');
{
  // A zero threshold read literally is "given >= 0", which is true of every
  // viewer who has never given anything — the entire audience, animated.
  const t = tier({ threshold: 0 });
  check('a zero threshold skips non-gifters', matchesTier(t, viewer()), false);
  check('but still catches a real gift', matchesTier(t, viewer({ sessionGiven: 1 })), true);
}

console.log('\nsession and lifetime are different questions');
{
  const session = tier({ scope: 'session', threshold: 100 });
  const lifetime = tier({ scope: 'lifetime', threshold: 100 });
  const loyalButQuiet = viewer({ sessionGiven: 0, lifetimeGiven: 50_000 });

  check('a quiet night fails a session tier', matchesTier(session, loyalButQuiet), false);
  // The reason lifetime exists: without it, the person who has given you more
  // than anyone else all year is indistinguishable from a stranger tonight.
  check('but passes a lifetime one', matchesTier(lifetime, loyalButQuiet), true);

  const newBigSpender = viewer({ sessionGiven: 5_000, lifetimeGiven: 5_000 });
  check('and tonight counts for both', matchesTier(session, newBigSpender), true);
}

console.log('\nplatform scope is honoured');
{
  const twitchOnly = tier({ platforms: ['twitch'], condition: 'subscriber' });
  check('fires on its platform', matchesTier(twitchOnly, viewer({ platform: 'twitch', isSubscriber: true })), true);
  // Two different people can hold the same handle on two services, so a tier
  // leaking across platforms would decorate a stranger.
  check('and nowhere else', matchesTier(twitchOnly, viewer({ platform: 'tiktok', isSubscriber: true })), false);

  const everywhere = tier({ platforms: [], condition: 'subscriber' });
  for (const platform of ['tiktok', 'twitch', 'youtube'] as Platform[]) {
    check(`an empty list covers ${platform}`, matchesTier(everywhere, viewer({ platform, isSubscriber: true })), true);
  }
}

console.log('\na disabled tier is inert');
{
  const off = tier({ enabled: false, threshold: 1 });
  check('never matches', matchesTier(off, viewer({ sessionGiven: 999_999 })), false);
  check('and is not picked', tierFor([off], viewer({ sessionGiven: 999_999 })), null);
}

console.log('\nthe biggest match wins, whatever order they are in');
{
  const small = tier({ id: 'small', threshold: 100, priority: 0 });
  const big = tier({ id: 'big', threshold: 5000, priority: 0 });
  const whale = viewer({ sessionGiven: 9000 });

  // Both match. Config order must not decide it, or the answer changes when
  // someone drags a row in the editor.
  check('big wins listed first', tierFor([big, small], whale)?.id, 'big');
  check('big wins listed last', tierFor([small, big], whale)?.id, 'big');

  // Priority overrides the amount, which is the point of having it: a
  // subscriber tier has no threshold to compare against at all.
  const sub = tier({ id: 'sub', condition: 'subscriber', threshold: 0, priority: 50 });
  check(
    'priority beats a bigger threshold',
    tierFor([big, sub], viewer({ sessionGiven: 9000, isSubscriber: true }))?.id,
    'sub',
  );
  check('a non-matching tier is skipped', tierFor([sub], whale), null);
}

console.log('\nthe shipped defaults catch the right people');
{
  const t = DEFAULT_HIGHLIGHTS;
  const of = (subject: Partial<HighlightSubject>): string | null =>
    tierFor(t, viewer(subject))?.id ?? null;

  check('an ordinary TikTok viewer is plain', of({ platform: 'tiktok' }), null);
  check('a single rose is not notable', of({ platform: 'tiktok', sessionGiven: 1 }), null);
  check('a real gift is', of({ platform: 'tiktok', sessionGiven: 500 }), 'tiktok-gifter');
  check('a Twitch sub is', of({ platform: 'twitch', isSubscriber: true }), 'twitch-sub');
  // TikTok's tier is platform-scoped, so a Twitch viewer who somehow had
  // diamonds must not pick it up.
  check('a Twitch non-sub is plain', of({ platform: 'twitch', sessionGiven: 9999 }), null);
  check('a YouTube gifter is', of({ platform: 'youtube', sessionGiven: 800 }), 'youtube-gifter');
  check('a YouTube member alone is not', of({ platform: 'youtube', isSubscriber: true }), null);

  // The defaults are meant to be rare. Every one of them is scoped to a
  // single platform, which is what stops three tiers from stacking up on the
  // same viewer.
  check('every default names its platform', t.every((entry) => entry.platforms.length === 1), true);
  check('and none animate fast enough to flicker', t.every((entry) => entry.speed === 0 || entry.speed >= 2), true);
}

console.log('\nthe generated CSS loops without a seam');
{
  const style = tierStyle(tier({ colors: ['#ff0000', '#00ff00', '#0000ff'], speed: 4 }));

  // The first stop is repeated at the end. Without it the sweep runs blue
  // straight back into red once per cycle, which flashes.
  check(
    'the first stop is repeated at the end',
    style.backgroundImage,
    'linear-gradient(90deg, #ff0000, #00ff00, #0000ff, #ff0000)',
  );
  check('the background is wider than the text', style.backgroundSize, '300% 100%');
  check('the fill is transparent so the gradient shows', style.WebkitTextFillColor, 'transparent');
  check('and it is clipped to the glyphs', style.backgroundClip, 'text');
  check('the sweep is set', style.animation, 'highlight-sweep 4s linear infinite');

  // Zero speed is a legitimate choice, and must not emit an animation that
  // runs a compositor frame forever to display something motionless.
  const still = tierStyle(tier({ speed: 0 }));
  check('a still tier has no animation', still.animation, undefined);

  // A one-colour tier is not a gradient; it must still produce valid CSS
  // rather than `linear-gradient(90deg, #abc)`, which the browser drops.
  const single = tierStyle(tier({ colors: ['#abcdef'] }));
  check(
    'a single colour still makes a valid gradient',
    single.backgroundImage,
    'linear-gradient(90deg, #abcdef, #abcdef, #abcdef)',
  );
}

console.log('\nthe sweep wraps on a tile boundary');
{
  /*
   * The bug this exists for produced a visible snap once per cycle, and
   * nothing in TypeScript could have caught it: the size lives in `tierStyle`
   * and the travel lives in a CSS keyframe, so the two can drift apart
   * silently.
   *
   * A background-position percentage offsets by `(element - image) * p`, not
   * by that share of the element. At `background-size: kx`, one full tile of
   * travel therefore needs `|(1 - k) * p| = k`. Landing anywhere else leaves
   * the last frame mid-tile, and the wrap back to 0% jumps.
   */
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

  const size = tierStyle(tier()).backgroundSize as string;
  const k = Number(size.split('%')[0]) / 100;
  check('the background is a whole number of element widths', Number.isInteger(k), true);

  for (const sheet of ['overlay.css', 'dashboard.css']) {
    const css = readFileSync(resolve(root, `packages/overlay/src/styles/${sheet}`), 'utf8');
    const frames = css.slice(css.indexOf('@keyframes highlight-sweep'));
    const to = frames.slice(frames.indexOf('to {'));
    const p = Number(/(-?[\d.]+)%/.exec(to)?.[1]) / 100;

    // Whole tiles travelled over one cycle. A non-integer is the snap.
    const tiles = Math.abs((1 - k) * p) / k;
    console.log(`         ${sheet}: size ${k}x, sweep ${p * 100}%, travels ${tiles} tile(s)`);
    check(`${sheet} travels a whole number of tiles`, Number.isInteger(tiles), true);
    check(`${sheet} actually moves`, tiles > 0, true);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
