/**
 * YouTube moderation guards.
 *   npm run check:youtube-moderation -w @streaming/server
 *
 * These are the checks that matter most in this codebase, because everything
 * they cover is irreversible from here: a ban lands on a real person, in front
 * of an audience, and no amount of correcting it afterwards un-does having
 * done it.
 *
 * So the assertions are mostly about what does *not* happen. Every refusal
 * below is verified to refuse before the network is touched at all — a guard
 * that returns the right answer after sending the request is not a guard.
 */
import { YouTubeModeration } from '../youtube/moderation.js';
import type { YouTubeModerationConfig } from '@streaming/shared';

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

const CHANNEL = 'UCsomeviewerchannelid00';

const config = (over: Partial<YouTubeModerationConfig> = {}): YouTubeModerationConfig => ({
  enabled: true,
  timeoutSeconds: 300,
  includeAutomatic: false,
  ...over,
});

/** Counts every outbound request, so "did not touch the network" is testable. */
function harness(
  cfg: YouTubeModerationConfig,
  reply: (url: string, init?: RequestInit) => Response = () =>
    new Response(JSON.stringify({ id: 'ban-1' }), { status: 200 }),
) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return reply(url, init);
  }) as typeof fetch;

  const mod = new YouTubeModeration(
    { userToken: async () => 'token' } as never,
    cfg,
  );
  mod.setChat({ liveChatId: 'chat-1' });
  return { mod, calls, restore: () => { globalThis.fetch = real; } };
}

console.log('\nrefusals, before anything leaves the machine\n');

{
  const h = harness(config({ enabled: false }));
  const result = await h.mod.ban(CHANNEL, 'test', false);
  check('disabled: refuses', result.ok, false);
  check('disabled: sends nothing', h.calls.length, 0);
  h.restore();
}

{
  // The one that protects against this app's own heuristics. Automatic
  // strikes come from evasion and phonetic near misses, which are wrong often
  // enough that they must not reach a real ban without a separate decision.
  const h = harness(config({ includeAutomatic: false }));
  const result = await h.mod.ban(CHANNEL, 'test', true);
  check('automatic penalty: refuses', result.ok, false);
  check('automatic penalty: sends nothing', h.calls.length, 0);
  h.restore();
}

{
  const h = harness(config());
  h.mod.setChat({});
  const result = await h.mod.ban(CHANNEL, 'test', false);
  check('no chat connected: refuses', result.ok, false);
  check('no chat connected: sends nothing', h.calls.length, 0);
  h.restore();
}

{
  const h = harness(config());
  const result = await h.mod.ban('   ', 'test', false);
  check('blank channel id: refuses', result.ok, false);
  check('blank channel id: sends nothing', h.calls.length, 0);
  h.restore();
}

console.log('\nwhat a permitted ban actually sends\n');

{
  const h = harness(config({ timeoutSeconds: 300 }));
  const result = await h.mod.ban(CHANNEL, 'severe term', false);
  const call = h.calls[0];
  const snippet = (call?.body as { snippet?: Record<string, unknown> })?.snippet ?? {};

  check('it succeeds', result.ok, true);
  check('exactly one request', h.calls.length, 1);
  // The path the docs give, not the one the resource name suggests — the same
  // trap that made reading chat 404 silently for weeks.
  check('to /liveChat/bans', call?.url.includes('/youtube/v3/liveChat/bans?part=snippet'), true);
  check('as a POST', call?.method, 'POST');
  check('temporary, not permanent', snippet.type, 'temporary');
  check('for the configured duration', snippet.banDurationSeconds, 300);
  check('against the right chat', snippet.liveChatId, 'chat-1');
  check(
    'against the right viewer',
    (snippet.bannedUserDetails as { channelId?: string })?.channelId,
    CHANNEL,
  );
  h.restore();
}

{
  // 0 means permanent, which is why it is not the default. When it is chosen
  // deliberately, the duration field must be absent rather than zero.
  const h = harness(config({ timeoutSeconds: 0 }));
  await h.mod.ban(CHANNEL, 'test', false);
  const snippet = (h.calls[0]?.body as { snippet?: Record<string, unknown> })?.snippet ?? {};
  check('zero seconds means a permanent ban', snippet.type, 'permanent');
  check('and sends no duration at all', 'banDurationSeconds' in snippet, false);
  h.restore();
}

{
  const h = harness(config({ includeAutomatic: true }));
  const result = await h.mod.ban(CHANNEL, 'test', true);
  check('an automatic penalty goes through once allowed', result.ok, true);
  h.restore();
}

console.log('\nfailures are reported, never swallowed\n');

{
  const h = harness(config(), () => new Response('nope', { status: 403 }));
  const result = await h.mod.ban(CHANNEL, 'test', false);
  check('a refusal is reported as a failure', result.ok, false);
  // 403 is nearly always "not a moderator here" rather than a bad token, and
  // saying so saves re-checking credentials that were never the problem.
  check('and names the likely cause', result.detail.includes('moderator'), true);
  h.restore();
}

{
  const h = harness(config(), () => {
    throw new Error('network is down');
  });
  const result = await h.mod.ban(CHANNEL, 'test', false);
  check('a thrown error is caught and reported', result.ok, false);
  h.restore();
}

console.log('\nlifting a ban\n');

{
  const h = harness(config());
  await h.mod.ban(CHANNEL, 'test', false);
  const result = await h.mod.unban(CHANNEL);
  check('a ban placed here can be lifted', result.ok, true);
  check('by id, with DELETE', h.calls[1]?.method, 'DELETE');
  check('naming the ban', h.calls[1]?.url.includes('id=ban-1'), true);
  h.restore();
}

{
  const h = harness(config());
  const result = await h.mod.unban(CHANNEL);
  check('a ban it never placed is refused, not faked', result.ok, false);
  check('and says where to go instead', result.detail.includes('YouTube Studio'), true);
  check('sending nothing', h.calls.length, 0);
  h.restore();
}

{
  // Ban ids belong to one broadcast. Carrying them across would aim a lift at
  // a chat that no longer exists.
  const h = harness(config());
  await h.mod.ban(CHANNEL, 'test', false);
  h.mod.setChat({ liveChatId: 'chat-2' });
  const result = await h.mod.unban(CHANNEL);
  check('records are dropped when the broadcast changes', result.ok, false);
  h.restore();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
