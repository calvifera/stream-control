/**
 * Loudness matching for TTS playback.
 *
 * Every speech provider returns audio that is peak-normalised but not
 * loudness-normalised. A measured clip from Google peaked at -2.1 dBFS while
 * averaging -21.0 dBFS — a 19 dB crest factor. Game audio and music are
 * heavily compressed, so they sit at a similar peak but a far higher average,
 * and speech dropped next to them sounds much quieter even at "full" volume.
 * Turning the volume up does not fix it: the peaks are already near 0 dBFS,
 * so it just clips.
 *
 * The chain below compresses first and makes up the difference afterwards,
 * with a limiter and a trim to guarantee headroom. Measured on the same clip:
 *
 *   raw                      peak  -2.1 dBFS   rms -21.0 dBFS
 *   compressed, +8 dB        peak  -0.9 dBFS   rms -13.2 dBFS
 *
 * — about 7.8 dB of extra perceived loudness with nothing clipped.
 */
export interface LoudnessOptions {
  enabled: boolean;
  /** Make-up gain in dB. 0 leaves the clip alone apart from the compressor. */
  gainDb: number;
}

/** Ceiling the limiter aims for, leaving a little room below full scale. */
const LIMIT_THRESHOLD_DB = -3;
const OUTPUT_TRIM_DB = -1;

const toGain = (db: number): number => 10 ** (db / 20);

/**
 * Builds compressor -> make-up -> limiter -> trim and returns the node to
 * feed. Connect a source to `input`; the chain is already wired to the
 * destination.
 *
 * When disabled it returns a plain gain node so callers do not need two paths.
 */
export function createLoudnessChain(
  context: AudioContext | OfflineAudioContext,
  options: LoudnessOptions,
): AudioNode {
  if (!options.enabled) {
    const passthrough = context.createGain();
    passthrough.connect(context.destination);
    return passthrough;
  }

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -30;
  compressor.knee.value = 6;
  compressor.ratio.value = 6;
  // Fast enough to catch a plosive, slow enough not to pump on speech.
  compressor.attack.value = 0.003;
  compressor.release.value = 0.12;

  const makeup = context.createGain();
  makeup.gain.value = toGain(options.gainDb);

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = LIMIT_THRESHOLD_DB;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;

  // The Web Audio compressor is not a brickwall, so transients still creep
  // over the threshold. A small fixed trim buys the headroom back.
  const trim = context.createGain();
  trim.gain.value = toGain(OUTPUT_TRIM_DB);

  compressor.connect(makeup).connect(limiter).connect(trim).connect(context.destination);
  return compressor;
}
