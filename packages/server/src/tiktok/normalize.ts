import { randomUUID } from 'node:crypto';
import type {
  ImageModel,
  User,
  WebcastChatMessage,
  WebcastEmoteChatMessage,
  WebcastEnvelopeMessage,
  WebcastGiftMessage,
  WebcastLikeMessage,
  WebcastMemberMessage,
  WebcastQuestionNewMessage,
  WebcastRoomUserSeqMessage,
  WebcastSocialMessage,
  WebcastSubNotifyMessage,
} from 'tiktok-live-connector';
import {
  anonymousUser,
  type ChatEvent,
  type EmoteEvent,
  type EnvelopeEvent,
  type FollowEvent,
  type FollowRole,
  type GiftEvent,
  type JoinEvent,
  type LikeEvent,
  type QuestionEvent,
  type RoomStatsEvent,
  type ShareEvent,
  type StreamUser,
  type SubscribeEvent,
} from '@streaming/shared';

/** TikTok sends numbers as strings in a lot of places. */
function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function imageUrl(image: ImageModel | undefined): string | null {
  const url = image?.urlList?.find((u) => typeof u === 'string' && u.length > 0);
  return url ?? null;
}

/**
 * `followInfo.followStatus`: 0 stranger, 1 follows the host, 2 mutual.
 * Some frames omit followInfo entirely but still set the boolean flags.
 */
function followRoleOf(user: User): FollowRole {
  const status = toInt(user.followInfo?.followStatus, -1);
  if (status === 2) return 2;
  if (status === 1) return 1;
  if (status === 0) return 0;
  if (user.isFollower && user.isFollowing) return 2;
  if (user.isFollower) return 1;
  return 0;
}

function badgesOf(user: User, moderator: boolean, subscriber: boolean): string[] {
  const badges: string[] = [];
  if (user.userRole === 3 || user.anchorInfo) badges.push('host');
  if (moderator) badges.push('moderator');
  if (subscriber) badges.push('subscriber');
  if (user.verified) badges.push('verified');
  const club = user.fansClub?.data?.clubName || user.fansClubInfo?.fansClubName;
  if (club) badges.push(`fans:${club}`);
  const grade = toInt(user.payGrade?.level, 0);
  if (grade > 0) badges.push(`level:${grade}`);
  return badges;
}

export function normalizeUser(user: User | undefined, hostUniqueId = ''): StreamUser {
  if (!user) return anonymousUser('tiktok');

  const moderator = Boolean(user.userAttr?.isAdmin || user.userAttr?.isSuperAdmin);
  const subscriber = Boolean(
    user.subscribeInfo?.isSubscribedToAnchor ?? user.subscribeInfo?.isSubscribe,
  );
  const role = followRoleOf(user);
  const uniqueId = user.displayId || user.idStr || '';
  const fansClubLevel = toInt(user.fansClub?.data?.level, toInt(user.fansClubInfo?.fansLevel, 0));

  return {
    platform: 'tiktok',
    userId: user.id || user.idStr || '0',
    uniqueId,
    nickname: user.nickname || uniqueId || 'Unknown',
    avatarUrl: imageUrl(user.avatarThumb) ?? imageUrl(user.avatarMedium),
    followRole: role,
    isFollower: role >= 1,
    isFriend: role === 2,
    isSubscriber: subscriber,
    isModerator: moderator,
    isHost: Boolean(
      hostUniqueId && uniqueId && uniqueId.toLowerCase() === hostUniqueId.toLowerCase(),
    ),
    isVerified: Boolean(user.verified),
    followerCount: toInt(user.followInfo?.followerCount, 0),
    fansClubLevel,
    badges: badgesOf(user, moderator, subscriber),
  };
}

/** Every event from this module is TikTok by construction. */
const baseEvent = (): { id: string; ts: number; platform: 'tiktok' } => ({
  id: randomUUID(),
  ts: Date.now(),
  platform: 'tiktok',
});

export function normalizeChat(msg: WebcastChatMessage, host: string): ChatEvent {
  return {
    ...baseEvent(),
    type: 'chat',
    user: normalizeUser(msg.user, host),
    text: msg.content ?? '',
    // Filled in by the filter stage before the event is broadcast.
    displayText: msg.content ?? '',
    filtered: false,
    filterReason: null,
    redacted: false,
    filterSeverity: 'none',
    emotes: (msg.emotes ?? [])
      .map((e) => imageUrl(e.emote?.image))
      .filter((url): url is string => Boolean(url)),
  };
}

