import { listKey, PLATFORMS, type Platform, type TextEffect } from '@streaming/shared';
import { z } from 'zod';
import {
  FALLBACK_PROVIDER_KEY,
  CHAT_DENSITIES,
  DEFAULT_GIFT_MIN_VALUE,
  GIFT_MEDIA_KINDS,
  GIFT_RAIN_DIRECTIONS,
  HOP_EFFECT,
  NO_TEXT_EFFECT,
  TEXT_FILLS,
  TEXT_MOTIONS,
  WAVE_GRADIENT_EFFECT,
  cloneTextEffect,
  defaultSoundSettings,
  DEFAULT_HIGHLIGHTS,
  DEFAULT_TRUST,
  HIGHLIGHT_CONDITIONS,
  HIGHLIGHT_SCOPES,
  IMAGE_FIT,
  OVERLAY_TYPES,
  SLIDESHOW_TRANSITIONS,
  STREAM_EVENT_TYPES,
  VIEWER_ROLES,
} from '@streaming/shared';

/**
 * A viewer reference stored in a list, normalized to `platform:handle`.
 *
 * Applied at the schema so every write path is covered rather than just the
 * one that happened to be updated: the dashboard, the archive, the API and an
 * old config file on disk all arrive here. Entries written before platforms
 * existed are bare handles, and `listKey` reads those as TikTok — which is
 * where they can only have come from.
 */
const viewerRef = z
  .string()
  .min(1)
  .transform((value) => listKey(value));

const eventType = z.enum(STREAM_EVENT_TYPES);
const overlayType = z.enum(OVERLAY_TYPES);

/** A media URL: served from /media, or http(s). Never `javascript:`. */
const mediaUrl = z
  .string()
  .max(2048)
  .refine((value) => value === '' || /^(\/|https?:\/\/)/i.test(value), {
    message: 'Use /media/yourfile.gif or an http(s) URL',
  });

const giftMediaRule = z.object({
  id: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
  platform: z.enum([...PLATFORMS, 'any'] as const).default('any'),
  kinds: z.array(z.enum(GIFT_MEDIA_KINDS)).default([]),
  giftName: z.string().max(80).default(''),
  minValue: z.number().int().min(0).default(0),
  mediaUrl: mediaUrl.default(''),
  soundUrl: mediaUrl.default(''),
});

