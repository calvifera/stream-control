/**
 * Outbound destination checks.
 *
 * The credentials screen tells people exactly which hosts each key is sent
 * to, and promises there is nothing else. That is a strong claim to make to
 * somebody who has just been asked for their TikTok login cookie, and a claim
 * like that is worth nothing unless something enforces it.
 *
 * This walks every hostname the server source can reach and fails on anything
 * not on the list below. Adding a new integration is meant to fail here — the
 * failure is the reminder that a screen elsewhere makes a promise which just
 * stopped being true.
 *
 * What it cannot see: hosts reached by dependencies. Those are audited by
 * hand — see `THIRD_PARTY_NOTES`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Every host this application is allowed to contact, and why.
 *
 * Each one is a platform the user has explicitly connected to. There is no
 * entry here for anything belonging to whoever wrote this, and that absence
 * is the point of the file.
 */
const ALLOWED: Record<string, string> = {
  // Twitch
  'id.twitch.tv': 'OAuth: sign-in and token refresh',
  'api.twitch.tv': 'Helix: avatars, follower status, moderation',
  'irc-ws.chat.twitch.tv': 'Chat, over anonymous IRC',

  // Google / YouTube
  'accounts.google.com': 'OAuth: the sign-in page itself',
  'oauth2.googleapis.com': 'OAuth: token exchange and refresh',
  'www.googleapis.com': 'YouTube live chat',
  'texttospeech.googleapis.com': 'Google Cloud text-to-speech',
  'www.google.com': 'The legacy translate-style speech endpoint',

  // TikTok
  'www.tiktok.com': 'Profile lookups for avatars',
  'api-va.tiktokv.com': 'TikTok text-to-speech',
  'api16-normal-c-useast1a.tiktokv.com': 'TikTok text-to-speech',
  'api16-normal-c-useast2a.tiktokv.com': 'TikTok text-to-speech',
  'api16-normal-useast5.us.tiktokv.com': 'TikTok text-to-speech',
  'api19-normal-c-useast1a.tiktokv.com': 'TikTok text-to-speech',
  'api22-normal-c-useast2a.tiktokv.com': 'TikTok text-to-speech',
};

/**
 * Hosts reached by dependencies rather than by this source, audited by hand.
 *
 * `api.eulerstream.com` is the one worth spelling out. The TikTok connector
 * sends it the room id to sign a stream URL — and it *can* be made to send
 * the user's session cookie too, which would put an account credential in a
 * third party's hands. That path requires `authenticateWs`, which this app
 * never sets, and the library additionally refuses it unless a
 * `WHITELIST_AUTHENTICATED_SESSION_ID_HOST` environment variable names the
 * sign server. Neither is set anywhere in this repository, which the check
 * below asserts rather than trusts.
 */
const THIRD_PARTY_NOTES: Record<string, string> = {
  'api.eulerstream.com': 'Signing the TikTok stream URL (connector library)',
  'connect.ngrok-agent.com': 'The tunnel, only while one is running',
};

/** Hostnames that only ever appear in test fixtures. */
const FIXTURE_HOSTS = new Set(['example.com', 'spam.example', 'yt3.example', 'x', 'localhost']);

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

console.log('\nOutbound destinations\n');

const files = sourceFiles(SRC);
const found = new Map<string, string[]>();

for (const file of files) {
  const body = fs.readFileSync(file, 'utf8');
  for (const match of body.matchAll(/(?:https|wss):\/\/([a-zA-Z0-9._-]+)/g)) {
    const host = match[1];
    if (!host || FIXTURE_HOSTS.has(host)) continue;
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    found.set(host, [...(found.get(host) ?? []), rel]);
  }
}

console.log('every host the source can reach');
{
  const unexpected = [...found.keys()].filter((host) => !(host in ALLOWED)).sort();
  for (const host of [...found.keys()].sort()) {
    const note = ALLOWED[host];
    console.log(`         ${note ? '·' : '!'} ${host.padEnd(38)} ${note ?? 'UNDECLARED'}`);
  }
  /*
   * A new host here is not necessarily wrong — it is necessarily
   * *undocumented*. The credentials screen enumerates destinations to the
   * person handing over their credentials, so anything reachable from the
   * code and absent from that list makes the screen inaccurate.
   */
  check('nothing contacts an undeclared host', unexpected, []);
}

console.log('\nnothing phones home');
{
  // The promise on the credentials screen is not "we protect your data", it
  // is "there is nobody to send it to". These are the shapes that would make
  // that false.
  const suspicious = [...found.keys()].filter((host) =>
    /analytics|telemetry|sentry|segment|mixpanel|amplitude|posthog|bugsnag|datadog/i.test(host),
  );
  check('no analytics or crash-reporting host', suspicious, []);

  const sources = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  check('no analytics SDK is imported', /from ['"](@sentry|posthog|mixpanel)/.test(sources), false);
}

console.log('\nthe TikTok session cookie never reaches the sign server');
{
  /*
   * The single most sensitive value this app accepts, and the one route that
   * could leak it. Both switches have to stay unset — asserted against the
   * whole repository rather than a single file, since either could be set
   * anywhere.
   */
  /*
   * This file is excluded from its own scan. It names both switches in order
   * to document them, and matching that would be the check failing on its own
   * explanation of why it exists.
   */
  const sources = files
    .filter((file) => !file.endsWith(`checks${path.sep}network.ts`))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  check('authenticateWs is never enabled', /authenticateWs\s*[:=]\s*true/.test(sources), false);
  check(
    'the sign-server whitelist is never set',
    /WHITELIST_AUTHENTICATED_SESSION_ID_HOST/.test(sources),
    false,
  );
}

console.log('\nthird-party destinations are declared');
{
  // Not discoverable by scanning this source, so they are listed by hand and
  // shown here on every run — a reviewer sees them rather than having to know
  // to go looking.
  for (const [host, why] of Object.entries(THIRD_PARTY_NOTES)) {
    console.log(`         · ${host.padEnd(38)} ${why}`);
  }
  check('the hand-audited list is not empty', Object.keys(THIRD_PARTY_NOTES).length > 0, true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
