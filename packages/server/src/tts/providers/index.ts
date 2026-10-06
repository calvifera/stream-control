import type { TtsConfig } from '@streaming/shared';
import { env } from '../../env.js';
import { GoogleTtsProvider } from './google.js';
import { GoogleLegacyProvider } from './googleLegacy.js';
import { TikTokTtsProvider } from './tiktok.js';
import type { ProviderId, TtsProviderAdapter } from './types.js';

export * from './types.js';
export { GoogleTtsProvider } from './google.js';
export { GoogleLegacyProvider } from './googleLegacy.js';
export { TikTokTtsProvider } from './tiktok.js';

/**
 * The credentials are not in the config, which every overlay is sent. They are
 * read from the environment, where the secret store publishes them and where a
 * plain `.env` puts them.
 */
const tiktokSettings = (config: TtsConfig) => ({
  sessionId: env.ttSessionId ?? '',
  apiBaseUrl: config.apiBaseUrl,
});

const googleSettings = (config: TtsConfig) => ({
  apiKey: env.googleTtsApiKey ?? '',
  defaultVoice: config.google.defaultVoice,
  languageCode: config.google.languageCode,
});

/**
 * Holds one adapter per backend and keeps them in step with the config.
 *
 * `browser` has no adapter: it is synthesized in the overlay by the Web Speech
 * API, so there is nothing for the server to do beyond forwarding the text.
 */
export class ProviderRegistry {
  private readonly tiktok: TikTokTtsProvider;
  private readonly google: GoogleTtsProvider;
  private readonly googleLegacy: GoogleLegacyProvider;

  constructor(config: TtsConfig) {
    this.tiktok = new TikTokTtsProvider(tiktokSettings(config));
    this.google = new GoogleTtsProvider(googleSettings(config));
    this.googleLegacy = new GoogleLegacyProvider({
      defaultVoice: config.googleLegacy.defaultVoice,
    });
  }

  /**
   * Re-reads the config and the credentials. Call it when either changes: the
   * adapters keep what they were given, so a key saved after startup does not
   * reach them until this runs.
   */
  update(config: TtsConfig): void {
    this.tiktok.setConfig(tiktokSettings(config));
    this.google.setConfig(googleSettings(config));
    this.googleLegacy.setConfig({ defaultVoice: config.googleLegacy.defaultVoice });
  }

  /** Returns null for `browser`, which the server never synthesizes. */
  get(id: ProviderId): TtsProviderAdapter | null {
    if (id === 'tiktok') return this.tiktok;
    if (id === 'google') return this.google;
    if (id === 'google-legacy') return this.googleLegacy;
    return null;
  }

  /** Configuration status for every backend, for the dashboard. */
  status(): Array<{ id: ProviderId; name: string; configured: boolean; hint: string }> {
    return [
      {
        id: 'tiktok' as const,
        name: this.tiktok.name,
        configured: this.tiktok.isConfigured(),
        hint: this.tiktok.configurationHint(),
      },
      {
        id: 'google' as const,
        name: this.google.name,
        configured: this.google.isConfigured(),
        hint: this.google.configurationHint(),
      },
      {
        id: 'google-legacy' as const,
        name: this.googleLegacy.name,
        configured: this.googleLegacy.isConfigured(),
        hint: this.googleLegacy.configurationHint(),
      },
      {
        id: 'browser' as const,
        name: 'Browser speech synthesis',
        configured: true,
        hint: 'Uses the voices installed on the machine running the overlay.',
      },
    ];
  }
}