/** Colours are CSS strings; kept short so a config file cannot smuggle markup. */
const cssColor = z.string().max(64).regex(/^[#a-zA-Z0-9(),.%\s-]+$/, 'Use a CSS colour');

const textEffect = (fallback: TextEffect) =>
  z
    .object({
      motion: z.enum(TEXT_MOTIONS),
      fill: z.enum(TEXT_FILLS),
      colors: z.array(cssColor).min(2).max(8),
      amplitude: z.number().min(0).max(0.6),
      speed: z.number().min(0.3).max(20),
    })
    .default(() => cloneTextEffect(fallback));

const soundBracket = z.object({
  id: z.string().min(1).max(64),
  minCents: z.number().int().min(0),
  sound: z
    .string()
    .max(2048)
    .refine((value) => value === '' || /^(builtin:[a-z]+|\/|https?:\/\/)/i.test(value), {
      message: 'Use a built-in sound, /media/yourfile.mp3 or an http(s) URL',
    }),
  volume: z.number().min(0).max(1),
});

const soundSettings = (enabled: boolean) =>
  z
    .object({
      enabled: z.boolean(),
      volume: z.number().min(0).max(1),
      brackets: z.array(soundBracket).max(50),
    })
    .default(() => defaultSoundSettings(enabled));

/** One minimum per platform, taken from `PLATFORMS` so a new platform gets one. */
const platformThresholds = z
  .object(
    Object.fromEntries(PLATFORMS.map((platform) => [platform, z.number().int().min(0)])) as Record<
      Platform,
      z.ZodNumber
    >,
  )
  .default(() => ({ ...DEFAULT_GIFT_MIN_VALUE }));

/**
 * The fields both gift sources share, with the defaults a new source starts
 * from. Spread into each source's own object.
 */
const giftFeedFields = (soundsEnabled: boolean) => ({
  platforms: z.array(z.enum(PLATFORMS)).default([]),
  minValue: platformThresholds,
  includeGiftedSubs: z.boolean().default(true),
  mediaRules: z.array(giftMediaRule).max(200).default([]),
  sounds: soundSettings(soundsEnabled),
});

const count = z.number().int().min(0);

export const ruleConditionSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('startsWith'), text: z.string(), strip: z.boolean() }),
  z.object({ id: z.string().min(1), type: z.literal('matches'), pattern: z.string() }),
  z.object({ id: z.string().min(1), type: z.literal('minLength'), chars: count }),
  z.object({ id: z.string().min(1), type: z.literal('giftValue'), diamonds: count }),
  z.object({ id: z.string().min(1), type: z.literal('giftIs'), names: z.array(z.string()) }),
  z.object({ id: z.string().min(1), type: z.literal('likeCount'), count }),
  z.object({ id: z.string().min(1), type: z.literal('viewerIs'), role: z.enum(VIEWER_ROLES) }),
  z.object({ id: z.string().min(1), type: z.literal('viewerGifted'), diamonds: count }),
  z.object({ id: z.string().min(1), type: z.literal('followerCount'), count }),
  z.object({ id: z.string().min(1), type: z.literal('fansClub'), level: count }),
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Turns a rule saved in the old shape into the current one.
 *
 * Rules used to carry two fixed objects: `gate` (who may trigger it, a dozen
 * switches and minimums) and `conditions` (what the message or gift must be).
 * They are now one list of conditions plus an `alwaysAllow` list. Every switch
 * that was on becomes one condition, in the order the old engine checked them,
 * so a migrated rule speaks for exactly the same events it did before. A
 * minimum length of 1 or less was never a real condition (an empty message is
 * dropped earlier), so it is not carried over.
 */
export function migrateLegacyRule(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const legacyConditions = isRecord(input.conditions) ? input.conditions : null;
  const legacyGate = isRecord(input.gate) ? input.gate : null;
  if (!legacyConditions && !legacyGate) return input;

  const { gate: _gate, conditions: _conditions, ...rest } = input;
  const out: Array<Record<string, unknown>> = [];
  const add = (type: string, fields: Record<string, unknown>): void => {
    const suffix = typeof fields.role === 'string' ? `-${fields.role}` : '';
    out.push({ id: `c-${type}${suffix}`, type, ...fields });
  };

  const c = legacyConditions ?? {};
  const g = legacyGate ?? {};
  const num = (value: unknown): number => (typeof value === 'number' && value > 0 ? value : 0);
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

  if (text(c.requirePrefix).trim()) add('startsWith', { text: text(c.requirePrefix), strip: c.stripPrefix !== false });
  if (text(c.matchRegex).trim()) add('matches', { pattern: text(c.matchRegex) });
  if (num(c.minLength) > 1) add('minLength', { chars: num(c.minLength) });
  if (num(c.minDiamonds) > 0) add('giftValue', { diamonds: num(c.minDiamonds) });
  if (list(c.giftNames).length > 0) add('giftIs', { names: list(c.giftNames) });
  if (num(c.minLikeCount) > 0) add('likeCount', { count: num(c.minLikeCount) });

  if (g.moderatorsOnly) add('viewerIs', { role: 'moderator' });
  if (g.friendsOnly) add('viewerIs', { role: 'mutual' });
  if (g.followersOnly) add('viewerIs', { role: 'follower' });
  if (g.subscribersOnly) add('viewerIs', { role: 'subscriber' });
  if (g.giftersOnly) add('viewerIs', { role: 'gifter' });
  if (num(g.minSessionDiamonds) > 0) add('viewerGifted', { diamonds: num(g.minSessionDiamonds) });
  if (num(g.minFollowerCount) > 0) add('followerCount', { count: num(g.minFollowerCount) });
  if (num(g.minFansClubLevel) > 0) add('fansClub', { level: num(g.minFansClubLevel) });

  return { ...rest, conditions: out, alwaysAllow: list(g.allowUsers) };
}

