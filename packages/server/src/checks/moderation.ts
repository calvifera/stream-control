/**
 * Twitch enforcement checks.
 *
 * These guard the safety rails rather than the HTTP call. The call either
 * works or returns an error you can read; the rails are the part that decides
 * *whether a real viewer gets removed from a real channel*, and every one of
 * them fails silently in the dangerous direction if it regresses.
 *
 * Nothing here touches the network. `fetch` is replaced so the requests can be
 * inspected without a token, a channel or an audience.
 */
import { TwitchModeration } from '../twitch/moderation.js';
import type { TwitchModerationConfig } from '@streaming/shared';

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

const config = (over: Partial<TwitchModerationConfig> = {}): TwitchModerationConfig => ({
  enabled: true,
  timeoutSeconds: 600,
  includeAutomatic: false,
  ...over,
});

/** Records every request instead of making one. */
interface Call {
  url: string;
  method: string;
  body: unknown;
}

function harness(cfg: TwitchModerationConfig, channel = 'calvifera') {
  const calls: Call[] = [];

  const auth = {
    userToken: async () => 'test-token',
    store: { get: () => ({ accountId: 'mod-1' }) },
  } as unknown as ConstructorParameters<typeof TwitchModeration>[0];

  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });

    // Every login resolves to a distinct id so "is this me?" is meaningful —
    // and the login `me` resolves to the signed-in account's own id, which is
    // what the real Helix lookup does for your own handle.
    if (url.includes('/helix/users')) {
      const login = new URL(url).searchParams.get('login') ?? '';
      const id = login === 'me' ? 'mod-1' : `id-${login}`;
      return new Response(JSON.stringify({ data: [{ id }] }), { status: 200 });
    }
    if (url.includes('/channels/followers')) {
      return new Response(JSON.stringify({ data: [{ user_id: 'x' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;

  return {
    mod: new TwitchModeration(auth, cfg, channel),
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

/** The ban/timeout request out of a run, if one was made at all. */
const banCall = (calls: Call[]): Call | undefined =>
  calls.find((call) => call.url.includes('/moderation/bans'));

console.log('\nTwitch enforcement\n');

console.log('nothing happens unless it is switched on');
{
  const h = harness(config({ enabled: false }));
  const result = await h.mod.timeout('troublemaker', 'test', false);
  // The important half is the second assertion: not merely reporting failure,
  // but never having reached the network at all.
  check('a disabled setup refuses', result.ok, false);
  check('and makes no request whatsoever', h.calls.length, 0);
  check('saying why', result.detail, 'Twitch moderation is off');
  h.restore();
}

console.log('\nautomatic penalties are held back separately');
{
  const h = harness(config({ enabled: true, includeAutomatic: false }));

  // This is the rail that matters most. Turning on Twitch enforcement must
  // not, by itself, hand the strike system — which fires on phonetic near
  // misses — the power to remove people from the channel.
  const auto = await h.mod.timeout('someone', 'Auto: evasion', true);
  check('an automatic penalty is refused', auto.ok, false);
  check('and never reaches Twitch', banCall(h.calls), undefined);
  check('with the reason given', auto.detail, 'automatic penalties are not allowed to act on Twitch');

  // A human clicking is the case enabling was meant to cover.
  const manual = await h.mod.timeout('someone', 'Manual', false);
  check('a manual one goes through', manual.ok, true);
  h.restore();
}

console.log('\nand are allowed through only when asked for');
{
  const h = harness(config({ enabled: true, includeAutomatic: true }));
  const auto = await h.mod.timeout('someone', 'Auto: evasion', true);
  check('the second switch permits it', auto.ok, true);
  h.restore();
}

console.log('\na timeout is a timeout, not a ban');
{
  const h = harness(config({ timeoutSeconds: 600 }));
  await h.mod.timeout('someone', 'being unpleasant', false);
  const call = banCall(h.calls);

  const body = call?.body as { data?: { duration?: number; user_id?: string; reason?: string } };
  // Omitting `duration` is how Twitch is told to ban permanently, so its
  // presence is the entire difference between ten minutes and forever.
  check('duration is sent', body?.data?.duration, 600);
  check('against the resolved user id', body?.data?.user_id, 'id-someone');
  check('with the reason attached', body?.data?.reason, 'being unpleasant');
  check('as a POST', call?.method, 'POST');

  const url = new URL(call?.url ?? 'https://x/');
  check('naming the broadcaster', url.searchParams.get('broadcaster_id'), 'id-calvifera');
  // Twitch requires this to match the token's own user, so a wrong value here
  // makes every call fail with a confusing 401.
  check('and the moderator', url.searchParams.get('moderator_id'), 'mod-1');
  h.restore();
}

console.log('\nzero seconds is a permanent ban, deliberately');
{
  const h = harness(config({ timeoutSeconds: 0 }));
  const result = await h.mod.timeout('someone', 'gone', false);
  const body = banCall(h.calls)?.body as { data?: { duration?: number } };

  check('no duration is sent', body?.data?.duration, undefined);
  // Reported in words, because "ok: true" reads the same for both and the
  // difference is the most consequential one in this file.
  check('and it says so plainly', result.detail, 'banned permanently');
  h.restore();
}

console.log('\nyou cannot moderate yourself');
{
  // The login `me` resolves to `mod-1`, the signed-in account. Penalising
  // your own handle is an easy mistake while testing, and Twitch's own error
  // for it is opaque.
  const h = harness(config());
  const result = await h.mod.timeout('me', 'oops', false);
  check('refused', result.ok, false);
  check('with a readable reason', result.detail, 'that is your own account');
  check('and no ban attempted', banCall(h.calls), undefined);
  h.restore();
}

console.log('\nlifting a penalty');
{
  const h = harness(config());
  await h.mod.unban('someone');
  const call = banCall(h.calls);

  // DELETE, not POST — the two share a path and differ only by method, which
  // is exactly the kind of thing that gets copied wrong.
  check('is a DELETE', call?.method, 'DELETE');
  const url = new URL(call?.url ?? 'https://x/');
  check('with the target in the query', url.searchParams.get('user_id'), 'id-someone');
  check('and no body', call?.body, null);
  h.restore();
}

console.log('\nunbanning someone who was never banned is success');
{
  const h = harness(config());
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/helix/users')) {
      return new Response(JSON.stringify({ data: [{ id: 'id-x' }] }), { status: 200 });
    }
    return new Response('{"message":"user is not banned"}', { status: 400 });
  }) as typeof fetch;

  // Otherwise releasing anyone who was penalised before enforcement was
  // switched on reports a failure, and the feature looks broken on first use.
  const result = await h.mod.unban('someone');
  check('reported as done', result.ok, true);
  check('explaining the state', result.detail, 'was not banned');
  globalThis.fetch = real;
  h.restore();
}

console.log('\nan unknown channel stops before acting');
{
  const h = harness(config(), '');
  const result = await h.mod.timeout('someone', 'test', false);
  check('no channel means no action', result.ok, false);
  check('and no ban call', banCall(h.calls), undefined);
  h.restore();
}

console.log('\nfollower status distinguishes no from unknown');
{
  const h = harness(config());
  // The whole reason `roles.ts` exists: an unanswerable question is not the
  // same as a "no", and treating it as one is what makes a gate silently
  // unsatisfiable.
  check('a follower is true', await h.mod.isFollower('someone'), true);
  h.restore();

  const g = harness(config());
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = String(input);
    if (url.includes('/helix/users')) {
      return new Response(JSON.stringify({ data: [{ id: 'id-x' }] }), { status: 200 });
    }
    return new Response('nope', { status: 500 });
  }) as typeof fetch;
  check('a failed lookup is null, never false', await g.mod.isFollower('someone'), null);
  globalThis.fetch = real;
  g.restore();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
