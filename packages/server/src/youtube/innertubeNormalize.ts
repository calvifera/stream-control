import { randomUUID } from 'node:crypto';
import type { ChatEvent, GiftEvent, StreamEvent, StreamUser, SubscribeEvent } from '@streaming/shared';
import { youtubeUser } from './normalize.js';

/**
 * Turns watch-page chat renderers into the app's events.
 *
 * A separate normalizer from `normalize.ts` because the two sources agree on
 * almost nothing at the wire level. The Data API hands over a tidy
 * `snippet`/`authorDetails` pair with booleans and an integer amount in
 * micros; the watch page hands over nested renderers, badges identified by
 * icon name, and money as the string a viewer saw — "$5.00", "£3", "¥500".
 *
 * What they must agree on is identity, and they do: both key a viewer on the
 * channel id, so the trusted list, the penalty box and the archive survive
 * switching between them mid-stream. That is the reason `youtubeUser` is
 * imported rather than reimplemented — one definition of who someone is.
 */

interface Thumbnail {
  url?: string;
}

interface Run {
  text?: string;
  emoji?: {
    emojiId?: string;
    shortcuts?: string[];
    isCustomEmoji?: boolean;
    image?: { thumbnails?: Thumbnail[] };
  };
}

interface AuthorBadge {
  liveChatAuthorBadgeRenderer?: {
    icon?: { iconType?: string };
    /** Member badges carry an image instead of a named icon. */
    customThumbnail?: { thumbnails?: Thumbnail[] };
    tooltip?: string;
  };
}

interface BaseRenderer {
  id?: string;
  timestampUsec?: string;
  authorName?: { simpleText?: string };
  authorPhoto?: { thumbnails?: Thumbnail[] };
  authorExternalChannelId?: string;
  authorBadges?: AuthorBadge[];
  message?: { runs?: Run[] };
  purchaseAmountText?: { simpleText?: string };
  headerSubtext?: { runs?: Run[]; simpleText?: string };
  headerPrimaryText?: { runs?: Run[]; simpleText?: string };
}

const thumb = (thumbnails: Thumbnail[] | undefined): string | null => {
  // Last is the largest; YouTube orders them small to large.
  const list = thumbnails?.filter((t) => Boolean(t.url)) ?? [];
  return list.length > 0 ? (list[list.length - 1]?.url ?? null) : null;
};

/**
 * Flattens a message into text, keeping emoji as their shortcodes.
 *
 * Custom emotes arrive here as objects with an image and a shortcut like
 * `:_sagethink:`, which is strictly more than the Data API gives — it flattens
 * the same message to the bare text `[sagethink]` with no picture attached.
 * The shortcode is kept in the text so the message still reads, and the image
 * is collected separately for anything that wants to render it.
 */
export function runsToText(runs: Run[] | undefined): string {
  if (!runs) return '';
  return runs
    .map((run) => {
      if (typeof run.text === 'string') return run.text;
      const emoji = run.emoji;
      if (!emoji) return '';
      // Standard emoji have the character itself as the id; custom ones have
      // an opaque id and are only nameable by their shortcut.
      if (!emoji.isCustomEmoji && emoji.emojiId) return emoji.emojiId;
      return emoji.shortcuts?.[0] ?? '';
    })
    .join('');
}

