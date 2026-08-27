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
      this.fail(describeError(error));
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

    const data = await this.call<{
      items?: { snippet?: { title?: string; liveChatId?: string } }[];
    }>(token, 'liveBroadcasts', {
      part: 'snippet',
      broadcastStatus: 'active',
      broadcastType: 'all',
      mine: 'true',
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
        throw new Error('YouTube API quota exhausted for today — chat will resume tomorrow.');
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

      const data = await this.call<{
        items?: YouTubeChatMessage[];
        nextPageToken?: string;
        pollingIntervalMillis?: number;
        offlineAt?: string;
      }>(token, 'liveChatMessages', params);

      this.pageToken = data.nextPageToken ?? this.pageToken;

      for (const item of data.items ?? []) {
        const event = youtubeEventFrom(item);
        if (event) this.push(event);
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
      this.fail(describeError(error));
    } finally {
      this.polling = false;
    }
  }

  private fail(reason: string): void {
    log.warn(`YouTube: ${reason}`);
    this.patch({ status: 'error', lastError: reason, connectedAt: null });
    this.push(systemEvent('error', `YouTube: ${reason}`));
    this.stopPolling();
    this.scheduleReconnect();
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
