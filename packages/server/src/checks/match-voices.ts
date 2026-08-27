/**
 * Finds the Google Cloud voices closest to Tikfinity's default male/female.
 *   npm run match:voices -w @streaming/server
 *
 * Tikfinity's defaults do NOT come from Cloud TTS. They call the legacy
 * `google.com/speech-api/v2/synthesize` engine, which exposes only
 * `gender=male|female` — there is no voice id to copy across. So this instead
 * measures the reference clips and every en-US Cloud voice on the same
 * sentence, and ranks Cloud voices by acoustic closeness.
 *
 * Pitch and tempo are a shortlist, not a verdict — timbre decides, and that
 * needs ears. The companion page written at the end lets you A/B them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MPEGDecoder } from 'mpg123-decoder';
import { DATA_DIR, CONFIG_PATH, ensureDirs } from '../env.js';
import { GoogleTtsProvider } from '../tts/providers/google.js';

/** The exact parameters observed in Tikfinity's network traffic. */
const REFERENCE = {
  key: 'AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw',
  speed: '0.50',
  pitch: '0.45',
  rate: '48000',
  lang: 'en-US',
};

const SENTENCE = 'Thanks for the follow, welcome to the stream';
const OUT_DIR = path.join(DATA_DIR, 'voice-match');

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

async function fetchReference(gender: 'male' | 'female'): Promise<Buffer> {
  const url = new URL('https://www.google.com/speech-api/v2/synthesize');
  url.searchParams.set('key', REFERENCE.key);
  url.searchParams.set('enc', 'mpeg');
  url.searchParams.set('lang', REFERENCE.lang);
  url.searchParams.set('text', SENTENCE);
  url.searchParams.set('speed', REFERENCE.speed);
  url.searchParams.set('pitch', REFERENCE.pitch);
  url.searchParams.set('rate', REFERENCE.rate);
  url.searchParams.set('gender', gender);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`reference ${gender}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

interface Acoustics {
  /** Median fundamental frequency over voiced frames, in Hz. */
  medianF0: number;
  /** Fraction of frames that were voiced — a rough proxy for pace. */
  voicedRatio: number;
  durationSeconds: number;
}

/**
 * Estimates pitch by autocorrelation over 40 ms frames.
 *
 * Deliberately simple: only the median across voiced frames is used, which is
 * robust to the octave errors a naive detector makes on a minority of frames.
 */
function analyse(samples: Float32Array, sampleRate: number): Acoustics {
  const frameSize = Math.floor(sampleRate * 0.04);
  const hop = Math.floor(frameSize / 2);
  const minLag = Math.floor(sampleRate / 400); // 400 Hz ceiling
  const maxLag = Math.floor(sampleRate / 60); // 60 Hz floor

  const f0s: number[] = [];
  let voiced = 0;
  let frames = 0;

  for (let start = 0; start + frameSize < samples.length; start += hop) {
    frames += 1;
    const frame = samples.subarray(start, start + frameSize);

    let energy = 0;
    for (const value of frame) energy += value * value;
    const rms = Math.sqrt(energy / frame.length);
    if (rms < 0.01) continue; // silence

    let bestLag = -1;
    let bestScore = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let i = 0; i + lag < frame.length; i += 1) {
        sum += (frame[i] ?? 0) * (frame[i + lag] ?? 0);
      }
      const score = sum / (frame.length - lag);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    // Normalized score keeps unvoiced/noisy frames out of the median.
    if (bestLag > 0 && bestScore / (energy / frame.length) > 0.3) {
      f0s.push(sampleRate / bestLag);
      voiced += 1;
    }
  }

  f0s.sort((a, b) => a - b);
  const median = f0s.length > 0 ? (f0s[Math.floor(f0s.length / 2)] as number) : 0;

  return {
    medianF0: median,
    voicedRatio: frames > 0 ? voiced / frames : 0,
    durationSeconds: samples.length / sampleRate,
  };
}

async function decode(mp3: Buffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const result = decoder.decode(new Uint8Array(mp3));
  decoder.free();

  const left = result.channelData[0] ?? new Float32Array();
  return { samples: left, sampleRate: result.sampleRate };
}

async function measure(mp3: Buffer): Promise<Acoustics> {
  const { samples, sampleRate } = await decode(mp3);
  return analyse(samples, sampleRate);
}

interface Candidate {
  code: string;
  gender: string;
  tier: string;
  acoustics: Acoustics;
  file: string;
}

function tierOf(name: string): string {
  for (const tier of ['Chirp3-HD', 'Chirp-HD', 'Studio', 'Journey', 'Neural2', 'Polyglot', 'News', 'Wavenet', 'Standard']) {
    if (name.includes(tier)) return tier;
  }
  return 'Other';
}

async function main(): Promise<void> {
  const key = apiKey();
  if (!key) {
    console.error('No Google API key found — add one on the TTS tab or in .env.');
    process.exitCode = 1;
    return;
  }

  ensureDirs();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Fetching Tikfinity reference clips (legacy speech-api engine)…');
  const references: Record<'male' | 'female', { acoustics: Acoustics; file: string }> = {} as never;

  for (const gender of ['male', 'female'] as const) {
    const mp3 = await fetchReference(gender);
    const file = `reference-${gender}.mp3`;
    fs.writeFileSync(path.join(OUT_DIR, file), mp3);
    const acoustics = await measure(mp3);
    references[gender] = { acoustics, file };
    console.log(
      `  ${gender.padEnd(7)} median F0 ${acoustics.medianF0.toFixed(1)} Hz, ` +
        `${acoustics.durationSeconds.toFixed(2)}s`,
    );
  }

  const google = new GoogleTtsProvider({
    apiKey: key,
    defaultVoice: 'en-US-Neural2-C',
    languageCode: 'en-US',
  });

  const all = await google.listVoices();
  // Chirp voices are excluded: they reject the pitch parameter and are a very
  // different generation of model, so they'd never be the closest match here.
  const candidates = all.filter(
    (v) => v.language === 'en-US' && !/Chirp/i.test(v.code),
  );

  console.log(`\nSynthesizing the same sentence with ${candidates.length} en-US voices…`);

  const measured: Candidate[] = [];
  for (const [index, voice] of candidates.entries()) {
    try {
      // Neutral settings: the point is the voice's own character, not a shift.
      const result = await google.synthesize({ text: SENTENCE, voice: voice.code, rate: 1, pitch: 1 });
      const file = `${voice.code}.mp3`;
      fs.writeFileSync(path.join(OUT_DIR, file), result.audio);
      measured.push({
        code: voice.code,
        gender: /female/i.test(voice.name) ? 'female' : 'male',
        tier: tierOf(voice.code),
        acoustics: await measure(result.audio),
        file,
      });
      process.stdout.write('.');
    } catch {
      process.stdout.write('x');
    }
    if ((index + 1) % 40 === 0) process.stdout.write('\n');
  }

  console.log('\n');

  for (const gender of ['male', 'female'] as const) {
    const reference = references[gender].acoustics;
    const ranked = measured
      .filter((c) => c.gender === gender)
      // Compare in semitones so the distance is perceptual rather than linear.
      .map((c) => ({
        ...c,
        semitoneGap: Math.abs(Math.log2(c.acoustics.medianF0 / reference.medianF0) * 12),
      }))
      .filter((c) => Number.isFinite(c.semitoneGap))
      .sort((a, b) => a.semitoneGap - b.semitoneGap);

    console.log(`=== closest to Tikfinity's ${gender} (${reference.medianF0.toFixed(1)} Hz) ===`);
    for (const candidate of ranked.slice(0, 8)) {
      console.log(
        `  ${candidate.code.padEnd(22)} ${candidate.tier.padEnd(10)} ` +
          `${candidate.acoustics.medianF0.toFixed(1).padStart(6)} Hz  ` +
          `${candidate.semitoneGap.toFixed(2)} semitones off`,
      );
    }
    console.log('');
  }

  writeComparisonPage(references, measured);
  console.log(`Clips and a comparison page are in ${OUT_DIR}`);
  console.log('Open compare.html to listen — pitch is only a shortlist, your ear decides.');
}

