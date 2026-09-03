import type { HighlightTier } from './highlights.js';
import type { Platform } from './platforms.js';
import type { StreamEventType } from './events.js';
import { DEFAULT_TTS_VOICE } from './voices.js';

/* ------------------------------------------------------------------ *
 * Connection
 * ------------------------------------------------------------------ */

export interface ConnectionConfig {
  /** TikTok @handle to watch, without the leading @. */
  username: string;
  /** Reconnect automatically when the socket drops or the host goes offline. */
  autoReconnect: boolean;
  /** Seconds between reconnect attempts. Backs off up to 10x this value. */
  reconnectDelaySeconds: number;
  /** Connect as soon as the server boots. */
  connectOnStartup: boolean;
  /** Pull the room gift list so gift events carry diamond values and images. */
  enableExtendedGiftInfo: boolean;
}


/**
 * Twitch connection.
 *
 * Chat is read over anonymous IRC (nick `justinfanNNNN`), which needs no
 * OAuth, no registered app and no secret — verified working against the live
 * service. The cost of staying anonymous is that IRC carries no avatar URLs
 * and no viewer count; both would need the Helix API and a client id.
 */
export interface TwitchConnectionConfig {
  /** Channel login name to join, without the leading #. */
  channel: string;
  enabled: boolean;
  autoReconnect: boolean;
  reconnectDelaySeconds: number;
  connectOnStartup: boolean;
  moderation: TwitchModerationConfig;
}

/**
 * Whether the penalty box reaches Twitch itself.
 *
 * Without this, penalising someone only mutes TTS — they carry on posting to
 * everyone watching, and the only person who notices anything changed is you.
 * With it, a penalty also times them out in the channel.
 *
 * Off by default, and every default inside it errs towards doing less: these
 * actions land on real people, in public, and some of them are hard to
 * reverse.
 */
export interface TwitchModerationConfig {
  enabled: boolean;
  /**
   * How long a penalised viewer is timed out for, in seconds.
   *
   * **0 means a permanent ban**, which is why the default is ten minutes and
   * not zero. Twitch's own maximum for a timeout is 14 days.
   */
  timeoutSeconds: number;
  /**
   * Let *automatic* penalties act on Twitch too.
   *
   * Separate from `enabled`, and off even when that is on. The automatic
   * strike system fires on evasion heuristics and phonetic near misses, which
   * have false positives by design — a wrong call that mutes TTS is private
   * and recoverable, and one that times out a real viewer is neither.
   */
  includeAutomatic: boolean;
}
/**
 * YouTube live chat.
 *
 * The one connection that cannot be anonymous. TikTok and Twitch both allow
 * read-only chat with no account at all; YouTube's live chat API has no such
 * mode, so this needs a signed-in account with `youtube.force-ssl` before it
 * can read a single message.
 *
 * It is also polled rather than pushed — there is no public socket — which
 * means every connected minute spends from a daily API quota. `pollIntervalMs`
 * is the floor on how fast that happens.
 */
/**
 * Where YouTube chat is read from.
 *
 * `innertube` is the route the watch page itself uses: no Google Cloud
 * project, no sign-in, no quota, and it works on any public stream. It is
 * also undocumented, so it can change without notice.
 *
 * `api` is the official Data API. It needs an OAuth app and a signed-in
 * account, and it spends a daily quota that a long stream can exhaust — but
 * Google supports it, so it is the one to fall back to if the other breaks.
 */
export type YouTubeChatSource = 'innertube' | 'api';

export interface YouTubeConnectionConfig {
  enabled: boolean;
  source: YouTubeChatSource;
  /**
   * `@handle` of the channel to read, for the innertube source.
   *
   * Only needed when you are not signed in: with a Google account attached,
   * the channel id from that account is used instead and nothing has to be
   * typed. Ignored entirely when a video id is set.
   */
  handle: string;
  /**
   * A specific video to read, or blank to use whichever broadcast on your own
   * channel is currently live.
   *
   * Blank is right for your own stream. Set it for a stream you do not own, or
   * one that the broadcasts endpoint does not list.
   */
  videoId: string;
  autoReconnect: boolean;
  reconnectDelaySeconds: number;
  connectOnStartup: boolean;
  /**
   * Shortest gap between polls, in milliseconds.
   *
   * The API suggests its own interval based on how busy chat is, and this is
   * the floor applied to that suggestion. Lower means chat appears sooner and
   * the daily quota runs out earlier; there is no setting that avoids the
   * trade, only one that chooses where to sit on it.
   */
  pollIntervalMs: number;
}

