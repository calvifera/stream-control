import type { TwitchModerationConfig } from '@streaming/shared';
import { createLogger, describeError } from '../logger.js';
import type { AuthManager } from '../auth/manager.js';
import { env } from '../env.js';

const log = createLogger('twitch-mod');

const HELIX = 'https://api.twitch.tv/helix';

export interface ModerationResult {
  ok: boolean;
  /** What happened, in words, for the log and the dashboard. */
  detail: string;
}

/**
 * Timeouts and bans on Twitch, driven by the penalty box.
 *
 * The gap this closes: until now the penalty box only muted TTS. Someone you
 * had penalised was still posting to everyone watching — they simply were not
 * read aloud, on your machine, where only you would notice the difference.
 * A moderation tool that does not moderate is worse than none, because you
 * would reasonably believe you had dealt with it.
 *
 * Everything here is deliberately conservative, because these actions are
 * outward-facing, land on real people, and are seen by an audience:
 *
 *   - **Off by default.** Wiring the penalty box to Twitch has to be a
 *     decision someone makes, not something that starts happening after an
 *     update.
 *   - **Timeout, not ban, by default.** A ten-minute timeout that was wrong
 *     costs someone ten minutes. A permanent ban that was wrong costs you a
 *     viewer, usually silently.
 *   - **Automatic penalties do not reach Twitch unless separately enabled.**
 *     The auto-penalty system fires on evasion heuristics and phonetic near
 *     misses; those have false positives by construction. A false positive
 *     that mutes TTS is invisible and recoverable. One that bans a real
 *     viewer is neither.
 *
 * Message deletion is not implemented, and that is on purpose. Twitch already
 * purges a user's recent messages when you time them out, so the useful half
 * comes free — while the delete endpoint clears the *entire chat* if the
 * message id is omitted, which is a much worse thing to get wrong than it is
 * to do without.
 */
export class TwitchModeration {
  /** login → Twitch user id. Ids never change, so this never needs eviction. */
  private ids = new Map<string, string>();

  constructor(
    private auth: AuthManager,
    private config: TwitchModerationConfig,
    private channel: string,
  ) {}

  setConfig(config: TwitchModerationConfig, channel: string): void {
    this.config = config;
    if (channel !== this.channel) {
      this.channel = channel;
      // Ids are per-person, not per-channel, so only the broadcaster's own
      // cached id would be wrong — and that is looked up by login anyway.
    }
  }

  /** Whether this is switched on and could actually work. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Times out (or bans) a viewer.
   *
   * `automatic` says where the request came from, and is the whole reason
   * this parameter exists: it is checked against `includeAutomatic` so that
   * turning on Twitch moderation does not silently also hand the automatic
   * strike system the power to ban people.
   */
  async timeout(
    login: string,
    reason: string,
    automatic: boolean,
  ): Promise<ModerationResult> {
    if (!this.config.enabled) {
      return { ok: false, detail: 'Twitch moderation is off' };
    }
    if (automatic && !this.config.includeAutomatic) {
      return {
        ok: false,
        detail: 'automatic penalties are not allowed to act on Twitch',
      };
    }

    try {
      const ctx = await this.context();
      if ('error' in ctx) return { ok: false, detail: ctx.error };

      const target = await this.userId(login, ctx.token);
      if (!target) return { ok: false, detail: `no Twitch user called ${login}` };

      // Refusing to act on yourself: the API would reject it anyway, but the
      // clear message matters more than the round trip. Penalising your own
      // handle is a plausible mistake while testing.
      if (target === ctx.moderatorId) {
        return { ok: false, detail: 'that is your own account' };
      }

      const url = new URL(`${HELIX}/moderation/bans`);
      url.searchParams.set('broadcaster_id', ctx.broadcasterId);
      url.searchParams.set('moderator_id', ctx.moderatorId);

      // Omitting `duration` is a *permanent ban*, so the seconds value is
      // only left out when someone has explicitly asked for one by setting
      // the timeout to zero.
      const data: Record<string, unknown> = { user_id: target, reason: reason.slice(0, 500) };
      if (this.config.timeoutSeconds > 0) data.duration = this.config.timeoutSeconds;

      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers(ctx.token),
        body: JSON.stringify({ data }),
      });

      if (!response.ok) return { ok: false, detail: await this.explain(response) };

