/**
 * Archive checks.
 *
 * These run in-process against real `UserDirectory` instances, which both read
 * and write `users.json` on construction and on a debounce. Pointed at the
 * real data dir they would load the live archive and then overwrite it with
 * test fixtures, so `DATA_DIR` is redirected to a throwaway folder *before*
 * `env.js` is loaded — hence the dynamic import below, since a static one
 * would be hoisted above the assignment and read the real path.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StreamEvent, StreamUser } from '@streaming/shared';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-check-'));
process.env.DATA_DIR = SANDBOX;

const { UserDirectory, localDay } = await import('../state/directory.js');
const { DATA_DIR } = await import('../env.js');
type ArchiveContext = import('../state/directory.js').ArchiveContext;

// Belt and braces. If the redirect ever silently fails — an import order
// change, a cached module — this stops before the first write rather than
// discovering it afterwards in a diff of the user's archive.
if (path.resolve(DATA_DIR) !== path.resolve(SANDBOX)) {
  console.error(`\n!! DATA_DIR is ${DATA_DIR}, not the sandbox. Refusing to run.\n`);
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}`);
    console.log(`         actual   ${JSON.stringify(actual)}`);
  }
}

/**
 * A directory with nothing behind it.
 *
 * The constructor loads `users.json` from the data dir, so without clearing it
 * each block would inherit the previous block's fixtures — including the
 * 26,000 lurkers the trim test writes.
 */
const fresh = (): InstanceType<typeof UserDirectory> => {
  fs.rmSync(path.join(SANDBOX, 'users.json'), { force: true });
  return new UserDirectory();
};

const user = (uniqueId: string): StreamUser => ({
  platform: 'tiktok',
  userId: `id-${uniqueId}`,
  uniqueId,
  nickname: uniqueId.toUpperCase(),
  avatarUrl: null,
  followRole: 0,
  isFollower: false,
  isFriend: false,
  isSubscriber: false,
  isModerator: false,
  isHost: false,
  isVerified: false,
  followerCount: 0,
  fansClubLevel: 0,
  badges: [],
});

/** The same fixture on a chosen service, for the cross-platform blocks. */
const onPlatform = (uniqueId: string, platform: StreamUser['platform']): StreamUser => ({
  ...user(uniqueId),
  platform,
  userId: `${platform}-${uniqueId}`,
});

const ctx = (over: Partial<ArchiveContext> = {}): ArchiveContext => ({
  trusted: new Set(),
  penalized: new Set(),
  voiced: new Set(),
  avatarPath: () => null,
  ...over,
});

const gift = (uniqueId: string, diamonds: number, count = 1): StreamEvent =>
  ({
    type: 'gift',
    id: `g-${Math.random()}`,
    timestamp: Date.now(),
    user: user(uniqueId),
    giftId: 1,
    giftName: 'Rose',
    giftImageUrl: null,
    diamondCount: diamonds,
    repeatCount: count,
    totalDiamonds: diamonds * count,
    streakable: false,
    repeatEnd: true,
  }) as unknown as StreamEvent;

console.log('\nArchive\n');

/* ---------------------------------------------------------------------- *
 * Lifetime counters
 * ---------------------------------------------------------------------- */

console.log('lifetime totals');
{
  const dir = fresh();
  dir.observe(user('alice'), true);
  dir.observe(user('alice'), true);
  dir.record(gift('alice', 10, 3));
  dir.record(gift('alice', 5));

  const entry = dir.get('alice');
  check('messages count up', entry?.messages, 2);
  check('diamonds accumulate across gifts', entry?.diamonds, 35);
  check('gift count sums repeats', entry?.gifts, 4);
}