/* ------------------------------------------------------------------ *
 * Text filtering
 * ------------------------------------------------------------------ */

export type FilterAction = 'skip' | 'censor';

export interface FilterConfig {
  enabled: boolean;
  /** Matched as whole words after normalization. "ass" won't hit "class". */
  blockedWords: string[];
  /** Matched anywhere in the message, including across word boundaries. */
  blockedPhrases: string[];
  /** Raw JS regex sources, applied case-insensitively. Invalid ones are skipped. */
  blockedRegex: string[];
  /**
   * People dropped entirely: no TTS, no overlay, no stats, no archive entry.
   *
   * Two forms, and the difference matters once more than one platform is
   * connected:
   *   `spambot123`         blocks that handle on every service
   *   `tiktok:spambot123`  blocks only TikTok's spambot123
   *
   * A bare handle is the wildcard rather than the narrow case on purpose.
   * This list is typed by hand, usually in a hurry, and an entry that
   * quietly stopped applying the day a second platform was connected would
   * be the worst possible failure for a list whose only job is keeping
   * somebody out. Qualify an entry when the handle belongs to two different
   * people.
   */
  blockedUsers: string[];
  /**
   * `skip` drops the whole message, `censor` replaces just the match.
   * TTS always respects this; overlays only do when `applyToOverlay` is on.
   */
  action: FilterAction;
  censorReplacement: string;
  /**
   * Fold l33tspeak and repeated characters before matching, so `f-u-c-k`,
   * `fuuuck` and `fu(k` all hit the same entry.
   */
  normalizeLeetspeak: boolean;
  collapseRepeatedChars: boolean;
  /**
   * Also run the blocklist against romanized copies of the message.
   * TTS reads Ethiopic, Hangul, kana and Cyrillic aloud phonetically, so
   * `ኒገር` / `니거` / `ニガー` / `нигер` are spoken slurs that a latin-only
   * word list never sees. Matches found only in a romanized copy are always
   * dropped rather than censored — offsets can't be mapped back safely.
   */
  matchTransliterations: boolean;
  /**
   * Scripts allowed to reach TTS. Anything containing letters from a script
   * outside this list is refused when `blockDisallowedScripts` is on — the
   * backstop for scripts we cannot romanize at all.
   */
  allowedScripts: string[];
  blockDisallowedScripts: boolean;
  /**
   * Drop any message containing a word built from two writing systems, e.g.
   * `ᏣΟᏒΝ` (Cherokee + Greek). Such words are spoofs by construction, but
   * this is off by default because it drops the message outright — a
   * mixed-script word always counts as evasion for strike purposes either way.
   */
  blockMixedScriptWords: boolean;
  /**
   * Report — never block — messages that *sound* like a severe term without
   * being spelled like one: "deal dough", "pool sea", "gape horn", "pho q".
   *
   * The character-level matcher cannot see these, and a phonetic matcher
   * cannot be made safe to block on: "peace" and "pace" fold to exactly the
   * same sound as one slur, "no gear" to another. So near misses are only
   * listed for review, grouped by phrase, and a phrase you dismiss never
   * comes back. Promote a real one into `severe.phrases` and the ordinary
   * matcher takes over.
   */
  reviewNearMatches: boolean;
  /** Strip links before they ever reach TTS or the overlay. */
  stripUrls: boolean;
  stripEmoji: boolean;
  /** Drop messages that are mostly non-latin, useful against spam waves. */
  maxLength: number;
  /** Also hide/censor filtered messages in chat overlays, not just in TTS. */
  applyToOverlay: boolean;
}

