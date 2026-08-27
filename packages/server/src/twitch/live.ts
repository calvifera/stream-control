import { createLogger } from '../logger.js';
import type { AuthManager } from '../auth/manager.js';
import { env } from '../env.js';

const log = createLogger('twitch-live');

/**
 * How often to ask whether the channel is live.
 *
 * A minute. Going live and going offline are not events anyone needs to see
 * within seconds, and this spends an API call every time it runs — for a
 * question whose answer changes twice a day, polling faster would be all cost
 * and no benefit.
 */
const POLL_MS = 60_000;

/**
 * Whether a Twitch channel is actually broadcasting.
 *
 * Needed because on Twitch, connected and live are close to unrelated. Chat is
 * read over IRC, which joins a channel whether or not anyone is streaming to
 * it — so a "connected" Twitch entry says the socket is open, and nothing at
 * all about whether there is a stream. A timer counting from that on an idle
 * channel measures how long the app has been running.
 *
 * TikTok and YouTube need none of this: neither can connect to a room that is
 * not live, so for them connecting is the answer.
 *
 * Reports `started_at` from Helix rather than the moment this noticed, so
 * uptime is the broadcast's real uptime even when the app joined an hour in.
 * Returns null for "not live" and also for "could not tell" — the caller
 * shows no timer either way, which is the honest rendering of both.
 */
export class TwitchLive {
  private timer: NodeJS.Timeout | null = null;
  private channel = '';
  private liveSince: number | null = null;

  constructor(
    private auth: AuthManager,
    /** Called only when the answer changes, so state does not churn. */
    private onChange: (liveSince: number | null) => void,
  ) {}

  /** Starts polling a channel, or stops when given an empty one. */
  watch(channel: string): void {
    const next = channel.trim().toLowerCase().replace(/^#/, '');
    if (next === this.channel) return;

    this.channel = next;
    this.stop();
    if (!next) {
      this.set(null);
      return;
    }

    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private set(value: number | null): void {
    if (value === this.liveSince) return;
    this.liveSince = value;
    this.onChange(value);
  }

  private async poll(): Promise<void> {
    if (!this.channel) return;

    /*
     * An app token, not the user's.
     *
     * Stream status is public information, so this works with nothing but a
     * registered application — no sign-in, and no dependence on a user token
     * that may have expired. Without app credentials it simply reports
     * unknown, which degrades to "no uptime shown" rather than to a wrong
     * number.
     */
    const token = await this.auth.appAccessToken('twitch');
    if (!token || !env.twitchClientId) {
      this.set(null);
      return;
    }

    try {
      const url = new URL('https://api.twitch.tv/helix/streams');
      url.searchParams.set('user_login', this.channel);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Client-Id': env.twitchClientId },
      });
      if (!response.ok) {
        this.set(null);
        return;
      }

      const body = (await response.json()) as { data?: { started_at?: string }[] };
      const stream = body.data?.[0];
      if (!stream) {
        if (this.liveSince !== null) log.info(`${this.channel} is no longer live`);
        this.set(null);
        return;
      }

      const started = Date.parse(stream.started_at ?? '');
      const value = Number.isFinite(started) ? started : Date.now();
      if (this.liveSince === null) log.info(`${this.channel} is live`);
      this.set(value);
    } catch {
      // A failed lookup is "do not know", never "offline". Reporting offline
      // would make the uptime vanish and reappear on a flaky network.
      this.set(null);
    }
  }
}
