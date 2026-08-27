import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  ConnectionState,
  StreamEvent,
  SystemEvent,
  TwitchConnectionConfig,
} from '@streaming/shared';
import { createLogger, describeError } from '../logger.js';
import { parseIrc, twitchEventFrom } from './normalize.js';

const log = createLogger('twitch');

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
/** Twitch drops silent connections; it PINGs, but this is the backstop. */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const systemEvent = (level: SystemEvent['level'], text: string): SystemEvent => ({
  id: randomUUID(),
  ts: Date.now(),
  platform: 'twitch',
  type: 'system',
  user: null,
  level,
  text,
});

export interface TwitchManagerEvents {
  event: (event: StreamEvent) => void;
  state: (state: ConnectionState) => void;
  sessionStart: () => void;
}

/**
 * Reads a Twitch channel's chat over anonymous IRC.
 *
 * Twitch allows read-only chat with the nick `justinfanNNNN` and no password,
 * so this needs no OAuth, no registered application and no secret on disk —
 * which is why it can ship without asking anyone to sign in. The trade-offs
 * are real and worth knowing:
 *
 *   - No avatars. IRC carries no profile images; that needs the Helix API and
 *     a client id.
 *   - No viewer count, so this never emits `roomStats`.
 *   - No follow relationship, so follower-only gates never match Twitch users.
 *
 * Everything it *can* see — chat, cheers, subs, raids, badges, moderator and
 * subscriber status — comes through IRCv3 tags and is normalized in
 * `./normalize.ts`.
 */
export class TwitchManager extends EventEmitter {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private manuallyDisconnected = false;
  private joined = false;

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

  constructor(private config: TwitchConnectionConfig) {
    super();
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  setConfig(config: TwitchConnectionConfig): void {
    const channelChanged = config.channel !== this.config.channel;
    this.config = config;
    // Changing the channel mid-session should land you in the new one rather
    // than leaving you silently watching the old.
    if (channelChanged && this.state.status === 'connected') {
      this.disconnect();
      if (config.enabled && config.channel) void this.connect();
    }
  }

  private patch(partial: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...partial };
    this.emit('state', this.getState());
  }

  private push(event: StreamEvent): void {
    this.emit('event', event);
  }

  connect(channel?: string): void {
    const target = (channel ?? this.config.channel).trim().toLowerCase().replace(/^#/, '');
    if (!target) {
      this.patch({ status: 'error', lastError: 'No Twitch channel set' });
      return;
    }

    this.manuallyDisconnected = false;
    this.clearReconnect();
    this.teardown();

    this.joined = false;
    this.patch({ status: 'connecting', username: target, lastError: null });
    log.info(`Joining #${target}`);

    let socket: WebSocket;
    try {
      socket = new WebSocket(IRC_URL);
    } catch (error) {
      this.fail(describeError(error));
      return;
    }
    this.socket = socket;

    socket.onopen = (): void => {
      // Tags carry display name, colour, badges, bits and sub info; commands
      // carry USERNOTICE (subs and raids). Without both, chat is just text.
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      socket.send(`NICK justinfan${Math.floor(Math.random() * 80_000) + 1000}`);
      socket.send(`JOIN #${target}`);
      this.armIdleTimer();
    };

    socket.onmessage = (message: MessageEvent): void => {
      this.armIdleTimer();
      for (const line of String(message.data).split('\r\n')) {
        if (line) this.handleLine(line, target, socket);
      }
    };

    socket.onerror = (): void => {
      // The error event carries nothing useful; onclose does the reporting.
      log.debug('Twitch socket error');
    };

    socket.onclose = (): void => {
      this.clearIdleTimer();
      if (this.manuallyDisconnected) {
        this.patch({ status: 'idle', connectedAt: null });
        return;
      }
      this.patch({ status: 'error', connectedAt: null, lastError: 'Connection closed' });
      this.scheduleReconnect();
    };
  }

  private handleLine(line: string, target: string, socket: WebSocket): void {
    // Answer PING before anything else or Twitch drops the connection.
    if (line.startsWith('PING')) {
      socket.send('PONG :tmi.twitch.tv');
      return;
    }

    const message = parseIrc(line);
    if (!message) return;

    // 366 = end of NAMES, the first reliable signal that the join succeeded.
    if (message.command === '366' && !this.joined) {
      this.joined = true;
      this.patch({
        status: 'connected',
        connectedAt: Date.now(),
        reconnectAttempts: 0,
        lastError: null,
        hostNickname: target,
      });
      log.info(`Connected to #${target}`);
      this.emit('sessionStart');
      this.push(systemEvent('info', `Connected to Twitch #${target}`));
      return;
    }

    if (message.command === 'NOTICE' && !this.joined) {
      // A NOTICE before joining means the join was refused outright — a
      // channel that does not exist, or one this connection cannot read.
      this.fail(message.text || 'Twitch refused the join');
      return;
    }

    const event = twitchEventFrom(message, target);
    if (event) this.push(event);
  }

  private fail(reason: string): void {
    log.warn(`Twitch: ${reason}`);
    this.patch({ status: 'error', lastError: reason, connectedAt: null });
    this.push(systemEvent('error', `Twitch: ${reason}`));
    this.teardown();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.manuallyDisconnected || !this.config.autoReconnect || !this.config.enabled) return;
    if (this.reconnectTimer) return;

    const attempts = this.state.reconnectAttempts + 1;
    // Linear backoff capped at 10x, matching the TikTok manager's behaviour.
    const delay = Math.min(attempts, 10) * this.config.reconnectDelaySeconds * 1000;
    this.patch({ status: 'reconnecting', reconnectAttempts: attempts });
    log.info(`Reconnecting to Twitch in ${Math.round(delay / 1000)}s (attempt ${attempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      log.warn('No traffic from Twitch in 5 minutes — reconnecting');
      this.teardown();
      this.scheduleReconnect();
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private teardown(): void {
    this.clearIdleTimer();
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    // Drop the handlers first so the close we are about to cause does not
    // re-enter onclose and schedule a second reconnect.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closing; nothing to do.
    }
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.clearReconnect();
    this.teardown();
    this.patch({ status: 'idle', connectedAt: null, reconnectAttempts: 0 });
    log.info('Disconnected from Twitch');
  }
}
