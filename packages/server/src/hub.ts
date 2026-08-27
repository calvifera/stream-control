import { listKey, readViewerKey, userKey, viewerKey } from '@streaming/shared';
import type { Server, Socket } from 'socket.io';
import type {
  AppConfig,
  ProfileUpdate,
  TestEventOutcome,
  ClientToServerEvents,
  ServerSnapshot,
  ServerToClientEvents,
  StreamEvent,
  TtsQueueItem,
  TunnelState,
} from '@streaming/shared';
import { ConfigStore } from './config/store.js';
import { FilterEngine } from './pipeline/filters.js';
import { RuleEngine, type RuleRejection } from './pipeline/rules.js';
import { SessionState } from './state/session.js';
import { UserDirectory, normalize } from './state/directory.js';
import { RetentionTracker } from './state/retention.js';
import { ReviewFeed } from './state/review.js';
import { AvatarStore } from './state/avatars.js';
import { SlideshowStore } from './state/slideshows.js';
import { AvatarPoller } from './state/avatarPoller.js';
import { TikTokManager } from './tiktok/manager.js';
import { TwitchManager } from './twitch/manager.js';
import { YouTubeManager } from './youtube/manager.js';
import { TwitchProfiles } from './twitch/helix.js';
import { TwitchModeration } from './twitch/moderation.js';
import { TwitchLive } from './twitch/live.js';
import { AuthManager } from './auth/manager.js';
import { TtsEngine } from './tts/engine.js';
import { createLogger } from './logger.js';
import { env } from './env.js';

const log = createLogger('hub');

/** Whether a connection is in a state where its viewers are still observable. */
const isLive = (status: string): boolean =>
  status === 'connected' || status === 'connecting' || status === 'reconnecting';

const HISTORY_LIMIT = 150;
/** Stats and leaderboard are chatty; batch them into one update per tick. */
const BROADCAST_INTERVAL_MS = 500;

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface ClientInfo {
  role: 'overlay' | 'dashboard';
  overlayId?: string;
  listener: boolean;
  /** A listener of last resort: only used when no real TTS source is open. */
  fallback: boolean;
}

/** Wires config, the TikTok connection, the pipeline and the socket layer together. */
export class Hub {
  readonly config = new ConfigStore();
  readonly session = new SessionState();
  readonly directory = new UserDirectory();
  readonly retention = new RetentionTracker();
  readonly review = new ReviewFeed();
  readonly avatars = new AvatarStore();
  readonly slideshows = new SlideshowStore();
  readonly avatarPoller: AvatarPoller;
  readonly filters: FilterEngine;
  readonly rules = new RuleEngine();
  readonly tts: TtsEngine;
  readonly tiktok: TikTokManager;
  readonly twitch: TwitchManager;
  readonly youtube: YouTubeManager;
  readonly auth = new AuthManager();
  readonly twitchProfiles: TwitchProfiles;
  readonly twitchModeration: TwitchModeration;
  readonly twitchLive: TwitchLive;

  private io: TypedServer | null = null;
  private clients = new Map<string, ClientInfo>();
  private history: StreamEvent[] = [];
  private statsTimer: NodeJS.Timeout | null = null;
  private statsDirty = false;
  private tunnel: TunnelState = { enabled: false, url: null, error: null };

  /** Most recent gate/filter rejections, surfaced in the dashboard. */
  private recentRejections: Array<RuleRejection & { ts: number; username: string }> = [];

