import type { YouTubeModerationConfig } from '@streaming/shared';
import { createLogger, describeError } from '../logger.js';
import type { AuthManager } from '../auth/manager.js';

const log = createLogger('youtube-mod');

const API = 'https://www.googleapis.com/youtube/v3';

export interface ModerationResult {
  ok: boolean;
  /** What happened, in words, for the log and the dashboard. */
  detail: string;
}

/**
 * Bans and timeouts on YouTube, driven by the penalty box.
 *
 * The gap this closes is the one Twitch's version already closed, and it was
 * open on YouTube the whole time: penalising someone only muted TTS. They
 * carried on posting to everyone watching, and the only person who saw a
 * difference was the host — who had every reason to believe it was handled.
 *
 * Deliberately conservative, because these actions are outward-facing, land
 * on real people and are seen by an audience:
 *
 *   - **Off by default.** Wiring the penalty box to YouTube is a decision
 *     somebody makes, never something that starts happening after an update.
 *   - **A timed ban, not a permanent one.** Five minutes wrongly applied
 *     costs somebody five minutes. A permanent ban wrongly applied costs you
 *     a viewer, usually without either of you noticing.
 *   - **Automatic penalties stay local unless separately enabled**, because
 *     the heuristics that raise them have false positives by construction.
 *
 * One thing here is sharper than the Twitch equivalent and worth naming.
 * Twitch needs a login-to-id lookup before it can act, so a malformed handle
 * fails harmlessly at the lookup. YouTube bans by channel id, and a channel
 * id is exactly what a viewer is already keyed on in this app — nothing
 * stands between a mistaken penalty and a real person. The guards above are
 * the only thing doing that job.
 *
 * Message deletion is not implemented, on purpose. A ban already hides the
 * banned viewer's messages, so the useful half comes free, and the delete
 * endpoint is a sharper instrument than this needs.
 */
export class YouTubeModeration {
  /**
   * Channel id → the id of the ban placed on them.
   *
   * Kept because lifting a ban needs the ban's own id, which exists only in
   * the reply to the request that created it — there is no endpoint that
   * answers "who is banned here". Lost on restart, which is why `unban`
   * reports honestly rather than pretending.
   */
  private bans = new Map<string, string>();

  /** The chat currently being read. Bans are per-chat, not per-channel. */
  private liveChatId: string | null = null;
  /**
   * The video being read, when the chat id is not known.
   *
   * The watch-page source never learns a Data API chat id — it does not need
   * one to read — but banning goes through the Data API, which does. So the
   * video id is kept and turned into a chat id the first time somebody
   * actually moderates. Lazily, because resolving it up front would spend a
   * quota call on every connection for a feature most sessions never use, and
   * would mean the source that exists to avoid the API called it anyway.
   */
  private videoId: string | null = null;

  constructor(
    private auth: AuthManager,
    private config: YouTubeModerationConfig,
  ) {}

  setConfig(config: YouTubeModerationConfig): void {
    this.config = config;
  }

  /**
   * Points moderation at the chat now being read.
   *
   * Called on connect and cleared on disconnect: a ban belongs to a broadcast,
   * so acting with a stale id would either fail or, worse, land on the wrong
   * stream.
   */
  setChat(chat: { liveChatId?: string | null; videoId?: string | null }): void {
    const liveChatId = chat.liveChatId ?? null;
    const videoId = chat.videoId ?? null;
    if (liveChatId !== this.liveChatId || videoId !== this.videoId) this.bans.clear();
    this.liveChatId = liveChatId;
    this.videoId = videoId;
  }

