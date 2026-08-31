import { randomUUID } from 'node:crypto';
import type {
  Platform,
  StreamEvent,
  StreamEventType,
  StreamUser,
  TestEventSpec,
} from '@streaming/shared';

const NAMES = [
  ['glitchcat', 'Glitch Cat'],
  ['bassdrop', 'Bass Drop'],
  ['nightowl', 'Night Owl'],
  ['pixelpanda', 'Pixel Panda'],
  ['moonrunner', 'Moon Runner'],
];

const MESSAGES = [
  'this stream is unreal',
  'first time here, love the setup',
  'can you play that track again?',
  'how long have you been streaming?',
  'the overlay looks so clean',
];

const GIFTS: Array<[string, number]> = [
  ['Rose', 1],
  ['TikTok', 1],
  ['Finger Heart', 5],
  ['Galaxy', 1000],
  ['Lion', 29999],
];

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;

/**
 * Builds the person the event comes from.
 *
 * Roles default to *off* rather than to something random. The old version
 * rolled `isSubscriber` on a 30% chance and always set `isFollower`, which
 * made a gated rule appear to work or not work depending on the dice — the
 * worst possible behaviour for a tool whose job is answering "will this
 * fire?".
 */
function testUser(spec: TestEventSpec): StreamUser {
  const [randomId, randomName] = pick(NAMES) as [string, string];
  const uniqueId = spec.username?.trim().toLowerCase().replace(/^@/, '') || randomId;
  const isFollower = spec.isFollower ?? false;

  return {
    platform: spec.platform,
    // Derived from the handle so repeat fires are the same person, which is
    // what per-user cooldowns and session totals key on.
    userId: `test-${uniqueId}`,
    uniqueId,
    nickname: spec.displayName?.trim() || (spec.username ? uniqueId : randomName),
    avatarUrl: null,
    // Mutuals follow by definition; letting these disagree would spoof a
    // state no platform can produce.
    followRole: spec.isFriend ? 2 : isFollower ? 1 : 0,
    isFollower: isFollower || Boolean(spec.isFriend),
    isFriend: spec.isFriend ?? false,
    isSubscriber: spec.isSubscriber ?? false,
    isModerator: spec.isModerator ?? false,
    isHost: spec.isHost ?? false,
    isVerified: spec.isVerified ?? false,
    followerCount: spec.followerCount ?? 0,
    fansClubLevel: spec.fansClubLevel ?? 0,
    badges: badgesFor(spec),
  };
}

/** Badges the platforms would have attached, so overlays render honestly. */
function badgesFor(spec: TestEventSpec): string[] {
  const badges: string[] = [];
  if (spec.isHost) badges.push(spec.platform === 'twitch' ? 'broadcaster' : 'host');
  if (spec.isModerator) badges.push('moderator');
  if (spec.isSubscriber) badges.push('subscriber');
  if (spec.isVerified) badges.push(spec.platform === 'twitch' ? 'partner' : 'verified');
  return badges;
}

const base = (
  platform: Platform,
): { id: string; ts: number; platform: Platform; synthetic: true } => ({
  id: randomUUID(),
  ts: Date.now(),
  platform,
  synthetic: true,
});

/**
 * Synthesizes a realistic event so overlays, filters and TTS rules can be
 * designed and tested without waiting for a real viewer to do something.
 *
 * Marked `synthetic`, which keeps it out of the permanent viewer archive
 * while still letting it run the full pipeline — filters, gates, TTS and
 * every overlay — exactly as a real event would.
 */
export function createTestEvent(spec: TestEventSpec): StreamEvent {
  const { type, platform, text } = spec;
  const user = testUser(spec);

  switch (type) {
    case 'chat': {
      const message = text ?? pick(MESSAGES);
      return {
        ...base(platform),
        type: 'chat',
        user,
        text: message,
        displayText: message,
        filtered: false,
        filterReason: null,
        redacted: false,
        emotes: [],
      };
    }
    case 'gift': {
      const [randomGift, randomDiamonds] = pick(GIFTS);
      const giftName = spec.giftName?.trim() || randomGift;
      const diamondCount = spec.diamonds ?? randomDiamonds;
      const repeatCount =
        spec.repeatCount ?? (diamondCount <= 5 ? 1 + Math.floor(Math.random() * 20) : 1);
      return {
        ...base(platform),
        type: 'gift',
        user,
        giftId: '5655',
        giftName,
        giftImageUrl: null,
        diamondCount,
        repeatCount,
        repeatEnd: true,
        streakable: diamondCount <= 5,
        totalDiamonds: diamondCount * repeatCount,
      };
    }
    case 'follow':
      return { ...base(platform), type: 'follow', user, totalFollowCount: 1 };
    case 'share':
      return { ...base(platform), type: 'share', user, shareCount: 1 };
    case 'like':
      return {
        ...base(platform),
        type: 'like',
        user,
        likeCount: spec.likeCount ?? 15,
        totalLikeCount: 500 + Math.floor(Math.random() * 5000),
      };
    case 'join':
      return { ...base(platform), type: 'join', user, memberCount: 42, isFirstJoin: true };
    case 'subscribe':
      return { ...base(platform), type: 'subscribe', user, subMonths: 1, isGifted: false };
    case 'envelope':
      return { ...base(platform), type: 'envelope', user, coins: 99, peopleCount: 10 };
    case 'question':
      return { ...base(platform), type: 'question', user, text: text ?? 'What mic are you using?' };
    case 'emote':
      return { ...base(platform), type: 'emote', user, emoteUrls: [] };
    case 'roomStats':
      return {
        ...base(platform),
        type: 'roomStats',
        user: null,
        viewerCount: spec.viewerCount ?? 100 + Math.floor(Math.random() * 900),
        totalViewers: null,
        topViewers: [],
      };
    case 'streamEnd':
      return { ...base(platform), type: 'streamEnd', user: null, reason: 'Test stream end' };
    case 'system':
      return {
        ...base(platform),
        type: 'system',
        user: null,
        level: 'info',
        text: text ?? 'Test system message',
      };
  }
}
