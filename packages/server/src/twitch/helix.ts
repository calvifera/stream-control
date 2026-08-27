import type { AuthManager } from '../auth/manager.js';
import { env } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('twitch-helix');

/**
 * Profile lookups for Twitch chatters.
 *
 * IRC carries no avatar URL, which is the one visible gap in anonymous Twitch
 * chat. Helix fills it, and only needs an *application* token — registering an
 * app is enough, nobody has to sign in. That makes this the cheapest possible
 * upgrade from "letters in coloured circles" to real faces.
 *
 * Lookups are batched (100 logins per request), cached, and never retried in a
 * tight loop: a chat that is moving fast would otherwise turn one busy minute
 * into hundreds of API calls.
 */

const BATCH_SIZE = 100;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Batches are collected for this long before firing, to coalesce bursts. */
const DEBOUNCE_MS = 400;

interface CachedProfile {
  avatarUrl: string | null;
  displayName: string | null;
  fetchedAt: number;
}

export class TwitchProfiles {
  private cache = new Map<string, CachedProfile>();
  private queue = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    private auth: AuthManager,
    /** Called when a lookup fills in details for logins already seen. */
    private onResolved: (profiles: Map<string, CachedProfile>) => void,
  ) {}

  /** Cached avatar for a login, or null when unknown (a lookup is queued). */
  avatarFor(login: string): string | null {
    const key = login.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.avatarUrl;
    this.enqueue(key);
    return hit?.avatarUrl ?? null;
  }

  private enqueue(login: string): void {
    if (!env.twitchClientId) return;
    this.queue.add(login);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    // One request at a time. Overlapping flushes would multiply the request
    // count exactly when chat is busiest.
    if (this.inFlight || this.queue.size === 0) return;
    const token = await this.auth.appAccessToken('twitch');
    if (!token || !env.twitchClientId) return;

    const batch = [...this.queue].slice(0, BATCH_SIZE);
    for (const login of batch) this.queue.delete(login);
    this.inFlight = true;

    try {
      const url = new URL('https://api.twitch.tv/helix/users');
      for (const login of batch) url.searchParams.append('login', login);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Client-Id': env.twitchClientId },
      });
      if (!response.ok) {
        log.warn(`Helix user lookup failed: HTTP ${response.status}`);
        return;
      }

      const data = (await response.json()) as {
        data?: Array<{ login: string; display_name: string; profile_image_url: string }>;
      };

      const resolved = new Map<string, CachedProfile>();
      for (const user of data.data ?? []) {
        const entry: CachedProfile = {
          avatarUrl: user.profile_image_url || null,
          displayName: user.display_name || null,
          fetchedAt: Date.now(),
        };
        this.cache.set(user.login.toLowerCase(), entry);
        resolved.set(user.login.toLowerCase(), entry);
      }

      // Logins Helix did not return are deleted or banned accounts. Cache the
      // miss so they are not retried on every single message they ever sent.
      for (const login of batch) {
        if (!resolved.has(login)) {
          this.cache.set(login, { avatarUrl: null, displayName: null, fetchedAt: Date.now() });
        }
      }

      if (resolved.size > 0) this.onResolved(resolved);
    } catch (error) {
      log.warn(`Helix lookup error: ${String(error)}`);
    } finally {
      this.inFlight = false;
      // More arrived while this was in flight.
      if (this.queue.size > 0) this.enqueue([...this.queue][0] as string);
    }
  }

  size(): number {
    return this.cache.size;
  }
}
