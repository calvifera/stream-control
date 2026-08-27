/**
 * Session aggregate checks.
 *
 * Mostly about the viewer count, which used to be written straight from
 * TikTok's `roomStats` into a single field. That made it a TikTok-only number
 * presenting itself as the total: connect a second platform and its audience
 * silently did not exist. The distinction these checks defend is between a
 * platform reporting zero viewers and a platform not reporting at all — they
 * are very different facts and only one of them is a number.
 *
 * Pure in-process; `SessionState` touches no files.
 */
import { SessionState } from '../state/session.js';
import { viewerSourceNote, type Platform, type StreamEvent } from '@streaming/shared';

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

const roomStats = (
  platform: Platform,
  viewerCount: number,
  totalViewers: number | null = null,
): StreamEvent =>
  ({
    type: 'roomStats',
    id: `rs-${platform}-${viewerCount}-${totalViewers ?? 'x'}`,
    ts: Date.now(),
    platform,
    user: null,
    viewerCount,
    totalViewers,
    topViewers: [],
  }) as unknown as StreamEvent;

console.log('\nSession\n');

console.log('viewer counts are per platform');
{
  const session = new SessionState();
  check('nothing reported yet', session.getStats().viewerCount, 0);
  check('and no platform claims a number', session.getStats().viewerCounts, {});

  session.ingest(roomStats('tiktok', 180));
  check('one platform reporting', session.getStats().viewerCount, 180);
  check('attributed to it', session.getStats().viewerCounts, { tiktok: 180 });

  session.ingest(roomStats('twitch', 24));
  check('two platforms are summed, not overwritten', session.getStats().viewerCount, 204);
  check('both attributed', session.getStats().viewerCounts, { tiktok: 180, twitch: 24 });

  // The bug this replaces: the last platform to report won, so a TikTok
  // update after a Twitch one would silently drop Twitch's audience.
  session.ingest(roomStats('tiktok', 200));
  check('an update replaces only its own platform', session.getStats().viewerCount, 224);
  check('the other is untouched', session.getStats().viewerCounts.twitch, 24);
}

console.log('\na platform that never reports is absent, not zero');
{
  const session = new SessionState();
  session.ingest(roomStats('tiktok', 100));

  const stats = session.getStats();
  // Twitch over IRC carries no viewer count at all. Recording it as 0 would
  // be inventing a fact, and the dashboard could not tell "nobody watching"
  // apart from "never measured".
  check('absent from the map entirely', 'twitch' in stats.viewerCounts, false);
  check('reads as undefined, not 0', stats.viewerCounts.twitch, undefined);
  check('and does not drag the total down', stats.viewerCount, 100);
}

console.log('\npeak follows the combined total');
{
  const session = new SessionState();
  session.ingest(roomStats('tiktok', 100));
  session.ingest(roomStats('twitch', 50));
  check('peak is the sum at its highest', session.getStats().peakViewerCount, 150);

  session.ingest(roomStats('tiktok', 40));
  check('a dip does not lower the peak', session.getStats().peakViewerCount, 150);
  check('but the live number follows it down', session.getStats().viewerCount, 90);
}

console.log('\na dropped connection stops being counted');
{
  const session = new SessionState();
  session.ingest(roomStats('tiktok', 300));
  session.ingest(roomStats('twitch', 40));

  session.clearViewers('twitch');
  check('the platform is forgotten', session.getStats().viewerCounts, { tiktok: 300 });
  check('and drops out of the total', session.getStats().viewerCount, 300);
  // Its audience was real while it lasted; the peak is a record of what
  // happened, not a claim about right now.
  check('the peak still remembers it', session.getStats().peakViewerCount, 340);

  session.clearViewers('twitch');
  check('clearing twice is harmless', session.getStats().viewerCount, 300);
  session.clearViewers('youtube');
  check('clearing one that never reported is harmless', session.getStats().viewerCount, 300);
}

console.log('\nreset clears the split too');
{
  const session = new SessionState();
  session.ingest(roomStats('tiktok', 120));
  session.reset();
  check('counts are gone', session.getStats().viewerCounts, {});
  check('total is gone', session.getStats().viewerCount, 0);
  check('peak is gone', session.getStats().peakViewerCount, 0);
}

console.log('\nsnapshots do not share the nested object');
{
  const session = new SessionState();
  session.ingest(roomStats('tiktok', 10));
  const before = session.getStats();
  session.ingest(roomStats('twitch', 5));

  // `getStats` returns a shallow copy, so a nested object that was mutated in
  // place would change under a reader still holding an older snapshot.
  check('an older snapshot is not rewritten', before.viewerCounts, { tiktok: 10 });
  check('while the current one has both', session.getStats().viewerCounts, {
    tiktok: 10,
    twitch: 5,
  });
}

console.log('\nthe viewer number says where it came from');
{
  // One platform, nothing else connected: the number speaks for itself.
  check('a lone reporter needs no explanation', viewerSourceNote({ tiktok: 100 }, ['tiktok']), null);
  check('nothing at all says nothing', viewerSourceNote({}, []), null);

  check(
    'two reporters are broken down',
    viewerSourceNote({ tiktok: 180, twitch: 24 }, ['tiktok', 'twitch']),
    'TikTok 180 · Twitch 24',
  );

  // The case this exists for: Twitch is connected and contributing viewers
  // that nothing can measure, so the total is knowably incomplete and has to
  // say so.
  check(
    'a connected platform that reports nothing is named',
    viewerSourceNote({ tiktok: 180 }, ['tiktok', 'twitch']),
    'TikTok 180 — Twitch not counted',
  );
  check(
    'and several of them are',
    viewerSourceNote({ tiktok: 180 }, ['tiktok', 'twitch', 'youtube']),
    'TikTok 180 — YouTube and Twitch not counted',
  );
  check(
    'a disconnected platform is not mentioned at all',
    viewerSourceNote({ tiktok: 180 }, ['tiktok']),
    null,
  );
}

