/**
 * Credential store checks.
 *
 * The property that matters most here is a negative one — **no value ever
 * leaves the store** — and negatives are exactly what gets lost in a refactor,
 * because nothing breaks when they stop holding. A status object that starts
 * carrying the value works perfectly, renders fine, and quietly publishes
 * every key in the app to anything that can reach the dashboard.
 *
 * The rest is precedence. Two sources can supply the same key, and getting
 * that wrong produces the worst kind of bug: someone types a credential into
 * a form, sees it saved, and it does nothing because a stale environment
 * variable outranked it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Pointed at a throwaway directory before anything is imported.
 *
 * `SecretStore.save()` writes to `DATA_DIR/secrets.json`, and `DATA_DIR` is
 * resolved once when `env.ts` is first evaluated. A static import of the
 * store would therefore run these checks against the real credentials file
 * and overwrite it — so the redirect has to happen first, and the import has
 * to be dynamic to stay after it.
 */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-check-'));
process.env.DATA_DIR = SANDBOX;

const { SecretStore, SECRET_KEYS, parseSecretKey } = await import('../secrets.js');
type SecretStore = InstanceType<typeof SecretStore>;

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

/** A store with a known environment, isolated from the real one. */
function withEnv(vars: Record<string, string | undefined>): SecretStore {
  const saved: Record<string, string | undefined> = {};
  for (const key of SECRET_KEYS) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  const store = new SecretStore();
  // The saved values are restored by the caller through `restore` below; the
  // store has already snapshotted what it needs.
  (store as unknown as { __restore: () => void }).__restore = () => {
    for (const key of SECRET_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  return store;
}

const restore = (store: SecretStore): void =>
  (store as unknown as { __restore: () => void }).__restore();

const statusFor = (store: SecretStore, key: string) =>
  store.status().find((entry) => entry.key === key);

console.log('\nCredentials\n');

console.log('a status report never carries the value');
{
  const store = withEnv({ TWITCH_CLIENT_ID: 'abcdefghijklmnopqrstuvwxyz1234' });
  const status = store.status();

  // Checked as a property of the whole serialized object rather than field by
  // field: a future field carrying the secret would pass a field-by-field
  // test and fail this one.
  const serialized = JSON.stringify(status);
  check('the secret is nowhere in the payload', serialized.includes('abcdefghijklmnopqrstuvwxyz1234'), false);
  check('every key is reported', status.length, SECRET_KEYS.length);

  const entry = statusFor(store, 'TWITCH_CLIENT_ID');
  check('it says the key is set', entry?.configured, true);
  // The length is the one detail allowed out, because it answers "did my
  // paste pick up a trailing space?" without revealing anything.
  check('and how long it is', entry?.length, 30);
  check('and where it came from', entry?.source, 'env');

  const fields = Object.keys(entry ?? {}).sort();
  check('the shape has no room for a value', fields, ['configured', 'key', 'length', 'source']);
  restore(store);
}

console.log('\nan unset key is reported as unset, not as empty');
{
  const store = withEnv({});
  const entry = statusFor(store, 'GOOGLE_CLIENT_SECRET');
  check('not configured', entry?.configured, false);
  check('no source', entry?.source, null);
  check('zero length', entry?.length, 0);
  check('and reading it gives undefined', store.get('GOOGLE_CLIENT_SECRET'), undefined);
  restore(store);
}

console.log('\nwhitespace around a pasted value is discarded');
{
  const store = withEnv({});
  // Copying out of a developer console picks up a newline more often than
  // not, and a key with a trailing newline fails authentication with an
  // error that never mentions whitespace.
  store.set('SIGN_API_KEY', '  a-real-key\n');
  check('trimmed on the way in', store.get('SIGN_API_KEY'), 'a-real-key');
  check('and the reported length matches', statusFor(store, 'SIGN_API_KEY')?.length, 10);
  store.clear('SIGN_API_KEY');
  restore(store);
}

console.log('\nsaving publishes the value to the process');
{
  const store = withEnv({});
  // This is the mechanism that makes a key work without a restart: `env` and
  // the OAuth providers read `process.env` at access time.
  store.set('NGROK_AUTHTOKEN', 'token-value');
  check('visible to everything that reads env', process.env.NGROK_AUTHTOKEN, 'token-value');
  store.clear('NGROK_AUTHTOKEN');
  restore(store);
}

console.log('\nthe dashboard outranks .env');
{
  const store = withEnv({ TWITCH_CLIENT_SECRET: 'from-dot-env' });
  check('starts out reading .env', store.get('TWITCH_CLIENT_SECRET'), 'from-dot-env');

  store.set('TWITCH_CLIENT_SECRET', 'from-the-dashboard');
  check('a saved value wins', store.get('TWITCH_CLIENT_SECRET'), 'from-the-dashboard');
  check('and takes effect in the process', process.env.TWITCH_CLIENT_SECRET, 'from-the-dashboard');
  check('the source is reported honestly', statusFor(store, 'TWITCH_CLIENT_SECRET')?.source, 'dashboard');

  /*
   * The bug this pins down: `apply()` overwrites `process.env`, so the
   * original `.env` value is gone from there. Clearing has to restore it from
   * the snapshot taken at construction — otherwise "clear" silently deletes a
   * credential the user never touched and cannot get back without a restart.
   */
  store.clear('TWITCH_CLIENT_SECRET');
  check('clearing reveals .env again', store.get('TWITCH_CLIENT_SECRET'), 'from-dot-env');
  check('and puts it back in the process', process.env.TWITCH_CLIENT_SECRET, 'from-dot-env');
  check('reported as coming from env once more', statusFor(store, 'TWITCH_CLIENT_SECRET')?.source, 'env');
  restore(store);
}

console.log('\nclearing something .env never had removes it entirely');
{
  const store = withEnv({});
  store.set('GOOGLE_TTS_API_KEY', 'a-key');
  store.clear('GOOGLE_TTS_API_KEY');
  check('gone from the store', store.get('GOOGLE_TTS_API_KEY'), undefined);
  check('and gone from the process', process.env.GOOGLE_TTS_API_KEY, undefined);
  restore(store);
}

console.log('\nsaving an empty value clears rather than storing emptiness');
{
  const store = withEnv({});
  store.set('SIGN_API_KEY', 'something');
  store.set('SIGN_API_KEY', '   ');
  // Otherwise an empty string would shadow `.env` forever while reporting
  // itself as configured.
  check('treated as a clear', store.get('SIGN_API_KEY'), undefined);
  check('and reported unset', statusFor(store, 'SIGN_API_KEY')?.configured, false);
  restore(store);
}

console.log('\nonly known keys are accepted');
{
  // The API passes user input straight to this. Without the guard, a request
  // could write arbitrary names into the file and, through `apply`, set
  // arbitrary environment variables on the server process.
  check('a real key parses', parseSecretKey('TWITCH_CLIENT_ID'), 'TWITCH_CLIENT_ID');
  check('an unknown one does not', parseSecretKey('PATH'), null);
  check('nor does a lookalike', parseSecretKey('twitch_client_id'), null);
  check('nor a non-string', parseSecretKey({ key: 'TWITCH_CLIENT_ID' }), null);
  check('nor an empty string', parseSecretKey(''), null);
}

console.log('\nchanges are announced');
{
  // The TTS providers and the TikTok signing key copy a value when they are
  // built, so they only see a key saved later if they are told.
  const store = withEnv({});
  const seen: string[] = [];
  store.on('change', (key: string) => seen.push(key));
  store.set('SIGN_API_KEY', 'abc');
  store.set('GOOGLE_TTS_API_KEY', 'def');
  store.clear('SIGN_API_KEY');
  store.clear('SIGN_API_KEY');
  check('a save and a clear each announce the key', seen, ['SIGN_API_KEY', 'GOOGLE_TTS_API_KEY', 'SIGN_API_KEY']);
  check('clearing what was never stored is silent', seen.length, 3);
  restore(store);
}

console.log('\ncredentials never stay in the config');
{
  // config.json is broadcast to every overlay. An older build let the TTS tab
  // write these straight into it, so a config arriving with them — from an old
  // file, an un-updated dashboard, a restored backup — has to have them moved
  // out rather than passed along. The fields are gone from the config now, so
  // "moved out" means absent, not blank.
  const { ConfigStore } = await import('../config/store.js');
  const { secrets } = await import('../secrets.js');
  const CONFIG = path.join(SANDBOX, 'config.json');
  const hasLegacyField = (config: { tts: object; tunnel: object }): boolean =>
    'sessionId' in config.tts ||
    'apiKey' in (config.tts as { google: object }).google ||
    'basicAuth' in config.tunnel;

  // At startup, from a file an older build wrote.
  const first = new ConfigStore();
  fs.writeFileSync(
    CONFIG,
    JSON.stringify({
      ...first.get(),
      tts: { ...first.get().tts, sessionId: 'sess-file', google: { ...first.get().tts.google, apiKey: 'AIza-file' } },
      tunnel: { ...first.get().tunnel, basicAuth: 'old:login' },
    }),
  );
  const loaded = new ConfigStore();
  check('an old file gives up its credentials at startup', [secrets.get('TIKTOK_SESSION_ID'), secrets.get('GOOGLE_TTS_API_KEY'), secrets.get('TUNNEL_BASIC_AUTH')], ['sess-file', 'AIza-file', 'old:login']);
  check('the loaded config does not carry them', hasLegacyField(loaded.get()), false);
  check('and the file is rewritten without them', /sess-file|AIza-file|old:login/.test(fs.readFileSync(CONFIG, 'utf8')), false);

  // From a patch sent by a dashboard that has not been updated.
  const store = new ConfigStore();
  const after = store.update({ tts: { sessionId: 'sess-123', google: { apiKey: 'AIza-456' } } });
  check('a session id in a patch is not kept in the config', hasLegacyField(after), false);
  check('the session id is in the secret store', secrets.get('TIKTOK_SESSION_ID'), 'sess-123');
  check('and so is the key', secrets.get('GOOGLE_TTS_API_KEY'), 'AIza-456');

  store.flush();
  const onDisk = fs.readFileSync(CONFIG, 'utf8');
  check('neither value reached config.json', /sess-123|AIza-456/.test(onDisk), false);

  // From a backup restored whole.
  const restored = store.replace({ ...after, tts: { ...after.tts, sessionId: 'sess-789' } });
  check('a restored config is moved out too', hasLegacyField(restored), false);
  check('and the newer value wins', secrets.get('TIKTOK_SESSION_ID'), 'sess-789');

  check('untouched settings survive', restored.tts.provider, after.tts.provider);

  // A patch the schema rejects must not leave a credential behind.
  let rejected = false;
  try {
    store.update({ tts: { sessionId: 'sess-rejected', provider: 'not-a-provider' } });
  } catch {
    rejected = true;
  }
  check('a rejected patch is rejected', rejected, true);
  check('and stores nothing', secrets.get('TIKTOK_SESSION_ID'), 'sess-789');

  // The tunnel login is the same kind of thing: it used to sit in the config
  // as `tunnel.basicAuth`, which every overlay is sent.
  const tunnel = store.update({ tunnel: { domain: 'my-stream.ngrok.app', basicAuth: 'streamer:hunter2' } });
  check('a tunnel login in a patch is not kept in the config', hasLegacyField(tunnel), false);
  check('and is in the secret store', secrets.get('TUNNEL_BASIC_AUTH'), 'streamer:hunter2');
  check('the rest of the tunnel settings survive', tunnel.tunnel.domain, 'my-stream.ngrok.app');
  store.flush();
  check(
    'it never reached config.json',
    fs.readFileSync(path.join(SANDBOX, 'config.json'), 'utf8').includes('hunter2'),
    false,
  );

  secrets.clear('TIKTOK_SESSION_ID');
  secrets.clear('GOOGLE_TTS_API_KEY');
  secrets.clear('TUNNEL_BASIC_AUTH');
}

/*
 * Proof the sandbox redirect actually took effect.
 *
 * Every `set` above wrote a file. If `DATA_DIR` had not been honoured they
 * went to the real data directory and overwrote live credentials instead —
 * so asserting the sandbox received them is what makes the isolation a test
 * rather than a hope.
 */
check('writes landed in the sandbox', fs.existsSync(path.join(SANDBOX, 'secrets.json')), true);
fs.rmSync(SANDBOX, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