  constructor() {
    const config = this.config.get();
    this.avatarPoller = new AvatarPoller(this.directory, this.avatars);
    this.filters = new FilterEngine(config.filters, config.users.severe);
    this.tts = new TtsEngine(this.resolveTtsConfig(config));
    this.tiktok = new TikTokManager(config.connection);
    this.twitch = new TwitchManager(config.twitch);
    this.twitchModeration = new TwitchModeration(
      this.auth,
      config.twitch.moderation,
      config.twitch.channel,
    );
    this.twitchLive = new TwitchLive(this.auth, (liveSince) => {
      this.twitch.setLive(liveSince);
      this.broadcastConnections();
    });
    // Started here rather than only on a config change, or a server that boots
    // with Twitch already configured would report no uptime until something
    // was edited.
    if (config.twitch.enabled && config.twitch.channel) {
      this.twitchLive.watch(config.twitch.channel);
    }
    this.youtube = new YouTubeManager(config.youtube, this.auth);
    // Fills in Twitch avatars once app credentials exist. Resolved profiles
    // are written back into the directory so the archive and overlays get
    // faces too, not just the live chat log.
    this.twitchProfiles = new TwitchProfiles(this.auth, (profiles) => {
      const updates: ProfileUpdate[] = [];
      for (const [login, profile] of profiles) {
        this.directory.applyProfile(viewerKey('twitch', login), {
          avatarUrl: profile.avatarUrl ?? undefined,
          nickname: profile.displayName ?? undefined,
        });
        updates.push({
          platform: 'twitch',
          uniqueId: login,
          avatarUrl: profile.avatarUrl ?? null,
          ...(profile.displayName ? { displayName: profile.displayName } : {}),
        });
      }

      // Tell anyone already showing this person. The events carrying them went
      // out before the lookup finished, so without this their first message
      // stays faceless permanently.
      if (updates.length > 0) {
        this.applyProfileUpdates(updates);
        this.io?.emit('profiles', updates);
      }
    });

    this.config.on('change', (next: AppConfig) => this.onConfigChange(next));
    this.tiktok.on('event', (event: StreamEvent) => this.handleEvent(event));
    this.tiktok.on('state', () => this.broadcastConnections());
    this.tiktok.on('sessionStart', () => {
      this.session.reset();
      this.rules.resetCooldowns();
      this.history = [];
      this.markStatsDirty();
    });

    this.twitch.on('event', (event: StreamEvent) => this.handleEvent(event));
    this.twitch.on('state', () => this.broadcastConnections());

    this.youtube.on('event', (event: StreamEvent) => this.handleEvent(event));
    this.youtube.on('state', () => this.broadcastConnections());
    // Twitch joining does not reset session aggregates: TikTok may already be
    // live, and wiping its counters because a second platform connected would
    // lose the night's numbers.

    this.tts.on('state', () => this.io?.emit('tts', this.tts.getState()));
    this.tts.on('play', (item: TtsQueueItem) => this.dispatchPlayback(item));
    this.tts.on('stop', () => this.io?.emit('tts:stop'));

    // Hourly, and the people shown in the dashboard go first.
    this.avatarPoller.start(60 * 60 * 1000, () => this.avatarPriority());
    this.retention.start();
  }

  /**
   * Handles worth a profile lookup before anyone else: the ones that actually
   * appear in the dashboard and in overlays.
   */
  avatarPriority(): string[] {
    const users = this.config.get().users;
    return [
      ...users.trusted,
      ...users.voiceProfiles.map((p) => p.username),
      ...users.penaltyBox.map((e) => e.username),
    ];
  }

  /**
   * The dashboard field wins, but an env var means the session id never has to
   * be typed into a UI that might be exposed through the tunnel.
   */
  private resolveTtsConfig(config: AppConfig): AppConfig['tts'] {
    const sessionId = config.tts.sessionId.trim() || env.ttSessionId || '';
    return { ...config.tts, sessionId };
  }

  private onConfigChange(next: AppConfig): void {
    this.filters.setConfig(next.filters, next.users.severe);
    this.tts.setConfig(this.resolveTtsConfig(next));
    this.tiktok.setConfig(next.connection);
    this.twitch.setConfig(next.twitch);
    this.twitchModeration.setConfig(next.twitch.moderation, next.twitch.channel);
    this.twitchLive.watch(next.twitch.enabled ? next.twitch.channel : '');
    this.youtube.setConfig(next.youtube);
    this.io?.emit('config', next);
  }

  /**
   * Decides whether a filtered message earns a strike, and drops the user in
   * the penalty box once they hit the threshold.
   *
   * Only severe-list hits count. Ordinary swearing gets filtered and forgotten
   * — the point is to catch people deliberately routing a slur around the
   * filter, not to punish anyone who says a rude word.
   */
  /**
   * Carries a penalty through to the platform, where the platform allows it.
   *
   * Until this existed the penalty box only muted TTS, so a penalised viewer
   * carried on posting to everyone watching and the only person who saw any
   * difference was the streamer. Silent on platforms with no moderation path:
   * TikTok's live connection is read-only by nature, and there is nothing to
   * report there beyond what the penalty already did.
   */
  async enforcePenalty(key: string, reason: string, automatic: boolean): Promise<void> {
    const { platform, handle } = readViewerKey(key);
    if (platform !== 'twitch' || !this.twitchModeration.enabled) return;

    const result = await this.twitchModeration.timeout(handle, reason, automatic);
    // Reported as a system event rather than only logged: a moderation action
    // that quietly failed would leave you believing someone had been dealt
    // with when they are still talking.
    this.handleEvent({
      id: `mod-${Date.now()}`,
      ts: Date.now(),
      platform: 'twitch',
      type: 'system',
      user: null,
      level: result.ok ? 'info' : 'warn',
      text: result.ok
        ? `@${handle} ${result.detail} on Twitch`
        : `Could not moderate @${handle} on Twitch — ${result.detail}`,
    });
  }