console.log('\ngift streaks');
{
  const dir = fresh();
  dir.observe(user('bob'));

  // A streak emits on every tick. Banking each one multiplies the total, which
  // is the bug `SessionState` already guards against.
  const tick = {
    ...(gift('bob', 100, 5) as unknown as Record<string, unknown>),
    streakable: true,
    repeatEnd: false,
  } as unknown as StreamEvent;
  dir.record(tick);
  dir.record(tick);
  check('mid-streak ticks are ignored', dir.get('bob')?.diamonds ?? 0, 0);

  dir.record({ ...(tick as unknown as Record<string, unknown>), repeatEnd: true } as unknown as StreamEvent);
  check('only the streak end banks', dir.get('bob')?.diamonds, 500);
}

console.log('\nrecord() requires an existing entry');
{
  const dir = fresh();
  // No `observe` first — this must not invent a half-populated user.
  dir.record(gift('ghost', 50));
  check('unknown user is not created by a gift', dir.get('ghost'), undefined);
}

/* ---------------------------------------------------------------------- *
 * Days seen
 * ---------------------------------------------------------------------- */

console.log('\ndays seen');
{
  const dir = fresh();
  dir.observe(user('carol'), true);
  dir.observe(user('carol'), true);
  dir.observe(user('carol'), true);
  check('repeat visits in one day count once', dir.get('carol')?.daysSeen, 1);

  // Force yesterday, the way a second night would arrive.
  const entry = dir.get('carol');
  if (entry) entry.lastDay = ' 1999-01-01';
  dir.observe(user('carol'), true);
  check('a new day increments', dir.get('carol')?.daysSeen, 2);
}

console.log('\nlocalDay is local, not UTC');
{
  // 23:30 local on any given day must report that day, not tomorrow's UTC date.
  const late = new Date(2026, 0, 15, 23, 30, 0).getTime();
  check('late-night stream stays on its own date', localDay(late), '2026-01-15');
}

/* ---------------------------------------------------------------------- *
 * Trim bands — the part that destroys data if it is wrong
 * ---------------------------------------------------------------------- */

console.log('\ntrim under real capacity pressure');
{
  // Genuinely overfill the archive rather than asserting the sort keys and
  // hoping. This is the one code path that destroys data, so it gets tested
  // through the front door: fill past MAX_USERS, persist, reload, see who
  // survived.
  const dir = fresh();
  const now = Date.now();
  const day = 86_400_000;

  const age = (name: string, mutate: (entry: NonNullable<ReturnType<typeof dir.get>>) => void) => {
    const entry = dir.get(name);
    if (entry) mutate(entry);
  };

  // Three people worth keeping, all long inactive — exactly the profile the
  // old recency-only trim would have discarded first.
  dir.observe(user('old-regular'), true);
  age('old-regular', (e) => {
    e.messages = 400;
    e.lastSeen = now - 200 * day;
  });

  dir.observe(user('old-flagged'));
  dir.recordStrike(user('old-flagged'), 'evasion attempt', 'severe term');
  age('old-flagged', (e) => {
    e.lastSeen = now - 300 * day;
  });

  dir.remember('old-friend');
  age('old-friend', (e) => {
    e.lastSeen = now - 400 * day;
  });

  // 26,000 lurkers who were all here seconds ago. Past MAX_USERS (25,000), so
  // the trim has to actually choose.
  for (let i = 0; i < 26_000; i++) {
    dir.observe(user(`lurk${i}`));
  }

  check('over capacity before the trim', dir.size() > 25_000, true);

  dir.flush();
  const stored = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'users.json'), 'utf8')) as {
    users: Array<{ username: string }>;
  };
  const kept = new Set(stored.users.map((u) => u.username));

  check('trimmed down to the cap', stored.users.length, 25_000);
  check('a pinned friend survives however stale', kept.has('old-friend'), true);
  check('a moderation record survives however stale', kept.has('old-flagged'), true);
  check('an old regular outranks fresh lurkers', kept.has('old-regular'), true);
  // 26,003 in, 25,000 kept — so 1,003 had to go, and every one of them should
  // be a silent lurker rather than any of the three protected accounts.
  const keptLurkers = [...kept].filter((name) => name.startsWith('lurk')).length;
  check('the whole loss fell on lurkers', 26_000 - keptLurkers, 26_003 - 25_000);
  check('every remaining slot is filled', keptLurkers + 3, 25_000);
}

