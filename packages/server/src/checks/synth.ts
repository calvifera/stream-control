/**
 * Verifies real TTS synthesis through the production code path.
 *   npm run check:synth -w @streaming/server
 *
 * Needs a valid session id in .env or data/config.json. Writes nothing to
 * disk and never prints the session id.
 */
import fs from 'node:fs';
import { CONFIG_PATH } from '../env.js';
import { chunkText, synthesizeWithTikTok, TIKTOK_TTS_ENDPOINTS } from '../tts/tiktokProvider.js';

function sessionId(): string {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as { tts?: { sessionId?: string } };
    return process.env.TIKTOK_SESSION_ID?.trim() || config.tts?.sessionId?.trim() || '';
  } catch {
    return process.env.TIKTOK_SESSION_ID?.trim() ?? '';
  }
}

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/** MP3 frames start with 0xFF 0xEx, or an ID3 tag. */
function looksLikeMp3(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return buffer[0] === 0xff && (buffer[1] ?? 0) >= 0xe0;
}

async function main(): Promise<void> {
  const session = sessionId();
  if (!session) {
    console.error('No session id found — set TIKTOK_SESSION_ID or paste one in the dashboard.');
    process.exitCode = 1;
    return;
  }
  console.log(`session id: ${session.length} chars\n`);

  console.log('chunking');
  check('short text stays one chunk', chunkText('hello world').length === 1);
  const long = 'word '.repeat(120).trim();
  const chunks = chunkText(long);
  check(
    'long text splits on word boundaries',
    chunks.length > 1 && chunks.every((c) => c.length <= 200) && !chunks.join(' ').includes('  '),
    `${chunks.length} chunks`,
  );

  console.log('\nsynthesis');
  const start = Date.now();
  const result = await synthesizeWithTikTok('Testing one two three', 'en_us_002', {
    sessionId: session,
  });
  const elapsed = Date.now() - start;

  check('returns audio', result.audio.length > 0, `${result.audio.length} bytes in ${elapsed}ms`);
  check('audio is a valid MP3 stream', looksLikeMp3(result.audio));
  check('mime type is audio/mpeg', result.mimeType === 'audio/mpeg');

  console.log('\nmulti-chunk synthesis (exercises the concat path)');
  const longResult = await synthesizeWithTikTok(
    'This sentence is deliberately long enough that the provider has to split it into more than one request and then stitch the resulting audio back together into a single clip for playback. '.repeat(
      2,
    ),
    'en_us_002',
    { sessionId: session },
  );
  check(
    'joined audio is larger than a single chunk',
    longResult.audio.length > result.audio.length,
    `${longResult.audio.length} bytes`,
  );
  check('joined audio is still a valid MP3 stream', looksLikeMp3(longResult.audio));

  console.log('\na second voice');
  const other = await synthesizeWithTikTok('Testing a different voice', 'en_us_006', {
    sessionId: session,
  });
  check('en_us_006 synthesizes', other.audio.length > 0, `${other.audio.length} bytes`);

  console.log('\nerror handling');
  try {
    await synthesizeWithTikTok('test', 'not_a_real_voice', { sessionId: session });
    check('a bogus voice is rejected', false, 'it unexpectedly succeeded');
  } catch (error) {
    check('a bogus voice is rejected with a clear error', true, (error as Error).message);
  }

  console.log(`\nendpoints in use, first is preferred:`);
  for (const endpoint of TIKTOK_TTS_ENDPOINTS.slice(0, 2)) console.log(`  ${endpoint}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('\nsynthesis failed outright:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