/* ------------------------------------------------------------------ *
 * People: trusted list, penalty box, per-user voices
 * ------------------------------------------------------------------ */

/**
 * The zero-tolerance list, kept separate from `blockedWords` on purpose.
 *
 * Ordinary swearing usually just gets skipped and forgotten. Terms on this
 * list are the ones worth tracking: a viewer who reaches for a phonetic or
 * cross-script bypass to get one of these read aloud is doing it deliberately,
 * and that is what earns an automatic penalty.
 */
export interface SevereTermsConfig {
  words: string[];
  phrases: string[];
  regex: string[];
}

export interface PenaltyEntry {
  /** @handle, lowercased, without the leading @. */
  username: string;
  /** Cached for the UI so the list is readable after the user leaves. */
  displayName: string;
  reason: string;
  addedAt: number;
  /** True when the system added this rather than you. */
  automatic: boolean;
  /** The offending message, kept so you can review and undo a bad call. */
  evidence: string | null;
}

export interface AutoPenaltyConfig {
  enabled: boolean;
  /** Evasion attempts on a severe term before the penalty lands. 1 = instant. */
  strikesBeforePenalty: number;
  /**
   * Only count deliberate evasion (cross-script, homoglyph or mixed-script
   * spellings). With this off, plainly typing a severe term also counts.
   */
  onlyCountEvasion: boolean;
  /** Trusted users never accrue strikes. */
  exemptTrusted: boolean;
}

/** One backend's worth of speech settings. */
export interface VoiceSettings {
  /** Voice code, or '' to keep whatever the matching rule chose. */
  voice: string;
  /** Speed multiplier, pitch preserved. 1 = unchanged. */
  rate: number;
  /** Pitch multiplier, duration preserved. 1 = unchanged. */
  pitch: number;
  /** Volume multiplier applied on top of the rule's volume. */
  volume: number;
}

export const NEUTRAL_VOICE_SETTINGS: VoiceSettings = {
  voice: '',
  rate: 1,
  pitch: 1,
  volume: 1,
};

/**
 * Settings carried over from before profiles were per-provider. Applies to
 * any backend that has no entry of its own.
 */
export const FALLBACK_PROVIDER_KEY = '*';

/**
 * Per-user speech overrides. Anything left at the neutral value inherits from
 * the rule that fired, so you only have to set what you actually want changed.
 *
 * Settings are stored per backend because a voice code is meaningless outside
 * the provider it came from — `en_us_002` means nothing to Google, and
 * `en-US-Studio-Q` means nothing to TikTok. Keeping them separate means
 * switching the global provider, or giving one person their own, never
 * silently drops a voice you picked.
 */
export interface UserVoiceProfile {
  username: string;
  displayName: string;
  /**
   * Backend this person is spoken with, or '' to follow whatever the TTS tab
   * is set to. Lets one viewer keep a TikTok voice while everyone else moves
   * to Google.
   */
  provider: TtsProvider | '';
  /** Keyed by provider id, plus `*` for pre-per-provider settings. */
  settings: Partial<Record<string, VoiceSettings>>;
  note: string;
}

export interface UsersConfig {
  /**
   * Handles that bypass every rule gate and per-user cooldown. For regulars
   * you never want to think about again.
   */
  trusted: string[];
  /** Muted from TTS only — their messages still appear in chat overlays. */
  penaltyBox: PenaltyEntry[];
  autoPenalty: AutoPenaltyConfig;
  severe: SevereTermsConfig;
  voiceProfiles: UserVoiceProfile[];
}

export const DEFAULT_USERS: UsersConfig = {
  trusted: [],
  penaltyBox: [],
  autoPenalty: {
    enabled: true,
    strikesBeforePenalty: 1,
    onlyCountEvasion: true,
    exemptTrusted: true,
  },
  // Left empty deliberately: you decide what counts as severe for your room,
  // and shipping a slur list in a config file helps nobody.
  severe: { words: [], phrases: [], regex: [] },
  voiceProfiles: [],
};

