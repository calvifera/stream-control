import type {
  AppConfig,
  AuthOverview,
  Platform,
  ArchiveAnalytics,
  ArchiveFilter,
  ArchivePage,
  ArchiveSort,
  OverlaySource,
  OverlayType,
  SourceHostCheck,
  StreamEventType,
  TestEventOutcome,
  TestEventSpec,
  UsersConfig,
  UserVoiceProfile,
  VoiceSettings,
} from '@streaming/shared';
import { subscribeAuth } from './store.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });

  if (!response.ok) {
    // The API always returns `{ error }` for handled failures.
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * What the dashboard is allowed to know about a credential.
 *
 * Note what is absent: the value. There is no route that returns one, so this
 * type has no field for it — the shape itself is the guarantee.
 */
export interface CredentialStatus {
  key: string;
  configured: boolean;
  source: 'dashboard' | 'env' | null;
  length: number;
}

export interface ProviderStatus {
  id: 'tiktok' | 'google' | 'browser';
  name: string;
  configured: boolean;
  hint: string;
}

export interface ProviderVoice {
  code: string;
  name: string;
  group: string;
  language?: string;
}

export interface ServerMeta {
  voices: Array<{ code: string; name: string; group: string }>;
  eventTypes: StreamEventType[];
  overlayTypes: OverlayType[];
  ttsEndpoints: string[];
  providers: ProviderStatus[];
  /** How reachable this server is, for the access explanation on the Keys tab. */
  network: {
    host: string;
    port: number;
    loopbackOnly: boolean;
    passwordSet: boolean;
  };
  env: {
    hasSignApiKey: boolean;
    hasTikTokSession: boolean;
    hasNgrokToken: boolean;
    hasGoogleTtsKey: boolean;
  };
}

export interface OverlayWithUrls extends OverlaySource {
  localUrl: string;
  publicUrl: string | null;
  /** What to paste into your streaming software; honours `sources.host`. */
  sourceUrl: string;
}

export interface FilterTestResult {
  result: {
    text: string | null;
    filtered: boolean;
    reason: string | null;
    severity: 'none' | 'normal' | 'severe';
    evasion: boolean;
  };
  matches: string[];
  variants: string[];
  scripts: string[];
  mixedScriptWords: string[];
}

export interface UserSearchResult {
  platform: Platform;
  /** Canonical `platform:handle` — send this on any write, not `username`. */
  key: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  messages: number;
  strikes: number;
  lastSeen: number;
  trusted: boolean;
  penalized: boolean;
}

export interface KnownUserDetail extends UserSearchResult {
  userId: string;
  firstSeen: number;
  evidence: Array<{ ts: number; text: string; reason: string }>;
}

/**
 * A partial profile update. `settings` is keyed by provider and merges per
 * backend, so sending one provider's values leaves the others untouched —
 * which is why it can't reuse `UserVoiceProfile['settings']` directly.
 */
export type VoiceProfilePatch = Omit<Partial<UserVoiceProfile>, 'settings'> & {
  username: string;
  settings?: Record<string, Partial<VoiceSettings>>;
};

export interface SlideshowFolder {
  name: string;
  images: string[];
  bytes: number;
}

export interface AvatarStatus {
  cached: number;
  known: number;
  missing: number;
  running: boolean;
  lastRun: number | null;
}

export interface AvatarRefreshResult {
  checked: number;
  updated: number;
  failed: number;
  skipped: number;
  cached: number;
}

export interface ReviewEntry {
  phrase: string;
  term: string;
  distance: number;
  count: number;
  firstSeen: number;
  lastSeen: number;
  samples: Array<{ ts: number; username: string; text: string }>;
}

export interface ReviewState {
  entries: ReviewEntry[];
  ignored: string[];
}

export interface VoiceProbeResult {
  results: Array<{ code: string; ok: boolean; error?: string }>;
  available: number;
  tested: number;
}

export const api = {
  meta: () => request<ServerMeta>('/meta'),
  checkSourceHost: () => request<SourceHostCheck>('/sources/check'),
  authStatus: () => request<{ required: boolean; authenticated: boolean }>('/auth/status'),
  login: (password: string) => post<{ ok: true }>('/auth/login', { password }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  config: () => request<AppConfig>('/config'),
  patchConfig: (patch: Partial<AppConfig>) =>
    request<AppConfig>('/config', { method: 'PATCH', body: JSON.stringify(patch) }),
  resetConfig: () => post<AppConfig>('/config/reset'),

  overlays: () => request<OverlayWithUrls[]>('/overlays'),
  addOverlay: (type: OverlayType, name?: string) => post<OverlaySource>('/overlays', { type, name }),
  deleteOverlay: (id: string) => request<{ ok: true }>(`/overlays/${id}`, { method: 'DELETE' }),
  resetOverlay: (id: string) => post<OverlaySource>(`/overlays/${id}/reset`),

  connect: (username: string) => post('/connect', { username }),
  disconnect: () => post('/disconnect'),

  twitchConnect: (channel: string) => post('/twitch/connect', { channel }),
  twitchDisconnect: () => post('/twitch/disconnect'),

  /** Sign-in state for every platform. Never contains tokens. */
  authPlatforms: () => request<AuthOverview>('/auth/platforms'),
  authStart: (platform: Platform) => post<{ url: string }>(`/auth/${platform}/start`),
  authSignOut: (platform: Platform) => post<AuthOverview>(`/auth/${platform}/signout`),
  /** Fires when a sign-in completes in the callback tab. Returns an unsubscribe. */
  onAuthChange: (fn: (overview: AuthOverview) => void) => subscribeAuth(fn),

  testFilter: (text: string) => post<FilterTestResult>('/filters/test', { text }),
  testTts: (text: string, voice: string) =>
    post<{ playing: boolean; reason: string | null; filtered: boolean }>('/tts/test', {
      text,
      voice,
    }),
  skipTts: () => post('/tts/skip'),
  clearTts: () => post('/tts/clear'),
  credentials: () => request<{ credentials: CredentialStatus[] }>('/credentials'),
  setCredential: (key: string, value: string) =>
    post<{ credentials: CredentialStatus[] }>('/credentials', { key, value }),
  clearCredential: (key: string) =>
    request<{ credentials: CredentialStatus[] }>(`/credentials/${key}`, { method: 'DELETE' }),
  youtubeConnect: (videoId: string) => post('/youtube/connect', { videoId }),
  youtubeDisconnect: () => post('/youtube/disconnect'),
  youtubeUsage: () => request<{ polls: number; minutes: number }>('/youtube/usage'),

  /** Spoofs an event. See `TestEventSpec` for everything that can be set. */
  testEvent: (spec: TestEventSpec) =>
    post<{ fired: number; outcome: TestEventOutcome; outcomes: TestEventOutcome[] }>(
      '/test-event',
      spec,
    ),

  /** One page of the viewer archive. Filter/sort happen on the server so
   *  the dashboard never has to hold all 3,000+ rows at once. */
  archive: (query: {
    q?: string;
    platform?: Platform;
    sort?: ArchiveSort;
    filter?: ArchiveFilter;
    desc?: boolean;
    offset?: number;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.platform) params.set('platform', query.platform);
    if (query.sort) params.set('sort', query.sort);
    if (query.filter) params.set('filter', query.filter);
    if (query.desc === false) params.set('desc', 'false');
    if (query.offset) params.set('offset', String(query.offset));
    if (query.limit) params.set('limit', String(query.limit));
    return request<ArchivePage>(`/users/archive?${params.toString()}`);
  },
  archiveAnalytics: () => request<ArchiveAnalytics>('/users/analytics'),

  /** Whether the desktop chat panel can be launched from here. */
  panelStatus: () => request<PanelStatus>('/panel/status'),
  openPanel: () => post<PanelStatus>('/panel/open'),
  searchUsers: (query: string, limit = 12) =>
    request<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  getUser: (username: string) => request<KnownUserDetail>(`/users/${encodeURIComponent(username)}`),

  /** Directory entries for handles already on a list, so lists can show names. */
  knownUsers: (usernames: string[]) =>
    usernames.length === 0
      ? Promise.resolve([] as UserSearchResult[])
      : request<UserSearchResult[]>(
          `/users/known?usernames=${encodeURIComponent(usernames.join(','))}`,
        ),

  trustUser: (username: string, displayName?: string) =>
    post<UsersConfig>('/users/trusted', { username, displayName }),
  untrustUser: (username: string) =>
    request<UsersConfig>(`/users/trusted/${encodeURIComponent(username)}`, { method: 'DELETE' }),

  penalizeUser: (username: string, reason?: string, displayName?: string) =>
    post<UsersConfig>('/users/penalty', { username, reason, displayName }),
  pardonUser: (username: string) =>
    request<UsersConfig>(`/users/penalty/${encodeURIComponent(username)}`, { method: 'DELETE' }),

  setUserVoice: (profile: VoiceProfilePatch) => post<UsersConfig>('/users/voice', profile),
  clearUserVoice: (username: string) =>
    request<UsersConfig>(`/users/voice/${encodeURIComponent(username)}`, { method: 'DELETE' }),

  slideshows: () => request<SlideshowFolder[]>('/slideshows'),
  slideshow: (folder: string) => request<SlideshowFolder>(`/slideshows/${encodeURIComponent(folder)}`),
  /** One image at a time, raw body — no multipart dependency on the server. */
  uploadSlide: (folder: string, filename: string, file: Blob) =>
    request<{ folder: string; filename: string }>(
      `/slideshows/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } },
    ),
  deleteSlide: (folder: string, filename: string) =>
    request<{ ok: true }>(
      `/slideshows/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
    ),
  deleteSlideshow: (folder: string) =>
    request<{ ok: true }>(`/slideshows/${encodeURIComponent(folder)}`, { method: 'DELETE' }),

  avatarStatus: () => request<AvatarStatus>('/users/avatars'),
  refreshAvatars: (force = false) =>
    post<AvatarRefreshResult>('/users/avatars/refresh', { force }),

  review: () => request<ReviewState>('/review'),
  reviewBlock: (phrase: string) => post<ReviewState>('/review/block', { phrase }),
  reviewIgnore: (phrase: string) => post<ReviewState>('/review/ignore', { phrase }),
  reviewUnignore: (phrase: string) => post<ReviewState>('/review/unignore', { phrase }),
  reviewClear: () => post<ReviewState>('/review/clear', {}),

  probeVoices: (voices?: string[], provider?: string) =>
    post<VoiceProbeResult>('/tts/voices/probe', { voices, provider }),

  /** Voices for a backend. Google's list comes live from its own API. */
  voices: (provider?: string) =>
    request<{ provider: string; voices: ProviderVoice[]; note?: string }>(
      provider ? `/tts/voices?provider=${encodeURIComponent(provider)}` : '/tts/voices',
    ),

  startTunnel: () => post<{ url: string | null; error: string | null }>('/tunnel/start'),
  stopTunnel: () => post<{ url: string | null; error: string | null }>('/tunnel/stop'),
};

/** Reported by `/panel/status`. */
export interface PanelStatus {
  /** The binary exists and could be launched. */
  available: boolean;
  /** It is the optimised build rather than a debug one. */
  release: boolean;
  /** This server has already started one that has not exited. */
  running: boolean;
  /** The request came from the machine running the server, not the tunnel. */
  local: boolean;
}