/** A plain page so the candidates can be auditioned side by side. */
function writeComparisonPage(
  references: Record<'male' | 'female', { acoustics: Acoustics; file: string }>,
  measured: Candidate[],
): void {
  const row = (label: string, file: string, detail: string): string =>
    `<tr><td>${label}</td><td>${detail}</td><td><audio controls preload="none" src="${file}"></audio></td></tr>`;

  const section = (gender: 'male' | 'female'): string => {
    const reference = references[gender].acoustics;
    const ranked = measured
      .filter((c) => c.gender === gender)
      .map((c) => ({ ...c, gap: Math.abs(Math.log2(c.acoustics.medianF0 / reference.medianF0) * 12) }))
      .filter((c) => Number.isFinite(c.gap))
      .sort((a, b) => a.gap - b.gap);

    return `
      <h2>${gender}</h2>
      <table>
        <tr><th>Voice</th><th>Pitch</th><th>Listen</th></tr>
        ${row(
          '<strong>Tikfinity reference</strong>',
          references[gender].file,
          `${reference.medianF0.toFixed(1)} Hz`,
        )}
        ${ranked
          .map((c) =>
            row(
              `${c.code} <span class="tier">${c.tier}</span>`,
              c.file,
              `${c.acoustics.medianF0.toFixed(1)} Hz · ${c.gap.toFixed(2)} st off`,
            ),
          )
          .join('\n')}
      </table>`;
  };

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Voice match</title>
<style>
  body { font-family: system-ui, sans-serif; background:#0b0d13; color:#e8ecf5; padding:24px; max-width:900px; margin:0 auto; }
  table { border-collapse:collapse; width:100%; margin-bottom:32px; }
  th, td { text-align:left; padding:6px 10px; border-bottom:1px solid #232838; font-size:14px; }
  th { color:#8b93a7; font-size:12px; text-transform:uppercase; }
  tr:first-child + tr td { background:rgba(37,244,238,0.08); }
  .tier { color:#8b93a7; font-size:11px; }
  audio { height:32px; }
  p { color:#8b93a7; max-width:70ch; }
</style>
<h1>Closest Google Cloud voices to Tikfinity's defaults</h1>
<p>The highlighted row is Tikfinity's actual output, from the legacy
<code>speech-api/v2</code> engine — which has no voice id, only male/female.
Everything under it is a Google Cloud TTS voice, ordered by how close its
median pitch sits to the reference. Pitch is a shortlist; pick by ear.</p>
${section('female')}
${section('male')}`;

  fs.writeFileSync(path.join(OUT_DIR, 'compare.html'), html, 'utf8');
}

main().catch((error: unknown) => {
  console.error('match failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
