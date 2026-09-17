import {
  approxCents,
  bracketFor,
  builtinSoundId,
  type BuiltinSoundId,
  type GiftShowcaseEvent,
  type GiftSoundSettings,
} from '@streaming/shared';

/**
 * The built-in gift sounds, synthesized with Web Audio.
 *
 * Every sound runs through the same small chain — a touch of reverb and a
 * limiter — so they sound like one set rather than eight clips from eight
 * places, and so a jackpot landing on top of three coins does not clip.
 *
 * What makes these satisfying rather than merely audible: notes come from
 * one major key, so overlapping gifts harmonise instead of clashing; every
 * note has a fast attack and an exponential tail, which reads as struck
 * rather than switched on; and each bracket up adds register, length and
 * layers, so the size of a gift can be heard without looking.
 */

let ctx: AudioContext | null = null;
let input: GainNode | null = null;

/** Seconds of reverb tail. Long enough to feel roomy, short enough to stay out of speech. */
const REVERB_SECONDS = 1.6;
const REVERB_MIX = 0.22;

function impulse(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * REVERB_SECONDS);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
  }
  return buffer;
}

/** Builds the shared chain on first use. Null where Web Audio is unavailable. */
function chain(): { context: AudioContext; bus: GainNode } | null {
  if (ctx && input) return { context: ctx, bus: input };
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  ctx = new Ctor();
  input = ctx.createGain();

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  limiter.connect(ctx.destination);

  const dry = ctx.createGain();
  dry.gain.value = 1 - REVERB_MIX;
  const wet = ctx.createGain();
  wet.gain.value = REVERB_MIX;
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx);

  input.connect(dry).connect(limiter);
  input.connect(reverb).connect(wet).connect(limiter);
  return { context: ctx, bus: input };
}

/* ------------------------------------------------------------ Building blocks */

interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  /** Glide to this frequency over the note, for pops and sweeps. */
  freqEnd?: number;
  start: number;
  duration: number;
  gain: number;
  attack?: number;
  /** Low-pass cutoff, to soften square and saw waves. */
  cutoff?: number;
  detune?: number;
}

function tone(context: AudioContext, out: AudioNode, o: ToneOptions): void {
  const osc = context.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, o.start);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, o.start + o.duration * 0.6);
  if (o.detune) osc.detune.value = o.detune;

  const env = context.createGain();
  const attack = o.attack ?? 0.004;
  env.gain.setValueAtTime(0.0001, o.start);
  env.gain.linearRampToValueAtTime(o.gain, o.start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, o.start + o.duration);

  let node: AudioNode = osc;
  if (o.cutoff) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = o.cutoff;
    osc.connect(filter);
    node = filter;
  }
  node.connect(env).connect(out);
  osc.start(o.start);
  osc.stop(o.start + o.duration + 0.05);
}

/** A struck bell: a few inharmonic partials, the high ones dying first. */
function bell(context: AudioContext, out: AudioNode, freq: number, start: number, duration: number, gain: number): void {
  const partials: Array<[number, number]> = [
    [1, 1],
    [2.01, 0.42],
    [3.02, 0.2],
    [4.18, 0.1],
  ];
  for (const [ratio, level] of partials) {
    tone(context, out, { freq: freq * ratio, start, duration: duration / ratio ** 0.6, gain: gain * level, attack: 0.002 });
  }
}

/** Notes of C major, by name, so the sounds stay in one key and harmonise. */
const N = {
  G4: 392,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  A5: 880,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
  G6: 1567.98,
  A6: 1760,
  C7: 2093,
  E7: 2637,
};

/* ------------------------------------------------------------------ Sounds */

type Voice = (context: AudioContext, out: AudioNode, t: number) => void;

