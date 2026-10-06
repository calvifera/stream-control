import type { GiftEvent, ShareEvent, StreamEvent, SubscribeEvent } from '../events.js';
import type { Platform } from '../platforms.js';
import { formatUnit, SUB_TIER_LABELS, type GiftMedia } from './model.js';

/**
 * One line for a gift, the way each platform would say it.
 *
 * Every surface that prints a gift — chat log, chat overlay, ticker, event log
 * — used to build "sent 1x Super Chat" for itself, which read as nonsense for
 * everything that is not a TikTok gift. This is the one place that knows a
 * cheer is "cheered 500 bits" and a Super Chat is its amount.
 */
export function describeGift(event: GiftEvent): string {
  const detail = event.detail;
  switch (detail.kind) {
    case 'tiktok-gift':
      return `sent ${event.repeatCount}× ${event.giftName}`;
    case 'twitch-cheer':
      return `cheered ${formatUnit(event.totalDiamonds, 'bits')}`;
    case 'twitch-power-up':
      return detail.effect === 'gigantify' ? 'gigantified an emote' : 'used a message effect';
    case 'youtube-super-chat':
      return `sent a ${detail.value.label} Super Chat`;
    case 'youtube-super-sticker':
      return `sent a ${detail.value.label} Super Sticker`;
    case 'youtube-jewels':
      return `sent ${event.giftName} (${detail.value.label})`;
  }
}

/** The gift line plus the viewer's message, when there is one to show. */
export function describeGiftWithMessage(event: GiftEvent): string {
  const message = event.detail.displayMessage;
  return message ? `${describeGift(event)}: ${message}` : describeGift(event);
}

/**
 * What a `share` event means depends on the platform, and the field that
 * carries the number means something different on each.
 *
 * On Twitch a share is a raid, and `shareCount` is how many viewers the raider
 * brought along. On TikTok it is somebody sharing the live, and the number is
 * a share tally — not a count of people it brought in. Printing it as
 * "brought 12 viewers" claimed an audience that never arrived, so only a raid
 * is allowed to say that.
 */
export function describeShare(event: ShareEvent): string {
  if (event.platform === 'twitch') {
    return event.shareCount > 1 ? `raided with ${event.shareCount} viewers` : 'raided the channel';
  }
  return 'shared the stream';
}

export function describeSubscribe(event: SubscribeEvent): string {
  const tier = event.tier ? ` ${SUB_TIER_LABELS[event.tier]}` : '';
  if (event.giftCount && event.giftCount > 1) {
    return `gifted ${event.giftCount}${tier} ${event.platform === 'youtube' ? 'memberships' : 'subs'}`;
  }
  if (event.isGifted && event.recipient) {
    return `gifted a${tier} ${event.platform === 'youtube' ? 'membership' : 'sub'} to ${event.recipient}`;
  }
  if (event.isGifted) return event.platform === 'youtube' ? 'received a gifted membership' : 'was gifted a sub';
  if (event.tier === 'prime') return 'subscribed with Prime';
  return event.subMonths > 1
    ? `subscribed${tier} for ${event.subMonths} months`
    : `subscribed${tier}`;
}

/**
 * What an event says, without who it is from: "followed", "sent 3 likes".
 *
 * One wording for every surface that lists events, so the chat log, the event
 * log and the chat overlay cannot drift apart. A chat line is the exception and
 * returns null: what it shows depends on the surface — filtered text, pictures,
 * a removed-by-filter note — so each paints its own. Which events a surface
 * lists at all is its own choice too.
 */
export function describeEvent(event: StreamEvent): string | null {
  switch (event.type) {
    case 'chat':
      return null;
    case 'gift':
      return describeGiftWithMessage(event);
    case 'follow':
      return 'followed';
    case 'share':
      return describeShare(event);
    case 'subscribe':
      return describeSubscribe(event);
    case 'like':
      return `sent ${event.likeCount} likes`;
    case 'join':
      return 'joined';
    case 'envelope':
      return `dropped a ${event.coins}-coin treasure box`;
    case 'question':
      return `asked: ${event.text}`;
    case 'emote':
      return 'sent an emote';
    case 'roomStats':
      return `${event.viewerCount} viewers`;
    case 'streamEnd':
      return event.reason;
    case 'system':
      return event.text;
  }
}

/**
 * How many subscriptions an event stands for, in totals.
 *
 * A gift bomb arrives as one announcement from the buyer followed by one
 * event per recipient. Counting both doubled every gifted sub; counting the
 * recipients alone made a bomb whose recipients never arrived count zero. So
 * the announcement carries the count, and the recipient events count nothing.
 */
export function subscriptionWeight(event: SubscribeEvent): number {
  if (event.giftBombMember) return 0;
  return Math.max(1, event.giftCount ?? 1);
}

/** Best thing to show for a gift: moving if there is one, still otherwise. */
export function giftVisual(media: GiftMedia): string | null {
  return media.animationUrl ?? media.imageUrl;
}

/** Native total in the platform's unit, e.g. "500 bits" or "12.00". */
export function giftTotalLabel(event: GiftEvent): string {
  const detail = event.detail;
  if (!detail.value.known) return '';
  // Only TikTok multiplies: a combo is many of one gift. Everywhere else the
  // value label already describes the whole thing.
  return detail.kind === 'tiktok-gift'
    ? formatUnit(event.totalDiamonds, detail.value.unit)
    : detail.value.label;
}

export type PlatformThresholds = Record<Platform, number>;