  /** Lifts a platform penalty when someone leaves the penalty box. */
  async liftPenalty(key: string): Promise<void> {
    const { platform, handle } = readViewerKey(key);
    if (platform !== 'twitch' || !this.twitchModeration.enabled) return;
    const result = await this.twitchModeration.unban(handle);
    if (!result.ok) log.warn(`Could not lift the Twitch ban on @${handle}: ${result.detail}`);
  }

  private considerPenalty(event: StreamEvent, severity: string, evasion: boolean, reason: string): void {
    if (event.type !== 'chat') return;
    if (severity !== 'severe') return;

    const config = this.config.get();
    const auto = config.users.autoPenalty;
    if (!auto.enabled) return;
    if (auto.onlyCountEvasion && !evasion) return;

    const handle = userKey(event.user);
    if (!handle) return;

    if (auto.exemptTrusted && config.users.trusted.some((u) => listKey(u) === handle)) {
      log.info(`Trusted user @${handle} tripped the severe filter — no strike recorded`);
      return;
    }

    if (config.users.penaltyBox.some((entry) => listKey(entry.username) === handle)) return;

    const strikes = this.directory.recordStrike(event.user, event.text, reason);
    log.warn(`@${handle} strike ${strikes}/${auto.strikesBeforePenalty}: ${reason}`);

    if (strikes < auto.strikesBeforePenalty) return;

    const entry = {
      username: handle,
      displayName: event.user.nickname,
      reason: `Auto: ${reason}`,
      addedAt: Date.now(),
      automatic: true,
      evidence: event.text.slice(0, 280),
    };

    this.config.update({ users: { penaltyBox: [...config.users.penaltyBox, entry] } });
    log.warn(`@${handle} moved to the penalty box (TTS muted)`);
    // `automatic: true` is the important argument. Turning Twitch moderation
    // on must not, by itself, hand the strike system the power to time people
    // out — that needs `includeAutomatic` as a second, deliberate decision.
    void this.enforcePenalty(handle, `Auto: ${reason}`, true);
    this.handleEvent({
      id: `penalty-${Date.now()}`,
      ts: Date.now(),
      platform: event.platform,
      type: 'system',
      user: null,
      level: 'warn',
      text: `@${handle} was muted from TTS: ${reason}`,
    });
  }

  attach(io: TypedServer): void {
    this.io = io;

    io.on('connection', (socket: TypedSocket) => {
      this.clients.set(socket.id, { role: 'dashboard', listener: false, fallback: false });

      socket.on('hello', (info) => {
        this.clients.set(socket.id, {
          role: info.role,
          overlayId: info.overlayId,
          listener: Boolean(info.listener),
          fallback: Boolean(info.fallback),
        });
        this.syncListenerCount();
        log.debug(`Client ${socket.id} is a ${info.role}${info.listener ? ' (listener)' : ''}`);
        // Backfill so a source added mid-stream isn't blank.
        socket.emit('history', [...this.history]);
      });

      socket.on('tts:done', (id) => this.tts.reportDone(id));
      socket.on('tts:error', ({ id, message }) => this.tts.reportError(id, message));

      socket.on('disconnect', () => {
        this.clients.delete(socket.id);
        this.syncListenerCount();
      });

      socket.emit('snapshot', this.snapshot());
      socket.emit('config', this.config.get());
      socket.emit('history', [...this.history]);
    });

    this.statsTimer = setInterval(() => this.flushStats(), BROADCAST_INTERVAL_MS);
  }

