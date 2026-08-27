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
    this.tiktok = new TikTokTtsProvider({
      sessionId: config.sessionId.trim() || env.ttSessionId || '',
      apiBaseUrl: config.apiBaseUrl,
    });
    this.google = new GoogleTtsProvider({
      apiKey: config.google.apiKey.trim() || env.googleTtsApiKey || '',
      defaultVoice: config.google.defaultVoice,
      languageCode: config.google.languageCode,
    });
    this.googleLegacy = new GoogleLegacyProvider({
      defaultVoice: config.googleLegacy.defaultVoice,
    });
  }

  update(config: TtsConfig): void {
    this.tiktok.setConfig({
      sessionId: config.sessionId.trim() || env.ttSessionId || '',
      apiBaseUrl: config.apiBaseUrl,
    });
    this.google.setConfig({
      apiKey: config.google.apiKey.trim() || env.googleTtsApiKey || '',
      defaultVoice: config.google.defaultVoice,
      languageCode: config.google.languageCode,
    });
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
