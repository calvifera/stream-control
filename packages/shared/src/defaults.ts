import {
  CONFIG_VERSION,
  DEFAULT_CONDITIONS,
  DEFAULT_FILTERS,
  DEFAULT_GATE,
  DEFAULT_STYLE,
  DEFAULT_USERS,
  type AppConfig,
  type ChatPanelConfig,
  type OverlaySettings,
  type OverlaySource,
  type OverlayStyle,
  type OverlayType,
  type TtsRule,
} from './config.js';
import type { HighlightTier } from './highlights.js';

const style = (over: Partial<OverlayStyle> = {}): OverlayStyle => ({ ...DEFAULT_STYLE, ...over });

export const DEFAULT_OVERLAYS: OverlaySource[] = [
  {
    id: 'chat',
    name: 'Live chat',
    type: 'chat',
    group: '',
    enabled: true,
    width: 480,
    height: 720,
    align: 'start',
    justify: 'end',
    style: style(),
    settings: {
      type: 'chat',
      chat: {
        maxMessages: 12,
        messageTtl: 60,
        showAvatars: true,
        showBadges: true,
        showGifts: true,
        showFollows: true,
        showJoins: false,
        hideFiltered: true,
        newestFirst: false,
        animation: 'slide-left',
        colorfulNames: true,
        density: 'compact',
        showPlatform: true,
        showHighlights: true,
        platforms: [],
        mergeRuns: false,
      },
    },
  },
  {
    id: 'alerts',
    name: 'Alerts',
    type: 'alerts',
    group: '',
    enabled: true,
    width: 800,
    height: 320,
    align: 'center',
    justify: 'center',
    style: style({ fontSize: 30, itemBackground: 'rgba(12, 12, 20, 0.82)' }),
    settings: {
      type: 'alerts',
      alerts: {
        eventTypes: ['follow', 'gift', 'subscribe', 'share'],
        durationMs: 5000,
        animation: 'pop',
        minDiamonds: 1,
        showAvatar: true,
        showGiftImage: true,
        templates: {
          follow: '{{nickname}} followed!',
          gift: '{{nickname}} sent {{count}}x {{gift}}',
          subscribe: '{{nickname}} subscribed!',
          share: '{{nickname}} shared the stream',
          join: '{{nickname}} joined',
        },
        soundUrl: '',
        soundVolume: 0.7,
      },
    },
  },
  {
    id: 'tts',
    name: 'TTS audio',
    type: 'tts',
    group: '',
    enabled: true,
    width: 640,
    height: 200,
    align: 'center',
    justify: 'end',
    style: style({ fontSize: 20 }),
    settings: {
      type: 'tts',
      tts: { showCaption: true, captionMaxChars: 140, showQueue: false, queueSize: 3 },
    },
  },
  {
    id: 'goal',
    name: 'Like goal',
    type: 'goal',
    group: '',
    enabled: true,
    width: 520,
    height: 120,
    align: 'center',
    justify: 'center',
    style: style({ fontSize: 20 }),
    settings: {
      type: 'goal',
      goal: {
        metric: 'likes',
        label: 'Like goal',
        target: 10000,
        startValue: 0,
        showNumbers: true,
        showPercent: true,
        barHeight: 22,
      },
    },
  },
  {
    id: 'leaderboard',
    name: 'Top gifters',
    type: 'leaderboard',
    group: '',
    enabled: true,
    width: 380,
    height: 420,
    align: 'start',
    justify: 'start',
    style: style({ fontSize: 19 }),
    settings: {
      type: 'leaderboard',
      leaderboard: {
        metric: 'diamonds',
        size: 5,
        title: 'Top gifters',
        showAvatars: true,
        showValues: true,
      },
    },
  },
  {
    id: 'counters',
    name: 'Stat counters',
    type: 'counter',
    group: '',
    enabled: true,
    width: 640,
    height: 110,
    align: 'center',
    justify: 'start',
    style: style({ fontSize: 22 }),
    settings: {
      type: 'counter',
      counter: {
        metrics: ['viewers', 'likes', 'diamonds', 'followers'],
        layout: 'row',
        showLabels: true,
        showIcons: true,
      },
    },
  },
  {
    id: 'ticker',
    name: 'Event ticker',
    type: 'ticker',
    group: '',
    enabled: false,
    width: 1280,
    height: 60,
    align: 'center',
    justify: 'center',
    style: style({ fontSize: 20 }),
    settings: {
      type: 'ticker',
      ticker: {
        eventTypes: ['follow', 'gift', 'subscribe', 'share'],
        speedPxPerSecond: 60,
        separator: '  •  ',
        maxItems: 20,
      },
    },
  },
];