export const ttsRuleSchema = z.preprocess(
  migrateLegacyRule,
  z.object({
    id: z.string().min(1),
    name: z.string(),
    enabled: z.boolean(),
    eventTypes: z.array(eventType),
    // Defaulted to empty so rules saved before platforms existed keep firing on
    // every platform rather than silently going quiet.
    platforms: z.array(z.enum(PLATFORMS)).default([]),
    template: z.string(),
    voice: z.string(),
    voicePool: z.array(z.string()),
    priority: z.number().int(),
    cooldownSeconds: z.number().min(0),
    maxChars: z.number().int().min(1).max(1000),
    conditions: z.array(ruleConditionSchema).default([]),
    alwaysAllow: z.array(z.string()).default([]),
    volume: z.number().min(0).max(1),
    rate: z.number().min(0.5).max(2),
  }),
);

export const filterSchema = z.object({
  enabled: z.boolean(),
  blockedWords: z.array(z.string()),
  blockedPhrases: z.array(z.string()),
  blockedRegex: z.array(z.string()),
  blockedUsers: z.array(z.string()),
  action: z.enum(['skip', 'censor']),
  censorReplacement: z.string(),
  normalizeLeetspeak: z.boolean(),
  collapseRepeatedChars: z.boolean(),
  matchTransliterations: z.boolean(),
  allowedScripts: z.array(z.string()),
  blockDisallowedScripts: z.boolean(),
  blockMixedScriptWords: z.boolean(),
  // Added after the first release, so existing config files lack it.
  reviewNearMatches: z.boolean().default(true),
  stripUrls: z.boolean(),
  stripEmoji: z.boolean(),
  maxLength: z.number().int().min(1).max(2000),
  applyToOverlay: z.boolean(),
});

export const severeTermsSchema = z.object({
  words: z.array(z.string()),
  phrases: z.array(z.string()),
  regex: z.array(z.string()),
});

export const penaltyEntrySchema = z.object({
  username: viewerRef,
  displayName: z.string(),
  reason: z.string(),
  addedAt: z.number(),
  automatic: z.boolean(),
  evidence: z.string().nullable(),
});

export const voiceSettingsSchema = z.object({
  voice: z.string().default(''),
  rate: z.number().min(0.5).max(2).default(1),
  pitch: z.number().min(0.5).max(2).default(1),
  volume: z.number().min(0).max(1).default(1),
});

/**
 * Accepts both shapes. Profiles used to hold one flat set of values with no
 * provider attached; those are carried into the `*` slot, which applies to
 * any backend that has no entry of its own. Nothing is lost and nothing has
 * to be re-entered — the first time a provider is edited it gets its own
 * entry and stops using the carry-over.
 */
export const voiceProfileSchema = z
  .object({
    username: viewerRef,
    displayName: z.string(),
    note: z.string().default(''),
    provider: z.enum(['tiktok', 'google', 'google-legacy', 'browser', '']).default(''),
    settings: z.record(z.string(), voiceSettingsSchema).default({}),
    // Legacy flat fields — still parsed so existing config files load.
    voice: z.string().optional(),
    rate: z.number().optional(),
    pitch: z.number().optional(),
    volume: z.number().optional(),
  })
  .transform(({ voice, rate, pitch, volume, ...profile }) => {
    const hasLegacy =
      voice !== undefined || rate !== undefined || pitch !== undefined || volume !== undefined;
    if (!hasLegacy || Object.keys(profile.settings).length > 0) return profile;

    return {
      ...profile,
      settings: {
        [FALLBACK_PROVIDER_KEY]: {
          voice: voice ?? '',
          rate: rate ?? 1,
          pitch: pitch ?? 1,
          volume: volume ?? 1,
        },
      },
    };
  });

