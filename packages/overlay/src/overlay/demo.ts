import type { Platform,
  LeaderboardEntry,
  SessionStats,
  StreamEvent,
  StreamUser,
  TtsState,
} from '@streaming/shared';

/**
 * Placeholder data for previewing a source without a live room.
 *
 * Everything here is invented. Avatars are generated as inline SVG rather than
 * fetched, so a preview never hits the network and never shows a real person's
 * picture in a mock-up.
 */

const PALETTE = ['#25f4ee', '#fe2c55', '#6ea8ff', '#34d399', '#fbbf24', '#c084fc'];

function avatarFor(name: string, index: number): string {
  const initials = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
  const color = PALETTE[index % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${color}" opacity="0.22"/><circle cx="32" cy="32" r="31" fill="none" stroke="${color}" stroke-width="2"/><text x="32" y="41" font-family="Inter,Segoe UI,sans-serif" font-size="24" font-weight="700" fill="${color}" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const NAMES = [
  'PixelPatty',
  'NeonNoodle',
  'CaptainCrumb',
  'VelvetVulture',
  'SirLoafalot',
  'QuietStorm',
  'MangoDynamo',
  'BitRotBetty',
];

/** Rotated across platforms so demo chat exercises every accent colour. */
const DEMO_PLATFORMS: Platform[] = ['tiktok', 'twitch', 'youtube'];

export const DEMO_USERS: StreamUser[] = NAMES.map((nickname, i) => ({
  platform: DEMO_PLATFORMS[i % DEMO_PLATFORMS.length] as Platform,
  userId: `demo-${i}`,
  uniqueId: nickname.toLowerCase(),
  nickname,
  avatarUrl: avatarFor(nickname, i),
  followRole: (i % 3) as 0 | 1 | 2,
  isFollower: i % 3 !== 0,
  isFriend: i % 4 === 0,
  isSubscriber: i % 5 === 0,
  isModerator: i === 1,
  isHost: false,
  isVerified: i === 3,
  followerCount: 120 + i * 733,
  fansClubLevel: i % 3,
  badges: i === 1 ? ['moderator'] : [],
}));

const MESSAGES = [
  'this overlay actually looks clean',
  'first time here, love the setup',
  'what game is this?',
  'the transition was so smooth',
  'ayy the goal is almost done',
  'someone gift so we can hear the alert',
  'chat is moving so fast today',
  'that was a wild play ngl',
];

const GIFTS: Array<{ name: string; diamonds: number }> = [
  { name: 'Rose', diamonds: 1 },
  { name: 'Finger Heart', diamonds: 5 },
  { name: 'Perfume', diamonds: 20 },
  { name: 'Doughnut', diamonds: 30 },
  { name: 'Galaxy', diamonds: 1000 },
];

let seq = 0;
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)] as T;

const base = (platform: Platform = 'tiktok'): { id: string; ts: number; platform: Platform } => ({
  id: `demo-${seq++}`,
  ts: Date.now(),
  platform,
});