/* ---------------------------------------------------------------------- *
 * Querying
 * ---------------------------------------------------------------------- */

console.log('\nfilters');
{
  const dir = fresh();
  dir.observe(user('chatty'), true);
  dir.observe(user('silent'));
  dir.observe(user('gifter'));
  dir.record(gift('gifter', 20));
  dir.observe(user('naughty'));
  dir.recordStrike(user('naughty'), 'bad text', 'severe term');

  const context = ctx({
    // Qualified exactly as `listKey()` produces them in api.ts. Using bare
    // handles here once hid a real bug: the sets held qualified keys while the
    // lookup used a bare username, so every badge silently went missing.
    trusted: new Set(['tiktok:chatty']),
    penalized: new Set(['tiktok:naughty']),
  });
  const names = (filter: Parameters<typeof dir.archive>[0]['filter']): string[] =>
    dir
      .archive({ filter, limit: 50 }, context)
      .entries.map((e) => e.username)
      .sort();

  check('all', names('all'), ['chatty', 'gifter', 'naughty', 'silent']);
  check('chatters', names('chatters'), ['chatty']);
  check('lurkers', names('lurkers'), ['gifter', 'naughty', 'silent']);
  check('gifters', names('gifters'), ['gifter']);
  check('trusted', names('trusted'), ['chatty']);
  check('penalized', names('penalized'), ['naughty']);
  check('flagged', names('flagged'), ['naughty']);
}

console.log('\nsearch and sort');
{
  const dir = fresh();
  for (const [name, count] of [
    ['zed', 5],
    ['amy', 100],
    ['mia', 50],
  ] as const) {
    dir.observe(user(name), true);
    const entry = dir.get(name);
    if (entry) entry.messages = count;
  }

  const context = ctx();
  check(
    'sorted by messages, descending',
    dir.archive({ sort: 'messages', desc: true }, context).entries.map((e) => e.username),
    ['amy', 'mia', 'zed'],
  );
  check(
    'sorted by name, ascending',
    dir.archive({ sort: 'username', desc: false }, context).entries.map((e) => e.username),
    ['amy', 'mia', 'zed'],
  );
  check(
    'search matches display name too',
    dir.archive({ q: 'AMY' }, context).entries.map((e) => e.username),
    ['amy'],
  );
  check('search that matches nothing', dir.archive({ q: 'nobody' }, context).total, 0);
}

console.log('\npagination');
{
  const dir = fresh();
  for (let i = 0; i < 25; i++) dir.observe(user(`p${String(i).padStart(2, '0')}`), true);

  const context = ctx();
  const first = dir.archive({ sort: 'username', desc: false, limit: 10 }, context);
  const second = dir.archive({ sort: 'username', desc: false, limit: 10, offset: 10 }, context);

  check('total counts matches, not the page', first.total, 25);
  check('page size respected', first.entries.length, 10);
  check('offset moves the window', second.entries[0]?.username, 'p10');
  check('pages do not overlap', first.entries.some((e) => e.username === 'p10'), false);
  check(
    'limit is capped so one request cannot ask for everything',
    dir.archive({ limit: 100_000 }, context).limit,
    200,
  );
}

/* ---------------------------------------------------------------------- *
 * Analytics
 * ---------------------------------------------------------------------- */

