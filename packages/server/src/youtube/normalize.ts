import { randomUUID } from 'node:crypto';
import type {
  ChatEvent,
  GiftEvent,
  StreamEvent,
  StreamUser,
  SubscribeEvent,
  SystemEvent,
} from '@streaming/shared';

/**
 * YouTube Live Chat → the normalized event model.
 *
 * The counterpart to `tiktok/normalize.ts` and `twitch/normalize.ts`: nothing
 * downstream should ever learn that this arrived as JSON from a polled REST
 * endpoint rather than over a socket.
 *
 * YouTube's vocabulary differs from the other two in a way that has bitten
 * this codebase before, so it is worth stating plainly: a YouTube
 * **subscriber** is free and corresponds to a TikTok or Twitch *follower*,
 * while the paid tier is a **member**. `authorDetails` only reports the paid
 * one (`isChatSponsor`), so that is what maps to `isSubscriber` here — and
 * free subscription, which is the thing most people mean by the word, is not
 * reported at all.
 */

/** The subset of the API response this module reads. */
export interface YouTubeAuthorDetails {
  channelId?: string;
  displayName?: string;
  profileImageUrl?: string;
  isVerified?: boolean;
  isChatOwner?: boolean;
  isChatSponsor?: boolean;
  isChatModerator?: boolean;
}

export interface YouTubeChatMessage {
  id?: string;
  snippet?: {
    type?: string;
    displayMessage?: string;
    publishedAt?: string;
    textMessageDetails?: { messageText?: string };
    superChatDetails?: YouTubeAmount & { userComment?: string };
    superStickerDetails?: YouTubeAmount & {
      superStickerMetadata?: { stickerId?: string; altText?: string };
    };
    newSponsorDetails?: { memberLevelName?: string; isUpgrade?: boolean };
    memberMilestoneChatDetails?: {
      memberLevelName?: string;
      memberMonth?: number;
      userComment?: string;
    };
    membershipGiftingDetails?: {
      giftMembershipsCount?: number;
      giftMembershipsLevelName?: string;
    };
  };
  authorDetails?: YouTubeAuthorDetails;
}

interface YouTubeAmount {
  amountMicros?: string | number;
  currency?: string;
  amountDisplayString?: string;
  tier?: number;
}

/**
 * Money, converted to the integer unit the rest of the system counts in.
 *
 * Every gift path in this codebase funnels into `diamondCount` — gates,
 * highlight thresholds, the leaderboard, lifetime totals. TikTok supplies
 * diamonds and Twitch supplies bits; YouTube supplies actual currency, so it
 * has to become *some* integer or none of those features work on it.
 *
 * Cents is that integer. `amountMicros` is millionths of a unit, so dividing
 * by 10,000 gives cents: a $5.00 Super Chat becomes 500, which is legible in
 * a threshold box in a way that 5,000,000 is not.
 *
 * The honest caveat: this ignores currency. A ¥500 Super Chat and a $5.00 one
 * both land near 500 despite being worth very different amounts. Converting
 * properly would mean live FX rates, a network call per message and a number
 * that changes retroactively — all worse than a documented approximation for
 * something whose only job is sorting a leaderboard and tripping a threshold.
 */
export function centsFrom(amount: YouTubeAmount | undefined): number {
  const micros = Number(amount?.amountMicros ?? 0);
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return Math.round(micros / 10_000);
}

export function youtubeUser(author: YouTubeAuthorDetails | undefined): StreamUser {
  const channelId = author?.channelId ?? '';
  const displayName = author?.displayName ?? '';

  const badges: string[] = [];
  if (author?.isChatOwner) badges.push('owner');
  if (author?.isChatModerator) badges.push('moderator');
  if (author?.isChatSponsor) badges.push('member');
  if (author?.isVerified) badges.push('verified');

  return {
    platform: 'youtube',
    userId: channelId || 'unknown',
    /*
     * The channel id, not the display name.
     *
     * YouTube display names are neither unique nor stable — two people in one
     * chat can share one, and anybody can change theirs mid-stream. Using it
     * as the handle would merge strangers into a single identity in the
     * archive, the trusted list and the penalty box. The id is ugly in a
     * `@handle` but it is the only thing that actually identifies a person.
     */
    uniqueId: channelId.toLowerCase(),
    nickname: displayName || channelId || 'Unknown',
    avatarUrl: author?.profileImageUrl ?? null,
    // Free subscription is not in `authorDetails` at all, so this stays 0
    // rather than being guessed. See the module comment.
    followRole: 0,
    isFollower: false,
    isFriend: false,
    // Paid channel membership — YouTube's analogue of a Twitch sub.
    isSubscriber: Boolean(author?.isChatSponsor),
    isModerator: Boolean(author?.isChatModerator),
    isHost: Boolean(author?.isChatOwner),
    isVerified: Boolean(author?.isVerified),
    followerCount: 0,
    fansClubLevel: 0,
    badges,
  };
}

