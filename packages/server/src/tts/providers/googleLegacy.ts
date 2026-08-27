import { createLogger, describeError } from '../../logger.js';
import {
  TtsProviderError,
  type ProviderVoice,
  type SynthesisRequest,
  type SynthesisResult,
  type TtsProviderAdapter,
} from './types.js';

const log = createLogger('tts:google-legacy');

const ENDPOINT = 'https://www.google.com/speech-api/v2/synthesize';

/**
 * Chromium's public API key, shipped in its source tree for over a decade and
 * copied into countless projects — including the TikTok tooling this was
 * modelled on. It is deliberately not a secret, and it is deliberately not
 * ours: requests are attributed to Google's own key rather than an account you
 * control. See the warning on the class below.
 */
const CHROMIUM_KEY = 'AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw';

/**
 * The endpoint's `speed` runs roughly 0.1 (slow) to 1.0 (fast) and rejects
 * anything above 1.0. 0.5 is the comfortable middle and what other tools use,
 * so it is treated as "normal" and our rate multiplier scales from there.
 */
const BASE_SPEED = 0.5;

/**
 * `pitch` runs 0..1 and moves the fundamental exponentially — measured on a
 * male clip: 0.0 -> 99 Hz, 0.45 -> 121 Hz, 0.75 -> 239 Hz, 1.0 -> 364 Hz.
 * Above ~0.45 the curve fits `F0 = base * e^(2 * (p - 0.45))`, which inverts
 * to the mapping below. 0.45 is the neutral point other tools default to.
 */
const PITCH_NEUTRAL = 0.45;
const PITCH_SLOPE = 2.0;

/** Languages confirmed to return audio. Others may work; these were tested. */
const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Español' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'hi-IN', label: 'हिन्दी' },
];

export interface GoogleLegacyConfig {
  /** Fallback when a rule doesn't name a voice. */
  defaultVoice: string;
}

/**
 * The unofficial `speech-api/v2` engine — the one behind the "default male /
 * female" voices in some other stream tools.
 *
 * It needs no credentials because it rides Chromium's public API key. That is
 * exactly the catch: the quota is not yours, Google can throttle or revoke it
 * without notice (the speech-to-*text* half of the same key already was), and
 * using a key that wasn't issued to you sits outside Google's terms. It also
 * offers only two voices per language.
 *
 * Kept as an option because it is instant to use and costs nothing, but
 * `google` (Cloud TTS) is the one to build on.
 */
export class GoogleLegacyProvider implements TtsProviderAdapter {
  readonly id = 'google-legacy' as const;
  readonly name = 'Google Translate voices (unofficial)';

  constructor(private config: GoogleLegacyConfig) {}

  setConfig(config: GoogleLegacyConfig): void {
    this.config = config;
  }

  /** No credentials needed — that is the whole appeal, and the whole problem. */
  isConfigured(): boolean {
    return true;
  }

  configurationHint(): string {
    return 'No setup needed. Uses a public key that is not yours and can stop working without notice.';
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    const text = request.text.trim();
    if (!text) throw new TtsProviderError('Nothing to speak', 'empty_text', false);

    const { language, gender } = parseVoice(request.voice.trim() || this.config.defaultVoice);

    const url = new URL(ENDPOINT);
    url.searchParams.set('key', CHROMIUM_KEY);
    url.searchParams.set('enc', 'mpeg');
    url.searchParams.set('rate', '48000');
    url.searchParams.set('lang', language);
    url.searchParams.set('text', text);
    url.searchParams.set('gender', gender);
    url.searchParams.set('speed', String(rateToSpeed(request.rate)));
    url.searchParams.set('pitch', String(multiplierToPitch(request.pitch)));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new TtsProviderError(
        aborted ? 'Legacy TTS request timed out' : describeError(error),
        aborted ? 'timeout' : 'network',
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 403 || response.status === 401) {
      // The expected way this dies: Google revokes or restricts the key.
      throw new TtsProviderError(
        'The public Chromium key was refused — it may finally have been revoked. Switch to Google Cloud TTS.',
        'key_revoked',
        false,
      );
    }
    if (response.status === 429) {
      throw new TtsProviderError('Rate limited on the shared public key', 'quota', true);
    }
    if (!response.ok) {
      throw new TtsProviderError(
        `Legacy endpoint returned HTTP ${response.status}`,
        'http',
        response.status >= 500,
      );
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) {
      throw new TtsProviderError('Legacy endpoint returned no audio', 'empty', true);
    }

    return {
      audio,
      mimeType: 'audio/mpeg',
      durationMs: null,
      // Both are real query parameters on this endpoint, applied during
      // synthesis, so the browser must not touch them again.
      rateApplied: true,
      pitchApplied: true,
    };
  }

  /**
   * Two voices per language, which is the whole catalogue. `neutral` and even
   * a nonsense gender return the female voice, so only male is distinct.
   */
  async listVoices(): Promise<ProviderVoice[]> {
    return LANGUAGES.flatMap((language) =>
      (['female', 'male'] as const).map((gender) => ({
        code: `${language.code}:${gender}`,
        name: `${language.label} — ${gender}`,
        group: language.label,
        language: language.code,
      })),
    );
  }
}

/** Voice codes are `<lang>:<gender>`, e.g. `en-US:male`. */
function parseVoice(voice: string): { language: string; gender: 'male' | 'female' } {
  const [language, gender] = voice.split(':');
  if (!language || !/^[a-z]{2,3}-[A-Z]{2}$/.test(language)) {
    log.debug(`"${voice}" is not a legacy voice code; falling back to en-US female`);
    return { language: 'en-US', gender: 'female' };
  }
  return { language, gender: gender === 'male' ? 'male' : 'female' };
}

/** Our rate multiplier (1 = normal) onto the endpoint's 0.1..1.0 speed. */
export function rateToSpeed(rate: number): number {
  const scaled = BASE_SPEED * Math.min(2, Math.max(0.5, rate));
  return Number(Math.min(1, Math.max(0.1, scaled)).toFixed(3));
}

/**
 * Our pitch multiplier (1 = unchanged) onto the endpoint's 0..1 pitch.
 *
 * Shifting down is limited: the parameter bottoms out around 99 Hz on a male
 * voice, so a 0.5x request clamps rather than reaching it.
 */
export function multiplierToPitch(multiplier: number): number {
  const safe = Math.min(2, Math.max(0.5, multiplier));
  const raw = PITCH_NEUTRAL + Math.log(safe) / PITCH_SLOPE;
  return Number(Math.min(1, Math.max(0, raw)).toFixed(3));
}
