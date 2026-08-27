import type { AuthOverview } from './auth.js';
import type { AppConfig } from './config.js';
import type { StreamEvent } from './events.js';
import type { Platform } from './platforms.js';
import type {
  ConnectionState,
  LeaderboardEntry,
  ServerSnapshot,
  SessionStats,
  TtsQueueItem,
  TtsState,
  TunnelState,
} from './state.js';

/** Server -> client. */
export interface ServerToClientEvents {
  snapshot: (snapshot: ServerSnapshot) => void;
  config: (config: AppConfig) => void;
  event: (event: StreamEvent) => void;
  /** Replayed history so a freshly opened overlay isn't blank. */
  history: (events: StreamEvent[]) => void;
  stats: (stats: SessionStats) => void;
  /** TikTok only, kept for existing overlays. */
  connection: (state: ConnectionState) => void;
  /** Any platform. Carries which one, so the dashboard can route it. */
  connections: (states: Partial<Record<Platform, ConnectionState>>) => void;
  /** Sign-in state per platform. Never contains tokens. */
  auth: (overview: AuthOverview) => void;
  leaderboard: (entries: LeaderboardEntry[]) => void;
  tts: (state: TtsState) => void;
  /** Play this item now. Only sent to clients that registered as listeners. */
  'tts:play': (item: TtsQueueItem) => void;
  /** Stop whatever is playing (skip / clear pressed in the dashboard). */
  'tts:stop': () => void;
  tunnel: (state: TunnelState) => void;
  /**
   * Profile details that arrived after the event they belong to.
   *
   * Twitch chat carries no avatar, so the first message from someone new is
   * broadcast faceless and the picture is fetched a few hundred milliseconds
   * later. Without this the already-sent event keeps its blank avatar for
   * ever — which mattered most for the very common viewer who says one thing
   * and is never heard from again, and so never got a face at all.
   */
  profiles: (updates: ProfileUpdate[]) => void;
  log: (entry: LogEntry) => void;
}

/** A late-arriving profile for someone whose events are already on screen. */
export interface ProfileUpdate {
  platform: Platform;
  /** Bare handle, matching `StreamUser.uniqueId`. */
  uniqueId: string;
  avatarUrl: string | null;
  /** Only when the platform gave us a better one than the handle. */
  displayName?: string;
}

/** Client -> server. */
export interface ClientToServerEvents {
  /**
   * Identify this socket. `listener: true` means the client owns an <audio>
   * element and can receive `tts:play`.
   *
   * `fallback: true` marks a listener of last resort — the dashboard sets it
   * so speech is audible before any TTS browser source exists, without
   * stealing audio from a real one once you add it.
   */
  hello: (info: {
    role: 'overlay' | 'dashboard';
    overlayId?: string;
    listener?: boolean;
    fallback?: boolean;
  }) => void;
  'tts:done': (id: string) => void;
  'tts:error': (payload: { id: string; message: string }) => void;
}

export interface LogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
}

export const SOCKET_PATH = '/socket.io';
