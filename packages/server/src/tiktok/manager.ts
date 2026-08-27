import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  ControlEvent,
  SignConfig,
  TikTokLiveConnection,
  WebcastEvent,
  type TikTokLiveConstructorConnectionOptions,
} from 'tiktok-live-connector';
import type { ConnectionConfig, ConnectionState, StreamEvent, SystemEvent } from '@streaming/shared';
import { createLogger, describeError } from '../logger.js';
import { env } from '../env.js';
import {
  normalizeChat,
  normalizeEmote,
  normalizeEnvelope,
  normalizeFollow,
  normalizeGift,
  normalizeLike,
  normalizeMember,
  normalizeQuestion,
  normalizeRoomStats,
  normalizeShare,
  normalizeSubscribe,
} from './normalize.js';

const log = createLogger('tiktok');

const systemEvent = (level: SystemEvent['level'], text: string): SystemEvent => ({
  id: randomUUID(),
  ts: Date.now(),
  platform: 'tiktok',
  type: 'system',
  user: null,
  level,
  text,
});

export interface TikTokManagerEvents {
  event: (event: StreamEvent) => void;
  state: (state: ConnectionState) => void;
  /** Fired when a fresh room is joined, so session aggregates can reset. */
  sessionStart: () => void;
}

/**
 * Owns the lifecycle of the webcast connection: connect, normalize, reconnect.
 *
 * `tiktok-live-connector` talks to TikTok's internal Webcast service, which is
 * reverse-engineered rather than a supported API. Connections drop, rooms go
 * offline and signatures rate-limit, so everything here treats failure as
 * routine and backs off instead of throwing.
 */
export class TikTokManager extends EventEmitter {
  private connection: TikTokLiveConnection | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private state: ConnectionState = {
    status: 'idle',
    username: '',
    roomId: null,
    hostNickname: null,
    hostAvatarUrl: null,
    connectedAt: null,
    lastError: null,
    reconnectAttempts: 0,
  };

  /** User ids seen this session, for the `isFirstJoin` flag on join events. */
  private seenJoins = new Set<string>();
  private manuallyDisconnected = false;

  constructor(private config: ConnectionConfig) {
    super();
    if (env.signApiKey) SignConfig.apiKey = env.signApiKey;
  }

  setConfig(config: ConnectionConfig): void {
    this.config = config;
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  private patchState(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.getState());
  }

  private push(event: StreamEvent): void {
    this.emit('event', event);
  }

  private notify(level: SystemEvent['level'], text: string): void {
    this.push(systemEvent(level, text));
  }

  get isConnected(): boolean {
    return this.state.status === 'connected';
  }

