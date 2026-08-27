/**
 * Verifies the unofficial Google Translate (speech-api/v2) provider.
 *   npm run check:google-legacy -w @streaming/server
 *
 * Needs no credentials, which is exactly why it also asserts the failure mode:
 * if the shared key is ever revoked, that must surface as a clear message
 * rather than silence.
 */
import { MPEGDecoder } from 'mpg123-decoder';
import {
  GoogleLegacyProvider,
  multiplierToPitch,
  rateToSpeed,
} from '../tts/providers/googleLegacy.js';

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

function looksLikeMp3(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return buffer[0] === 0xff && (buffer[1] ?? 0) >= 0xe0;
}

async function medianF0(mp3: Buffer): Promise<number> {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const decoded = decoder.decode(new Uint8Array(mp3));
  decoder.free();

  const samples = decoded.channelData[0] ?? new Float32Array();
  const sampleRate = decoded.sampleRate;
  const frameSize = Math.floor(sampleRate * 0.04);
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 60);
  const f0s: number[] = [];

  for (let start = 0; start + frameSize < samples.length; start += Math.floor(frameSize / 2)) {
    const frame = samples.subarray(start, start + frameSize);
    let energy = 0;
    for (const v of frame) energy += v * v;
    if (Math.sqrt(energy / frame.length) < 0.01) continue;

    let bestLag = -1;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let i = 0; i + lag < frame.length; i += 1) sum += (frame[i] ?? 0) * (frame[i + lag] ?? 0);
      const score = sum / (frame.length - lag);
      if (score > best) {
        best = score;
        bestLag = lag;
      }
    }
    if (bestLag > 0 && best / (energy / frame.length) > 0.3) f0s.push(sampleRate / bestLag);
  }

  f0s.sort((a, b) => a - b);
  return f0s.length ? (f0s[Math.floor(f0s.length / 2)] as number) : 0;
}

async function main(): Promise<void> {
  console.log('parameter mapping');
  check('rate 1.0 maps to the neutral speed', rateToSpeed(1) === 0.5, String(rateToSpeed(1)));
  check('rate 2.0 maps to the maximum speed', rateToSpeed(2) === 1, String(rateToSpeed(2)));
  check('rate is clamped inside the accepted range', rateToSpeed(99) <= 1 && rateToSpeed(0.01) >= 0.1);
  check('pitch 1.0 maps to the neutral point', multiplierToPitch(1) === 0.45, String(multiplierToPitch(1)));
  check(
    'pitch 2.0 maps above neutral and stays in range',
    multiplierToPitch(2) > 0.45 && multiplierToPitch(2) <= 1,
    String(multiplierToPitch(2)),
  );
  check('pitch is never negative', multiplierToPitch(0.1) >= 0, String(multiplierToPitch(0.1)));

  const provider = new GoogleLegacyProvider({ defaultVoice: 'en-US:female' });

  console.log('\nprovider basics');
  check('reports itself configured without credentials', provider.isConfigured());

  const voices = await provider.listVoices();
  check('lists two voices per language', voices.length > 0 && voices.length % 2 === 0, `${voices.length} voices`);
  check('includes en-US male and female', voices.some((v) => v.code === 'en-US:male') && voices.some((v) => v.code === 'en-US:female'));

  console.log('\nsynthesis');
  const female = await provider.synthesize({ text: 'Testing the legacy engine', voice: 'en-US:female', rate: 1, pitch: 1 });
  check('female voice returns audio', female.audio.length > 0, `${female.audio.length} bytes`);
  check('audio is a valid MP3 stream', looksLikeMp3(female.audio));
  check('reports rate and pitch as applied server-side', female.rateApplied && female.pitchApplied);

  const male = await provider.synthesize({ text: 'Testing the legacy engine', voice: 'en-US:male', rate: 1, pitch: 1 });
  const femaleF0 = await medianF0(female.audio);
  const maleF0 = await medianF0(male.audio);
  check('male and female are acoustically distinct', maleF0 < femaleF0 - 30, `male ${maleF0.toFixed(1)} Hz vs female ${femaleF0.toFixed(1)} Hz`);

  console.log('\nrate and pitch actually take effect');
  const fast = await provider.synthesize({ text: 'Testing the legacy engine', voice: 'en-US:female', rate: 2, pitch: 1 });
  check('a higher rate produces a shorter clip', fast.audio.length < female.audio.length, `${fast.audio.length} vs ${female.audio.length} bytes`);

  const high = await provider.synthesize({ text: 'Testing the legacy engine', voice: 'en-US:male', rate: 1, pitch: 1.8 });
  const highF0 = await medianF0(high.audio);
  check('a higher pitch raises the fundamental', highF0 > maleF0 + 20, `${maleF0.toFixed(1)} Hz -> ${highF0.toFixed(1)} Hz`);

  console.log('\nfallbacks');
  const unknown = await provider.synthesize({ text: 'Unknown voice code', voice: 'en_us_002', rate: 1, pitch: 1 });
  check('a foreign voice code still produces audio', unknown.audio.length > 0, `${unknown.audio.length} bytes`);

  const otherLang = await provider.synthesize({ text: 'Hola mundo', voice: 'es-ES:female', rate: 1, pitch: 1 });
  check('another language synthesizes', otherLang.audio.length > 0, `${otherLang.audio.length} bytes`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('check failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
