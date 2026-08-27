/**
 * Proves the Twitch app credentials in .env actually work.
 *   npm run probe:twitch-app -w @streaming/server
 *
 * Uses the client-credentials grant, which authenticates the *application*
 * rather than a person — no sign-in, no consent screen, no password. That is
 * the whole point: it is the tier that unlocks chat avatars, and it can be
 * verified end to end without anyone logging into anything.
 *
 * Deliberately reads nothing from and writes nothing to the credential store.
 * It asks Twitch for a throwaway token, uses it once, and forgets it.
 *
 * Never prints a token, id or secret — only lengths and outcomes. A probe that
 * echoes the thing it is checking turns a terminal scrollback into a leak.
 */
import { appToken } from '../auth/oauth.js';
import { TWITCH_PROVIDER } from '../auth/providers.js';
import { env } from '../env.js';

const mask = (value: string | undefined): string =>
  value ? `${value.length} chars` : '(not set)';

console.log('\nTwitch app credentials\n');
console.log(`  client id     ${mask(env.twitchClientId)}`);
console.log(`  client secret ${mask(env.twitchClientSecret)}`);

if (!env.twitchClientId || !env.twitchClientSecret) {
  console.error('\n  Both must be set in .env. Nothing to test.\n');
  process.exit(1);
}

let failed = 0;

try {
  console.log('\nrequesting an app token (client_credentials)…');
  const token = await appToken(TWITCH_PROVIDER);
  const minutes = Math.round((token.expiresAt - Date.now()) / 60000);

  console.log(`  ok   Twitch accepted the credentials`);
  console.log(`  ok   token returned (${mask(token.accessToken)}), valid ~${minutes} min`);
  console.log(`  ok   no refresh token, as expected for an app token: ${token.refreshToken === null}`);

  // The reason this tier matters: Helix profile lookups are where chat
  // avatars come from, and they need an app token plus the client id.
  const channel = process.argv[2] ?? 'twitchdev';
  console.log(`\nlooking up @${channel} through Helix…`);

  const response = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`,
    {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Client-Id': env.twitchClientId,
      },
    },
  );

  if (!response.ok) {
    console.error(`  FAIL Helix returned HTTP ${response.status}`);
    failed += 1;
  } else {
    const data = (await response.json()) as {
      data?: Array<{ display_name?: string; profile_image_url?: string; created_at?: string }>;
    };
    const user = data.data?.[0];
    if (!user) {
      console.log(`  --   no such channel as @${channel} (the call itself worked)`);
    } else {
      console.log(`  ok   display name: ${user.display_name}`);
      console.log(`  ok   avatar URL:   ${user.profile_image_url ? 'present' : 'MISSING'}`);
      console.log(`  ok   account since ${(user.created_at ?? '').slice(0, 10)}`);
    }
  }
} catch (error) {
  console.error(`\n  FAIL ${error instanceof Error ? error.message : String(error)}`);
  failed += 1;
}

console.log(
  failed === 0
    ? '\nApp credentials work. Twitch chat avatars will resolve.\n'
    : '\nSomething is wrong with the credentials or the request.\n',
);
process.exit(failed === 0 ? 0 : 1);