  /**
   * The chat id to ban in, resolving it from the video if that is all we have.
   *
   * Null means moderation cannot proceed, and the caller says why. Note this
   * is the one place the watch-page source still touches the Data API: banning
   * is an authenticated action either way, so there is no version of this that
   * avoids it.
   */
  private async resolveChatId(token: string): Promise<string | null> {
    if (this.liveChatId) return this.liveChatId;
    if (!this.videoId) return null;

    try {
      const url = new URL(`${API}/videos`);
      url.searchParams.set('part', 'liveStreamingDetails');
      url.searchParams.set('id', this.videoId);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return null;

      const body = (await response.json()) as {
        items?: { liveStreamingDetails?: { activeLiveChatId?: string } }[];
      };
      const found = body.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
      // Cached for the rest of the broadcast: it does not change while the
      // stream is up, and setChat clears it when the stream does.
      this.liveChatId = found;
      return found;
    } catch {
      return null;
    }
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Bans a viewer from the live chat.
   *
   * @param channelId The viewer's channel id — the same value used as their
   * handle throughout this app.
   * @param automatic Whether an automatic strike raised this, checked against
   * `includeAutomatic` before anything reaches the network.
   */
  async ban(channelId: string, reason: string, automatic: boolean): Promise<ModerationResult> {
    if (!this.config.enabled) {
      return { ok: false, detail: 'YouTube moderation is off' };
    }
    // Refused before a token is even fetched, so an automatic strike cannot
    // reach YouTube through a bug further down.
    if (automatic && !this.config.includeAutomatic) {
      return { ok: false, detail: 'automatic penalties are not sent to YouTube' };
    }
    if (!this.liveChatId && !this.videoId) {
      return { ok: false, detail: 'not connected to a YouTube chat' };
    }
    if (!channelId.trim()) {
      return { ok: false, detail: 'no channel id for that viewer' };
    }

    const token = await this.auth.userToken('youtube');
    if (!token) {
      return { ok: false, detail: 'not signed in to YouTube — moderating is an action taken as you' };
    }

    const liveChatId = await this.resolveChatId(token);
    if (!liveChatId) {
      return { ok: false, detail: 'could not find the live chat to ban in' };
    }

    const seconds = this.config.timeoutSeconds;
    const permanent = seconds <= 0;

    try {
      const response = await fetch(`${API}/liveChat/bans?part=snippet`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: {
            liveChatId,
            bannedUserDetails: { channelId: channelId.trim() },
            type: permanent ? 'permanent' : 'temporary',
            // Sent only for a temporary ban: paired with `permanent` it is
            // meaningless, and sending meaningless fields to an API that
            // validates them is how a request starts failing for no reason.
            ...(permanent ? {} : { banDurationSeconds: seconds }),
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // 403 here almost always means the account is not a moderator on the
        // broadcast rather than that the token is wrong, and saying so saves
        // an hour of re-checking credentials that were never the problem.
        const hint =
          response.status === 403
            ? ' — is the signed-in account the broadcaster or a moderator on this stream?'
            : '';
        return { ok: false, detail: `YouTube refused the ban (${response.status})${hint}` };
      }

      const created = (await response.json()) as { id?: string };
      if (created.id) this.bans.set(channelId.trim().toLowerCase(), created.id);

      const how = permanent ? 'banned permanently' : `banned for ${seconds}s`;
      log.info(`${how} on YouTube: ${channelId} (${reason})`);
      return { ok: true, detail: how };
    } catch (error) {
      return { ok: false, detail: describeError(error) };
    }
  }

  /**
   * Lifts a ban this process placed.
   *
   * Only one it placed: the ban id comes back from the request that created
   * it and there is no way to ask YouTube for it afterwards, so a restart
   * loses the mapping. That is reported rather than hidden, because a pardon
   * that silently did nothing is the same failure as a ban that silently did
   * nothing — someone believing a thing was handled when it was not.
   */
  async unban(channelId: string): Promise<ModerationResult> {
    if (!this.config.enabled) return { ok: false, detail: 'YouTube moderation is off' };

    const key = channelId.trim().toLowerCase();
    const banId = this.bans.get(key);
    if (!banId) {
      return {
        ok: false,
        detail: 'no ban on record here — lift it in YouTube Studio if it was placed before a restart',
      };
    }

    const token = await this.auth.userToken('youtube');
    if (!token) return { ok: false, detail: 'not signed in to YouTube' };

    try {
      const response = await fetch(`${API}/liveChat/bans?id=${encodeURIComponent(banId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        return { ok: false, detail: `YouTube refused the unban (${response.status})` };
      }
      this.bans.delete(key);
      log.info(`Lifted the YouTube ban on ${channelId}`);
      return { ok: true, detail: 'ban lifted' };
    } catch (error) {
      return { ok: false, detail: describeError(error) };
    }
  }
}