  /**
   * Pushes the state of every platform.
   *
   * Also re-emits TikTok under the original `connection` event so overlays
   * written before multi-platform keep updating.
   */
  /**
   * Backfills late profile details into the replay buffer.
   *
   * A client that connects after the lookup lands gets its history from here,
   * and would otherwise be handed the same faceless rows the live clients
   * just finished patching.
   */
  private applyProfileUpdates(updates: ProfileUpdate[]): void {
    const byKey = new Map(updates.map((u) => [viewerKey(u.platform, u.uniqueId), u]));
    for (const event of this.history) {
      if (!event.user) continue;
      const update = byKey.get(userKey(event.user));
      if (!update) continue;
      if (update.avatarUrl) event.user.avatarUrl = update.avatarUrl;
      // Only when the current name is just the handle — a nickname already
      // supplied by chat is fresher than a profile lookup.
      if (update.displayName && event.user.nickname === event.user.uniqueId) {
        event.user.nickname = update.displayName;
      }
    }
  }

  /** Pushes sign-in state to every dashboard. Carries no secrets. */
  broadcastAuth(): void {
    this.io?.emit('auth', this.auth.overview());
  }

  /**
   * A platform that is no longer connected can no longer see its viewers, so
   * any visit still open there stops accruing. Leaving them open would count
   * an unobservable stretch as watch time.
   */
  private syncRetentionConnections(): void {
    for (const [platform, state] of [
      ['tiktok', this.tiktok.getState()],
      ['twitch', this.twitch.getState()],
      ['youtube', this.youtube.getState()],
    ] as const) {
      if (isLive(state.status)) continue;
      this.retention.closePlatform(platform);
      // Its last reported viewer count is stale the moment it drops, and
      // leaving it in the headline total would keep counting an audience we
      // can no longer see.
      this.session.clearViewers(platform);
    }
  }

  private broadcastConnections(): void {
    this.syncRetentionConnections();
    if (!this.io) return;
    this.io.emit('connection', this.tiktok.getState());
    this.io.emit('connections', {
      tiktok: this.tiktok.getState(),
      twitch: this.twitch.getState(),
      youtube: this.youtube.getState(),
    });
  }

  private syncListenerCount(): void {
    let total = 0;
    let overlays = 0;
    for (const client of this.clients.values()) {
      if (!client.listener) continue;
      total += 1;
      if (!client.fallback) overlays += 1;
    }
    this.tts.setListenerCount(total, overlays);
  }

  /**
   * Sends the clip to exactly one listener. Broadcasting would make every open
   * TTS overlay speak the same line at once — an echo chamber if the source is
   * open in both a live source and a preview tab.
   *
   * A real TTS source always wins over a fallback listener, so opening the
   * dashboard alongside a live overlay never pulls audio out of the stream and into your
   * desktop speakers.
   */
  private dispatchPlayback(item: TtsQueueItem): void {
    if (!this.io) return;

    const listeners = [...this.clients.entries()].filter(([, info]) => info.listener);
    const target =
      listeners.find(([, info]) => !info.fallback) ?? listeners.find(([, info]) => info.fallback);

    if (!target) return;
    this.io.to(target[0]).emit('tts:play', item);
  }

