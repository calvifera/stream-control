import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  ConnectionState,
  StreamEvent,
  SystemEvent,
  YouTubeConnectionConfig,
} from '@streaming/shared';
import { createLogger, describeError } from '../logger.js';
import type { AuthManager } from '../auth/manager.js';
import { youtubeEventFrom, type YouTubeChatMessage } from './normalize.js';
import { findLiveChat, pollChat, type ChatSession } from './innertube.js';
import { innertubeEventFrom } from './innertubeNormalize.js';

const log = createLogger('youtube');

const API = 'https://www.googleapis.com/youtube/v3';

/**
 * Floor on how often the chat is polled, whatever the API asks for.
 *
 * `pollingIntervalMillis` comes back very short on a busy chat, and honouring
 * it literally is how a day's quota disappears in an afternoon — see the
 * class comment. One second is fast enough that nobody perceives chat as
 * lagging.
 */
const MIN_POLL_MS = 1000;

/** Ceiling, so a quiet chat still notices the stream ending reasonably soon. */
const MAX_POLL_MS = 30_000;

/**
 * Quota exhaustion, which is the one failure that reconnecting cannot fix.
 *
 * Everything else the API returns is worth another attempt — a 500, a dropped
 * connection, a token that just refreshed. This one is a budget that does not
 * refill until midnight Pacific, so each retry spends another call to be told
 * the same thing, digging the hole it is trying to climb out of.
 */
class QuotaExhaustedError extends Error {}

const systemEvent = (level: SystemEvent['level'], text: string): SystemEvent => ({
  id: randomUUID(),
  ts: Date.now(),
  platform: 'youtube',
  type: 'system',
  user: null,
  level,
  text,
});

export interface YouTubeManagerEvents {
  event: (event: StreamEvent) => void;
  state: (state: ConnectionState) => void;
  sessionStart: () => void;
}

/**
 * Reads a YouTube live chat.
 *
 * Unlike TikTok and Twitch this is not a socket — YouTube offers no public
 * push API for live chat, so the only way in is polling
 * `liveChatMessages.list` and following `nextPageToken`. Three consequences
 * shape everything below.
 *
 * **It costs quota.** Every poll spends from a daily allowance (10,000 units
 * by default for a new project) that is shared with every other call the app
 * makes. Google does not publish the per-call cost of the live-chat endpoints
 * — the widely repeated community figure is 5 units, which this code neither
 * confirms nor relies on. What it does instead is count its own calls and
 * report them in `pollCount`, so the cost can be observed against a real
 * stream rather than guessed at. A long stream polled aggressively will run
 * out; that is a fact about the API, not a bug here.
 *
 * **It needs your account.** Anonymous access does not exist for this, so a
 * signed-in YouTube account with `youtube.force-ssl` is required before this
 * can connect at all. Without one it reports a clear error rather than
 * retrying forever.
 *
 * **It has to find the stream first.** The chat id belongs to a broadcast,
 * not to the channel, so connecting means asking which broadcast is currently
 * active and starting from there.
 */
