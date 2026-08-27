/**
 * Does every Google voice tier actually honour pitch and speaking rate?
 *   npx tsx packages/server/src/checks/google-pitch.ts
 *
 * Matters because the provider tells the overlay "pitch is already applied" —
 * if a tier silently ignores it, per-user pitch would do nothing at all, since
 * the browser would skip it too.
 */
import fs from 'node:fs';
import { CONFIG_PATH } from '../env.js';
import { GoogleTtsProvider } from '../tts/providers/google.js';

const TIERS = [
  'en-US-Standard-C',
  'en-US-Wavenet-C',
  'en-US-Neural2-C',
  'en-US-News-K',
  'en-US-Studio-O',
  'en-US-Polyglot-1',
  'en-US-Chirp-HD-F',
  'en-US-Chirp3-HD-Aoede',
];

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

async function main(): Promise<void> {
  const key = apiKey();
  if (!key) {
    console.error('No Google API key found.');
    process.exitCode = 1;
    return;
  }

  const google = new GoogleTtsProvider({
    apiKey: key,
    defaultVoice: 'en-US-Neural2-C',
    languageCode: 'en-US',
  });

  const text = 'The quick brown fox jumps over the lazy dog';
  console.log('voice                       neutral   pitch 0.5   rate 1.6   verdict\n');

  for (const voice of TIERS) {
    const sizes: Record<string, number | string> = {};

    for (const [label, req] of [
      ['neutral', { rate: 1, pitch: 1 }],
      ['pitch', { rate: 1, pitch: 0.5 }],
      ['rate', { rate: 1.6, pitch: 1 }],
    ] as const) {
      try {
        const result = await google.synthesize({ text, voice, ...req });
        sizes[label] = result.audio.length;
      } catch (error) {
        sizes[label] = `ERR: ${(error as Error).message.slice(0, 40)}`;
      }
    }

    const neutral = sizes.neutral;
    // Pitch shouldn't change duration much, but re-synthesis at a different
    // pitch does change the encoded bytes — identical sizes mean it was ignored.
    const pitchWorks = typeof neutral === 'number' && typeof sizes.pitch === 'number'
      ? sizes.pitch !== neutral
      : false;
    const rateWorks = typeof neutral === 'number' && typeof sizes.rate === 'number'
      ? Math.abs(sizes.rate - neutral) > neutral * 0.05
      : false;

    const verdict = typeof neutral !== 'number'
      ? 'unavailable'
      : `${pitchWorks ? 'pitch OK' : 'PITCH IGNORED'}, ${rateWorks ? 'rate OK' : 'RATE IGNORED'}`;

    console.log(
      `${voice.padEnd(26)} ${String(neutral).padEnd(9)} ${String(sizes.pitch).padEnd(11)} ${String(
        sizes.rate,
      ).padEnd(10)} ${verdict}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error('check failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