  /**
   * The single path every event takes: filter -> aggregate -> rules -> fan out.
   *
   * Returns what happened, which is only interesting for a spoofed event: the
   * test panel reports whether a rule spoke and, when it did not, which gate
   * turned it away. Real events ignore the return value.
   */
  handleEvent(event: StreamEvent): TestEventOutcome {
    // Captured here because `filtered` only exists on a chat event, and the
    // outcome below is built for every type.
    let filtered = false;
    let filterReason: string | null = null;

    if (event.type === 'chat') {
      const result = this.filters.apply(event.text, event.user);
      event.displayText = result.text;
      event.filtered = result.filtered;
      event.filterReason = result.reason;
      filtered = result.filtered;
      filterReason = result.reason;
      this.considerPenalty(event, result.severity, result.evasion, result.reason ?? 'severe term');

      // Observational only, and only for what got through — a message the
      // filter already stopped needs no review. Never changes the outcome.
      const filterConfig = this.config.get().filters;
      if (filterConfig.enabled && filterConfig.reviewNearMatches && result.text !== null) {
        const severe = this.config.get().users.severe;
        const terms = [...severe.words, ...severe.phrases];
        for (const entry of this.review.observe(event.text, event.user.uniqueId, terms)) {
          log.info(
            `Near miss: "${entry.phrase}" sounds like "${entry.term}" ` +
              `(@${event.user.uniqueId}) — review it in the Filters tab`,
          );
        }
      }
    }

    if (event.user && this.filters.isUserBlocked(event.user.platform, event.user.uniqueId)) {
      // Blocked users are dropped entirely: no overlay, no stats, no TTS.
      return {
        eventId: event.id,
        filtered: true,
        filterReason: 'user is blocked',
        spoke: [],
        declined: [],
        synthetic: Boolean(event.synthetic),
      };
    }

    // Twitch IRC carries no avatar; Helix fills it in when app credentials
    // are configured, and leaves it null when they are not.
    if (event.user?.platform === 'twitch' && !event.user.avatarUrl) {
      event.user.avatarUrl = this.twitchProfiles.avatarFor(event.user.uniqueId);
    }

    // Spoofed events run the whole pipeline but leave no permanent trace.
    // Firing a rule a few dozen times to get it right should not invent
    // regulars who then sit in the viewer archive for ever, skewing every
    // lifetime total and appearing in the leaderboard alongside real people.
    if (event.user && !event.synthetic) {
      this.directory.observe(event.user, event.type === 'chat');
      // Any event at all counts as being present — for the quieter half of an
      // audience a like is the only signal there is.
      this.retention.observe(userKey(event.user), event.user.platform);
      // Lifetime counterpart to `session.ingest` below. Must run after
      // `observe`, which is what creates the entry this folds into.
      this.directory.record(event);
    }

    if (event.type !== 'roomStats') {
      this.session.markSeen(event.user ?? null);
    }
    this.session.ingest(event);

    // Stamped after both totals have taken this event in, so the gift that
    // pushes someone over a threshold is highlighted on the gift itself
    // rather than only on whatever they happen to say next.
    if (event.user) {
      event.giving = {
        session: this.session.sessionDiamonds(event.user),
        lifetime: this.directory.lifetimeGiven(event.user),
      };
    }

    const config = this.config.get();
    const { matches, rejections } = this.rules.evaluate(
      event,
      this.resolveTtsConfig(config),
      this.session,
      config.users,
    );

    const outcome: TestEventOutcome = {
      eventId: event.id,
      filtered,
      filterReason,
      spoke: matches.map((match) => match.rule.name),
      declined: rejections.map((rejection) => ({
        rule: rejection.ruleName,
        reason: rejection.reason,
      })),
      synthetic: Boolean(event.synthetic),
    };

    for (const match of matches) {
      this.tts.enqueue({
        ruleId: match.rule.id,
        ruleName: match.rule.name,
        text: match.text,
        voice: match.voice,
        priority: match.rule.priority,
        volume: match.volume * config.tts.masterVolume,
        rate: match.rate,
        pitch: match.pitch,
        provider: match.provider,
        username: event.user?.uniqueId ?? '',
      });
    }

    if (rejections.length > 0 && event.user) {
      for (const rejection of rejections) {
        this.recentRejections.unshift({ ...rejection, ts: Date.now(), username: event.user.uniqueId });
      }
      this.recentRejections = this.recentRejections.slice(0, 50);
    }

    // roomStats fires every few seconds and would flood the history buffer.
    if (event.type !== 'roomStats') {
      this.history.push(event);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }

    this.io?.emit('event', event);
    this.markStatsDirty();
    return outcome;
  }

  private markStatsDirty(): void {
    this.statsDirty = true;
  }

  private flushStats(): void {
    if (!this.statsDirty || !this.io) return;
    this.statsDirty = false;
    this.io.emit('stats', this.session.getStats());
    this.io.emit('leaderboard', this.session.leaderboard());
  }

  getRejections(): Array<RuleRejection & { ts: number; username: string }> {
    return [...this.recentRejections];
  }

  setTunnelState(state: TunnelState): void {
    this.tunnel = state;
    this.io?.emit('tunnel', state);
  }

  getTunnelState(): TunnelState {
    return this.tunnel;
  }

  getHistory(): StreamEvent[] {
    return [...this.history];
  }

  snapshot(): ServerSnapshot {
    return {
      connection: this.tiktok.getState(),
      connections: {
        tiktok: this.tiktok.getState(),
        twitch: this.twitch.getState(),
        youtube: this.youtube.getState(),
      },
      stats: this.session.getStats(),
      leaderboard: this.session.leaderboard(),
      tts: this.tts.getState(),
      tunnel: this.tunnel,
      localUrl: `http://localhost:${env.port}`,
    };
  }

  async dispose(): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.tts.dispose();
    await this.tiktok.disconnect({ silent: true });
    this.twitch.disconnect();
    this.twitchLive.stop();
    this.youtube.disconnect();
    this.directory.flush();
    this.retention.stop();
    this.retention.flush();
    this.config.flush();
  }
}
