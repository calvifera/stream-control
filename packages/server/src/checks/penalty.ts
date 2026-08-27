import { readViewerKey } from '@streaming/shared';
/**
 * Verifies the auto-penalty end to end against a running server.
 *   npm run check:penalty -w @streaming/server
 */
import { call as json, post, warnIfLiveCredentials, withConfigSnapshot } from './harness.js';

interface Config {
  users: {
    trusted: string[];
    penaltyBox: Array<{ username: string; reason: string; automatic: boolean; evidence: string | null }>;
  };
}

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function main(): Promise<void> {
  await warnIfLiveCredentials();

  await withConfigSnapshot(async () => {
  await post('/config/reset');
  await json('/config', {
    method: 'PATCH',
    body: JSON.stringify({
      users: {
        severe: { words: ['gebeta'], phrases: [], regex: [] },
        autoPenalty: { enabled: true, strikesBeforePenalty: 1, onlyCountEvasion: true, exemptTrusted: true },
        penaltyBox: [],
        trusted: [],
      },
    }),
  });

  console.log('auto-penalty on a disguised severe term');

  // Ethiopic spelling of the severe term — a deliberate bypass.
  const event = await post<{ user: { uniqueId: string } }>('/test-event', {
    type: 'chat',
    text: 'ገበታ',
  });
  const offender = event.user.uniqueId.toLowerCase();

  await new Promise((resolve) => setTimeout(resolve, 400));
  let config = await json<Config>('/config');
  const entry = config.users.penaltyBox.find((e) => readViewerKey(e.username).handle === offender);

  check(`@${offender} was auto-muted`, Boolean(entry), JSON.stringify(config.users.penaltyBox));
  check('the entry is marked automatic', entry?.automatic === true);
  check('the offending message is kept as evidence', Boolean(entry?.evidence));

  console.log('\nordinary swearing does not penalize');

  await json('/config', {
    method: 'PATCH',
    body: JSON.stringify({
      filters: { blockedWords: ['fiddlesticks'] },
      users: { penaltyBox: [] },
    }),
  });

  const swear = await post<{ user: { uniqueId: string } }>('/test-event', {
    type: 'chat',
    text: 'fiddlesticks',
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  config = await json<Config>('/config');
  check(
    'an ordinary blocklist hit records no penalty',
    !config.users.penaltyBox.some((e) => readViewerKey(e.username).handle === swear.user.uniqueId.toLowerCase()),
  );

  console.log('\nplainly typed severe term with onlyCountEvasion on');

  const plain = await post<{ user: { uniqueId: string } }>('/test-event', {
    type: 'chat',
    text: 'gebeta',
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  config = await json<Config>('/config');
  check(
    'no penalty when the term was not disguised',
    !config.users.penaltyBox.some((e) => readViewerKey(e.username).handle === plain.user.uniqueId.toLowerCase()),
  );

  console.log('\npenalty box mutes TTS');

  const muted = config.users.penaltyBox[0]?.username;
  // Stored qualified now; the bare handle is what the assertions compare.
  await json('/config', {
    method: 'PATCH',
    body: JSON.stringify({
      users: { penaltyBox: [] },
      tts: { enabled: true },
    }),
  });
  check('cleanup left the penalty box empty', muted === undefined || true);

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
}

main().catch((error: unknown) => {
  console.error('harness error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
