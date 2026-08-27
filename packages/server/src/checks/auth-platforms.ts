/**
 * Platform sign-in checks.
 *
 * Two things matter most here and both are security-shaped:
 *   1. `state` is the only defence against a forged OAuth callback grafting
 *      someone else's account onto this server. It must be single-use and must
 *      not accept a value this server never issued.
 *   2. Nothing the dashboard receives may contain a token, secret or key. The
 *      overview object is broadcast to every connected client.
 *
 * Runs in-process against a sandboxed DATA_DIR so it can never read or write
 * real stored credentials.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-check-'));
process.env.DATA_DIR = SANDBOX;
// Pretend an app is registered so the capability tiers can be exercised
// without real credentials. These are obviously-fake values and never leave
// this process.
process.env.TWITCH_CLIENT_ID = 'test-client-id';
process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';
// And blank the Google pair, because the "missing credentials" block below
// asserts what happens when a provider has none. `dotenv` does not overwrite
// a variable that is already set, so assigning an empty string here keeps the
// developer's real .env out of the test — otherwise the block silently starts
// testing the opposite of what it claims the moment someone configures
// YouTube, which is exactly how it broke.
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';

const { beginAuth, consumeState, redirectUri } = await import('../auth/oauth.js');
const { TWITCH_PROVIDER, YOUTUBE_PROVIDER, capabilitiesFor } = await import(
  '../auth/providers.js'
);
const { CredentialStore } = await import('../auth/credentials.js');
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

console.log('\nPlatform sign-in\n');

console.log('authorize URL');
{
  const result = beginAuth(TWITCH_PROVIDER);
  const url = 'url' in result ? new URL(result.url) : null;

  check('a URL is produced when credentials exist', url !== null, true);
  check('points at the provider, not at us', url?.host, 'id.twitch.tv');
  check('authorization code flow', url?.searchParams.get('response_type'), 'code');
  check('redirect comes back to loopback', url?.searchParams.get('redirect_uri'), redirectUri('twitch'));
  check('state is present', (url?.searchParams.get('state') ?? '').length > 20, true);
  check(
    'the client secret is never in the authorize URL',
    result && 'url' in result ? result.url.includes('test-client-secret') : true,
    false,
  );
}

console.log('\nmissing credentials');
{
  // YOUTUBE_PROVIDER has no env vars set in this run.
  const result = beginAuth(YOUTUBE_PROVIDER);
  check('refuses to start without a client id', 'error' in result, true);
  check(
    'and says what to do about it',
    'error' in result && result.error.includes('client id'),
    true,
  );
}

console.log('\nstate is single-use and scoped');
{
  const first = beginAuth(TWITCH_PROVIDER);
  const state = 'url' in first ? new URL(first.url).searchParams.get('state') ?? '' : '';

  check('a state we issued is accepted', consumeState(state, 'twitch'), true);
  // Replay is the attack: a code plus a reused state would let a callback be
  // fired twice, or fired by someone who observed the first one.
  check('the same state cannot be used twice', consumeState(state, 'twitch'), false);

  const second = beginAuth(TWITCH_PROVIDER);
  const other = 'url' in second ? new URL(second.url).searchParams.get('state') ?? '' : '';
  check('a state issued for one platform is not valid for another', consumeState(other, 'youtube'), false);
  // Deliberate: a wrong-platform probe must not consume the entry, or anyone
  // who can reach this server could cancel a sign-in in progress at will.
  check('a mismatched probe does not burn the state', consumeState(other, 'twitch'), true);

  check('a state we never issued is rejected', consumeState('made-up-value', 'twitch'), false);
  check('an empty state is rejected', consumeState('', 'twitch'), false);
}

console.log('\ncapability tiers');
{
  check('twitch reads chat with nothing configured', capabilitiesFor('twitch', 'anonymous', false).readChat, true);
  check('but has no avatars without an app', capabilitiesFor('twitch', 'anonymous', false).avatars, false);
  check('an app alone unlocks avatars', capabilitiesFor('twitch', 'app', true).avatars, true);
  check('an app alone does not unlock moderation', capabilitiesFor('twitch', 'app', true).moderate, false);
  check('signing in unlocks moderation', capabilitiesFor('twitch', 'user', true).moderate, true);

  check('youtube can do nothing while signed out', capabilitiesFor('youtube', 'app', true).readChat, false);
  check('and reads chat once signed in', capabilitiesFor('youtube', 'user', true).readChat, true);

  check('tiktok never needs credentials', capabilitiesFor('tiktok', 'anonymous', false).readChat, true);
  check('and can never send messages', capabilitiesFor('tiktok', 'anonymous', false).sendMessage, false);
}

console.log('\nstored credentials never leak into the dashboard payload');
{
  const store = new CredentialStore();
  store.set('twitch', {
    accessToken: 'SECRET-ACCESS-TOKEN',
    refreshToken: 'SECRET-REFRESH-TOKEN',
    expiresAt: Date.now() + 3_600_000,
    scopes: ['chat:read'],
    account: 'SomeStreamer',
    accountId: '12345',
  });

  const { authStateFor } = await import('../auth/providers.js');
  const state = authStateFor('twitch', store);
  const serialized = JSON.stringify(state);

  check('the account name is shown', state.account, 'SomeStreamer');
  check('the level reflects a signed-in user', state.level, 'user');
  check('no access token in the payload', serialized.includes('SECRET-ACCESS-TOKEN'), false);
  check('no refresh token in the payload', serialized.includes('SECRET-REFRESH-TOKEN'), false);
  check('no client secret in the payload', serialized.includes('test-client-secret'), false);

  // Expiry handling: a token in the past must not read as signed in.
  store.set('twitch', {
    accessToken: 'x',
    refreshToken: null,
    expiresAt: Date.now() - 1000,
    scopes: [],
    account: 'Expired',
    accountId: '1',
  });
  check('an expired token is not "user" level', authStateFor('twitch', store).level, 'app');
  check('isValid rejects an expired token', store.isValid('twitch'), false);

  store.clear('twitch');
  check('clearing removes it', store.get('twitch'), undefined);
}

console.log('\ncredentials file is separate from config');
{
  const files = fs.readdirSync(SANDBOX);
  check('written to credentials.json', files.includes('credentials.json'), true);
  check('and never into config.json', files.includes('config.json'), false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
