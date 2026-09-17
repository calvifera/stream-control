import type { AuthManager } from '../auth/manager.js';
import { env } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('twitch-cheermotes');

/**
 * A channel's cheermotes, for showing the right animation for a cheer.
 *
 * The global "Cheer" cheermote lives at a public URL and needs nothing — that
 * is what the normalizer uses. But partners can have their own (`corgo100`,
 * a channel's custom prefix), and those only come from Helix. With app
 * credentials configured this fetches the channel's list once and keeps it;
 * without them it stays empty and every cheer shows the global one, which is
 * the right thing to be wrong with.
 */

/** Cheermotes change when a partner uploads new ones — rarely. */
const REFRESH_MS = 60 * 60 * 1000;

interface HelixTier {
  min_bits: number;
  can_cheer: boolean;
  images?: { dark?: { animated?: Record<string, string>; static?: Record<string, string> } };
}

interface HelixCheermote {
  prefix: string;
  tiers: HelixTier[];
}

export interface CheermoteImages {
  animationUrl: string | null;
  imageUrl: string | null;
}

export class TwitchCheermotes {
  private channel = '';
  private byPrefix = new Map<string, HelixTier[]>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private auth: AuthManager) {}

  /** Prefixes this channel accepts, for telling cheers from ordinary words. */
  prefixes(): ReadonlySet<string> {
    return new Set(this.byPrefix.keys());
  }

  watch(channel: string): void {
    const next = channel.trim().toLowerCase().replace(/^#/, '');
    if (next === this.channel) return;
    this.channel = next;
    this.byPrefix.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!next) return;
    void this.load();
    this.timer = setInterval(() => void this.load(), REFRESH_MS);
  }

  /**
   * The images for a cheer, or null when the catalogue does not know the
   * prefix — the caller keeps the global cheermote then.
   */
  resolve(prefix: string, bits: number): CheermoteImages | null {
    const tiers = this.byPrefix.get(prefix.toLowerCase());
    if (!tiers) return null;
    const tier = tiers
      .filter((candidate) => bits >= candidate.min_bits)
      .sort((a, b) => b.min_bits - a.min_bits)[0];
    const dark = tier?.images?.dark;
    if (!dark) return null;
    return {
      animationUrl: dark.animated?.['4'] ?? dark.animated?.['3'] ?? null,
      imageUrl: dark.static?.['4'] ?? dark.static?.['3'] ?? null,
    };
  }

  private async load(): Promise<void> {
    if (!env.twitchClientId) return;
    const channel = this.channel;
    try {
      const token = await this.auth.appAccessToken('twitch');
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}`, 'Client-Id': env.twitchClientId };

      const users = await fetch(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`,
        { headers },
      );
      if (!users.ok) throw new Error(`user lookup HTTP ${users.status}`);
      const id = ((await users.json()) as { data?: Array<{ id: string }> }).data?.[0]?.id;

      // Without a broadcaster id Helix still returns the global set.
      const url = new URL('https://api.twitch.tv/helix/bits/cheermotes');
      if (id) url.searchParams.set('broadcaster_id', id);
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`cheermotes HTTP ${response.status}`);
      const data = ((await response.json()) as { data?: HelixCheermote[] }).data ?? [];

      // The channel may have changed while this was in flight.
      if (channel !== this.channel) return;
      this.byPrefix = new Map(data.map((entry) => [entry.prefix.toLowerCase(), entry.tiers]));
      log.info(`Loaded ${this.byPrefix.size} cheermotes for #${channel}`);
    } catch (error) {
      log.warn(`Could not load cheermotes for #${channel}: ${String(error)}`);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
