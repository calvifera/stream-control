/**
 * Pitch and speed control for TTS playback.
 *
 * `HTMLAudioElement.playbackRate` alone can only trade one for the other, so
 * per-user pitch needs real resampling. The approach here is the standard
 * two-step: time-stretch the audio by a factor using overlap-add, then play it
 * back resampled by the same factor. The stretch and the resample cancel out
 * in duration while the resample carries the pitch, which gives independent
 * control of the two.
 *
 *   want pitch x P and speed x R
 *     -> time-stretch by (P / R), then playbackRate = P
 *     -> duration  = (P / R) / P = 1 / R   ✓ (faster when R > 1)
 *     -> pitch     = P                     ✓
 *
 * Overlap-add on speech at these ratios is not transparent, but for a chipmunk
 * or a demon voice — which is what this is for — it holds up fine.
 */
import { createLoudnessChain, type LoudnessOptions } from './loudness.js';

/** Grain length in seconds. Long enough to keep pitch, short enough to avoid echo. */
const GRAIN_SECONDS = 0.082;

let sharedContext: AudioContext | null = null;

export function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

/** True when the item needs Web Audio rather than a plain <audio> element. */
export function needsPitchShift(pitch: number): boolean {
  return Math.abs(pitch - 1) > 0.01;
}

/**
 * Overlap-add time stretch. `factor` > 1 makes the buffer longer without
 * changing pitch; < 1 makes it shorter.
 */
function timeStretch(context: BaseAudioContext, input: AudioBuffer, factor: number): AudioBuffer {
  if (Math.abs(factor - 1) < 0.001) return input;

  const sampleRate = input.sampleRate;
  const grain = Math.max(256, Math.round(GRAIN_SECONDS * sampleRate));
  const overlap = Math.round(grain / 2);
  // Analysis hop moves through the source; synthesis hop writes the output.
  const synthesisHop = grain - overlap;
  const analysisHop = Math.max(1, Math.round(synthesisHop / factor));

  const outputLength = Math.max(1, Math.round(input.length * factor));
  const output = context.createBuffer(input.numberOfChannels, outputLength, sampleRate);

  // Hann window, applied on both read and write so overlapping grains sum flat.
  const window = new Float32Array(grain);
  for (let i = 0; i < grain; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grain - 1)));
  }

  for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
    const source = input.getChannelData(channel);
    const target = output.getChannelData(channel);
    const weights = new Float32Array(outputLength);

    let readAt = 0;
    let writeAt = 0;

    while (writeAt + grain < outputLength && readAt + grain < source.length) {
      for (let i = 0; i < grain; i += 1) {
        const w = window[i] ?? 0;
        target[writeAt + i] = (target[writeAt + i] ?? 0) + (source[readAt + i] ?? 0) * w;
        weights[writeAt + i] = (weights[writeAt + i] ?? 0) + w;
      }
      readAt += analysisHop;
      writeAt += synthesisHop;
    }

    // Normalize by accumulated window weight so overlaps don't get louder.
    for (let i = 0; i < outputLength; i += 1) {
      const weight = weights[i] ?? 0;
      if (weight > 0.0001) target[i] = (target[i] ?? 0) / weight;
    }
  }

  return output;
}

export interface PitchedPlayback {
  stop: () => void;
}

/**
 * Decodes and plays a clip with independent pitch and speed.
 * Resolves the returned handle immediately; `onEnded` fires when playback stops.
 */
export async function playWithPitch(
  url: string,
  options: { pitch: number; rate: number; volume: number; loudness?: LoudnessOptions },
  onEnded: () => void,
): Promise<PitchedPlayback> {
  const context = audioContext();
  if (context.state === 'suspended') await context.resume();

  const response = await fetch(url);
  const encoded = await response.arrayBuffer();
  const decoded = await context.decodeAudioData(encoded);

  const pitch = Math.min(2, Math.max(0.5, options.pitch));
  const rate = Math.min(2, Math.max(0.5, options.rate));

  const stretched = timeStretch(context, decoded, pitch / rate);

  const source = context.createBufferSource();
  source.buffer = stretched;
  source.playbackRate.value = pitch;

  const gain = context.createGain();
  gain.gain.value = Math.min(1, Math.max(0, options.volume));

  // Same loudness chain the plain <audio> path uses, so a pitch-shifted voice
  // does not come out noticeably quieter than an unshifted one.
  const output = createLoudnessChain(context, options.loudness ?? { enabled: false, gainDb: 0 });
  source.connect(gain).connect(output);
  source.onended = onEnded;
  source.start();

  return {
    stop: () => {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    },
  };
}