/** Image URLs for the custom emotes in a message, in the order they appear. */
export function runsToEmotes(runs: Run[] | undefined): string[] {
  if (!runs) return [];
  const urls: string[] = [];
  for (const run of runs) {
    if (!run.emoji?.isCustomEmoji) continue;
    const url = thumb(run.emoji.image?.thumbnails);
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Rebuilds the author-details shape the shared `youtubeUser` expects.
 *
 * Badges are the awkward part: the Data API states roles as booleans, while
 * the watch page names an icon — `MODERATOR`, `OWNER`, `VERIFIED` — and marks
 * a paying member with a custom image and no icon name at all. Reading the
 * absence of an icon as "member" is what makes memberships visible here.
 */
function authorOf(renderer: BaseRenderer): StreamUser {
  const badges = renderer.authorBadges ?? [];
  const icons = badges
    .map((b) => b.liveChatAuthorBadgeRenderer?.icon?.iconType?.toUpperCase())
    .filter((v): v is string => Boolean(v));
  const isMember = badges.some(
    (b) =>
      b.liveChatAuthorBadgeRenderer?.customThumbnail !== undefined &&
      b.liveChatAuthorBadgeRenderer.icon === undefined,
  );

  return youtubeUser({
    channelId: renderer.authorExternalChannelId ?? '',
    displayName: renderer.authorName?.simpleText ?? '',
    profileImageUrl: thumb(renderer.authorPhoto?.thumbnails) ?? undefined,
    isChatOwner: icons.includes('OWNER'),
    isChatModerator: icons.includes('MODERATOR'),
    isChatSponsor: isMember,
    isVerified: icons.includes('VERIFIED'),
  });
}

/**
 * Money, from the string a viewer was shown.
 *
 * The watch page never sends a machine amount — only "$5.00", "£3", "¥500",
 * "R$ 10,00". Currency is deliberately discarded rather than guessed at: this
 * feeds gift totals and leaderboards, and quietly adding yen to dollars would
 * produce a number that is wrong in a way nobody would ever question. The
 * digits are all that is taken, in cents, and mixed-currency streams are
 * mixed-currency streams either way.
 */
export function centsFromText(text: string | undefined): number {
  if (!text) return 0;
  const digits = text.replace(/[^\d.,]/g, '').trim();
  if (!digits) return 0;

  // Whichever separator comes last is the decimal one: "1,234.56" and
  // "1.234,56" both mean the same amount written by different conventions.
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  const decimalAt = Math.max(lastDot, lastComma);

  let whole = digits;
  let fraction = '';
  if (decimalAt !== -1 && digits.length - decimalAt - 1 <= 2) {
    whole = digits.slice(0, decimalAt);
    fraction = digits.slice(decimalAt + 1);
  }

  const value = Number(whole.replace(/[.,]/g, '')) * 100 + Number(fraction.padEnd(2, '0') || 0);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

const base = (renderer: BaseRenderer) => ({
  // The renderer's own id, so a message redelivered across a reconnect is the
  // same event rather than a new one.
  id: renderer.id ?? randomUUID(),
  ts: renderer.timestampUsec ? Math.round(Number(renderer.timestampUsec) / 1000) : Date.now(),
  platform: 'youtube' as const,
});

const chatFrom = (renderer: BaseRenderer): ChatEvent => {
  const text = runsToText(renderer.message?.runs);
  return {
    ...base(renderer),
    type: 'chat',
    user: authorOf(renderer),
    text,
    displayText: text,
    filtered: false,
    filterReason: null,
    redacted: false,
    filterSeverity: 'none',
    emotes: runsToEmotes(renderer.message?.runs),
  };
};

const giftFrom = (renderer: BaseRenderer, name: string): GiftEvent => {
  const cents = centsFromText(renderer.purchaseAmountText?.simpleText);
  return {
    ...base(renderer),
    type: 'gift',
    user: authorOf(renderer),
    giftId: name,
    giftName: name,
    giftImageUrl: null,
    diamondCount: cents,
    repeatCount: 1,
    repeatEnd: true,
    streakable: false,
    totalDiamonds: cents,
  };
};

const subscribeFrom = (renderer: BaseRenderer, isGifted: boolean): SubscribeEvent => ({
  ...base(renderer),
  type: 'subscribe',
  user: authorOf(renderer),
  subMonths: 1,
  isGifted,
});

/**
 * Maps one chat action to an event, or null for the ones with no equivalent.
 *
 * Null is the common answer and not a failure: the stream carries banners,
 * poll updates, ticker animations and YouTube's own "welcome to live chat"
 * notice, none of which is something a viewer said or gave.
 */
export function innertubeEventFrom(action: unknown): StreamEvent | null {
  const item = (action as { addChatItemAction?: { item?: Record<string, BaseRenderer> } })
    ?.addChatItemAction?.item;
  if (!item) return null;

  const [kind, renderer] = Object.entries(item)[0] ?? [];
  if (!kind || !renderer) return null;

  switch (kind) {
    case 'liveChatTextMessageRenderer':
      return chatFrom(renderer);

    // Super Chat and Super Stickers: a paid highlight, which this app already
    // models as a gift so thresholds and leaderboards treat them alike.
    case 'liveChatPaidMessageRenderer':
      return giftFrom(renderer, 'Super Chat');
    case 'liveChatPaidStickerRenderer':
      return giftFrom(renderer, 'Super Sticker');

    // A membership: YouTube's paid tier, the counterpart of a Twitch sub.
    case 'liveChatMembershipItemRenderer':
      return subscribeFrom(renderer, false);
    case 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer':
    case 'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer':
      return subscribeFrom(renderer, true);

    default:
      return null;
  }
}
