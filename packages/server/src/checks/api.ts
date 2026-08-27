import { viewerKey } from '@streaming/shared';
/**
 * End-to-end smoke test against a running server.
 *   npm run check:api -w @streaming/server
 *
 * Exercises the paths that are hard to verify by reading code: the auto
 * penalty, trusted-list gate bypass, per-user voice profiles and the
 * autocomplete directory.
 */
import { BASE, call, post, warnIfLiveCredentials, withConfigSnapshot } from './harness.js';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Config {
  users: {
    trusted: string[];
    penaltyBox: Array<{ username: string; reason: string; automatic: boolean; evidence: string | null }>;
    voiceProfiles: Array<{
      username: string;
      provider: string;
      settings: Record<string, { voice: string; rate: number; pitch: number; volume: number }>;
    }>;
  };
  filters: { blockedWords: string[] };
  tts: { rules: Array<{ id: string; enabled: boolean }> };
}

async function main(): Promise<void> {
  await warnIfLiveCredentials();

  // Everything below resets and rewrites config, so it runs inside a snapshot
  // that is restored even if a check throws.
  await withConfigSnapshot(async () => {
  console.log('setup');
  await post('/config/reset');

  // A severe term plus a followers-only TTS rule to test gating against.
  await call('/config', {
    method: 'PATCH',
    body: JSON.stringify({
      filters: { blockedWords: ['fiddlesticks'], action: 'skip' },
      users: {
        severe: { words: ['gebeta'], phrases: [], regex: [] },
        autoPenalty: { enabled: true, strikesBeforePenalty: 1, onlyCountEvasion: true, exemptTrusted: true },
      },
    }),
  });
  console.log('  ok  configured severe list and blocklist\n');

  console.log('filter severity and evasion');

  const plain = await post<{ result: { severity: string; evasion: boolean } }>('/filters/test', {
    text: 'gebeta',
  });
  check('plain severe term reports severity=severe, evasion=false',
    plain.result.severity === 'severe' && !plain.result.evasion,
    JSON.stringify(plain.result));

  const disguised = await post<{ result: { severity: string; evasion: boolean } }>('/filters/test', {
    text: 'ገበታ',
  });
  check('Ethiopic spelling reports severity=severe, evasion=true',
    disguised.result.severity === 'severe' && disguised.result.evasion,
    JSON.stringify(disguised.result));

  const ordinary = await post<{ result: { severity: string } }>('/filters/test', {
    text: 'fiddlesticks',
  });
  check('ordinary blocklist hit is severity=normal, not severe',
    ordinary.result.severity === 'normal',
    JSON.stringify(ordinary.result));

  const spoof = await post<{ mixedScriptWords: string[]; result: { evasion: boolean } }>(
    '/filters/test',
    { text: 'ᏣΟᏒΝ' },
  );
  check('mixed-script word is detected', spoof.mixedScriptWords.length === 1, JSON.stringify(spoof.mixedScriptWords));

  console.log('\nuser directory and autocomplete');

  // Fire chat events so the directory has people in it.
  for (let i = 0; i < 3; i += 1) {
    await post('/test-event', { type: 'chat', text: 'hello from the test harness' });
  }

  const found = await call<Array<{ username: string; messages: number }>>('/users/search?q=');
  check('directory records users seen in chat', found.length > 0, `${found.length} users`);

  const first = found[0];
  if (!first) throw new Error('no users in directory to continue with');

  // Everything written to a list is stored platform-qualified now; the search
  // result carries the canonical form as `key`.
  const prefix = await call<Array<{ username: string }>>(
    `/users/search?q=${encodeURIComponent(first.username.slice(0, 3))}`,
  );
  check('prefix search finds them', prefix.some((u) => u.username === first.username));

  // Directory entries seen in chat here all come from the TikTok test events,
  // so this is their canonical stored form.
  const key = viewerKey('tiktok', first.username);

  console.log('\ntrusted list');

  await post('/users/trusted', { username: key });
  let config = await call<Config>('/config');
  check('trusting adds them to the list', config.users.trusted.includes(key));

  await post('/users/penalty', { username: key, reason: 'test' });
  config = await call<Config>('/config');
  check('muting someone removes them from trusted',
    !config.users.trusted.includes(key) &&
      config.users.penaltyBox.some((e) => e.username === key));

  await post('/users/trusted', { username: key });
  config = await call<Config>('/config');
  check('trusting again lifts the mute',
    config.users.trusted.includes(key) &&
      !config.users.penaltyBox.some((e) => e.username === key));

  await call(`/users/trusted/${encodeURIComponent(key)}`, { method: 'DELETE' });
  config = await call<Config>('/config');
  check('untrusting removes them', !config.users.trusted.includes(key));

  /*
   * Position in the array is add order, and the dashboard's "recently added"
   * view reads it as such. Nothing enforces that beyond every write being an
   * append or a filter — so if someone ever sorts this list on write, the
   * order silently stops meaning anything and the view keeps claiming it does.
   */
  console.log('\ntrusted list keeps its add order');

  const ordered = ['tiktok:order-a', 'tiktok:order-b', 'tiktok:order-c'];
  for (const entry of ordered) await post('/users/trusted', { username: entry });
  config = await call<Config>('/config');
  const positions = ordered.map((entry) => config.users.trusted.indexOf(entry));
  check(
    'new entries are appended in the order they were added',
    positions.every((at, i) => at >= 0 && (i === 0 || at > (positions[i - 1] ?? -1))),
    JSON.stringify(positions),
  );
  check('and land at the end, not the front', positions[2] === config.users.trusted.length - 1);

  await call(`/users/trusted/${encodeURIComponent('tiktok:order-b')}`, { method: 'DELETE' });
  config = await call<Config>('/config');
  const remaining = [
    config.users.trusted.indexOf('tiktok:order-a'),
    config.users.trusted.indexOf('tiktok:order-c'),
  ];
  check(
    'removing someone leaves the rest in order',
    remaining[0]! >= 0 && remaining[1]! > remaining[0]!,
  );

  for (const entry of ['tiktok:order-a', 'tiktok:order-c']) {
    await call(`/users/trusted/${encodeURIComponent(entry)}`, { method: 'DELETE' });
  }

  console.log('\nper-user voice profiles');

  await post('/users/voice', {
    username: key,
    settings: { tiktok: { voice: 'en_us_ghostface', rate: 1.25, pitch: 0.8 } },
  });
  config = await call<Config>('/config');
  const profile = config.users.voiceProfiles.find((p) => p.username === key);
  const tiktok = profile?.settings.tiktok;
  check('voice profile is stored under its provider',
    tiktok?.voice === 'en_us_ghostface' && tiktok.rate === 1.25 && tiktok.pitch === 0.8,
    JSON.stringify(profile));

  await post('/users/voice', { username: key, settings: { tiktok: { pitch: 1.5 } } });
  config = await call<Config>('/config');
  const merged = config.users.voiceProfiles.find((p) => p.username === key)?.settings.tiktok;
  check('partial updates merge instead of replacing',
    merged?.voice === 'en_us_ghostface' && merged.pitch === 1.5 && merged.rate === 1.25,
    JSON.stringify(merged));

  // The whole point of keying by provider: one backend's voice must not be
  // disturbed by editing another's.
  await post('/users/voice', {
    username: key,
    provider: 'google',
    settings: { google: { voice: 'en-US-Studio-Q', rate: 0.9 } },
  });
  config = await call<Config>('/config');
  const both = config.users.voiceProfiles.find((p) => p.username === key);
  check('a second provider gets its own settings',
    both?.settings.google?.voice === 'en-US-Studio-Q' && both.settings.google?.rate === 0.9,
    JSON.stringify(both?.settings.google));
  check('and the first provider is untouched',
    both?.settings.tiktok?.voice === 'en_us_ghostface' && both.settings.tiktok?.pitch === 1.5,
    JSON.stringify(both?.settings.tiktok));
  check('the speaker can be pinned to their own backend', both?.provider === 'google', both?.provider);

  await call(`/users/voice/${encodeURIComponent(key)}`, { method: 'DELETE' });
  config = await call<Config>('/config');
  check('voice profile can be removed',
    !config.users.voiceProfiles.some((p) => p.username === key));

  console.log('\noverlay sources');

  const created = await post<{ id: string; type: string }>('/overlays', { type: 'goal', name: 'Test Goal' });
  check('a source can be created with a slugified id', created.id === 'test-goal', created.id);

  const overlays = await call<Array<{ id: string; localUrl: string }>>('/overlays');
  check('new source appears with a browser-source URL',
    overlays.some((o) => o.id === created.id && o.localUrl.endsWith('/overlay/test-goal')));

  await call(`/overlays/${created.id}`, { method: 'DELETE' });
  const after = await call<Array<{ id: string }>>('/overlays');
  check('a source can be deleted', !after.some((o) => o.id === created.id));

  console.log('\nvalidation');

  // Raw fetch rather than `call`, because this one is expected to fail and
  // `call` throws on a non-2xx.
  const bad = await fetch(`${BASE}/api/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tts: { masterVolume: 42 } }),
  });
  check('out-of-range config values are rejected with 400', bad.status === 400, `got ${bad.status}`);

  const stillFine = await call<Config>('/config');
  check('a rejected patch leaves the config untouched', stillFine.filters.blockedWords.includes('fiddlesticks'));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
}

main().catch((error: unknown) => {
  console.error('harness error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