console.log('\nanalytics');
{
  const dir = fresh();
  dir.observe(user('a'), true);
  dir.observe(user('a'), true);
  dir.observe(user('b'), true);
  dir.observe(user('c'));
  dir.record(gift('a', 40));

  const entryB = dir.get('b');
  if (entryB) {
    entryB.lastDay = '1999-01-01';
    dir.observe(user('b'), true);
  }

  const stats = dir.analytics(ctx({ trusted: new Set(['tiktok:a']) }));
  check('total viewers', stats.totalViewers, 3);
  check('chatters', stats.chatters, 2);
  check('lurkers', stats.lurkers, 1);
  check('regulars are multi-day only', stats.regulars, 1);
  check('total messages', stats.totalMessages, 4);
  check('total diamonds', stats.totalDiamonds, 40);
  check('trusted counted', stats.trusted, 1);
  check('messages averaged over chatters, not everyone', stats.messagesPerChatter, 2);
  check('arrivals histogram has 24 buckets', stats.arrivalsByHour.length, 24);
  check(
    'arrivals sum to the viewer count',
    stats.arrivalsByHour.reduce((sum, n) => sum + n, 0),
    3,
  );
  check('top chatters excludes silent people', stats.topChatters.length, 2);
  check('top gifters excludes non-gifters', stats.topGifters.map((e) => e.username), ['a']);
}

console.log('\nempty archive');
{
  const dir = fresh();
  const stats = dir.analytics(ctx());
  check('no divide-by-zero on an empty set', stats.messagesPerChatter, 0);
  check('no first record', stats.firstRecordAt, null);
  check('capacity reports nothing pending', dir.capacity().daysUntilFull, null);
}

/* ---------------------------------------------------------------------- *
 * Identity: config lists hold `platform:handle`, the directory is keyed the
 * same way, and a bare handle from an older config still has to resolve.
 *
 * This is the regression that made an entire trusted list lose its avatars
 * and display names: `lookup` normalized instead of qualifying, so every
 * bare-handle entry missed and the dashboard silently fell back to the raw
 * key. It is silent by nature — nothing errors, the rows just go blank — so
 * it needs a test rather than an eye.
 * ---------------------------------------------------------------------- */

console.log('\nlist lookups resolve both key forms');
{
  const dir = fresh();
  dir.observe(onPlatform('bob', 'tiktok'), true);
  dir.observe(onPlatform('bob', 'twitch'), true);

  check('a qualified key finds its owner', dir.lookup(['tiktok:bob'])[0]?.platform, 'tiktok');
  check('and only its owner', dir.lookup(['tiktok:bob']).length, 1);
  check(
    'a bare handle from an old config reads as TikTok',
    dir.lookup(['bob'])[0]?.platform,
    'tiktok',
  );
  check('the other platform is reachable too', dir.lookup(['twitch:bob'])[0]?.platform, 'twitch');
  check('both at once', dir.lookup(['tiktok:bob', 'twitch:bob']).length, 2);
  check('an @ prefix is tolerated', dir.lookup(['@tiktok:bob']).length, 1);
  check('mixed case is tolerated', dir.lookup(['TikTok:BOB']).length, 1);
  check('the same person twice is returned once', dir.lookup(['bob', 'tiktok:bob']).length, 1);
  check('an unknown handle yields nothing', dir.lookup(['nobody']).length, 0);

  // The other half of the same bug: badges are matched on the qualified key,
  // so a context built from bare handles would light up nothing.
  const trusted = dir.archive(
    { filter: 'all' },
    ctx({ trusted: new Set(['tiktok:bob']) }),
  ).entries;
  check(
    'trust lands on the TikTok bob only',
    trusted.map((entry) => `${entry.platform}:${entry.trusted}`).sort(),
    ['tiktok:true', 'twitch:false'],
  );
}

/* ---------------------------------------------------------------------- *
 * Platform tabs
 * ---------------------------------------------------------------------- */