      const detail =
        this.config.timeoutSeconds > 0
          ? `timed out for ${this.config.timeoutSeconds}s`
          : 'banned permanently';
      log.warn(`@${login} ${detail} on Twitch — ${reason}`);
      return { ok: true, detail };
    } catch (error) {
      return { ok: false, detail: describeError(error) };
    }
  }

  /** Lifts a ban or timeout. Used when someone leaves the penalty box. */
  async unban(login: string): Promise<ModerationResult> {
    if (!this.config.enabled) return { ok: false, detail: 'Twitch moderation is off' };

    try {
      const ctx = await this.context();
      if ('error' in ctx) return { ok: false, detail: ctx.error };

      const target = await this.userId(login, ctx.token);
      if (!target) return { ok: false, detail: `no Twitch user called ${login}` };

      const url = new URL(`${HELIX}/moderation/bans`);
      url.searchParams.set('broadcaster_id', ctx.broadcasterId);
      url.searchParams.set('moderator_id', ctx.moderatorId);
      url.searchParams.set('user_id', target);

      const response = await fetch(url, { method: 'DELETE', headers: this.headers(ctx.token) });

      // 400 here is usually "they were not banned", which is the state the
      // caller wanted anyway — reporting it as a failure would make lifting a
      // penalty look broken.
      if (response.status === 400) return { ok: true, detail: 'was not banned' };
      if (!response.ok) return { ok: false, detail: await this.explain(response) };

      log.info(`@${login} unbanned on Twitch`);
      return { ok: true, detail: 'unbanned' };
    } catch (error) {
      return { ok: false, detail: describeError(error) };
    }
  }

  /**
   * Whether a viewer follows the channel.
   *
   * This is the answer IRC cannot give, and its absence is why every
   * followers-only gate has been unsatisfiable on Twitch. Returns null for
   * "could not find out", which callers must not treat as "does not follow" —
   * the distinction is the entire point of `roles.ts`.
   */
  async isFollower(login: string): Promise<boolean | null> {
    try {
      const ctx = await this.context();
      if ('error' in ctx) return null;

      const target = await this.userId(login, ctx.token);
      if (!target) return null;

      const url = new URL(`${HELIX}/channels/followers`);
      url.searchParams.set('broadcaster_id', ctx.broadcasterId);
      url.searchParams.set('user_id', target);

      const response = await fetch(url, { headers: this.headers(ctx.token) });
      if (!response.ok) return null;

      const body = (await response.json()) as { data?: unknown[] };
      return (body.data?.length ?? 0) > 0;
    } catch {
      return null;
    }
  }

  /** Token, broadcaster and moderator ids — everything a call needs. */
  private async context(): Promise<
    { token: string; broadcasterId: string; moderatorId: string } | { error: string }
  > {
    const token = await this.auth.userToken('twitch');
    if (!token) {
      return { error: 'not signed in to Twitch — sign in on the Setup tab' };
    }

    const stored = this.auth.store.get('twitch');
    const moderatorId = stored?.accountId ?? null;
    if (!moderatorId) {
      // Twitch requires moderator_id to match the token's own user. Without
      // it there is no correct value to send.
      return { error: 'signed in, but Twitch did not report which account — sign in again' };
    }

    const channel = this.channel.trim().toLowerCase().replace(/^#/, '');
    if (!channel) return { error: 'no Twitch channel set' };

    const broadcasterId = await this.userId(channel, token);
    if (!broadcasterId) return { error: `could not find the channel ${channel}` };

    return { token, broadcasterId, moderatorId };
  }

  /** Twitch user id for a login, cached. */
  private async userId(login: string, token: string): Promise<string | null> {
    const key = login.trim().toLowerCase().replace(/^@/, '');
    if (!key) return null;

    const cached = this.ids.get(key);
    if (cached) return cached;

    const url = new URL(`${HELIX}/users`);
    url.searchParams.set('login', key);

    const response = await fetch(url, { headers: this.headers(token) });
    if (!response.ok) return null;

    const body = (await response.json()) as { data?: { id?: string }[] };
    const id = body.data?.[0]?.id;
    if (!id) return null;

    this.ids.set(key, id);
    return id;
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Client-Id': env.twitchClientId ?? '',
      'Content-Type': 'application/json',
    };
  }

  /** A Twitch error turned into something worth putting in front of a person. */
  private async explain(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    if (response.status === 401) return 'Twitch rejected the token — sign in again';
    if (response.status === 403) {
      return 'not allowed — you must be the broadcaster or a moderator of that channel';
    }
    if (response.status === 429) return 'Twitch is rate limiting moderation actions';
    try {
      const parsed = JSON.parse(body) as { message?: string };
      if (parsed.message) return parsed.message;
    } catch {
      // Not JSON; fall through to the raw text.
    }
    return `Twitch API ${response.status}: ${body.slice(0, 160)}`;
  }
}
