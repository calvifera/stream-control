/**
 * Characterizes the legacy `speech-api/v2/synthesize` endpoint.
 *   npx tsx packages/server/src/checks/probe-legacy.ts
 *
 * Establishes what the parameters actually do before wiring it up as a
 * provider: whether `pitch` changes anything measurable, how long the text can
 * be, and which languages answer.
 */
import { MPEGDecoder } from 'mpg123-decoder';

const KEY = 'AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw';
const ENDPOINT = 'https://www.google.com/speech-api/v2/synthesize';

async function fetchClip(params: Record<string, string>): Promise<Buffer | string> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('key', KEY);
  url.searchParams.set('enc', 'mpeg');
  url.searchParams.set('rate', '48000');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url);
  if (!response.ok) return `HTTP ${response.status}`;
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length === 0 ? 'empty body' : buffer;
}

/** Median F0 by autocorrelation — same method as the voice matcher. */
async function medianF0(mp3: Buffer): Promise<number> {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const decoded = decoder.decode(new Uint8Array(mp3));
  decoder.free();

  const samples = decoded.channelData[0] ?? new Float32Array();
  const sampleRate = decoded.sampleRate;
  const frameSize = Math.floor(sampleRate * 0.04);
  const hop = Math.floor(frameSize / 2);
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 60);
  const f0s: number[] = [];

  for (let start = 0; start + frameSize < samples.length; start += hop) {
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

const TEXT = 'The quick brown fox jumps over the lazy dog';

async function main(): Promise<void> {
  console.log('does `pitch` change the fundamental frequency?\n');
  for (const pitch of ['0.0', '0.25', '0.45', '0.75', '1.0']) {
    const clip = await fetchClip({ lang: 'en-US', text: TEXT, speed: '0.5', pitch, gender: 'male' });
    if (typeof clip === 'string') {
      console.log(`  pitch=${pitch.padEnd(5)} ${clip}`);
      continue;
    }
    console.log(
      `  pitch=${pitch.padEnd(5)} ${String(clip.length).padStart(6)} bytes   F0 ${(
        await medianF0(clip)
      ).toFixed(1)} Hz`,
    );
  }

  console.log('\ndoes `speed` change duration?\n');
  for (const speed of ['0.3', '0.5', '0.8', '1.0', '1.5']) {
    const clip = await fetchClip({ lang: 'en-US', text: TEXT, speed, pitch: '0.45', gender: 'male' });
    console.log(
      typeof clip === 'string'
        ? `  speed=${speed.padEnd(5)} ${clip}`
        : `  speed=${speed.padEnd(5)} ${String(clip.length).padStart(6)} bytes`,
    );
  }

  console.log('\nhow long can the text be?\n');
  for (const length of [100, 200, 300, 500, 1000, 2000]) {
    const clip = await fetchClip({
      lang: 'en-US',
      text: 'word '.repeat(Math.ceil(length / 5)).slice(0, length),
      speed: '0.5',
      pitch: '0.45',
      gender: 'female',
    });
    console.log(
      typeof clip === 'string'
        ? `  ${String(length).padStart(5)} chars  ${clip}`
        : `  ${String(length).padStart(5)} chars  ${String(clip.length).padStart(7)} bytes  ok`,
    );
  }

  console.log('\nwhich languages answer?\n');
  for (const lang of ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU', 'hi-IN']) {
    const clip = await fetchClip({ lang, text: 'hello world', speed: '0.5', pitch: '0.45', gender: 'female' });
    console.log(
      typeof clip === 'string'
        ? `  ${lang.padEnd(7)} ${clip}`
        : `  ${lang.padEnd(7)} ${String(clip.length).padStart(6)} bytes  ok`,
    );
  }

  console.log('\ndoes gender actually differ?\n');
  for (const gender of ['male', 'female', 'neutral', 'bogus']) {
    const clip = await fetchClip({ lang: 'en-US', text: TEXT, speed: '0.5', pitch: '0.45', gender });
    console.log(
      typeof clip === 'string'
        ? `  ${gender.padEnd(8)} ${clip}`
        : `  ${gender.padEnd(8)} F0 ${(await medianF0(clip)).toFixed(1)} Hz`,
    );
  }
}

main().catch((error: unknown) => {
  console.error('probe failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
