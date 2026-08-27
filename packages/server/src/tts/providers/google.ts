import { createLogger, describeError } from '../../logger.js';
import {
  pitchMultiplierToSemitones,
  TtsProviderError,
  type ProviderVoice,
  type SynthesisRequest,
  type SynthesisResult,
  type TtsProviderAdapter,
} from './types.js';

const log = createLogger('tts:google');

const SYNTH_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const VOICES_URL = 'https://texttospeech.googleapis.com/v1/voices';

/** Google's documented ceiling is 5000 bytes of input per request. */
const MAX_INPUT_BYTES = 4500;

interface GoogleVoice {
  languageCodes?: string[];
  name?: string;
  ssmlGender?: string;
  naturalSampleRateHertz?: number;
}

interface GoogleError {
  error?: { code?: number; message?: string; status?: string };
}

export interface GoogleTtsConfig {
  apiKey: string;
  /** Fallback when a rule doesn't name a voice. */
  defaultVoice: string;
  /** Used to pick a voice when only a gender is known. */
  languageCode: string;
}

/**
 * Google Cloud Text-to-Speech.
 *
 * Unlike TikTok's internal endpoint this is a supported, documented API: it
 * enumerates its own voices, applies pitch and speaking rate server-side, and
 * doesn't move hosts. The free tier (4M characters/month for standard voices,
 * 1M for Neural2/WaveNet) is far past what a stream reads aloud.
 */
export class GoogleTtsProvider implements TtsProviderAdapter {
  readonly id = 'google' as const;
  readonly name = 'Google Cloud TTS';

  private voiceCache: { voices: ProviderVoice[]; fetchedAt: number } | null = null;
  /** Voice codes already warned about, so one bad rule doesn't spam the log. */
  private warned = new Set<string>();