/** Per-type starting settings, used when the dashboard adds a new source. */
export function defaultSettingsFor(type: OverlayType): OverlaySettings {
  switch (type) {
    case 'chat':
      return {
        type: 'chat',
        chat: {
          maxMessages: 12,
          messageTtl: 60,
          showAvatars: true,
          showBadges: true,
          showGifts: true,
          showFollows: true,
          showJoins: false,
          hideFiltered: true,
          newestFirst: false,
          animation: 'slide-left',
          colorfulNames: true,
          density: 'compact',
          showPlatform: true,
          showHighlights: true,
          platforms: [],
          mergeRuns: false,
        },
      };
    case 'alerts':
      return {
        type: 'alerts',
        alerts: {
          eventTypes: ['follow', 'gift', 'subscribe'],
          durationMs: 5000,
          animation: 'pop',
          minDiamonds: 1,
          showAvatar: true,
          showGiftImage: true,
          templates: {
            follow: '{{nickname}} followed!',
            gift: '{{nickname}} sent {{count}}x {{gift}}',
            subscribe: '{{nickname}} subscribed!',
          },
          soundUrl: '',
          soundVolume: 0.7,
        },
      };
    case 'tts':
      return {
        type: 'tts',
        tts: { showCaption: true, captionMaxChars: 140, showQueue: false, queueSize: 3 },
      };
    case 'goal':
      return {
        type: 'goal',
        goal: {
          metric: 'likes',
          label: 'Like goal',
          target: 10000,
          startValue: 0,
          showNumbers: true,
          showPercent: true,
          barHeight: 22,
        },
      };
    case 'ticker':
      return {
        type: 'ticker',
        ticker: {
          eventTypes: ['follow', 'gift', 'subscribe'],
          speedPxPerSecond: 60,
          separator: '  •  ',
          maxItems: 20,
        },
      };
    case 'leaderboard':
      return {
        type: 'leaderboard',
        leaderboard: {
          metric: 'diamonds',
          size: 5,
          title: 'Top gifters',
          showAvatars: true,
          showValues: true,
        },
      };
    case 'counter':
      return {
        type: 'counter',
        counter: {
          metrics: ['viewers', 'likes', 'diamonds'],
          layout: 'row',
          showLabels: true,
          showIcons: true,
        },
      };
    case 'slideshow':
      return {
        type: 'slideshow',
        slideshow: {
          folder: '',
          intervalSeconds: 6,
          transition: 'crossfade',
          transitionMs: 700,
          shuffle: false,
          fit: 'cover',
          cornerRadius: 12,
          showCaption: false,
          once: false,
        },
      };
    case 'custom':
      return {
        type: 'custom',
        custom: {
          html: '<div class="row"><img src="{{avatar}}" alt="" /><b>{{nickname}}</b> {{message}}</div>',
          css: '.row{display:flex;align-items:center;gap:10px}\n.row img{width:36px;height:36px;border-radius:50%}',
          eventTypes: ['chat'],
          maxItems: 8,
          itemTtlMs: 12000,
        },
      };
  }
}

/** Builds a complete overlay source ready to be appended to the config. */
export function createOverlay(type: OverlayType, id: string, name?: string): OverlaySource {
  const sizes: Record<OverlayType, [number, number]> = {
    chat: [480, 720],
    alerts: [800, 320],
    tts: [640, 200],
    goal: [520, 120],
    ticker: [1280, 60],
    leaderboard: [380, 420],
    counter: [640, 110],
    slideshow: [800, 450],
    custom: [640, 400],
  };
  const [width, height] = sizes[type];

  return {
    id,
    name: name?.trim() || `${type.charAt(0).toUpperCase()}${type.slice(1)} source`,
    type,
    group: '',
    enabled: true,
    width,
    height,
    align: 'start',
    justify: 'start',
    style: { ...DEFAULT_STYLE },
    settings: defaultSettingsFor(type),
  };
}