console.log('\nplatform filter');
{
  const dir = fresh();
  dir.observe(onPlatform('a', 'tiktok'), true);
  dir.observe(onPlatform('b', 'tiktok'), true);
  dir.observe(onPlatform('c', 'twitch'), true);

  check('everything by default', dir.archive({}, ctx()).total, 3);
  check('narrowed to one service', dir.archive({ platform: 'tiktok' }, ctx()).total, 2);
  check('and to another', dir.archive({ platform: 'twitch' }, ctx()).total, 1);
  check('a service with nobody on it is empty, not an error', dir.archive({ platform: 'youtube' }, ctx()).total, 0);
  check(
    'rows really are from that platform',
    dir.archive({ platform: 'twitch' }, ctx()).entries.map((entry) => entry.username),
    ['c'],
  );
  // The two axes have to compose, or "Twitch chatters" is unaskable.
  check(
    'platform and filter stack',
    dir.archive({ platform: 'tiktok', filter: 'lurkers' }, ctx()).total,
    0,
  );
}

console.log('\nchronological ordering');
{
  const dir = fresh();
  const base = Date.now() - 5 * 86_400_000;
  for (const [index, name] of ['first', 'second', 'third'].entries()) {
    dir.observe(onPlatform(name, 'tiktok'), true);
    const entry = dir.get(name);
    if (entry) entry.firstSeen = base + index * 86_400_000;
  }

  const oldest = dir.archive({ sort: 'firstSeen', desc: false }, ctx()).entries;
  check(
    'oldest first',
    oldest.map((entry) => entry.username),
    ['first', 'second', 'third'],
  );
  const newest = dir.archive({ sort: 'firstSeen', desc: true }, ctx()).entries;
  check(
    'newest first',
    newest.map((entry) => entry.username),
    ['third', 'second', 'first'],
  );
}

/* ---------------------------------------------------------------------- *
 * Per-platform analytics
 * ---------------------------------------------------------------------- */

console.log('\nper-platform breakdown');
{
  const dir = fresh();
  dir.observe(onPlatform('tt1', 'tiktok'), true);
  dir.observe(onPlatform('tt1', 'tiktok'), true);
  dir.observe(onPlatform('tt2', 'tiktok'), false);
  dir.observe(onPlatform('tw1', 'twitch'), true);

  const stats = dir.analytics(ctx({ trusted: new Set(['twitch:tw1']) }));
  const by = (platform: string) => stats.platforms.find((entry) => entry.platform === platform);

  check('one entry per platform, always', stats.platforms.length, 3);
  check('tiktok viewers', by('tiktok')?.viewers, 2);
  check('tiktok chatters', by('tiktok')?.chatters, 1);
  check('tiktok lurkers', by('tiktok')?.lurkers, 1);
  check('tiktok messages', by('tiktok')?.messages, 2);
  check('twitch viewers', by('twitch')?.viewers, 1);
  check('trust is attributed to the right platform', by('twitch')?.trusted, 1);
  check('and not to the wrong one', by('tiktok')?.trusted, 0);
  check('a platform with nobody on it still reports', by('youtube')?.viewers, 0);
  check('no divide-by-zero on an empty platform', by('youtube')?.messagesPerChatter, 0);

  // The split has to account for everything, or a viewer is being dropped or
  // double-counted somewhere and neither is visible on screen.
  check(
    'platform viewer counts sum to the total',
    stats.platforms.reduce((sum, entry) => sum + entry.viewers, 0),
    stats.totalViewers,
  );
  check(
    'platform message counts sum to the total',
    stats.platforms.reduce((sum, entry) => sum + entry.messages, 0),
    stats.totalMessages,
  );

  // A leaderboard filtered from the global top-ten would show TikTok names
  // under a Twitch heading, or nothing at all.
  check(
    'top chatters are scoped to their own platform',
    by('twitch')?.topChatters.map((entry) => entry.username),
    ['tw1'],
  );
  check(
    'and never leak in from another',
    by('tiktok')?.topChatters.every((entry) => entry.platform === 'tiktok'),
    true,
  );
  check('a silent platform has no leaderboard', by('youtube')?.topChatters.length, 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