export const NEUTRAL_VOICE_PROFILE: Omit<UserVoiceProfile, 'username' | 'displayName'> = {
  provider: '',
  settings: {},
  note: '',
};

/**
 * The settings that apply to a profile under a given backend: its own if it
 * has them, otherwise the pre-per-provider carry-over, otherwise neutral.
 */
export function settingsFor(
  profile: Pick<UserVoiceProfile, 'settings'>,
  provider: string,
): VoiceSettings {
  return (
    profile.settings[provider] ??
    profile.settings[FALLBACK_PROVIDER_KEY] ??
    NEUTRAL_VOICE_SETTINGS
  );
}

/* ------------------------------------------------------------------ *
 * Gating
 * ------------------------------------------------------------------ */

export interface GateConfig {
  followersOnly: boolean;
  /** Mutuals only — stricter than followersOnly. */
  friendsOnly: boolean;
  subscribersOnly: boolean;
  moderatorsOnly: boolean;
  /** Must have sent at least one gift during this session. */
  giftersOnly: boolean;
  /** Cumulative diamonds this user has gifted this session. */
  minSessionDiamonds: number;
  /** TikTok follower count of the commenter. */
  minFollowerCount: number;
  /** Minimum fans-club level. 0 disables. */
  minFansClubLevel: number;
  /** @handles that bypass every gate above. */
  allowUsers: string[];
}

export const DEFAULT_GATE: GateConfig = {
  followersOnly: false,
  friendsOnly: false,
  subscribersOnly: false,
  moderatorsOnly: false,
  giftersOnly: false,
  minSessionDiamonds: 0,
  minFollowerCount: 0,
  minFansClubLevel: 0,
  allowUsers: [],
};

/* ------------------------------------------------------------------ *
 * TTS
 * ------------------------------------------------------------------ */

export type TtsProvider = 'tiktok' | 'google' | 'google-legacy' | 'browser';

export interface GoogleTtsConfig {
  /**
   * Google Cloud API key with the Text-to-Speech API enabled. Read from the
   * GOOGLE_TTS_API_KEY env var when left blank here.
   */
  apiKey: string;
  /** Used when a rule doesn't name a voice. */
  defaultVoice: string;
  /** Fallback language when a voice name doesn't imply one. */
  languageCode: string;
}

export interface RuleConditions {
  /** Only fire when the message starts with this (e.g. `!say`). Empty = any. */
  requirePrefix: string;
  /** Remove the prefix before speaking. */
  stripPrefix: boolean;
  /** Regex the message must match. Empty = any. */
  matchRegex: string;
  minLength: number;
  /** Gift rules: minimum diamond value of the (completed) gift. */
  minDiamonds: number;
  /** Gift rules: only these gift names. Empty = any gift. */
  giftNames: string[];
  /** Like rules: only fire once the user crosses this like count. */
  minLikeCount: number;
}

export const DEFAULT_CONDITIONS: RuleConditions = {
  requirePrefix: '',
  stripPrefix: true,
  matchRegex: '',
  minLength: 1,
  minDiamonds: 0,
  giftNames: [],
  minLikeCount: 0,
};

export interface TtsRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Which normalized events this rule listens to. */
  eventTypes: StreamEventType[];
  /**
   * Which platforms this rule speaks for. Empty means all of them.
   *
   * Empty-means-all keeps every existing rule behaving exactly as it did
   * before platforms existed, instead of silently going quiet the moment a
   * second service is connected.
   */
  platforms: Platform[];
  /**
   * Spoken text. Supports `{{nickname}}`, `{{username}}`, `{{message}}`,
   * `{{gift}}`, `{{count}}`, `{{diamonds}}`, `{{likes}}`, `{{months}}`,
   * `{{viewers}}` — unknown placeholders resolve to an empty string.
   */
  template: string;
  /** A voice code, or `random` to pick from `voicePool` each time. */
  voice: string;
  voicePool: string[];
  /** Higher priority items jump the queue. Ties fall back to arrival order. */
  priority: number;
  /** Per-user cooldown in seconds. 0 disables. */
  cooldownSeconds: number;
  /** Hard cap on spoken characters after templating. */
  maxChars: number;
  gate: GateConfig;
  conditions: RuleConditions;
  /** 0..1, applied client-side in the overlay. */
  volume: number;
  /** Playback rate multiplier, 0.5..2. */
  rate: number;
}