export function normalizeGift(msg: WebcastGiftMessage, host: string): GiftEvent {
  const diamonds = toInt(msg.gift?.diamondCount, 0);
  const repeatCount = Math.max(1, toInt(msg.repeatCount, 1));
  // giftType 1 is the streakable kind; everything else fires once.
  const streakable = toInt(msg.gift?.type, 0) === 1;

  return {
    ...baseEvent(),
    type: 'gift',
    user: normalizeUser(msg.user, host),
    giftId: msg.giftId ?? msg.gift?.id ?? '0',
    giftName: msg.gift?.name ?? 'Gift',
    giftImageUrl: imageUrl(msg.gift?.image) ?? imageUrl(msg.gift?.icon),
    diamondCount: diamonds,
    repeatCount,
    repeatEnd: streakable ? toInt(msg.repeatEnd, 0) === 1 : true,
    streakable,
    totalDiamonds: diamonds * repeatCount,
  };
}

/**
 * The connector routes `WebcastSocialMessage` to dedicated `follow` and
 * `share` events, so these are called from the specific listeners rather
 * than sniffing `msg.action` ourselves.
 */
export function normalizeFollow(msg: WebcastSocialMessage, host: string): FollowEvent {
  return {
    ...baseEvent(),
    type: 'follow',
    user: normalizeUser(msg.user, host),
    totalFollowCount: toInt(msg.followCount, 0),
  };
}

export function normalizeShare(msg: WebcastSocialMessage, host: string): ShareEvent {
  return {
    ...baseEvent(),
    type: 'share',
    user: normalizeUser(msg.user, host),
    shareCount: toInt(msg.shareCount, 1),
  };
}

export function normalizeLike(msg: WebcastLikeMessage, host: string): LikeEvent {
  return {
    ...baseEvent(),
    type: 'like',
    user: normalizeUser(msg.user, host),
    likeCount: toInt(msg.count, 1),
    totalLikeCount: toInt(msg.total, 0),
  };
}

export function normalizeMember(
  msg: WebcastMemberMessage,
  host: string,
  isFirstJoin: boolean,
): JoinEvent {
  return {
    ...baseEvent(),
    type: 'join',
    user: normalizeUser(msg.user, host),
    memberCount: toInt(msg.memberCount, 0),
    isFirstJoin,
  };
}

export function normalizeSubscribe(msg: WebcastSubNotifyMessage, host: string): SubscribeEvent {
  return {
    ...baseEvent(),
    type: 'subscribe',
    user: normalizeUser(msg.user, host),
    subMonths: toInt(msg.subMonth, 1),
    isGifted: toInt(msg.giftSource, 0) !== 0,
  };
}

export function normalizeEnvelope(msg: WebcastEnvelopeMessage, host: string): EnvelopeEvent {
  const info = msg.envelopeInfo;
  const user: StreamUser = {
    ...anonymousUser('tiktok'),
    userId: info?.sendUserId ?? '0',
    uniqueId: info?.sendUserName ?? '',
    nickname: info?.sendUserName ?? 'Someone',
    avatarUrl: imageUrl(info?.sendUserAvatar),
    isHost: Boolean(host && info?.sendUserName?.toLowerCase() === host.toLowerCase()),
  };
  return {
    ...baseEvent(),
    type: 'envelope',
    user,
    coins: toInt(info?.diamondCount, 0),
    peopleCount: toInt(info?.peopleCount, 0),
  };
}

export function normalizeQuestion(msg: WebcastQuestionNewMessage, host: string): QuestionEvent {
  return {
    ...baseEvent(),
    type: 'question',
    user: normalizeUser(msg.data?.user, host),
    text: msg.data?.content ?? '',
  };
}

export function normalizeEmote(msg: WebcastEmoteChatMessage, host: string): EmoteEvent {
  return {
    ...baseEvent(),
    type: 'emote',
    user: normalizeUser(msg.user, host),
    emoteUrls: (msg.emoteList ?? [])
      .map((e) => imageUrl(e.image))
      .filter((url): url is string => Boolean(url)),
  };
}

export function normalizeRoomStats(msg: WebcastRoomUserSeqMessage, host: string): RoomStatsEvent {
  return {
    ...baseEvent(),
    type: 'roomStats',
    user: null,
    /*
     * `total`, not `totalUser`. They are both here and they are very
     * different numbers.
     *
     * The wire format settles it. In v1 of this proto the field was literally
     * named `viewerCount`, and it was field 3; in v3 field 3 is `total`.
     * `totalUser` is field 7 — a separate field that did not exist in v1 at
     * all, carrying the cumulative count of everyone who has tuned in at any
     * point this stream.
     *
     * Preferring `totalUser` was the bug: it only ever rises, it is always
     * larger than the number of people actually watching, and it does not
     * match what TikTok's own dashboard shows.
     */
    viewerCount: toInt(msg.total, 0),
    // Kept rather than discarded, because it answers a question the
    // concurrent count cannot: how many distinct people saw the stream at
    // all. Null when the platform does not report it — every other platform.
    totalViewers: toInt(msg.totalUser, 0) || null,
    topViewers: (msg.ranks ?? []).slice(0, 10).map((rank, index) => ({
      user: normalizeUser(rank.user, host),
      coinCount: toInt(rank.score, 0),
      rank: toInt(rank.rank, index + 1),
    })),
  };
}