console.log('\nthe per-platform split');
{
  const session = new SessionState();

  const chat = (platform: Platform, userId: string): StreamEvent =>
    ({
      type: 'chat',
      id: `c-${platform}-${userId}-${Math.random()}`,
      ts: Date.now(),
      platform,
      user: { platform, userId, uniqueId: userId, nickname: userId },
      text: 'hi',
      displayText: 'hi',
      filtered: false,
    }) as unknown as StreamEvent;

  const gift = (platform: Platform, userId: string, diamonds: number): StreamEvent =>
    ({
      type: 'gift',
      id: `g-${platform}-${userId}-${diamonds}`,
      ts: Date.now(),
      platform,
      user: { platform, userId, uniqueId: userId, nickname: userId },
      giftName: 'Rose',
      diamondCount: diamonds,
      repeatCount: 1,
      totalDiamonds: diamonds,
      streakable: false,
      repeatEnd: true,
    }) as unknown as StreamEvent;

  const feed = (event: StreamEvent): void => {
    session.markSeen(event.user);
    session.ingest(event);
  };

  feed(chat('tiktok', 'a'));
  feed(chat('tiktok', 'a'));
  feed(chat('tiktok', 'b'));
  feed(chat('twitch', 'c'));
  feed(gift('tiktok', 'a', 500));
  feed(gift('twitch', 'c', 40));

  const stats = session.getStats();
  const tiktok = stats.platforms.tiktok;
  const twitch = stats.platforms.twitch;

  check('messages land on their own platform', tiktok?.messages, 3);
  check('and not on the other', twitch?.messages, 1);
  // Two of TikTok's three messages are the same person. A chatter count that
  // just counted messages would make a busy regular look like a crowd.
  check('repeat messages are one chatter', tiktok?.chatters, 2);
  check('seen counts people, not events', tiktok?.seen, 2);
  check('diamonds are split', [tiktok?.diamonds, twitch?.diamonds], [500, 40]);

  // The split has to reconcile with the headline totals, or one of the two is
  // lying and there is no way to tell which from looking at either.
  const sum = (pick: (s: NonNullable<typeof tiktok>) => number): number =>
    Object.values(stats.platforms).reduce((total, slice) => total + pick(slice), 0);
  check('messages reconcile with the total', sum((s) => s.messages), stats.comments);
  check('chatters reconcile', sum((s) => s.chatters), stats.uniqueChatters);
  check('diamonds reconcile', sum((s) => s.diamonds), stats.diamonds);

  // A platform nothing has arrived from has no entry at all — the same
  // absent-is-not-zero rule the viewer counts follow.
  check('an untouched platform has no slice', stats.platforms.youtube, undefined);
}

console.log('\nviewers are live, totals are history');
{
  const session = new SessionState();
  session.ingest(roomStats('tiktok', 180));
  session.ingest(roomStats('tiktok', 240));
  session.ingest(roomStats('tiktok', 90));

  check('the live figure is the latest', session.getStats().platforms.tiktok?.viewers, 90);
  check('peak remembers the best', session.getStats().platforms.tiktok?.peakViewers, 240);

  // Disconnecting means the number stops being true, not that it becomes
  // zero — the strip has to be able to say "unknown".
  session.clearViewers('tiktok');
  check('a disconnect makes it unknown', session.getStats().platforms.tiktok?.viewers, null);
  check('but the peak still happened', session.getStats().platforms.tiktok?.peakViewers, 240);
}

console.log('\nthe copy handed out is not the live object');
{
  const session = new SessionState();
  session.ingest(roomStats('tiktok', 50));

  const snapshot = session.getStats();
  session.ingest(roomStats('tiktok', 900));

  // A shallow copy would share the per-platform objects, so an overlay
  // holding a snapshot would see it change underneath.
  check('an old snapshot keeps its value', snapshot.platforms.tiktok?.viewers, 50);
  check('while the live one moves on', session.getStats().platforms.tiktok?.viewers, 900);
}

console.log('\nconcurrent and cumulative are different numbers');
{
  const session = new SessionState();

  // The bug this replaces: the TikTok normalizer preferred `totalUser` — the
  // cumulative count of everyone who ever tuned in — over `total`, the people
  // actually watching. The wire format settles which is which: in v1 of the
  // proto field 3 was literally named `viewerCount`, and in v3 field 3 is
  // `total`. `totalUser` is field 7 and did not exist in v1.
  session.ingest(roomStats('tiktok', 180, 2400));
  const first = session.getStats().platforms.tiktok;
  check('watching is the concurrent figure', first?.viewers, 180);
  check('and the cumulative one is kept apart', first?.reportedTotal, 2400);

  // The decisive property, and the one that made the old number obviously
  // wrong in hindsight: concurrent falls, cumulative never does.
  session.ingest(roomStats('tiktok', 90, 2600));
  const later = session.getStats().platforms.tiktok;
  check('concurrent can fall', later?.viewers, 90);
  check('cumulative keeps climbing', later?.reportedTotal, 2600);

  // A late or duplicated frame carrying a smaller total must not walk it back.
  session.ingest(roomStats('tiktok', 95, 2100));
  check('a stale frame does not lower it', session.getStats().platforms.tiktok?.reportedTotal, 2600);

  // Platforms that do not report it stay null rather than showing 0, which
  // would read as "nobody watched".
  session.ingest(roomStats('twitch', 40, null));
  check('an unreported total stays unknown', session.getStats().platforms.twitch?.reportedTotal, null);
  check('while its concurrent count still works', session.getStats().platforms.twitch?.viewers, 40);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
