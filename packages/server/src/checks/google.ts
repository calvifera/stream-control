/**
 * Verifies the Google Cloud TTS provider.
 *   npm run check:google -w @streaming/server
 *
 * Without a key it checks the failure paths (which must be clear, not
 * mysterious). With GOOGLE_TTS_API_KEY set it does a real round trip.
 * Never prints the key.
 */
import fs from 'node:fs';
import { CONFIG_PATH } from '../env.js';
import { GoogleTtsProvider } from '../tts/providers/google.js';
import { pitchMultiplierToSemitones, TtsProviderError } from '../tts/providers/types.js';

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

function apiKey(): string {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as {
      tts?: { google?: { apiKey?: string } };
    };
    return process.env.GOOGLE_TTS_API_KEY?.trim() || config.tts?.google?.apiKey?.trim() || '';
  } catch {
    return process.env.GOOGLE_TTS_API_KEY?.trim() ?? '';
  }
}

function looksLikeMp3(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return buffer[0] === 0xff && (buffer[1] ?? 0) >= 0xe0;
}

async function main(): Promise<void> {
  console.log('pitch conversion (multiplier -> semitones)');
  check('1.0x is unchanged', Math.abs(pitchMultiplierToSemitones(1)) < 0.001);
  check('2.0x is +12 semitones', Math.abs(pitchMultiplierToSemitones(2) - 12) < 0.001);
  check('0.5x is -12 semitones', Math.abs(pitchMultiplierToSemitones(0.5) + 12) < 0.001);
  check('out-of-range input is clamped', Math.abs(pitchMultiplierToSemitones(99) - 12) < 0.001);

  console.log('\nunconfigured behaviour');
  const empty = new GoogleTtsProvider({ apiKey: '', defaultVoice: 'en-US-Neural2-C', languageCode: 'en-US' });
  check('reports itself unconfigured', !empty.isConfigured());
  check('gives an actionable hint', empty.configurationHint().includes('Text-to-Speech'));

  try {
    await empty.synthesize({ text: 'hi', voice: 'en-US-Neural2-C', rate: 1, pitch: 1 });
    check('synthesizing without a key fails', false, 'it unexpectedly succeeded');
  } catch (error) {
    const err = error as TtsProviderError;
    check(
      'synthesizing without a key fails clearly and non-retryably',
      err.code === 'no_credentials' && !err.retryable,
      err.message,
    );
  }

  const key = apiKey();
  if (!key) {
    console.log('\nNo GOOGLE_TTS_API_KEY set — skipping the live round trip.');
    console.log('Add a key to .env and re-run to verify synthesis end to end.');
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
    return;
  }

  console.log(`\nlive round trip (key of ${key.length} chars)`);
  const google = new GoogleTtsProvider({
    apiKey: key,
    defaultVoice: 'en-US-Neural2-C',
    languageCode: 'en-US',
  });

  const voices = await google.listVoices();
  check('voice list is returned', voices.length > 0, `${voices.length} voices`);
  check(
    'US English voices are present',
    voices.some((v) => v.language === 'en-US'),
    `${voices.filter((v) => v.language === 'en-US').length} en-US voices`,
  );

  const result = await google.synthesize({
    text: 'Testing the Google provider',
    voice: 'en-US-Neural2-C',
    rate: 1,
    pitch: 1,
  });
  check('returns audio', result.audio.length > 0, `${result.audio.length} bytes`);
  check('audio is a valid MP3 stream', looksLikeMp3(result.audio));
  check('reports rate and pitch as applied server-side', result.rateApplied && result.pitchApplied);

  const shifted = await google.synthesize({
    text: 'Testing the Google provider',
    voice: 'en-US-Neural2-C',
    rate: 1.5,
    pitch: 0.7,
  });
  check(
    'rate change alters the clip length',
    Math.abs(shifted.audio.length - result.audio.length) > 500,
    `${result.audio.length} vs ${shifted.audio.length} bytes`,
  );

  // An unknown voice falls back to the default rather than throwing: losing a
  // line of TTS because a rule holds a stale code is worse than speaking it in
  // the wrong voice, and the log and dashboard both flag the mismatch.
  const bogus = await google.synthesize({
    text: 'hi',
    voice: 'not-a-real-voice',
    rate: 1,
    pitch: 1,
  });
  check('an unknown voice falls back instead of failing', bogus.audio.length > 0, `${bogus.audio.length} bytes`);

  // A bad *key* must still fail loudly — that is not recoverable.
  const badKey = new GoogleTtsProvider({
    apiKey: 'AIzaNotARealKeyAtAll',
    defaultVoice: 'en-US-Neural2-C',
    languageCode: 'en-US',
  });
  try {
    await badKey.synthesize({ text: 'hi', voice: 'en-US-Neural2-C', rate: 1, pitch: 1 });
    check('a bad API key is rejected', false, 'it unexpectedly succeeded');
  } catch (error) {
    const err = error as TtsProviderError;
    check('a bad API key is rejected non-retryably', !err.retryable, err.code);
  }

  // Chirp voices reject a pitch parameter outright, so a per-user pitch
  // profile on one used to fail the whole clip. Pitch must now be dropped from
  // the request and handed to the browser instead.
  console.log('\npitch handling across tiers');

  const chirp = await google.synthesize({
    text: 'Testing a Chirp voice with a pitch shift',
    voice: 'en-US-Chirp3-HD-Aoede',
    rate: 1,
    pitch: 0.6,
  });
  check('a Chirp voice synthesizes even with a pitch profile', chirp.audio.length > 0, `${chirp.audio.length} bytes`);
  check('Chirp reports pitch as NOT applied, so the browser shifts it', !chirp.pitchApplied);
  check('Chirp still reports rate as applied', chirp.rateApplied);

  const neural = await google.synthesize({
    text: 'Testing a Neural2 voice with a pitch shift',
    voice: 'en-US-Neural2-C',
    rate: 1,
    pitch: 0.6,
  });
  check('Neural2 reports pitch as applied server-side', neural.pitchApplied);

  const studio = await google.synthesize({
    text: 'Testing a Studio voice with a pitch shift',
    voice: 'en-US-Studio-O',
    rate: 1,
    pitch: 0.6,
  });
  check('Studio reports pitch as NOT applied (it silently ignores it)', !studio.pitchApplied);

  // Google's catalogue includes bare aliases for the Chirp3 voices, which no
  // naming rule distinguishes from a foreign backend's code. They must reach
  // Google rather than being second-guessed into the default voice.
  console.log('\nunusable alias entries');

  // Google lists bare Chirp3 aliases that its own synthesize endpoint refuses,
  // so offering them in a dropdown would hand the user broken choices.
  const listed = new Set(voices.map((v) => v.code));
  check('bare aliases are excluded from the voice list', !listed.has('Aoede'));
  check('their usable full names are kept', listed.has('en-US-Chirp3-HD-Aoede'));
  check(
    'oddly-cased real voices are kept',
    voices.some((v) => v.code === 'fil-ph-Neural2-A'),
  );

  // Even if one slips through from an old config, it must not fail the clip.
  const alias = await google.synthesize({
    text: 'Testing a stale alias voice name',
    voice: 'Aoede',
    rate: 1,
    pitch: 1,
  });
  check('a stale alias still produces audio via fallback', alias.audio.length > 0, `${alias.audio.length} bytes`);

  // A leftover code from another backend should degrade to the default voice
  // rather than failing the clip.
  const legacy = await google.synthesize({
    text: 'Testing a leftover TikTok code',
    voice: 'en_us_002',
    rate: 1,
    pitch: 1,
  });
  check('a TikTok code falls back to the default voice', legacy.audio.length > 0, `${legacy.audio.length} bytes`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('check failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
