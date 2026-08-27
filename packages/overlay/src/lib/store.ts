import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  DEMO_LEADERBOARD,
  DEMO_STATS,
  DEMO_TTS,
  demoEvent,
  demoHistory,
} from '../overlay/demo.js';
import type {
  AppConfig,
  AuthOverview,
  ClientToServerEvents,
  LeaderboardEntry,
  LogEntry,
  ServerSnapshot,
  ServerToClientEvents,
  SessionStats,
  StreamEvent,
  TtsQueueItem,
  TtsState,
} from '@streaming/shared';

export interface LiveState {
  socketConnected: boolean;
  config: AppConfig | null;
  snapshot: ServerSnapshot | null;
  stats: SessionStats | null;
  leaderboard: LeaderboardEntry[];
  tts: TtsState | null;
  /** Rolling buffer, oldest first. Overlays that need history read this. */
  events: StreamEvent[];
  logs: LogEntry[];
}

const EVENT_BUFFER = 200;
const LOG_BUFFER = 300;

let state: LiveState = {
  socketConnected: false,
  config: null,
  snapshot: null,
  stats: null,
  leaderboard: [],
  tts: null,
  events: [],
  logs: [],
};

const stateListeners = new Set<() => void>();
/** Separate channel for "an event just happened", used to trigger animations. */
const eventListeners = new Set<(event: StreamEvent) => void>();
const playListeners = new Set<(item: TtsQueueItem) => void>();
const stopListeners = new Set<() => void>();
/** Sign-in changes arrive from the OAuth callback tab, not from a request. */
const authListeners = new Set<(overview: AuthOverview) => void>();

export function subscribeAuth(fn: (overview: AuthOverview) => void): () => void {
  authListeners.add(fn);
  ensureSocket();
  return () => authListeners.delete(fn);
}

function setState(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  for (const listener of stateListeners) listener();
}

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;
let identity: Parameters<ClientToServerEvents['hello']>[0] = { role: 'dashboard' };

function ensureSocket(): TypedSocket {
  if (socket) return socket;

  socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    setState({ socketConnected: true });
    socket?.emit('hello', identity);
  });
  socket.on('disconnect', () => setState({ socketConnected: false }));

  socket.on('snapshot', (snapshot) =>
    setState({
      snapshot,
      stats: snapshot.stats,
      leaderboard: snapshot.leaderboard,
      tts: snapshot.tts,
    }),
  );
  socket.on('config', (config) => setState({ config }));
  socket.on('stats', (stats) => setState({ stats }));
  socket.on('leaderboard', (leaderboard) => setState({ leaderboard }));
  socket.on('tts', (tts) => setState({ tts }));
  socket.on('connection', (connection) =>
    setState({ snapshot: state.snapshot ? { ...state.snapshot, connection } : null }),
  );
  socket.on('auth', (overview) => {
    for (const listener of authListeners) listener(overview);
  });

  socket.on('connections', (connections) =>
    setState({ snapshot: state.snapshot ? { ...state.snapshot, connections } : null }),
  );
  socket.on('tunnel', (tunnel) =>
    setState({ snapshot: state.snapshot ? { ...state.snapshot, tunnel } : null }),
  );

  socket.on('history', (events) => setState({ events: events.slice(-EVENT_BUFFER) }));

  /*
   * A profile that resolved after its event was sent. Rebuilds the affected
   * events rather than mutating them: the chat log renders from this array,
   * and React reconciles rows by event id, so replacing the object updates the
   * avatar in place without remounting the row or re-triggering its arrival
   * animation.
   */
  socket.on('profiles', (updates) => {
    if (updates.length === 0) return;
    const byKey = new Map(
      updates.map((update) => [`${update.platform}:${update.uniqueId.toLowerCase()}`, update]),
    );

    let changed = false;
    const events = state.events.map((event) => {
      if (!event.user) return event;
      const update = byKey.get(`${event.user.platform}:${event.user.uniqueId.toLowerCase()}`);
      if (!update) return event;

      const avatarUrl = update.avatarUrl ?? event.user.avatarUrl;
      const nickname =
        update.displayName && event.user.nickname === event.user.uniqueId
          ? update.displayName
          : event.user.nickname;
      if (avatarUrl === event.user.avatarUrl && nickname === event.user.nickname) return event;

      changed = true;
      return { ...event, user: { ...event.user, avatarUrl, nickname } };
    });

    // Skip the state update entirely when nothing moved, so a repeated lookup
    // does not re-render every open overlay for no reason.
    if (changed) setState({ events });
  });

  socket.on('event', (event) => {
    setState({ events: [...state.events, event].slice(-EVENT_BUFFER) });
    for (const listener of eventListeners) listener(event);
  });

  socket.on('log', (entry) => {
    setState({ logs: [...state.logs, entry].slice(-LOG_BUFFER) });
  });

  socket.on('tts:play', (item) => {
    for (const listener of playListeners) listener(item);
  });
  socket.on('tts:stop', () => {
    for (const listener of stopListeners) listener();
  });

  return socket;
}