export interface TtsConfig {
  enabled: boolean;
  provider: TtsProvider;
  /**
   * TikTok session id cookie. Required for the `tiktok` provider.
   * Read from the TTS_SESSION_ID env var when left blank here.
   */
  sessionId: string;
  /** Override the TikTok TTS endpoint if the default region is blocked. */
  apiBaseUrl: string;
  google: GoogleTtsConfig;
  /**
   * The unofficial `speech-api/v2` engine. Needs no credentials because it
   * uses a public key that isn't yours — see the provider for the caveats.
   */
  googleLegacy: { defaultVoice: string };
  /** Fall back to the overlay's built-in browser speech synth on failure. */
  fallbackToBrowser: boolean;
  /** Drop the oldest queued item once the queue exceeds this. */
  maxQueueLength: number;
  /** Skip anything still queued after this many seconds. */
  itemTtlSeconds: number;
  /** Global cooldown between any two spoken items, in ms. */
  gapMs: number;
  /**
   * Minimum seconds between one person being spoken again, across *every*
   * rule. 0 disables it.
   *
   * Separate from each rule's own `cooldownSeconds`, which only limits that
   * one rule: without this, someone can talk continuously by alternating
   * between whatever rules happen to match. Trusted users are exempt, same as
   * with the per-rule cooldown.
   */
  userCooldownSeconds: number;
  /** Master volume multiplier applied on top of each rule's volume. */
  masterVolume: number;
  /**
   * Even out loudness before playback.
   *
   * Speech from every provider comes back peak-normalised but not
   * loudness-normalised: a clip can touch -2 dBFS at its loudest while
   * averaging -21, so next to game audio (which is heavily compressed) it
   * sounds far quieter despite nearly identical peaks. Compressing and
   * making up the difference recovers about 8 dB of perceived loudness
   * without ever clipping.
   */
  normalizeLoudness: boolean;
  /** Make-up gain in dB applied after compression. 0 disables the boost. */
  loudnessGainDb: number;
  /** Speak the queue even while no host is watching (keeps queue draining). */
  skipWhenNoListener: boolean;
  /**
   * Also play speech in the dashboard when a TTS browser source is running.
   *
   * Off by default because a clip normally goes to exactly one place: with a
   * source open, monitoring here means you hear every line twice — once from
   * your speakers and once back through the stream. On, it is a monitor feed
   * for hearing what your viewers hear without alt-tabbing to the source.
   */
  monitorInDashboard: boolean;
  rules: TtsRule[];
}

/* ------------------------------------------------------------------ *
 * Overlays
 * ------------------------------------------------------------------ */

export const OVERLAY_TYPES = [
  'chat',
  'alerts',
  'tts',
  'goal',
  'ticker',
  'leaderboard',
  'counter',
  'slideshow',
  'custom',
] as const;

export type OverlayType = (typeof OVERLAY_TYPES)[number];

export interface OverlayStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  accentColor: string;
  /** Any CSS color, including `transparent` for browser sources. */
  backgroundColor: string;
  /** Per-item background (chat rows, alert cards). */
  itemBackground: string;
  borderRadius: number;
  padding: number;
  gap: number;
  /** Outline drawn around text so it stays readable over any footage. */
  textStroke: number;
  textStrokeColor: string;
  shadow: boolean;
  opacity: number;
  /** Extra CSS injected into the overlay's shadow-free document. */
  customCss: string;
}