const VOICES: Record<BuiltinSoundId, Voice> = {
  pop: (c, out, t) => {
    tone(c, out, { freq: 420, freqEnd: 1250, start: t, duration: 0.11, gain: 0.55 });
    tone(c, out, { freq: 700, freqEnd: 1900, start: t + 0.065, duration: 0.09, gain: 0.25 });
  },

  bubbles: (c, out, t) => {
    [N.E5, N.A5, N.E6].forEach((freq, i) =>
      tone(c, out, { freq: freq * 0.7, freqEnd: freq, start: t + i * 0.075, duration: 0.14, gain: 0.35 }),
    );
  },

  coin: (c, out, t) => {
    tone(c, out, { type: 'square', freq: 987.77, start: t, duration: 0.09, gain: 0.21, cutoff: 5000 });
    tone(c, out, { type: 'square', freq: N.E6, start: t + 0.075, duration: 0.42, gain: 0.21, cutoff: 5000 });
    tone(c, out, { freq: N.E7, start: t + 0.075, duration: 0.3, gain: 0.05 });
  },

  chime: (c, out, t) => {
    [N.C6, N.E6, N.G6].forEach((freq, i) => bell(c, out, freq, t + i * 0.07, 1.5, 0.22));
  },

  sparkle: (c, out, t) => {
    const run = [N.E6, N.G6, N.A6, N.C7, N.E7];
    run.forEach((freq, i) =>
      tone(c, out, { type: 'triangle', freq, start: t + i * 0.045, duration: 0.28, gain: 0.16 }),
    );
    bell(c, out, N.C7, t + run.length * 0.045, 1.4, 0.2);
    bell(c, out, N.G6, t + run.length * 0.045 + 0.02, 1.2, 0.12);
  },

  levelup: (c, out, t) => {
    const arp = [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6];
    arp.forEach((freq, i) =>
      tone(c, out, { type: 'square', freq, start: t + i * 0.06, duration: 0.18, gain: 0.09, cutoff: 3500 }),
    );
    const land = t + arp.length * 0.06;
    [N.C6, N.E6, N.G6, N.C7].forEach((freq) => bell(c, out, freq, land, 1.8, 0.14));
    tone(c, out, { type: 'triangle', freq: N.C5, start: land, duration: 1.2, gain: 0.18 });
  },

  fanfare: (c, out, t) => {
    // Brass: detuned saws through a low-pass, a pickup into a held chord.
    const brass = (freq: number, start: number, duration: number, gain: number): void => {
      for (const detune of [-6, 6]) {
        tone(c, out, { type: 'sawtooth', freq, start, duration, gain, attack: 0.02, cutoff: 2600, detune });
      }
    };
    brass(N.G4, t, 0.14, 0.09);
    brass(N.C5, t + 0.15, 0.14, 0.09);
    brass(N.E5, t + 0.3, 0.14, 0.09);
    for (const freq of [N.C5, N.E5, N.G5]) brass(freq, t + 0.45, 1.1, 0.08);
    VOICES.sparkle(c, out, t + 0.55);
  },

  jackpot: (c, out, t) => {
    VOICES.fanfare(c, out, t);
    // A cascade of coins, pitched from the same key so it shimmers, not clatters.
    const pitches = [N.E6, N.G6, N.A6, N.C7];
    for (let i = 0; i < 14; i += 1) {
      const start = t + 0.5 + i * 0.085 + Math.random() * 0.03;
      const freq = pitches[Math.floor(Math.random() * pitches.length)] as number;
      tone(c, out, { type: 'square', freq: freq * 0.75, start, duration: 0.06, gain: 0.06, cutoff: 6000 });
      tone(c, out, { type: 'square', freq, start: start + 0.05, duration: 0.2, gain: 0.06, cutoff: 6000 });
    }
    const finale = t + 1.75;
    [N.C6, N.E6, N.G6, N.C7, N.E7].forEach((freq, i) => bell(c, out, freq, finale + i * 0.02, 2.4, 0.13));
    tone(c, out, { type: 'triangle', freq: N.C5 / 2, start: finale, duration: 1.8, gain: 0.25 });
  },
};

/* ---------------------------------------------------------------- Playback */

/**
 * Plays a built-in sound or an audio URL, at 0–1 volume.
 *
 * Safe to call anywhere: without Web Audio, or before a normal browser tab
 * has been clicked, it simply does nothing. OBS browser sources allow audio
 * without a click.
 */
export function playSound(sound: string, volume: number): void {
  if (!sound || volume <= 0) return;

  const id = builtinSoundId(sound);
  if (!id) {
    const audio = new Audio(sound);
    audio.volume = Math.min(1, volume);
    void audio.play().catch(() => undefined);
    return;
  }

  const audio = chain();
  if (!audio) return;
  const { context, bus } = audio;
  if (context.state === 'suspended') void context.resume().catch(() => undefined);

  const level = context.createGain();
  level.gain.value = Math.min(1, volume);
  level.connect(bus);
  VOICES[id](context, level, context.currentTime + 0.02);
  // Detach once every voice has finished, so nodes do not pile up over a stream.
  window.setTimeout(() => level.disconnect(), 5000);
}

/**
 * The sound a gift earns by its price bracket, or null for none.
 *
 * Returned rather than played so a caller can let a media rule's own sound
 * win, and play at the moment its card actually appears.
 */
export function bracketSound(
  event: GiftShowcaseEvent,
  settings: GiftSoundSettings | undefined,
): { sound: string; volume: number } | null {
  if (!settings?.enabled) return null;
  const bracket = bracketFor(approxCents(event), settings.brackets);
  if (!bracket?.sound) return null;
  return { sound: bracket.sound, volume: settings.volume * bracket.volume };
}
