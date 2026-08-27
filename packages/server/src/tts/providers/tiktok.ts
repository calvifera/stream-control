import { TTS_VOICES } from '@streaming/shared';
import { synthesizeWithTikTok, TtsError } from '../tiktokProvider.js';
import {
  TtsProviderError,
  type ProviderVoice,
  type SynthesisRequest,
  type SynthesisResult,
  type TtsProviderAdapter,
} from './types.js';

export interface TikTokTtsConfig {
  sessionId: string;
  apiBaseUrl: string;
}

/**
 * Adapter over the existing TikTok implementation.
 *
 * TikTok's endpoint takes only a voice code — no rate or pitch parameters — so
 * both are reported as unapplied and get handled in the browser instead.
 */
export class TikTokTtsProvider implements TtsProviderAdapter {
  readonly id = 'tiktok' as const;
  readonly name = 'TikTok TTS';

  constructor(private config: TikTokTtsConfig) {}

  setConfig(config: TikTokTtsConfig): void {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.sessionId.trim().length > 0;
  }

  configurationHint(): string {
    return 'Add your TikTok sessionid cookie (TIKTOK_SESSION_ID, or paste one on the TTS tab).';
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    try {
      const result = await synthesizeWithTikTok(request.text, request.voice, {
        sessionId: this.config.sessionId,
        baseUrl: this.config.apiBaseUrl,
      });

      return {
        audio: result.audio,
        mimeType: result.mimeType,
        durationMs: result.durationMs,
        rateApplied: false,
        pitchApplied: false,
      };
    } catch (error) {
      if (error instanceof TtsError) {
        throw new TtsProviderError(error.message, error.code, error.retryable);
      }
      throw error;
    }
  }

  /** Static catalogue: TikTok has no endpoint that enumerates voices. */
  async listVoices(): Promise<ProviderVoice[]> {
    return TTS_VOICES.map((voice) => ({
      code: voice.code,
      name: voice.name,
      group: voice.group,
    }));
  }
}