export const DEFAULT_STYLE: OverlayStyle = {
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  fontSize: 22,
  fontWeight: 600,
  textColor: '#ffffff',
  accentColor: '#25f4ee',
  backgroundColor: 'transparent',
  itemBackground: 'rgba(10, 10, 16, 0.62)',
  borderRadius: 14,
  padding: 12,
  gap: 8,
  textStroke: 0,
  textStrokeColor: '#000000',
  shadow: true,
  opacity: 1,
  customCss: '',
};

export type OverlayAnimation = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'pop' | 'none';

/**
 * How much room each message gets.
 *
 * `comfortable` is the original card-per-message look: an avatar column, a
 * translucent panel behind each row, the message free to wrap. `compact`
 * collapses a message to a single line with the avatar shrunk to the height of
 * the text and no panel behind it, which is what makes a merged three-platform
 * chat fit in a strip down the side of a game rather than a column across it.
 */
export const CHAT_DENSITIES = ['comfortable', 'compact'] as const;
export type ChatDensity = (typeof CHAT_DENSITIES)[number];

export interface ChatOverlaySettings {
  maxMessages: number;
  /** Seconds before a message fades out. 0 keeps them until pushed off. */
  messageTtl: number;
  showAvatars: boolean;
  showBadges: boolean;
  showGifts: boolean;
  showFollows: boolean;
  showJoins: boolean;
  hideFiltered: boolean;
  /** Newest at the bottom (like a chat client) or at the top. */
  newestFirst: boolean;
  animation: OverlayAnimation;
  /** Colour usernames deterministically from their handle. */
  colorfulNames: boolean;
  /** Card-per-message, or one line per message. */
  density: ChatDensity;
  /**
   * Draw each platform's logo beside the name.
   *
   * The point of a merged chat is not knowing which platform a line came from
   * until you look — so with this off, a combined source is only readable if
   * `colorfulNames` is on to carry that signal in the name colour instead.
   */
  showPlatform: boolean;
  /**
   * Which platforms this source shows. Empty means all of them, which is both
   * the default and the whole reason a single overlay can replace three.
   *
   * Listing one platform turns this into a dedicated source for it, so a
   * layout can mix a merged strip with a per-platform panel without needing a
   * second kind of widget.
   */
  platforms: Platform[];
  /** Apply the global highlight tiers to notable viewers in this source. */
  showHighlights: boolean;
  /**
   * Collapse the name off consecutive messages from the same person.
   *
   * Someone typing three lines in a row costs three name repetitions, which in
   * compact density is most of the width. Off by default: it is a real
   * readability trade, not a free win, because a collapsed run reads as one
   * long message at a glance.
   */
  mergeRuns: boolean;
}

export interface AlertsOverlaySettings {
  /** Which events produce a full-screen alert card. */
  eventTypes: StreamEventType[];
  durationMs: number;
  animation: OverlayAnimation;
  /** Minimum diamonds for a gift to alert. */
  minDiamonds: number;
  showAvatar: boolean;
  showGiftImage: boolean;
  /** Supports the same placeholders as TTS templates. */
  templates: Partial<Record<StreamEventType, string>>;
  /** URL of a sound to play with the alert. Served from /media. */
  soundUrl: string;
  soundVolume: number;
}

export interface TtsOverlaySettings {
  /** Draw a caption of what is currently being spoken. */
  showCaption: boolean;
  captionMaxChars: number;
  /** Show the pending queue under the caption. */
  showQueue: boolean;
  queueSize: number;
}

export interface GoalOverlaySettings {
  metric: 'likes' | 'diamonds' | 'followers' | 'shares' | 'viewers' | 'subscribers';
  label: string;
  target: number;
  /** Start counting from this value (e.g. an existing follower total). */
  startValue: number;
  showNumbers: boolean;
  showPercent: boolean;
  barHeight: number;
}

export interface TickerOverlaySettings {
  eventTypes: StreamEventType[];
  speedPxPerSecond: number;
  separator: string;
  maxItems: number;
}

export interface LeaderboardOverlaySettings {
  metric: 'diamonds' | 'likes' | 'gifts' | 'comments';
  size: number;
  title: string;
  showAvatars: boolean;
  showValues: boolean;
}