/**
 * Desktop chat panel. Every field defaulted so a config written before the
 * panel existed loads untouched.
 */
export const chatPanelSchema = z
  .object({
    opacity: z.number().min(0).max(1).default(0.72),
    background: z.string().default('#07080d'),
    fontScale: z.number().min(0.6).max(2.5).default(1),
    alwaysOnTop: z.boolean().default(true),
    newestAtBottom: z.boolean().default(true),
    chatOnly: z.boolean().default(false),
  })
  .default({});

export const usersSchema = z.object({
  trusted: z.array(viewerRef),
  penaltyBox: z.array(penaltyEntrySchema),
  autoPenalty: z.object({
    enabled: z.boolean(),
    strikesBeforePenalty: z.number().int().min(1).max(20),
    onlyCountEvasion: z.boolean(),
    exemptTrusted: z.boolean(),
  }),
  severe: severeTermsSchema,
  voiceProfiles: z.array(voiceProfileSchema),
});

/**
 * Viewer trust. Every field has a default, so a config written before trust
 * existed loads with it switched on at the default settings.
 */
export const trustSchema = z
  .object({
    enabled: z.boolean().default(DEFAULT_TRUST.enabled),
    strictBelow: z.number().int().min(0).max(100).default(DEFAULT_TRUST.strictBelow),
    strikeOnRetry: z.boolean().default(DEFAULT_TRUST.strikeOnRetry),
    retryWindowSeconds: z.number().int().min(10).max(600).default(DEFAULT_TRUST.retryWindowSeconds),
    holdNewViewers: z.boolean().default(DEFAULT_TRUST.holdNewViewers),
    holdMessages: z.number().int().min(0).max(50).default(DEFAULT_TRUST.holdMessages),
    holdMinutes: z.number().int().min(0).max(120).default(DEFAULT_TRUST.holdMinutes),
  })
  .default({});

export const connectionSchema = z.object({
  username: z.string(),
  autoReconnect: z.boolean(),
  reconnectDelaySeconds: z.number().min(1).max(600),
  connectOnStartup: z.boolean(),
  enableExtendedGiftInfo: z.boolean(),
});


/**
 * Twitch connection. Every field defaulted so an existing config.json that
 * predates multi-platform loads without complaint.
 */
export const twitchSchema = z
  .object({
    channel: z.string().default(''),
    enabled: z.boolean().default(false),
    autoReconnect: z.boolean().default(true),
    reconnectDelaySeconds: z.number().min(1).max(600).default(10),
    connectOnStartup: z.boolean().default(false),
    moderation: z
      .object({
        enabled: z.boolean().default(false),
        // Capped at Twitch's own 14-day maximum for a timeout. 0 is allowed
        // and means a permanent ban — see the type's doc comment.
        timeoutSeconds: z.number().int().min(0).max(1_209_600).default(600),
        includeAutomatic: z.boolean().default(false),
      })
      .default({}),
  })
  .default({});

/**
 * YouTube connection. Fully defaulted, like Twitch's, so a config written
 * before YouTube existed loads without complaint.
 */
