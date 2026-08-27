/**
 * Live-status checks.
 *
 * The distinction this defends: **connected is not live.** TikTok and YouTube
 * cannot join a room that is not broadcasting, so for them the two coincide
 * and it is easy to assume they always do. Twitch reads chat over IRC, which
 * joins a channel whether or not anyone is streaming to it — so a Twitch entry
 * can sit "connected" for a day on a channel that never went live.
 *
 * Getting that wrong is not a crash. It is a stream-uptime clock that runs all
 * night and reads as though you were broadcasting the whole time, which is the
 * bug this was written for.
 */
import { TwitchLive } from '../twitch/live.js';

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

process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'test-client-id';

/** A poller wired to a scripted Helix, recording every value it reports. */
function harness(reply: (url: string) => Response | Promise<Response>) {
  const seen: (number | null)[] = [];
  const auth = { appAccessToken: async () => 'app-token' } as unknown as ConstructorParameters<
    typeof TwitchLive
  >[0];

  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => reply(String(input))) as typeof fetch;

  return {
    live: new TwitchLive(auth, (value) => seen.push(value)),
    seen,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

const offline = () => new Response(JSON.stringify({ data: [] }), { status: 200 });
const liveAt = (startedAt: string) =>
  new Response(JSON.stringify({ data: [{ started_at: startedAt }] }), { status: 200 });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

console.log('\nTwitch live status\n');

console.log('an idle channel reports no uptime');
{
  const h = harness(offline);
  h.live.watch('somechannel');
  await settle();
  h.live.stop();

  // The whole point. Being in the channel is not being live, so there is
  // nothing to count and the panel shows no clock at all.
  check('never reports a start time', h.seen.filter((v) => v !== null), []);
  h.restore();
}

console.log('\na live channel reports when the broadcast began');
{
  const started = '2026-08-27T10:00:00Z';
  const h = harness(() => liveAt(started));
  h.live.watch('somechannel');
  await settle();
  h.live.stop();

  // Helix's own start time, not the moment this noticed. Joining an hour into
  // a stream should still show an hour of uptime.
  check('uses the broadcast start, not now', h.seen[0], Date.parse(started));
  h.restore();
}

console.log('\ngoing offline clears it');
{
  let live = true;
  const h = harness(() => (live ? liveAt('2026-08-27T10:00:00Z') : offline()));
  h.live.watch('somechannel');
  await settle();

  live = false;
  // Reaching the private poll directly rather than waiting a minute for the
  // interval; the transition is what matters, not the schedule.
  await (h.live as unknown as { poll: () => Promise<void> }).poll();
  h.live.stop();

  check('reports live, then not', [h.seen[0] !== null, h.seen[1]], [true, null]);
  h.restore();
}

console.log('\na failed lookup is unknown, never offline-with-a-timer');
{
  const h = harness(() => new Response('nope', { status: 500 }));
  h.live.watch('somechannel');
  await settle();
  h.live.stop();

  // Null both ways, so a flaky network shows no clock rather than a wrong one.
  check('reports nothing', h.seen.filter((v) => v !== null), []);
  h.restore();
}

console.log('\nno channel means no polling at all');
{
  let calls = 0;
  const h = harness(() => {
    calls += 1;
    return offline();
  });
  h.live.watch('');
  await settle();
  h.live.stop();

  check('never calls the API', calls, 0);
  h.restore();
}

console.log('\nunchanged answers do not churn state');
{
  const h = harness(() => liveAt('2026-08-27T10:00:00Z'));
  h.live.watch('somechannel');
  await settle();
  await (h.live as unknown as { poll: () => Promise<void> }).poll();
  await (h.live as unknown as { poll: () => Promise<void> }).poll();
  h.live.stop();

  // Three polls, one report. Otherwise every minute would rebroadcast
  // connection state to every client for no reason.
  check('reports once across three polls', h.seen.length, 1);
  h.restore();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