export interface CounterOverlaySettings {
  metrics: Array<'viewers' | 'likes' | 'diamonds' | 'followers' | 'shares' | 'comments'>;
  layout: 'row' | 'column';
  showLabels: boolean;
  showIcons: boolean;
}

export interface CustomOverlaySettings {
  /**
   * HTML rendered for every matching event, with `{{...}}` placeholders.
   * Rendered into a sandboxed container — scripts do not execute.
   */
  html: string;
  css: string;
  eventTypes: StreamEventType[];
  maxItems: number;
  itemTtlMs: number;
}

export type OverlaySettings =
  | { type: 'chat'; chat: ChatOverlaySettings }
  | { type: 'alerts'; alerts: AlertsOverlaySettings }
  | { type: 'tts'; tts: TtsOverlaySettings }
  | { type: 'goal'; goal: GoalOverlaySettings }
  | { type: 'ticker'; ticker: TickerOverlaySettings }
  | { type: 'leaderboard'; leaderboard: LeaderboardOverlaySettings }
  | { type: 'counter'; counter: CounterOverlaySettings }
  | { type: 'slideshow'; slideshow: SlideshowOverlaySettings }
  | { type: 'custom'; custom: CustomOverlaySettings };

export const SLIDESHOW_TRANSITIONS = [
  'fade',
  'crossfade',
  'slide-left',
  'slide-up',
  'zoom',
  'kenburns',
  'none',
] as const;

export type SlideshowTransition = (typeof SLIDESHOW_TRANSITIONS)[number];

export const IMAGE_FIT = ['cover', 'contain', 'fill'] as const;
export type ImageFit = (typeof IMAGE_FIT)[number];

export interface SlideshowOverlaySettings {
  /** Folder under data/media/slideshows. Empty means nothing to show yet. */
  folder: string;
  /** Seconds each image is held, before the transition starts. */
  intervalSeconds: number;
  transition: SlideshowTransition;
  /** How long the transition itself takes. */
  transitionMs: number;
  /** Random order. Reshuffles each time the list is exhausted. */
  shuffle: boolean;
  /** How an image fills the source box. */
  fit: ImageFit;
  /** Rounded corners, in px. */
  cornerRadius: number;
  /** Show the filename under each image, minus the extension. */
  showCaption: boolean;
  /** Stop after one pass instead of looping. */
  once: boolean;
}

export interface OverlaySource {
  /** URL-safe slug. The browser source URL is `/overlay/<id>`. */
  id: string;
  name: string;
  type: OverlayType;
  /**
   * Free-text group, for organising a long source list — "Main scene",
   * "Starting soon", "Just chatting". Empty means ungrouped. Purely
   * organisational; it has no effect on what a source renders.
   */
  group: string;
  enabled: boolean;
  /** Recommended browser-source dimensions. */
  width: number;
  height: number;
  align: 'start' | 'center' | 'end';
  justify: 'start' | 'center' | 'end';
  style: OverlayStyle;
  settings: OverlaySettings;
}

/* ------------------------------------------------------------------ *
 * Root
 * ------------------------------------------------------------------ */

export interface TunnelConfig {
  enabled: boolean;
  /** Reserved ngrok domain, e.g. `my-stream.ngrok.app`. Blank = random URL. */
  domain: string;
  /** Protect the dashboard behind ngrok basic auth (`user:password`). */
  basicAuth: string;
}

export interface SourcesConfig {
  /**
   * Hostname to use when copying a browser-source URL, replacing whatever
   * address the dashboard itself was loaded from.
   *
   * Exists because capture software validates the URL before it will even try
   * to load it, and the rules are stricter than a browser's. TikTok LIVE
   * Studio refuses `localhost` *and* bare IP addresses like
   * `http://192.168.1.20:4700` — it wants a hostname. Setting this to a name
   * that resolves to this machine (`stream.localhost.direct`, or anything you
   * have pinned in your hosts file) makes every copied URL acceptable to it
   * without involving a tunnel.
   *
   * Blank keeps the dashboard's own origin, which is right for most software.
   */
  host: string;
}

