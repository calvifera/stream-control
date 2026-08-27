/**
 * Archive query cost, measured rather than guessed.
 *
 * Reads a *copy* of the real `users.json` placed in a sandbox dir, so it
 * measures the shape of the actual data — a synthetic 3,000 rows of "user1"
 * would not exercise the string comparisons or the display-name scan.
 *
 * Run: BENCH_DIR=<dir holding a users.json copy> npm run bench:archive
 */
import path from 'node:path';

const SANDBOX = process.env.BENCH_DIR;
if (!SANDBOX) {
  console.error('Set BENCH_DIR to a folder holding a copy of users.json.');
  process.exit(1);
}
process.env.DATA_DIR = SANDBOX;

const { UserDirectory } = await import('../state/directory.js');
const { DATA_DIR } = await import('../env.js');
type ArchiveContext = import('../state/directory.js').ArchiveContext;

if (path.resolve(DATA_DIR) !== path.resolve(SANDBOX)) {
  console.error(`\n!! DATA_DIR is ${DATA_DIR}, not the sandbox. Refusing to run.\n`);
  process.exit(1);
}

const dir = new UserDirectory();
const ctx: ArchiveContext = {
  trusted: new Set(),
  penalized: new Set(),
  voiced: new Set(),
  avatarPath: () => null,
};

function time(label: string, fn: () => unknown): void {
  fn(); // warm the JIT; the first call is not the one that matters
  const started = performance.now();
  const runs = 20;
  for (let i = 0; i < runs; i += 1) fn();
  console.log(`  ${((performance.now() - started) / runs).toFixed(2)} ms  ${label}`);
}

console.log(`\n${dir.size().toLocaleString()} records\n`);
time('archive page, sorted and paginated', () => dir.archive({ sort: 'firstSeen', limit: 50 }, ctx));
time('archive page, one platform', () =>
  dir.archive({ platform: 'tiktok', sort: 'firstSeen', limit: 50 }, ctx),
);
time('archive page with a search term', () => dir.archive({ q: 'cat', limit: 50 }, ctx));
time('full analytics, including three platform breakdowns', () => dir.analytics(ctx));
console.log('');