/** One synthetic event, weighted toward chat so previews look like a real room. */
export function demoEvent(type?: StreamEvent['type']): StreamEvent {
  const user = pick(DEMO_USERS);
  const kind =
    type ??
    pick(['chat', 'chat', 'chat', 'chat', 'gift', 'follow', 'like', 'share', 'subscribe', 'join'] as const);

  switch (kind) {
    case 'gift': {
      const gift = pick(GIFTS);
      const repeatCount = gift.diamonds > 100 ? 1 : 1 + Math.floor(Math.random() * 8);
      return {
        ...base(user.platform),
        type: 'gift',
        user,
        giftId: gift.name.toLowerCase().replace(/\s+/g, '-'),
        giftName: gift.name,
        giftImageUrl: null,
        diamondCount: gift.diamonds,
        repeatCount,
        repeatEnd: true,
        streakable: gift.diamonds <= 100,
        totalDiamonds: gift.diamonds * repeatCount,
      } as unknown as StreamEvent;
    }
    case 'follow':
      return { ...base(user.platform), type: 'follow', user, totalFollowCount: 1240 + seq } as unknown as StreamEvent;
    case 'like':
      return {
        ...base(user.platform),
        type: 'like',
        user,
        likeCount: 5 + Math.floor(Math.random() * 20),
        totalLikeCount: 8400 + seq * 13,
      } as unknown as StreamEvent;
    case 'share':
      return { ...base(user.platform), type: 'share', user, shareCount: 1 } as unknown as StreamEvent;
    case 'subscribe':
      return {
        ...base(user.platform),
        type: 'subscribe',
        user,
        subMonths: 1 + Math.floor(Math.random() * 12),
        isGifted: Math.random() < 0.3,
      } as unknown as StreamEvent;
    case 'join':
      return {
        ...base(user.platform),
        type: 'join',
        user,
        memberCount: 210 + seq,
        isFirstJoin: true,
      } as unknown as StreamEvent;
    default: {
      const text = pick(MESSAGES);
      return {
        ...base(user.platform),
        type: 'chat',
        user,
        text,
        displayText: text,
        filtered: false,
        filterReason: null,
        emotes: [],
      } as unknown as StreamEvent;
    }
  }
}

export const DEMO_STATS: SessionStats = {
  startedAt: Date.now() - 42 * 60 * 1000,
  viewerCount: 214,
  // Two services reporting, so the preview shows the split rather than a
  // single number with no provenance.
  viewerCounts: { tiktok: 189, twitch: 25 },
  peakViewerCount: 388,
  likes: 8437,
  diamonds: 2160,
  gifts: 37,
  followers: 24,
  shares: 11,
  comments: 512,
  subscribers: 6,
  joins: 173,
  uniqueChatters: 96,
  // Split so the panel's per-tab strip has something to preview, including
  // the case that matters most: Twitch reporting no viewer count at all.
  platforms: {
    tiktok: {
      viewers: 189,
      peakViewers: 341,
      // Far larger than `seen`, which is the point: most of an audience never
      // does anything we can observe.
      reportedTotal: 2140,
      seen: 604,
      chatters: 74,
      messages: 431,
      diamonds: 2160,
      gifts: 37,
      followers: 21,
      subscribers: 2,
      shares: 9,
      likes: 8437,
    },
    twitch: {
      viewers: null,
      peakViewers: 0,
      reportedTotal: null,
      seen: 58,
      chatters: 22,
      messages: 81,
      diamonds: 0,
      gifts: 0,
      followers: 3,
      subscribers: 4,
      shares: 2,
      likes: 0,
    },
  },
};

export const DEMO_LEADERBOARD: LeaderboardEntry[] = DEMO_USERS.slice(0, 6).map((user, i) => ({
  user,
  diamonds: [1200, 640, 305, 140, 55, 20][i] ?? 10,
  gifts: [9, 6, 4, 3, 2, 1][i] ?? 1,
  likes: [420, 260, 180, 90, 40, 12][i] ?? 5,
  comments: [31, 22, 18, 9, 4, 2][i] ?? 1,
  shares: [3, 2, 1, 1, 0, 0][i] ?? 0,
  lastSeen: Date.now() - i * 45_000,
}));

/**
 * A TTS state that shows the widget's visuals without any audio. Previews must
 * never actually speak — several could be on screen at once.
 */
export const DEMO_TTS: TtsState = {
  enabled: true,
  speaking: {
    id: 'demo-clip',
    ruleId: 'chat-followers',
    ruleName: 'Read chat (followers only)',
    text: 'PixelPatty says this overlay actually looks clean',
    voice: 'en-US:female',
    provider: 'google-legacy',
    priority: 0,
    volume: 1,
    rate: 1,
    pitch: 1,
    createdAt: Date.now(),
    audioUrl: null,
    durationMs: 3200,
    username: 'pixelpatty',
  },
  queue: [],
  listeners: 1,
  overlayListeners: 1,
  lastError: null,
} as unknown as TtsState;

/** Seed events so a preview is populated the instant it loads. */
export function demoHistory(count = 14): StreamEvent[] {
  return Array.from({ length: count }, () => demoEvent());
}