export const DEFAULT_TTS_RULES: TtsRule[] = [
  {
    id: 'chat-followers',
    name: 'Read chat (followers only)',
    enabled: true,
    eventTypes: ['chat'],
    template: '{{nickname}} says {{message}}',
    voice: 'en_us_002',
    platforms: [],
    voicePool: [],
    priority: 0,
    cooldownSeconds: 8,
    maxChars: 180,
    gate: { ...DEFAULT_GATE, followersOnly: true },
    conditions: { ...DEFAULT_CONDITIONS, minLength: 2 },
    volume: 1,
    rate: 1,
  },
  {
    id: 'gift-thanks',
    name: 'Thank gifters',
    enabled: true,
    eventTypes: ['gift'],
    template: 'Thank you {{nickname}} for the {{count}} {{gift}}!',
    voice: 'en_us_006',
    platforms: [],
    voicePool: [],
    priority: 10,
    cooldownSeconds: 0,
    maxChars: 120,
    gate: { ...DEFAULT_GATE },
    conditions: { ...DEFAULT_CONDITIONS, minDiamonds: 1 },
    volume: 1,
    rate: 1,
  },
  {
    id: 'say-command',
    name: '!say command (subscribers)',
    enabled: false,
    eventTypes: ['chat'],
    template: '{{message}}',
    voice: 'random',
    platforms: [],
    voicePool: ['en_us_ghostface', 'en_us_rocket', 'en_us_stitch', 'en_male_narration'],
    priority: 5,
    cooldownSeconds: 30,
    maxChars: 160,
    gate: { ...DEFAULT_GATE, subscribersOnly: true },
    conditions: { ...DEFAULT_CONDITIONS, requirePrefix: '!say', stripPrefix: true, minLength: 2 },
    volume: 1,
    rate: 1,
  },
  {
    id: 'follow-shout',
    name: 'Shout out new followers',
    enabled: false,
    eventTypes: ['follow'],
    template: 'Welcome {{nickname}}, thanks for the follow!',
    voice: 'en_us_001',
    platforms: [],
    voicePool: [],
    priority: 8,
    cooldownSeconds: 0,
    maxChars: 100,
    gate: { ...DEFAULT_GATE },
    conditions: { ...DEFAULT_CONDITIONS },
    volume: 1,
    rate: 1,
  },
];

/**
 * Panel defaults.
 *
 * 0.72 rather than something more dramatic: at lower values the background
 * stops separating the text from whatever is moving behind it, and chat over
 * a bright game becomes genuinely unreadable. It is a slider — this is only
 * where it starts.
 */
export const DEFAULT_CHAT_PANEL: ChatPanelConfig = {
  opacity: 0.72,
  background: '#07080d',
  fontScale: 1,
  alwaysOnTop: true,
  newestAtBottom: true,
  chatOnly: false,
};

/**
 * Starting highlight tiers.
 *
 * Thresholds are set to catch a handful of people a stream rather than a
 * third of the room. That is the whole design constraint: an animated name
 * works because it is rare, and the moment several are on screen at once
 * they stop pulling the eye and just make chat hard to read.
 *
 * All three count *this stream* rather than all time, because a lifetime
 * threshold on a fresh archive marks nobody, and on an old one marks the same
 * dozen people every night whether or not they are here.
 */