/**
 * Declares what this page is. `listener` marks the one page allowed to play
 * TTS audio — the server sends each clip to a single listener so multiple
 * open tabs don't speak in unison.
 */
export function identify(info: Parameters<ClientToServerEvents['hello']>[0]): void {
  identity = info;
  const active = ensureSocket();
  if (active.connected) active.emit('hello', info);
}

export function reportTtsDone(id: string): void {
  socket?.emit('tts:done', id);
}

export function reportTtsError(id: string, message: string): void {
  socket?.emit('tts:error', { id, message });
}

export function onStreamEvent(listener: (event: StreamEvent) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function onTtsPlay(listener: (item: TtsQueueItem) => void): () => void {
  playListeners.add(listener);
  return () => playListeners.delete(listener);
}

export function onTtsStop(listener: () => void): () => void {
  stopListeners.add(listener);
  return () => stopListeners.delete(listener);
}

/* ------------------------------------------------------------------ *
 * Demo mode
 *
 * Drives the widgets from invented data instead of a socket. The "instead"
 * matters: a preview must not open a connection, because an overlay that
 * identifies itself as a TTS source would be handed real clips and take audio
 * away from OBS. In demo mode no socket is ever created.
 * ------------------------------------------------------------------ */

/*
 * Read at module load, not in an effect. `useSyncExternalStore` subscribes
 * during the first render — before any effect runs — so a flag set later is
 * set too late: the socket would already be open and its (empty) snapshot
 * would overwrite the demo data a moment after it appeared.
 */
const demoMode =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === '1';

let demoStarted = false;
let demoTimer: number | null = null;

export function isDemoMode(): boolean {
  return demoMode;
}

export function startDemo(): void {
  if (demoStarted) return;
  demoStarted = true;

  // Config still comes from the server — the preview should reflect the real
  // sizes, colours and settings — but over HTTP, which opens nothing.
  void fetch('/api/config')
    .then((response) => response.json() as Promise<AppConfig>)
    .then((config) => setState({ config, socketConnected: true }))
    .catch(() => undefined);

  setState({
    events: demoHistory(),
    stats: DEMO_STATS,
    leaderboard: DEMO_LEADERBOARD,
    tts: DEMO_TTS,
    socketConnected: true,
  });

  demoTimer = window.setInterval(() => {
    const event = demoEvent();
    setState({ events: [...state.events, event].slice(-EVENT_BUFFER) });
    for (const listener of eventListeners) listener(event);
  }, 2600);
}

export function stopDemo(): void {
  if (demoTimer !== null) {
    window.clearInterval(demoTimer);
    demoTimer = null;
  }
  demoStarted = false;
}

function subscribe(listener: () => void): () => void {
  if (!demoMode) ensureSocket();
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

const getState = (): LiveState => state;

export function useLive(): LiveState {
  return useSyncExternalStore(subscribe, getState, getState);
}
