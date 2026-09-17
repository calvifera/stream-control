import { randomUUID } from 'node:crypto';
import {
  absoluteUrl,
  argbToCss,
  bandForCents,
  bandForColor,
  formatUnit,
  hasEmotes,
  type ChatEvent,
  type GiftEvent,
  type MessagePart,
  type StreamEvent,
  type StreamUser,
  type SubscribeEvent,
} from '@streaming/shared';
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

interface Text {
  runs?: Run[];
  simpleText?: string;
}

interface AuthorBadge {
  liveChatAuthorBadgeRenderer?: {
    icon?: { iconType?: string };
    /** Member badges carry an image instead of a named icon. */
    customThumbnail?: { thumbnails?: Thumbnail[] };
    tooltip?: string;
  };
}

interface SponsorshipsHeader {
  authorName?: { simpleText?: string };
  authorPhoto?: { thumbnails?: Thumbnail[] };
  authorBadges?: AuthorBadge[];
  primaryText?: Text;
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
  headerSubtext?: Text;
  headerPrimaryText?: Text;
  /* Super Chat colours, as ARGB integers. */
  headerBackgroundColor?: number;
  bodyBackgroundColor?: number;
  bodyTextColor?: number;
  /* Super Sticker. */
  sticker?: { thumbnails?: Thumbnail[]; accessibility?: { accessibilityData?: { label?: string } } };
  backgroundColor?: number;
  moneyChipBackgroundColor?: number;
  moneyChipTextColor?: number;
  /* A gifted-membership purchase keeps the buyer in here, not at the top. */
  header?: { liveChatSponsorshipsHeaderRenderer?: SponsorshipsHeader };
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
 * goes into `parts` for anything that renders it.
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

/**
 * The message as text and pictures.
 *
 * Standard emoji stay text — they are Unicode and every font draws them.
 * Channel emoji become pictures, which is the only form in which they mean
 * anything. Undefined when there are none, which is most messages.
 */
export function runsToParts(runs: Run[] | undefined): MessagePart[] | undefined {
  if (!runs) return undefined;
  const parts: MessagePart[] = [];
  for (const run of runs) {
    if (typeof run.text === 'string') {
      parts.push({ type: 'text', text: run.text });
      continue;
    }
    const emoji = run.emoji;
    if (!emoji) continue;
    const url = absoluteUrl(thumb(emoji.image?.thumbnails));
    if (emoji.isCustomEmoji && url) {
      parts.push({ type: 'emote', name: emoji.shortcuts?.[0] ?? '', url, id: emoji.emojiId });
    } else {
      parts.push({ type: 'text', text: runsToText([run]) });
    }
  }
  return hasEmotes(parts) ? parts : undefined;
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
 *
 * A gift purchase keeps the buyer's name, photo and badges inside its header;
 * read from the top level alone, every gifter came out nameless.
 */
function authorOf(renderer: BaseRenderer): StreamUser {
  const header = renderer.header?.liveChatSponsorshipsHeaderRenderer;
  const badges = renderer.authorBadges ?? header?.authorBadges ?? [];
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
    displayName: renderer.authorName?.simpleText ?? header?.authorName?.simpleText ?? '',
    profileImageUrl:
      absoluteUrl(thumb(renderer.authorPhoto?.thumbnails ?? header?.authorPhoto?.thumbnails)) ??
      undefined,
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

const textOf = (text: Text | undefined): string => text?.simpleText ?? runsToText(text?.runs);

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
    parts: runsToParts(renderer.message?.runs),
  };
};

/** Fields every paid YouTube event shares. */
const paidBase = (renderer: BaseRenderer, name: string, cents: number) => ({
  ...base(renderer),
  type: 'gift' as const,
  user: authorOf(renderer),
  giftId: name.toLowerCase().replace(/\s+/g, '-'),
  giftName: name,
  diamondCount: cents,
  repeatCount: 1,
  repeatEnd: true,
  streakable: false,
  totalDiamonds: cents,
});

const amountOf = (renderer: BaseRenderer, cents: number) => ({
  amount: cents,
  unit: 'cents' as const,
  known: true,
  label: renderer.purchaseAmountText?.simpleText || formatUnit(cents, 'cents'),
});

/**
 * A Super Chat, in its colour band, with its message.
 *
 * The band comes from the colour YouTube painted it, which is already right
 * for the viewer's currency; the amount is only a fallback. The message used
 * to be dropped, which lost the one thing a Super Chat is bought to say.
 */
const superChatFrom = (renderer: BaseRenderer): GiftEvent => {
  const cents = centsFromText(renderer.purchaseAmountText?.simpleText);
  const body = argbToCss(renderer.bodyBackgroundColor);
  const band = bandForColor(body) ?? bandForCents(cents);
  const message = runsToText(renderer.message?.runs).trim() || null;
  return {
    ...paidBase(renderer, 'Super Chat', cents),
    giftImageUrl: null,
    detail: {
      kind: 'youtube-super-chat',
      platform: 'youtube',
      tier: band.tier,
      value: amountOf(renderer, cents),
      media: { imageUrl: null, animationUrl: null },
      message,
      displayMessage: message,
      colors: {
        primary: argbToCss(renderer.headerBackgroundColor) ?? band.colors.primary,
        secondary: body ?? band.colors.secondary,
        text: argbToCss(renderer.bodyTextColor) ?? band.colors.text,
      },
    },
  };
};

/**
 * A Super Sticker, with its picture.
 *
 * Sticker images are often animated WebP, so the same URL serves as both the
 * still and the animation — the browser plays it if it moves.
 */
const superStickerFrom = (renderer: BaseRenderer): GiftEvent => {
  const cents = centsFromText(renderer.purchaseAmountText?.simpleText);
  const image = absoluteUrl(thumb(renderer.sticker?.thumbnails));
  const band = bandForCents(cents);
  return {
    ...paidBase(renderer, 'Super Sticker', cents),
    giftImageUrl: image,
    detail: {
      kind: 'youtube-super-sticker',
      platform: 'youtube',
      tier: band.tier,
      stickerLabel: renderer.sticker?.accessibility?.accessibilityData?.label ?? null,
      value: amountOf(renderer, cents),
      media: { imageUrl: image, animationUrl: image },
      message: null,
      displayMessage: null,
      colors: {
        primary: argbToCss(renderer.moneyChipBackgroundColor) ?? band.colors.primary,
        secondary: argbToCss(renderer.backgroundColor) ?? band.colors.secondary,
        text: argbToCss(renderer.moneyChipTextColor) ?? band.colors.text,
      },
    },
  };
};

const firstNumber = (text: string): number | null => {
  const match = /\d[\d,.]*/.exec(text);
  if (!match) return null;
  const n = Number.parseInt(match[0].replace(/[,.]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

const membershipFrom = (renderer: BaseRenderer): SubscribeEvent => {
  // "Member for 6 months" on a milestone; a welcome line on a new member.
  const primary = textOf(renderer.headerPrimaryText);
  const months = /month/i.test(primary) ? firstNumber(primary) : null;
  return {
    ...base(renderer),
    type: 'subscribe',
    user: authorOf(renderer),
    subMonths: months ?? 1,
    isGifted: false,
    levelName: textOf(renderer.headerSubtext) || null,
  };
};

/**
 * "Gifted 5 memberships" — the purchase, from the buyer, with the count.
 *
 * Recipients arrive separately and are marked as part of it, so totals count
 * the purchase once and alerts show one card rather than six.
 */
const giftPurchaseFrom = (renderer: BaseRenderer): SubscribeEvent => {
  const primary = textOf(renderer.header?.liveChatSponsorshipsHeaderRenderer?.primaryText);
  return {
    ...base(renderer),
    type: 'subscribe',
    user: authorOf(renderer),
    subMonths: 1,
    isGifted: true,
    giftCount: Math.max(1, firstNumber(primary) ?? 1),
  };
};

const giftRedemptionFrom = (renderer: BaseRenderer): SubscribeEvent => ({
  ...base(renderer),
  type: 'subscribe',
  user: authorOf(renderer),
  subMonths: 1,
  isGifted: true,
  giftBombMember: true,
});

interface Sources {
  sources?: Array<{ url?: string }>;
}

interface GiftMessageViewModel {
  id?: string;
  text?: { content?: string };
  authorName?: { content?: string };
  giftImage?: Sources;
  giftImageA11yLabel?: string;
  authorAvatar?: { avatarViewModel?: { image?: Sources } };
}

/**
 * A Jewels gift, from vertical streams.
 *
 * A view model rather than a renderer, and a thinner one: it carries the
 * sender's @handle but no channel id. Handles are unique on YouTube, so it
 * keys the viewer — but a Jewels gifter is not merged with the same person's
 * chat messages, which are keyed on the channel id.
 */
function jewelsFrom(vm: GiftMessageViewModel): GiftEvent {
  // "sent Heart for 50 Jewels"
  const match = /sent (.+?) for ([\d,]+) Jewels?/i.exec(vm.text?.content ?? '');
  const name = match?.[1] ?? vm.giftImageA11yLabel ?? 'Gift';
  const jewels = match?.[2] ? Number.parseInt(match[2].replace(/,/g, ''), 10) || 0 : 0;
  const handle = (vm.authorName?.content ?? '').trim();
  const bare = handle.replace(/^@/, '').toLowerCase();
  const image = absoluteUrl(vm.giftImage?.sources?.[0]?.url);

  return {
    id: vm.id ?? randomUUID(),
    ts: Date.now(),
    platform: 'youtube',
    type: 'gift',
    user: {
      ...youtubeUser(undefined),
      userId: bare ? `handle:${bare}` : 'unknown',
      uniqueId: bare,
      nickname: handle || 'Unknown',
      avatarUrl: absoluteUrl(vm.authorAvatar?.avatarViewModel?.image?.sources?.[0]?.url),
    },
    giftId: name.toLowerCase().replace(/\s+/g, '-'),
    giftName: name,
    giftImageUrl: image,
    diamondCount: jewels,
    repeatCount: 1,
    repeatEnd: true,
    streakable: false,
    totalDiamonds: jewels,
    detail: {
      kind: 'youtube-jewels',
      platform: 'youtube',
      value: {
        amount: jewels,
        unit: 'jewels',
        known: jewels > 0,
        label: formatUnit(jewels, 'jewels'),
      },
      media: { imageUrl: image, animationUrl: image },
      message: null,
      displayMessage: null,
      colors: null,
    },
  };
}

/**
 * Maps one chat action to an event, or null for the ones with no equivalent.
 *
 * Null is the common answer and not a failure: the stream carries banners,
 * poll updates, ticker animations and YouTube's own "welcome to live chat"
 * notice, none of which is something a viewer said or gave.
 */
export function innertubeEventFrom(action: unknown): StreamEvent | null {
  const item = (action as { addChatItemAction?: { item?: Record<string, unknown> } })
    ?.addChatItemAction?.item;
  if (!item) return null;

  const [kind, value] = Object.entries(item)[0] ?? [];
  if (!kind || !value || typeof value !== 'object') return null;
  const renderer = value as BaseRenderer;

  switch (kind) {
    case 'liveChatTextMessageRenderer':
      return chatFrom(renderer);

    // Super Chat and Super Stickers: a paid highlight, which this app already
    // models as a gift so thresholds and leaderboards treat them alike.
    case 'liveChatPaidMessageRenderer':
      return superChatFrom(renderer);
    case 'liveChatPaidStickerRenderer':
      return superStickerFrom(renderer);
    case 'giftMessageViewModel':
      return jewelsFrom(value as GiftMessageViewModel);

    // A membership: YouTube's paid tier, the counterpart of a Twitch sub.
    case 'liveChatMembershipItemRenderer':
      return membershipFrom(renderer);
    case 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer':
      return giftPurchaseFrom(renderer);
    case 'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer':
      return giftRedemptionFrom(renderer);

    default:
      return null;
  }
}
