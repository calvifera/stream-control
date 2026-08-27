/**
 * A TTS backend.
 *
 * Providers differ in what they can do natively: TikTok takes only a voice
 * code, while Google applies speaking rate and pitch server-side. Whatever a
 * provider handles itself is reported back so the overlay doesn't apply it a
 * second time — double-applied pitch is the difference between a deep voice
 * and an unintelligible one.
 */

export type ProviderId = 'tiktok' | 'google' | 'google-legacy' | 'browser';

export interface SynthesisRequest {
  text: string;
  /** Provider-specific voice identifier. */
  voice: string;
  /** Speed multiplier, 1 = unchanged. */
  rate: number;
  /** Pitch multiplier, 1 = unchanged. */
  pitch: number;
}

export interface SynthesisResult {
  audio: Buffer;
  mimeType: string;
  durationMs: number | null;
  /** True when the provider already applied `rate`; the client must not re-apply. */
  rateApplied: boolean;
  /** True when the provider already applied `pitch`. */
  pitchApplied: boolean;
}

export interface ProviderVoice {
  code: string;
  name: string;
  group: string;
  /** BCP-47 tag, when the provider is language-aware. */
  language?: string;
}

export interface TtsProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;
  /** False when required credentials are missing, so the UI can say so. */
  isConfigured(): boolean;
  /** Human explanation of what's missing, when `isConfigured()` is false. */
  configurationHint(): string;
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
  /** Voices this provider can currently use. May hit the network. */
  listVoices(): Promise<ProviderVoice[]>;
}

export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** False for credential and input problems that a retry won't fix. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TtsProviderError';
  }
}

/** Multiplier (0.5..2) to semitones, which is how Google expresses pitch. */
export function pitchMultiplierToSemitones(multiplier: number): number {
  const safe = Math.min(2, Math.max(0.5, multiplier));
  return Math.log2(safe) * 12;
}