const base = (ts: string | undefined): { id: string; ts: number; platform: 'youtube' } => ({
  id: randomUUID(),
  // The publish time from YouTube where it parses, wall clock otherwise.
  // Polling means a batch can arrive seconds after it was sent, and ordering
  // a chat log by arrival rather than by when people spoke reads wrong.
  ts: parseTs(ts),
  platform: 'youtube',
});

function parseTs(value: string | undefined): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * One chat message from the API, as a normalized event — or null.
 *
 * Null is returned for the several message types that describe the *chat*
 * rather than a person: deletions, bans, tombstones, member-only mode
 * changing. Those matter for moderation but have no place in a chat overlay,
 * and inventing an event for them would put "userBannedEvent" on stream.
 */
export function youtubeEventFrom(message: YouTubeChatMessage): StreamEvent | null {
  const snippet = message.snippet;
  if (!snippet) return null;

  const user = youtubeUser(message.authorDetails);
  const ts = snippet.publishedAt;

  switch (snippet.type) {
    case 'textMessageEvent': {
      const text = snippet.textMessageDetails?.messageText ?? snippet.displayMessage ?? '';
      if (!text) return null;
      return {
        ...base(ts),
        type: 'chat',
        user,
        text,
        displayText: text,
        filtered: false,
        filterReason: null,
        redacted: false,
        emotes: [],
      } satisfies ChatEvent;
    }

    case 'superChatEvent': {
      const details = snippet.superChatDetails;
      const cents = centsFrom(details);
      return {
        ...base(ts),
        type: 'gift',
        user,
        giftId: 'super-chat',
        // The displayed amount, so an alert reads "$5.00" in the viewer's own
        // currency rather than a converted number they never typed.
        giftName: details?.amountDisplayString
          ? `Super Chat ${details.amountDisplayString}`
          : 'Super Chat',
        giftImageUrl: null,
        diamondCount: cents,
        repeatCount: 1,
        repeatEnd: true,
        streakable: false,
        totalDiamonds: cents,
      } satisfies GiftEvent;
    }

    case 'superStickerEvent': {
      const details = snippet.superStickerDetails;
      const cents = centsFrom(details);
      const alt = details?.superStickerMetadata?.altText;
      return {
        ...base(ts),
        type: 'gift',
        user,
        giftId: details?.superStickerMetadata?.stickerId ?? 'super-sticker',
        giftName: alt ? `Super Sticker: ${alt}` : 'Super Sticker',
        giftImageUrl: null,
        diamondCount: cents,
        repeatCount: 1,
        repeatEnd: true,
        streakable: false,
        totalDiamonds: cents,
      } satisfies GiftEvent;
    }

    case 'newSponsorEvent':
      return {
        ...base(ts),
        type: 'subscribe',
        user,
        subMonths: 1,
        isGifted: false,
      } satisfies SubscribeEvent;

    case 'memberMilestoneChatEvent':
      return {
        ...base(ts),
        type: 'subscribe',
        user,
        subMonths: snippet.memberMilestoneChatDetails?.memberMonth ?? 1,
        isGifted: false,
      } satisfies SubscribeEvent;

    case 'giftMembershipReceivedEvent':
      return {
        ...base(ts),
        type: 'subscribe',
        user,
        subMonths: 1,
        isGifted: true,
      } satisfies SubscribeEvent;

    /*
     * Someone buying memberships for other people.
     *
     * Modelled as one subscribe from the *buyer* rather than N from the
     * recipients: the recipients each get their own
     * `giftMembershipReceivedEvent`, so counting both would double every
     * gifted membership in the session totals.
     */
    case 'membershipGiftingEvent':
      return {
        ...base(ts),
        type: 'subscribe',
        user,
        subMonths: 1,
        isGifted: true,
      } satisfies SubscribeEvent;

    case 'chatEndedEvent':
      return {
        ...base(ts),
        type: 'system',
        user: null,
        level: 'info',
        text: 'YouTube: the live chat has ended',
      } satisfies SystemEvent;

    default:
      // messageDeletedEvent, userBannedEvent, tombstone, sponsorOnlyMode*,
      // pollEvent — all about the chat rather than in it.
      return null;
  }
}