export const DEFAULT_HIGHLIGHTS: HighlightTier[] = [
  {
    id: 'tiktok-gifter',
    label: 'TikTok gifter',
    enabled: true,
    platforms: ['tiktok'],
    condition: 'given',
    // Roughly a Galaxy, or a long streak of small gifts. Low enough to catch
    // a genuine supporter, high enough that a single Rose does not qualify.
    threshold: 500,
    scope: 'session',
    // Gold, with a pale band running through it — the pale stop is what makes
    // the sweep visible, since a gradient between two similar golds animates
    // without appearing to move at all.
    colors: ['#ffcf5c', '#fff3c4', '#ff9d2e'],
    speed: 4,
    priority: 20,
  },
  {
    id: 'twitch-sub',
    label: 'Twitch subscriber',
    enabled: true,
    platforms: ['twitch'],
    condition: 'subscriber',
    threshold: 0,
    scope: 'session',
    // Deliberately inside Twitch's own hue band, so a highlighted sub still
    // reads as a Twitch viewer first and a notable one second.
    colors: ['#a970ff', '#e5d4ff', '#7b3ff2'],
    speed: 6,
    priority: 10,
  },
  {
    id: 'youtube-gifter',
    label: 'YouTube gifter',
    enabled: true,
    platforms: ['youtube'],
    condition: 'given',
    threshold: 500,
    scope: 'session',
    colors: ['#ff2d55', '#ffd0d8', '#ff7a18'],
    speed: 4,
    priority: 20,
  },
];

export function createDefaultConfig(username = ''): AppConfig {
  return {
    version: CONFIG_VERSION,
    chatPanel: { ...DEFAULT_CHAT_PANEL },
    connection: {
      username,
      autoReconnect: true,
      reconnectDelaySeconds: 10,
      connectOnStartup: false,
      enableExtendedGiftInfo: true,
    },
    twitch: {
      channel: '',
      enabled: false,
      autoReconnect: true,
      reconnectDelaySeconds: 10,
      connectOnStartup: false,
      moderation: {
        enabled: false,
        // Ten minutes. Long enough to end whatever was happening, short
        // enough that being wrong costs a viewer an ad break rather than
        // their access to the channel.
        timeoutSeconds: 600,
        includeAutomatic: false,
      },
    },
    filters: { ...DEFAULT_FILTERS },
    users: {
      ...DEFAULT_USERS,
      autoPenalty: { ...DEFAULT_USERS.autoPenalty },
      severe: { words: [], phrases: [], regex: [] },
      trusted: [],
      penaltyBox: [],
      voiceProfiles: [],
    },
    tts: {
      enabled: true,
      provider: 'tiktok',
      sessionId: '',
      // Trailing slash is required — the route 404s without it.
      apiBaseUrl: 'https://api16-normal-useast5.us.tiktokv.com/media/api/text/speech/invoke/',
      google: {
        apiKey: '',
        // A Neural2 voice: noticeably better than Standard and still well
        // inside the free tier at the volume a stream reads aloud.
        defaultVoice: 'en-US-Neural2-C',
        languageCode: 'en-US',
      },
      googleLegacy: { defaultVoice: 'en-US:female' },
      fallbackToBrowser: true,
      maxQueueLength: 25,
      itemTtlSeconds: 90,
      gapMs: 250,
      // Off by default — it is a throttle to reach for when one person starts
      // dominating, not something to impose on a quiet room.
      userCooldownSeconds: 0,
      masterVolume: 1,
      normalizeLoudness: true,
      loudnessGainDb: 8,
      skipWhenNoListener: false,
      rules: DEFAULT_TTS_RULES.map((r) => ({ ...r })),
    },
    youtube: {
      enabled: false,
      videoId: '',
      autoReconnect: true,
      reconnectDelaySeconds: 15,
      connectOnStartup: false,
      // 3s: chat feels immediate, and a four-hour stream costs about 4,800
      // calls — inside a default day's quota with room for everything else.
      // The API is free to ask for slower and often does.
      pollIntervalMs: 3000,
    },
    tunnel: { enabled: false, domain: '', basicAuth: '' },
    // Blank = use whatever address the dashboard was loaded from, which is
    // what OBS wants. Set it only when your capture software is fussier.
    sources: { host: '' },
    overlays: DEFAULT_OVERLAYS.map((o) => ({ ...o })),
    highlights: DEFAULT_HIGHLIGHTS.map((tier) => ({ ...tier, platforms: [...tier.platforms] })),
  };
}