export const youtubeSchema = z
  .object({
    enabled: z.boolean().default(false),
    // Defaults to the watch-page route: it needs no setup at all, where the
    // API route needs a Cloud project before it returns a single message.
    source: z.enum(['innertube', 'api']).default('innertube'),
    moderation: z
      .object({
        enabled: z.boolean().default(false),
        // 0 is a permanent ban, so the floor is deliberate.
        timeoutSeconds: z.number().min(0).max(86_400).default(300),
        includeAutomatic: z.boolean().default(false),
      })
      .default({}),
    handle: z
      .string()
      .default('')
      // A handle, a channel URL or a bare name all end up as `@name`, because
      // all three are things people paste.
      .transform((value) => {
        const trimmed = value.trim();
        if (!trimmed) return '';
        const fromUrl = /youtube\.com\/(@[\w.-]+)/.exec(trimmed)?.[1];
        const bare = fromUrl ?? trimmed;
        return bare.startsWith('@') ? bare : `@${bare}`;
      }),
    videoId: z
      .string()
      .default('')
      // Accepts a full watch URL as well as a bare id: the id is what the API
      // wants, but a URL is what you have in your hand.
      .transform((value) => {
        const trimmed = value.trim();
        const match = /(?:v=|youtu\.be\/|\/live\/)([\w-]{11})/.exec(trimmed);
        return match?.[1] ?? trimmed;
      }),
    autoReconnect: z.boolean().default(true),
    reconnectDelaySeconds: z.number().min(1).max(600).default(15),
    connectOnStartup: z.boolean().default(false),
    pollIntervalMs: z.number().min(1000).max(60_000).default(3000),
  })
  .default({});

export const ttsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['tiktok', 'google', 'google-legacy', 'browser']),
  google: z.object({
    defaultVoice: z.string(),
    languageCode: z.string(),
  }),
  googleLegacy: z.object({ defaultVoice: z.string() }),
  // The TTS route 404s without a trailing slash. Repairing it here migrates
  // configs saved before that was understood, and stops a hand-typed URL from
  // silently failing.
  apiBaseUrl: z.string().transform((url) => {
    const trimmed = url.trim();
    if (!trimmed) return trimmed;
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }),
  fallbackToBrowser: z.boolean(),
  // Added after the first release, so existing config files lack it.
  onlyAllowList: z.boolean().default(false),
  maxQueueLength: z.number().int().min(1).max(500),
  itemTtlSeconds: z.number().min(5).max(3600),
  gapMs: z.number().min(0).max(10000),
  // Added after the first release, so existing config files lack it.
  userCooldownSeconds: z.number().min(0).max(3600).default(0),
  masterVolume: z.number().min(0).max(1),
  normalizeLoudness: z.boolean().default(true),
  loudnessGainDb: z.number().min(0).max(12).default(8),
  skipWhenNoListener: z.boolean(),
  monitorInDashboard: z.boolean().default(false),
  rules: z.array(ttsRuleSchema),
});

const animation = z.enum(['fade', 'slide-left', 'slide-right', 'slide-up', 'pop', 'none']);

export const styleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number().min(6).max(200),
  fontWeight: z.number().min(100).max(900),
  textColor: z.string(),
  accentColor: z.string(),
  backgroundColor: z.string(),
  itemBackground: z.string(),
  borderRadius: z.number().min(0).max(200),
  padding: z.number().min(0).max(200),
  gap: z.number().min(0).max(200),
  textStroke: z.number().min(0).max(20),
  textStrokeColor: z.string(),
  shadow: z.boolean(),
  opacity: z.number().min(0).max(1),
  customCss: z.string(),
});

const settingsSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    chat: z.object({
      maxMessages: z.number().int().min(1).max(200),
      messageTtl: z.number().min(0).max(3600),
      showAvatars: z.boolean(),
      showBadges: z.boolean(),
      showGifts: z.boolean(),
      showFollows: z.boolean(),
      showJoins: z.boolean(),
      hideFiltered: z.boolean(),
      newestFirst: z.boolean(),
      animation,
      colorfulNames: z.boolean(),
      // Defaulted, not required: every chat source saved before the compact
      // layout existed is still on disk, and a missing key here would fail
      // the whole config load rather than the one field.
      density: z.enum(CHAT_DENSITIES).default('comfortable'),
      showPlatform: z.boolean().default(true),
      showHighlights: z.boolean().default(true),
      platforms: z.array(z.enum(PLATFORMS)).default([]),
      mergeRuns: z.boolean().default(false),
      highlightMotion: z.enum(TEXT_MOTIONS).default('none'),
    }),
  }),
  z.object({
    type: z.literal('alerts'),
    alerts: z.object({
      eventTypes: z.array(eventType),
      durationMs: z.number().min(500).max(60000),
      animation,
      minDiamonds: z.number().int().min(0),
      showAvatar: z.boolean(),
      showGiftImage: z.boolean(),
      templates: z.record(eventType, z.string()).default({}),
      soundUrl: z.string(),
      soundVolume: z.number().min(0).max(1),
      nameEffect: textEffect(NO_TEXT_EFFECT),
      giftSounds: soundSettings(false),
    }),
  }),
  z.object({
    type: z.literal('tts'),
    tts: z.object({
      showCaption: z.boolean(),
      captionMaxChars: z.number().int().min(10).max(1000),
      showQueue: z.boolean(),
      queueSize: z.number().int().min(0).max(20),
    }),
  }),
  z.object({
    type: z.literal('goal'),
    goal: z.object({
      metric: z.enum(['likes', 'diamonds', 'followers', 'shares', 'viewers', 'subscribers']),
      label: z.string(),
      target: z.number().min(1),
      startValue: z.number().min(0),
      showNumbers: z.boolean(),
      showPercent: z.boolean(),
      barHeight: z.number().min(2).max(200),
    }),
  }),
  z.object({
    type: z.literal('ticker'),
    ticker: z.object({
      eventTypes: z.array(eventType),
      speedPxPerSecond: z.number().min(5).max(600),
      separator: z.string(),
      maxItems: z.number().int().min(1).max(200),
    }),
  }),
  z.object({
    type: z.literal('leaderboard'),
    leaderboard: z.object({
      metric: z.enum(['diamonds', 'likes', 'gifts', 'comments']),
      size: z.number().int().min(1).max(25),
      title: z.string(),
      showAvatars: z.boolean(),
      showValues: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('counter'),
    counter: z.object({
      metrics: z.array(
        z.enum(['viewers', 'likes', 'diamonds', 'followers', 'shares', 'comments']),
      ),
      layout: z.enum(['row', 'column']),
      showLabels: z.boolean(),
      showIcons: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('slideshow'),
    slideshow: z.object({
      // Folder name only — never a path. The server resolves it under
      // data/media/slideshows and refuses anything that escapes.
      folder: z.string().max(64).regex(/^[a-zA-Z0-9._-]*$/, 'Letters, numbers, dot, dash, underscore'),
      intervalSeconds: z.number().min(0.5).max(3600),
      transition: z.enum(SLIDESHOW_TRANSITIONS),
      transitionMs: z.number().int().min(0).max(10000),
      shuffle: z.boolean(),
      fit: z.enum(IMAGE_FIT),
      cornerRadius: z.number().int().min(0).max(200),
      showCaption: z.boolean(),
      once: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('giftSpotlight'),
    giftSpotlight: z.object({
      ...giftFeedFields(true),
      durationMs: z.number().min(500).max(60000),
      scaleDuration: z.boolean().default(true),
      showAvatar: z.boolean().default(true),
      showValue: z.boolean().default(true),
      showMessage: z.boolean().default(true),
      mediaSize: z.number().int().min(16).max(2000).default(180),
      animation,
      soundUrl: mediaUrl.default(''),
      soundVolume: z.number().min(0).max(1).default(0.7),
      maxQueue: z.number().int().min(0).max(500).default(20),
      nameEffect: textEffect(WAVE_GRADIENT_EFFECT),
      valueEffect: textEffect(HOP_EFFECT),
    }),
  }),
  z.object({
    type: z.literal('giftRain'),
    giftRain: z.object({
      ...giftFeedFields(false),
      maxPerGift: z.number().int().min(1).max(200).default(25),
      maxOnScreen: z.number().int().min(1).max(500).default(120),
      spriteSize: z.number().int().min(8).max(1000).default(72),
      fallSeconds: z.number().min(0.5).max(60).default(5),
      direction: z.enum(GIFT_RAIN_DIRECTIONS).default('fall'),
    }),
  }),
  z.object({
    type: z.literal('custom'),
    custom: z.object({
      html: z.string(),
      css: z.string(),
      eventTypes: z.array(eventType),
      maxItems: z.number().int().min(1).max(100),
      itemTtlMs: z.number().min(0).max(600000),
    }),
  }),
]);

export const overlaySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, numbers and dashes'),
    name: z.string().min(1).max(80),
    type: overlayType,
    // Added after the first release, so existing config files lack it.
    group: z.string().max(60).default(''),
    enabled: z.boolean(),
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(4320),
    align: z.enum(['start', 'center', 'end']),
    justify: z.enum(['start', 'center', 'end']),
    style: styleSchema,
    settings: settingsSchema,
  })
  .refine((o) => o.settings.type === o.type, {
    message: 'settings.type must match the overlay type',
    path: ['settings', 'type'],
  });

export const tunnelSchema = z.object({
  enabled: z.boolean(),
  domain: z.string(),
});

/**
 * Added after the first configs were written, so the whole group defaults —
 * an existing `config.json` has no `sources` key at all and must still load.
 */
export const sourcesSchema = z
  .object({
    // A hostname, not a URL: no scheme, no port, no path. Those come from the
    // server's own origin so the copied link cannot point somewhere dead.
    host: z
      .string()
      .max(253)
      .default('')
      .transform((value) => value.trim().replace(/^\w+:\/\//, '').replace(/[:/].*$/, '')),
  })
  .default({ host: '' });

/**
 * One highlight tier.
 *
 * Colours are accepted as free-form strings rather than validated as hex: the
 * value goes straight into a CSS gradient, so `rebeccapurple`, `#a970ff` and
 * `rgb(169 112 255)` are all legitimate and a hex-only rule would reject two
 * of them for no reason. A malformed stop makes one name render plainly,
 * which is a visible and self-correcting mistake.
 */
const highlightTierSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  enabled: z.boolean().default(true),
  platforms: z.array(z.enum(PLATFORMS)).default([]),
  condition: z.enum(HIGHLIGHT_CONDITIONS),
  threshold: z.number().min(0).max(10_000_000).default(0),
  scope: z.enum(HIGHLIGHT_SCOPES).default('session'),
  // Two stops minimum: one colour is not a gradient, and the sweep would be
  // invisible motion that still costs an animation frame every frame.
  colors: z.array(z.string().min(1)).min(2).max(8),
  // 0 holds the gradient still; anything above is seconds per sweep. Not
  // floored above zero here because "static gradient" is a legitimate choice,
  // but the editor steers away from the 0-2s range, where the motion reads as
  // flicker rather than movement on a name that sits on screen for a minute.
  speed: z.number().min(0).max(60).default(4),
  priority: z.number().int().min(-100).max(100).default(0),
});

export const appConfigSchema = z.object({
  version: z.number().int(),
  chatPanel: chatPanelSchema,
  connection: connectionSchema,
  twitch: twitchSchema,
  youtube: youtubeSchema,
  filters: filterSchema,
  users: usersSchema,
  trust: trustSchema,
  tts: ttsSchema,
  tunnel: tunnelSchema,
  sources: sourcesSchema,
  overlays: z.array(overlaySchema),
  // Defaulted so an existing config.json picks up the starting tiers instead
  // of failing to load or arriving with highlights silently switched off.
  highlights: z.array(highlightTierSchema).default(() => DEFAULT_HIGHLIGHTS),
});

export type ParsedConfig = z.infer<typeof appConfigSchema>;
