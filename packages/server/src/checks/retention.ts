/**
 * Retention checks.
 *
 * The tracker writes `retention.json` into the data dir on a debounce and
 * reads it back on construction, so `DATA_DIR` is redirected to a throwaway
 * folder *before* `env.js` loads — hence the dynamic import, since a static
 * one would be hoisted above the assignment.
 *
 * Everything here injects its own timestamps. Retention is entirely about
 * elapsed time, and a test that waited for real minutes to pass would be both
 * unrunnable and, at these thresholds, a four-hour test.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-check-'));
process.env.DATA_DIR = SANDBOX;

const { RetentionTracker } = await import('../state/retention.js');
const { DATA_DIR } = await import('../env.js');

if (path.resolve(DATA_DIR) !== path.resolve(SANDBOX)) {
  console.error(`\n!! DATA_DIR is ${DATA_DIR}, not the sandbox. Refusing to run.\n`);
  process.exit(1);
}

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

const MIN = 60_000;
/** A fixed clock, so "20 minutes later" means exactly that. */
const T0 = new Date('2026-03-14T20:00:00').getTime();

/** A tracker with no file behind it. */
const fresh = (): InstanceType<typeof RetentionTracker> => {
  fs.rmSync(path.join(SANDBOX, 'retention.json'), { force: true });
  return new RetentionTracker();
};

console.log('\nRetention\n');

console.log('a visit starts on the first sign of life');
{
  const r = fresh();
  r.observe('tiktok:a', 'tiktok', T0);

  const curve = r.curve('tiktok');
  check('one visit', curve.visits, 1);
  check('still open', curve.open, 1);
  check('no bucket reached yet', curve.reached, [0, 0, 0, 0, 0, 0]);
  check('nothing on another platform', r.curve('twitch').visits, 0);
}

console.log('\nbuckets fill as the visit runs');
{
  const r = fresh();
  // Every 10 minutes: inside the 15-minute idle window, so this is one
  // sitting. A single jump from 0 to 20 would be two visits with a gap
  // between them, which is the correct reading and a different test.
  for (const minute of [0, 10, 20]) r.observe('tiktok:a', 'tiktok', T0 + minute * MIN);

  const curve = r.curve('tiktok');
  check('still one visit, not two', curve.visits, 1);
  // 1, 5 and 15 minutes are behind them; 30, 60 and 120 are not.
  check('every threshold passed is credited', curve.reached, [1, 1, 1, 0, 0, 0]);
  check('duration is first-to-last event', curve.totalMs, 20 * MIN);
  check('longest tracks it too', curve.longestMs, 20 * MIN);

  // A curve where reaching 30 minutes did not imply reaching 15 would be
  // arithmetically impossible and would read as a broken chart.
  const monotone = curve.reached.every((count, i) => i === 0 || count <= (curve.reached[i - 1] ?? 0));
  check('the curve never rises', monotone, true);
}

console.log('\na long gap is a new visit, not a longer one');
{
  const r = fresh();
  r.observe('tiktok:a', 'tiktok', T0);
  r.observe('tiktok:a', 'tiktok', T0 + 10 * MIN);
  // Twenty minutes of silence: they left and came back.
  r.observe('tiktok:a', 'tiktok', T0 + 40 * MIN);
  r.observe('tiktok:a', 'tiktok', T0 + 45 * MIN);

  const curve = r.curve('tiktok');
  check('two sittings', curve.visits, 2);
  check('one of them still open', curve.open, 1);
  check('10 + 5 minutes, not 45', curve.totalMs, 15 * MIN);
  check('the longer one is the longest', curve.longestMs, 10 * MIN);
  check('both cleared 5 minutes, neither cleared 15', curve.reached, [2, 2, 0, 0, 0, 0]);
}

console.log('\ngoing quiet ends a visit');
{
  const r = fresh();
  for (const minute of [0, 10, 20, 30]) r.observe('tiktok:a', 'tiktok', T0 + minute * MIN);
  r.sweep(T0 + 40 * MIN);
  check('not yet — ten minutes of quiet is not gone', r.curve('tiktok').open, 1);

  r.sweep(T0 + 50 * MIN);
  const curve = r.curve('tiktok');
  check('closed after the idle window', curve.open, 0);
  check('the visit is still counted', curve.visits, 1);
  // Measured to their last event, not to the sweep: the twenty idle minutes
  // are not watch time and counting them would inflate every bucket.
  check('idle time is not watch time', curve.totalMs, 30 * MIN);
  check('reached 30 minutes but not 60', curve.reached, [1, 1, 1, 1, 0, 0]);
}

console.log('\nlosing a connection closes its visits and only its visits');
{
  const r = fresh();
  r.observe('tiktok:a', 'tiktok', T0);
  r.observe('twitch:b', 'twitch', T0);
  r.observe('tiktok:a', 'tiktok', T0 + 8 * MIN);
  r.observe('twitch:b', 'twitch', T0 + 8 * MIN);

  r.closePlatform('tiktok');
  check('tiktok visits are closed', r.curve('tiktok').open, 0);
  check('twitch is untouched', r.curve('twitch').open, 1);
  check('tiktok still counts the visit', r.curve('tiktok').visits, 1);
  check('overall sums both platforms', r.overall().visits, 2);
  check('overall open count', r.overall().open, 1);
}

console.log('\nopen visits never reach the file');
{
  const r = fresh();
  for (const minute of [0, 10, 20]) r.observe('tiktok:done', 'tiktok', T0 + minute * MIN);
  r.sweep(T0 + 40 * MIN);

  // Still in progress when the process goes away.
  r.observe('tiktok:live', 'tiktok', T0 + 60 * MIN);
  r.flush();

  const reloaded = new RetentionTracker();
  const curve = reloaded.curve('tiktok');
  // `flush` closes what is open, so both land — an orderly shutdown keeps the
  // evening's numbers rather than throwing away whoever was still watching.
  check('completed visits survive a restart', curve.visits, 2);
  check('nothing is left open', curve.open, 0);
  check('durations survive', curve.totalMs, 20 * MIN);
  check('buckets survive', curve.reached, [1, 1, 1, 0, 0, 0]);
}

console.log('\na crash mid-stream loses the visit rather than corrupting the average');
{
  const r = fresh();
  r.observe('tiktok:a', 'tiktok', T0);
  r.observe('tiktok:a', 'tiktok', T0 + 10 * MIN);
  r.sweep(T0 + 30 * MIN);

  // A second visit that is still running when the lights go out.
  r.observe('tiktok:b', 'tiktok', T0 + 40 * MIN);
  r.observe('tiktok:b', 'tiktok', T0 + 50 * MIN);

  check('both visible while running', r.curve('tiktok').visits, 2);

  // `save`, not `flush`: this is the state the file is in between debounced
  // writes, which is what a crash would leave behind.
  r.save();

  const reloaded = new RetentionTracker();
  const after = reloaded.curve('tiktok');
  check('only the completed visit was persisted', after.visits, 1);
  check('and it is not left open', after.open, 0);
  check('the lost visit is lost, not half-recorded', after.totalMs, 10 * MIN);
}

console.log('\nan empty tracker reports zero, not NaN');
{
  const r = fresh();
  const curve = r.curve('youtube');
  check('no visits', curve.visits, 0);
  check('bucket array is still the right shape', curve.reached.length, 6);
  check('overall is empty too', r.overall().visits, 0);
  check('no live visits', r.liveVisits(), 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