  async connect(username?: string): Promise<void> {
    const handle = (username ?? this.config.username).trim().replace(/^@/, '');
    if (!handle) throw new Error('Set a TikTok username before connecting');

    await this.disconnect({ silent: true });
    this.manuallyDisconnected = false;
    this.seenJoins.clear();

    this.patchState({
      status: 'connecting',
      username: handle,
      lastError: null,
      roomId: null,
    });
    log.info(`Connecting to @${handle}`);

    const options: TikTokLiveConstructorConnectionOptions = {
      processInitialData: true,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: this.config.enableExtendedGiftInfo,
      ...(env.signApiKey ? { signApiKey: env.signApiKey } : {}),
      // An authenticated session unlocks a couple of restricted rooms but is
      // strictly optional; without it we connect as an anonymous viewer.
      ...(env.ttSessionId
        ? {
            session: {
              cookie: {
                type: 'cookie' as const,
                value: { sessionId: env.ttSessionId, ttTargetIdc: env.ttTargetIdc },
              },
            },
          }
        : {}),
    };

    const connection = new TikTokLiveConnection(handle, options);
    this.connection = connection;
    this.registerHandlers(connection, handle);

    try {
      const result = await connection.connect();
      this.emit('sessionStart');
      this.patchState({
        status: 'connected',
        roomId: result.roomId ?? null,
        connectedAt: Date.now(),
        reconnectAttempts: 0,
        lastError: null,
        hostNickname: readRoomOwner(result.roomInfo)?.nickname ?? null,
        hostAvatarUrl: readRoomOwner(result.roomInfo)?.avatar ?? null,
      });
      log.info(`Connected to @${handle} (room ${result.roomId})`);
      this.notify('info', `Connected to @${handle}`);
    } catch (error) {
      const message = describeError(error);
      log.error(`Could not connect to @${handle}`, error);
      this.patchState({ status: 'error', lastError: message });
      this.notify('error', `Could not connect to @${handle}: ${message}`);
      this.scheduleReconnect();
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private registerHandlers(connection: TikTokLiveConnection, host: string): void {
    connection.on(WebcastEvent.CHAT, (msg) => this.push(normalizeChat(msg, host)));
    connection.on(WebcastEvent.GIFT, (msg) => this.push(normalizeGift(msg, host)));
    connection.on(WebcastEvent.FOLLOW, (msg) => this.push(normalizeFollow(msg, host)));
    connection.on(WebcastEvent.SHARE, (msg) => this.push(normalizeShare(msg, host)));
    connection.on(WebcastEvent.LIKE, (msg) => this.push(normalizeLike(msg, host)));
    connection.on(WebcastEvent.SUB_NOTIFY, (msg) => this.push(normalizeSubscribe(msg, host)));
    connection.on(WebcastEvent.ENVELOPE, (msg) => this.push(normalizeEnvelope(msg, host)));
    connection.on(WebcastEvent.QUESTION_NEW, (msg) => this.push(normalizeQuestion(msg, host)));
    connection.on(WebcastEvent.EMOTE, (msg) => this.push(normalizeEmote(msg, host)));
    connection.on(WebcastEvent.ROOM_USER, (msg) => this.push(normalizeRoomStats(msg, host)));

    connection.on(WebcastEvent.MEMBER, (msg) => {
      const userId = msg.user?.id ?? '';
      const isFirstJoin = Boolean(userId) && !this.seenJoins.has(userId);
      if (userId) this.seenJoins.add(userId);
      this.push(normalizeMember(msg, host, isFirstJoin));
    });

    connection.on(WebcastEvent.STREAM_END, () => {
      log.info(`@${host} ended the stream`);
      this.push({
        id: randomUUID(),
        ts: Date.now(),
        platform: 'tiktok',
        type: 'streamEnd',
        user: null,
        reason: 'The host ended the stream',
      });
      this.patchState({ status: 'idle', connectedAt: null });
      this.scheduleReconnect();
    });

    connection.on(ControlEvent.DISCONNECTED, () => {
      if (this.manuallyDisconnected) return;
      log.warn('WebSocket disconnected');
      this.patchState({ status: 'reconnecting', connectedAt: null });
      this.notify('warn', 'Lost connection to TikTok');
      this.scheduleReconnect();
    });

    connection.on(ControlEvent.ERROR, (error) => {
      const message = describeError(error);
      // Decode errors on exotic frames are noisy and harmless — the rest of
      // the stream keeps flowing, so don't surface them as connection errors.
      log.warn(`Connector error: ${message}`);
      this.patchState({ lastError: message });
    });
  }

  private scheduleReconnect(): void {
    if (!this.config.autoReconnect || this.manuallyDisconnected) return;
    if (this.reconnectTimer) return;

    const attempts = this.state.reconnectAttempts + 1;
    // Linear backoff capped at 10x, so a long-offline host is polled at a
    // sane rate instead of hammering the sign server.
    const delayMs = this.config.reconnectDelaySeconds * 1000 * Math.min(attempts, 10);
    this.patchState({ status: 'reconnecting', reconnectAttempts: attempts });
    log.info(`Reconnecting in ${Math.round(delayMs / 1000)}s (attempt ${attempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        /* connect() already logged, scheduled the next attempt and set state */
      });
    }, delayMs);
  }

  async disconnect(options: { silent?: boolean } = {}): Promise<void> {
    this.manuallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const connection = this.connection;
    this.connection = null;

    if (connection) {
      try {
        connection.removeAllListeners();
        connection.disconnect();
      } catch (error) {
        log.warn(`Error while disconnecting: ${describeError(error)}`);
      }
    }

    if (!options.silent) {
      this.patchState({ status: 'idle', connectedAt: null, roomId: null, reconnectAttempts: 0 });
      this.notify('info', 'Disconnected');
      log.info('Disconnected');
    }
  }
}

/** Room info shape varies; pull the owner defensively. */
function readRoomOwner(roomInfo: unknown): { nickname: string; avatar: string | null } | null {
  if (!roomInfo || typeof roomInfo !== 'object') return null;
  const data = (roomInfo as { data?: { owner?: Record<string, unknown> } }).data;
  const owner = data?.owner;
  if (!owner) return null;

  const nickname = typeof owner.nickname === 'string' ? owner.nickname : null;
  const avatarList = (owner.avatar_thumb as { url_list?: string[] } | undefined)?.url_list;
  const avatar = Array.isArray(avatarList) && avatarList.length > 0 ? (avatarList[0] as string) : null;

  return nickname ? { nickname, avatar } : null;
}