  constructor(private config: GoogleTtsConfig) {}

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    log.warn(message);
  }

  setConfig(config: GoogleTtsConfig): void {
    if (config.apiKey !== this.config.apiKey) this.voiceCache = null;
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.apiKey.trim().length > 0;
  }

  configurationHint(): string {
    return 'Add a Google Cloud API key with the Text-to-Speech API enabled (GOOGLE_TTS_API_KEY, or paste one on the TTS tab).';
  }

  private key(): string {
    const key = this.config.apiKey.trim();
    if (!key) {
      throw new TtsProviderError(this.configurationHint(), 'no_credentials', false);
    }
    return key;
  }

  /** Maps Google's error envelope onto our retry semantics. */
  private toError(status: number, body: string): TtsProviderError {
    let message = body.slice(0, 200);
    let reason = '';
    try {
      const parsed = JSON.parse(body) as GoogleError;
      message = parsed.error?.message ?? message;
      reason = parsed.error?.status ?? '';
    } catch {
      /* keep the raw slice */
    }

    // Distinguished so `synthesize` can retry without the pitch parameter
    // rather than failing the clip outright.
    if (status === 400 && /pitch/i.test(message)) {
      return new TtsProviderError(`Voice does not support pitch: ${message}`, 'pitch_unsupported', false);
    }
    if (status === 400 && /voice/i.test(message)) {
      return new TtsProviderError(`Google rejected the voice: ${message}`, 'bad_voice', false);
    }
    if (status === 400) {
      return new TtsProviderError(`Google rejected the request: ${message}`, 'bad_request', false);
    }
    if (status === 401 || status === 403) {
      return new TtsProviderError(
        `Google refused the API key (${reason || status}): ${message}`,
        'bad_credentials',
        false,
      );
    }
    if (status === 429) {
      return new TtsProviderError(`Google rate limit or quota reached: ${message}`, 'quota', true);
    }
    return new TtsProviderError(`Google returned HTTP ${status}: ${message}`, 'http', status >= 500);
  }

  /**
   * Synthesizes, correcting itself from Google's own errors rather than
   * guessing up front.
   *
   * Two things can only be known by asking: whether a voice name is real (the
   * catalogue includes bare aliases like `Aoede` alongside `en-US-Neural2-C`,
   * so no naming rule covers it), and whether a voice accepts pitch. Both are
   * cheap to retry and impossible to predict reliably, so the happy path sends
   * the request as-is and a rejection drives one corrective retry.
   */
  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    try {
      return await this.request(request, supportsPitch(request.voice.trim()));
    } catch (error) {
      if (!(error instanceof TtsProviderError)) throw error;

      // The voice refuses pitch — resend without it and let the browser shift.
      if (error.code === 'pitch_unsupported') {
        return this.request(request, false);
      }

      // The voice doesn't exist here: usually a code left behind by another
      // backend, e.g. a TikTok `en_us_002` after switching providers.
      const requested = request.voice.trim();
      if (error.code === 'bad_voice' && requested && requested !== this.config.defaultVoice) {
        this.warnOnce(
          requested,
          `"${requested}" is not a Google voice — using ${this.config.defaultVoice}. ` +
            'Update the rule or profile to a Google voice.',
        );
        const fallback = { ...request, voice: this.config.defaultVoice };
        return this.request(fallback, supportsPitch(this.config.defaultVoice));
      }

      throw error;
    }
  }

  private async request(request: SynthesisRequest, pitchable: boolean): Promise<SynthesisResult> {
    const key = this.key();
    const text = request.text.trim();
    if (!text) throw new TtsProviderError('Nothing to speak', 'empty_text', false);

    if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
      throw new TtsProviderError(
        `Text is longer than Google's ${MAX_INPUT_BYTES}-byte limit`,
        'too_long',
        false,
      );
    }

    const voice = request.voice.trim() || this.config.defaultVoice;

    // Full names embed their language ("en-US-Neural2-A"); the short aliases
    // don't, so fall back to the configured language for those.
    const languageCode = deriveLanguage(voice) ?? this.config.languageCode;
    const wantsPitchShift = Math.abs(request.pitch - 1) > 0.01;

    const audioConfig: Record<string, unknown> = {
      audioEncoding: 'MP3',
      // Google clamps these itself, but staying inside the documented
      // ranges keeps a wild profile from being rejected outright.
      speakingRate: clamp(request.rate, 0.25, 4),
    };
    // Omitted entirely for tiers that reject or ignore it — see supportsPitch.
    if (pitchable) {
      audioConfig.pitch = clamp(pitchMultiplierToSemitones(request.pitch), -20, 20);
    } else if (wantsPitchShift) {
      log.debug(`${voice} cannot shift pitch server-side; leaving it to the browser`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    let response: Response;
    try {
      response = await fetch(`${SYNTH_URL}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          input: { text },
          voice: { languageCode, name: voice },
          audioConfig,
        }),
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      throw new TtsProviderError(
        aborted ? 'Google TTS request timed out' : describeError(error),
        aborted ? 'timeout' : 'network',
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.text();
    if (!response.ok) throw this.toError(response.status, body);

    let audioContent: string | undefined;
    try {
      audioContent = (JSON.parse(body) as { audioContent?: string }).audioContent;
    } catch {
      throw new TtsProviderError('Google returned a non-JSON response', 'bad_response', true);
    }

    if (!audioContent) {
      throw new TtsProviderError('Google returned no audio', 'empty', true);
    }

    return {
      audio: Buffer.from(audioContent, 'base64'),
      mimeType: 'audio/mpeg',
      durationMs: null,
      // Rate is honoured by every tier. Pitch only by some, and saying it was
      // applied when it wasn't would drop the shift on the floor entirely.
      rateApplied: true,
      pitchApplied: pitchable,
    };
  }

  /**
   * Google exposes an official voice list, so unlike the TikTok catalogue this
   * is always accurate for the key in use. Cached for an hour.
   */
  async listVoices(): Promise<ProviderVoice[]> {
    if (this.voiceCache && Date.now() - this.voiceCache.fetchedAt < 60 * 60 * 1000) {
      return this.voiceCache.voices;
    }

    const key = this.key();
    const response = await fetch(`${VOICES_URL}?key=${encodeURIComponent(key)}`);
    const body = await response.text();
    if (!response.ok) throw this.toError(response.status, body);

    const parsed = JSON.parse(body) as { voices?: GoogleVoice[] };
    const named = (parsed.voices ?? []).filter(
      (voice): voice is GoogleVoice & { name: string } => Boolean(voice.name),
    );

    /**
     * `voices.list` also returns bare aliases for the Chirp3 voices ("Aoede"
     * next to "en-US-Chirp3-HD-Aoede"), but `text:synthesize` rejects the bare
     * form — so listing them would offer choices that silently fail. They are
     * dropped by looking for the full-name twin rather than by guessing at the
     * naming, which would also catch legitimate oddities like
     * `fil-ph-Neural2-A`.
     */
    const allNames = new Set(named.map((voice) => voice.name));
    const isUnusableAlias = (voice: GoogleVoice & { name: string }): boolean =>
      (voice.languageCodes ?? []).some((lang) => allNames.has(`${lang}-Chirp3-HD-${voice.name}`));

    const voices: ProviderVoice[] = named
      .filter((voice) => !isUnusableAlias(voice))
      .map((voice) => {
        const language = voice.languageCodes?.[0] ?? '';
        const gender = (voice.ssmlGender ?? '').toLowerCase();
        return {
          code: voice.name,
          name: `${voice.name}${gender ? ` (${gender})` : ''}`,
          group: `${language}${tierOf(voice.name) ? ` · ${tierOf(voice.name)}` : ''}`,
          language,
        };
      })
      .sort((a, b) => a.group.localeCompare(b.group) || a.code.localeCompare(b.code));

    log.info(`Google exposes ${voices.length} voices for this key`);
    this.voiceCache = { voices, fetchedAt: Date.now() };
    return voices;
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Not every tier accepts a pitch adjustment, and they disagree about how to
 * say so — verified by synthesizing one line per tier:
 *
 *   Standard / Wavenet / Neural2 / News  pitch honoured
 *   Studio / Polyglot                    pitch silently ignored
 *   Chirp-HD / Chirp3-HD                 request REJECTED outright
 *
 * The Chirp case is the dangerous one: sending pitch to the newest and
 * best-sounding voices fails the whole clip. So the parameter is omitted for
 * anything that can't use it, and the caller applies pitch in the browser
 * instead — the shift still happens, just downstream.
 *
 * Speaking rate is accepted by every tier.
 */
function supportsPitch(voiceName: string): boolean {
  return !/Chirp|Studio|Polyglot/i.test(voiceName);
}

/**
 * "en-US-Neural2-A" -> "en-US". Case-insensitive on the region, because the
 * catalogue is not consistent about it (`fil-ph-Neural2-A`).
 */
function deriveLanguage(voiceName: string): string | null {
  const match = /^([a-z]{2,3}-[a-z]{2})/i.exec(voiceName);
  return match?.[1] ?? null;
}


/** Groups the catalogue by quality tier, which is also the pricing tier. */
function tierOf(voiceName: string): string {
  for (const tier of ['Chirp3-HD', 'Chirp-HD', 'Studio', 'Journey', 'Neural2', 'Polyglot', 'News', 'Wavenet', 'Standard']) {
    if (voiceName.includes(tier)) return tier;
  }
  return '';
}