export class YouTubeManager extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private manuallyDisconnected = false;
  private liveChatId: string | null = null;
  private pageToken: string | null = null;
  /** Guards against two polls overlapping if one runs long. */
  private polling = false;
  /**
   * True until the first poll has established a cursor.
   *
   * Asked for a chat with no `pageToken`, the API answers with the backlog —
   * what has already been said, not what is new. TikTok and Twitch both hand
   * over a live stream of messages and nothing else, so without this, joining
   * a YouTube chat an hour in replayed that hour: every message queued for
   * speech, rendered in overlays, written to the archive, and weighed for
   * penalties, all at once and all long after the fact.
   */
  private priming = true;
  /** Set while reading from the watch page instead of the Data API. */
  private session: ChatSession | null = null;
  /** Calls made this connection, so quota burn can be seen rather than assumed. */
  private pollCount = 0;
  private startedAt = 0;

  private state: ConnectionState = {
    status: 'idle',
    username: '',
    roomId: null,
    hostNickname: null,
    hostAvatarUrl: null,
    connectedAt: null,
    liveSince: null,
    lastError: null,
    reconnectAttempts: 0,
  };

  constructor(
    private config: YouTubeConnectionConfig,
    private auth: AuthManager,
  ) {
    super();
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  /** Calls made and how long they have been spread over, for the dashboard. */
  getUsage(): { polls: number; minutes: number } {
    const minutes = this.startedAt > 0 ? (Date.now() - this.startedAt) / 60_000 : 0;
    return { polls: this.pollCount, minutes };
  }

  setConfig(config: YouTubeConnectionConfig): void {
    const targetChanged = config.videoId !== this.config.videoId;
    this.config = config;
    if (targetChanged && this.state.status === 'connected') {
      this.disconnect();
      if (config.enabled) this.connect();
    }
  }

  private patch(partial: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...partial };
    this.emit('state', this.getState());
  }

  private push(event: StreamEvent): void {
    this.emit('event', event);
  }

  connect(): void {
    this.manuallyDisconnected = false;
    this.clearReconnect();
    this.patch({ status: 'connecting', lastError: null });
    void this.begin();
  }

  private async begin(): Promise<void> {
    if (this.config.source === 'innertube') {
      await this.beginInnertube();
      return;
    }

    const token = await this.auth.userToken('youtube');
    if (!token) {
      // Terminal rather than retried: no amount of waiting produces a token,
      // and a reconnect loop here would just burn until someone signs in.
      this.patch({
        status: 'error',
        lastError: 'Sign in to YouTube on the Setup tab first — live chat has no anonymous access.',
        connectedAt: null,
      });
      this.push(systemEvent('error', 'YouTube: not signed in'));
      return;
    }

    try {
      const found = await this.findChat(token);
      if (!found) {
        this.fail(
          this.config.videoId
            ? `No live chat on video ${this.config.videoId} — is it live, and is chat enabled?`
            : 'No active broadcast on your channel. Start the stream, then connect.',
        );
        return;
      }

      this.liveChatId = found.liveChatId;
      this.pageToken = null;
      this.priming = true;
      this.pollCount = 0;
      this.startedAt = Date.now();
      this.patch({
        status: 'connected',
        username: this.config.videoId || found.title,
        roomId: found.liveChatId,
        hostNickname: found.title,
        connectedAt: Date.now(),
        // The chat id came from a broadcast with status `active`, so this is
        // live by construction.
        liveSince: Date.now(),
        reconnectAttempts: 0,
        lastError: null,
      });
      this.emit('sessionStart');
      this.push(systemEvent('info', `Connected to YouTube live chat — ${found.title}`));
      log.info(`Connected to YouTube live chat (${found.liveChatId})`);

      this.schedule(0);
    } catch (error) {
      this.failFrom(error);
    }
  }

  /**
   * Connects without credentials, the way the watch page does.
   *
   * No token is fetched and none is needed. Signing in still helps in one
   * small way — the channel id from the account saves having to type a handle
   * — but its absence is not an error here, which is the entire point of this
   * route.
   */
  private async beginInnertube(): Promise<void> {
    try {
      const found = await findLiveChat({
        videoId: this.config.videoId,
        handle: this.config.handle,
        channelId: this.auth.store.get('youtube')?.accountId ?? undefined,
      });

      if (!found) {
        this.fail(
          this.config.videoId
            ? `No live chat on video ${this.config.videoId} — is it live, and is chat enabled?`
            : 'That channel is not live, or its chat is disabled.',
        );
        return;
      }

      this.session = found;
      this.priming = true;
      this.pollCount = 0;
      this.startedAt = Date.now();
      this.liveChatId = found.videoId;
      this.patch({
        status: 'connected',
        username: found.videoId,
        roomId: found.videoId,
        hostNickname: found.title,
        connectedAt: Date.now(),
        liveSince: Date.now(),
        reconnectAttempts: 0,
        lastError: null,
      });
      this.emit('sessionStart');
      this.push(systemEvent('info', `Connected to YouTube live chat — ${found.title}`));
      log.info(`Reading YouTube chat from the watch page (${found.videoId})`);

      this.schedule(0);
    } catch (error) {
      this.failFrom(error);
    }
  }

  /**
   * Finds the chat to read.
   *
   * Two routes. A configured `videoId` is looked up directly, which is what
   * you need for a stream you do not own or one the broadcasts endpoint does
   * not list. Otherwise it asks for your own active broadcast, which is the
   * common case and needs nothing typed in.
   */
  private async findChat(token: string): Promise<{ liveChatId: string; title: string } | null> {
    if (this.config.videoId) {
      const data = await this.call<{
        items?: { snippet?: { title?: string }; liveStreamingDetails?: { activeLiveChatId?: string } }[];
      }>(token, 'videos', { part: 'snippet,liveStreamingDetails', id: this.config.videoId });

      const item = data.items?.[0];
      const chatId = item?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) return null;
      return { liveChatId: chatId, title: item?.snippet?.title ?? this.config.videoId };
    }

    /*
     * `broadcastStatus` on its own, never alongside `mine`.
     *
     * liveBroadcasts.list takes exactly one filter — `id`, `mine`, or
     * `broadcastStatus` — and rejects any combination with
     * "Incompatible parameters specified in the request: mine,
     * broadcastStatus". Sending both meant every connection attempt died on a
     * 400 before it ever looked for a chat.
     *
     * Dropping `mine` loses nothing: `broadcastStatus` already scopes the
     * results to the authenticated account's own broadcasts.
     */
    const data = await this.call<{
      items?: { snippet?: { title?: string; liveChatId?: string } }[];
    }>(token, 'liveBroadcasts', {
      part: 'snippet',
      broadcastStatus: 'active',
      broadcastType: 'all',
    });

    const item = data.items?.[0];
    const chatId = item?.snippet?.liveChatId;
    if (!chatId) return null;
    return { liveChatId: chatId, title: item?.snippet?.title ?? 'your stream' };
  }

  private async call<T>(
    token: string,
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${API}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    this.pollCount += 1;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // Quota exhaustion is worth naming: it is the one failure that will not
      // resolve by retrying, and it looks like a generic 403 otherwise.
      if (response.status === 403 && body.includes('quotaExceeded')) {
        throw new QuotaExhaustedError(
          `YouTube API quota is spent for today (${this.pollCount} calls this connection). ` +
            'It resets at midnight Pacific — reconnect after that. Raising the poll interval ' +
            'on the Setup tab makes it last longer.',
        );
      }
      if (response.status === 401) {
        throw new Error('YouTube rejected the token. Sign in again on the Setup tab.');
      }
      throw new Error(`YouTube API ${response.status}: ${body.slice(0, 200)}`);
    }

    return (await response.json()) as T;
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delay);
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.liveChatId || this.manuallyDisconnected) return;
    this.polling = true;

    if (this.session) {
      try {
        await this.pollInnertube();
      } finally {
        this.polling = false;
      }
      return;
    }

    try {
      const token = await this.auth.userToken('youtube');
      if (!token) {
        this.fail('YouTube sign-in expired.');
        return;
      }

      const params: Record<string, string> = {
        part: 'snippet,authorDetails',
        liveChatId: this.liveChatId,
        maxResults: '2000',
      };
      if (this.pageToken) params.pageToken = this.pageToken;

      /*
       * `liveChat/messages`, not `liveChatMessages`.
       *
       * The resource is named `liveChatMessages` everywhere in the docs, but
       * its HTTP path is not: it is `/youtube/v3/liveChat/messages`, the same
       * way bans and moderators live under `/liveChat/`. Getting it wrong
       * returns a bare 404 with an empty body rather than the API's usual
       * JSON error, which reads like the endpoint is gone rather than like a
       * typo in the path.
       */
      const data = await this.call<{
        items?: YouTubeChatMessage[];
        nextPageToken?: string;
        pollingIntervalMillis?: number;
        offlineAt?: string;
      }>(token, 'liveChat/messages', params);

      /*
       * A missing token means keep the one we have, never start over.
       * Clearing it would send the next poll back to the top of the chat and
       * redeliver everything already handled.
       */
      this.pageToken = data.nextPageToken ?? this.pageToken;

      const items = data.items ?? [];
      if (this.priming) {
        // The first answer is history. Take the cursor from it and let the
        // messages go: they were said before anyone here was listening.
        this.priming = false;
        if (items.length > 0) {
          log.info(`Skipped ${items.length} message(s) already in the chat backlog`);
        }
      } else {
        for (const item of items) {
          const event = youtubeEventFrom(item);
          if (event) this.push(event);
        }
      }

      if (data.offlineAt) {
        this.push(systemEvent('info', 'YouTube: the stream has gone offline'));
        log.info('YouTube stream went offline');
        this.stopPolling();
        this.patch({ status: 'idle', connectedAt: null });
        return;
      }

      // The API's own suggestion, clamped. It knows how busy the chat is and
      // this code does not, so it is the right input — but it is advice about
      // latency with no opinion about the quota it costs to follow.
      const suggested = data.pollingIntervalMillis ?? this.config.pollIntervalMs;
      const floor = Math.max(MIN_POLL_MS, this.config.pollIntervalMs);
      this.schedule(Math.min(MAX_POLL_MS, Math.max(floor, suggested)));
    } catch (error) {
      this.failFrom(error);
    } finally {
      this.polling = false;
    }
  }

  /**
   * One batch from the watch page.
   *
   * The server states how long to wait before asking again, and that is
   * honoured rather than overridden: it is the same self-throttling contract
   * the Data API offers, and ignoring it is what turns a reader into
   * something that looks like hammering.
   */
  private async pollInnertube(): Promise<void> {
    const session = this.session;
    if (!session) return;

    try {
      this.pollCount += 1;
      const batch = await pollChat(session);

      if (this.priming) {
        // Same as the Data API path: the opening answer is history, not news.
        this.priming = false;
        if (batch.items.length > 0) {
          log.info(`Skipped ${batch.items.length} message(s) already in the chat backlog`);
        }
      } else {
        for (const action of batch.items) {
          const event = innertubeEventFrom(action);
          if (event) this.push(event);
        }
      }

      if (!batch.continuation) {
        this.push(systemEvent('info', 'YouTube: the stream has gone offline'));
        log.info('YouTube chat ended');
        this.stopPolling();
        this.patch({ status: 'idle', connectedAt: null });
        return;
      }

      this.session = { ...session, continuation: batch.continuation };
      // The page's own pacing, already clamped by the reader. The config's
      // poll interval is a quota lever and this route has no quota, so it
      // has nothing to say here.
      this.schedule(batch.waitMs);
    } catch (error) {
      this.failFrom(error);
    }
  }

  /**
   * @param retry Whether another attempt could plausibly succeed. False stops
   * the reconnect loop dead, which matters for quota: retrying every couple of
   * minutes until the daily reset spends hundreds of calls to be refused
   * hundreds of times, and leaves less budget for tomorrow than doing nothing.
   */
  private fail(reason: string, retry = true): void {
    log.warn(`YouTube: ${reason}`);
    this.patch({ status: 'error', lastError: reason, connectedAt: null });
    this.push(systemEvent('error', `YouTube: ${reason}`));
    this.stopPolling();
    if (retry) this.scheduleReconnect();
    else this.clearReconnect();
  }

  /** Failure handling for a caught error, honouring what it says about retrying. */
  private failFrom(error: unknown): void {
    this.fail(describeError(error), !(error instanceof QuotaExhaustedError));
  }

  private scheduleReconnect(): void {
    if (this.manuallyDisconnected || !this.config.autoReconnect || !this.config.enabled) return;
    if (this.reconnectTimer) return;

    const attempts = this.state.reconnectAttempts + 1;
    const delay = Math.min(attempts, 10) * this.config.reconnectDelaySeconds * 1000;
    this.patch({ status: 'reconnecting', reconnectAttempts: attempts });
    log.info(`Reconnecting to YouTube in ${Math.round(delay / 1000)}s (attempt ${attempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private clearReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private stopPolling(): void {
    this.clearTimer();
    this.liveChatId = null;
    this.pageToken = null;
    // Dropped rather than kept: a continuation is only valid for the page it
    // came from, so reconnecting has to start by fetching the page again.
    this.session = null;
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.clearReconnect();
    this.stopPolling();
    this.patch({ status: 'idle', connectedAt: null, reconnectAttempts: 0 });
    log.info(
      `Disconnected from YouTube after ${this.pollCount} API call${this.pollCount === 1 ? '' : 's'}`,
    );
  }
}