/**
 * The desktop chat panel — the always-on-top window you keep open while
 * playing.
 *
 * Separate from overlay settings because it is read by two very different
 * things: the web page inside the window, and the native shell around it.
 * Living in the server config rather than beside the executable means the
 * settings survive rebuilding the shell, and can be changed from the
 * dashboard while the panel is open.
 */
export interface ChatPanelConfig {
  /**
   * How opaque the panel background is, 0-1.
   *
   * Applies to the *background only* — text, avatars and badges stay fully
   * opaque at every setting. Fading the whole window (which is what a native
   * window-opacity call does) makes chat unreadable long before the
   * background is see-through enough to play behind.
   */
  opacity: number;
  /** The colour the opacity is applied to. */
  background: string;
  /** Multiplier on the panel's text size, for reading it at a glance. */
  fontScale: number;
  /** Keep the window above other windows, including a borderless game. */
  alwaysOnTop: boolean;
  /** Show newest messages at the bottom, matching the dashboard log. */
  newestAtBottom: boolean;
  /** Hide join/like noise, leaving chat and gifts. */
  chatOnly: boolean;
}

export interface AppConfig {
  version: number;
  chatPanel: ChatPanelConfig;
  connection: ConnectionConfig;
  twitch: TwitchConnectionConfig;
  youtube: YouTubeConnectionConfig;
  filters: FilterConfig;
  users: UsersConfig;
  tts: TtsConfig;
  tunnel: TunnelConfig;
  sources: SourcesConfig;
  overlays: OverlaySource[];
  /**
   * Gradient tiers marking notable viewers.
   *
   * Global rather than per-overlay on purpose: the same person has to look
   * the same in the overlay, the pop-out panel and the dashboard, or the
   * highlight stops meaning anything. Individual chat sources opt in or out
   * with `showHighlights`, but they all read the same list.
   */
  highlights: HighlightTier[];
}

/**
 * Builds the URL you hand to a browser source.
 *
 * Swaps in `host` while keeping the protocol and port of `origin`, so the
 * result still points at this server. Shared between the dashboard (which
 * knows its own origin) and the API (which knows the request's), so both
 * cannot drift.
 */
export function overlayUrl(origin: string, host: string, id: string): string {
  const trimmed = host.trim();
  if (!trimmed) return `${origin}/overlay/${id}`;
  try {
    const url = new URL(origin);
    url.hostname = trimmed;
    return `${url.origin}/overlay/${id}`;
  } catch {
    // A malformed origin is not worth throwing over; fall back to the plain form.
    return `${origin}/overlay/${id}`;
  }
}

export const CONFIG_VERSION = 1;

export const DEFAULT_FILTERS: FilterConfig = {
  enabled: true,
  blockedWords: [],
  blockedPhrases: [],
  blockedRegex: [],
  blockedUsers: [],
  action: 'skip',
  censorReplacement: '***',
  normalizeLeetspeak: true,
  collapseRepeatedChars: true,
  matchTransliterations: true,
  // Latin plus the scripts whose speakers are most likely to be genuine
  // viewers. Widen this if your audience writes in another script.
  allowedScripts: ['Latin', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Cyrillic', 'Arabic'],
  blockDisallowedScripts: false,
  blockMixedScriptWords: false,
  // Safe to leave on: it reports, it never blocks.
  reviewNearMatches: true,
  stripUrls: true,
  stripEmoji: false,
  maxLength: 200,
  applyToOverlay: true,
};

export const DEFAULT_TTS_RULE: Omit<TtsRule, 'id'> = {
  name: 'New rule',
  enabled: true,
  eventTypes: ['chat'],
  /** Empty = every connected platform. */
  platforms: [],
  template: '{{nickname}} says {{message}}',
  voice: DEFAULT_TTS_VOICE,
  voicePool: [],
  priority: 0,
  cooldownSeconds: 5,
  maxChars: 200,
  gate: DEFAULT_GATE,
  conditions: DEFAULT_CONDITIONS,
  volume: 1,
  rate: 1,
};
