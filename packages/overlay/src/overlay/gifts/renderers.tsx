import type { CSSProperties, ReactNode } from 'react';
import {
  describeSubscribe,
  formatUnit,
  giftTotalLabel,
  PLATFORM_INFO,
  type GiftDetail,
  type GiftEvent,
  type GiftKind,
  type GiftShowcaseEvent,
  type StreamUser,
  type SubscribeEvent,
  type TextEffect,
} from '@streaming/shared';
import { GiftMedia } from './GiftMedia.js';
import { AnimatedText } from '../../lib/AnimatedText.js';

/**
 * How each platform's gifts look in the spotlight.
 *
 * One renderer per gift kind, looked up in `RENDERERS`. Each owns its whole
 * card, because the platforms' gifts have almost nothing visual in common: a
 * TikTok gift is a picture and a combo count, a cheer is a tiered animation
 * in Twitch's colours, and a Super Chat is a coloured message card. Adding a
 * kind means adding one component here and one entry in the table; the
 * compiler refuses a kind with no renderer.
 */

export interface CardOptions {
  showAvatar: boolean;
  showValue: boolean;
  showMessage: boolean;
  mediaSize: number;
  nameEffect: TextEffect;
  valueEffect: TextEffect;
}

interface CardProps<D extends GiftDetail> {
  event: GiftEvent & { detail: D };
  detail: D;
  /** Picture to show: a media rule's, or the platform's own. */
  mediaUrl: string | null;
  options: CardOptions;
}

const nameOf = (user: StreamUser): string => user.nickname.trim() || user.uniqueId || 'Someone';

function Avatar({ user, show }: { user: StreamUser; show: boolean }): JSX.Element | null {
  if (!show || !user.avatarUrl) return null;
  return <img className="gs-avatar" src={user.avatarUrl} alt="" />;
}

function Media({
  url,
  size,
  className = 'gs-media',
  alt,
}: {
  url: string | null;
  size: number;
  className?: string;
  alt?: string;
}): JSX.Element | null {
  if (!url) return null;
  return <GiftMedia url={url} className={className} style={{ height: size, maxWidth: size * 2 }} alt={alt} />;
}

function Message({ text, show }: { text: string | null; show: boolean }): JSX.Element | null {
  if (!show || !text) return null;
  return <div className="gs-message">{text}</div>;
}

/** The layout most kinds share: picture, then who, then what, then message. */
function StandardCard({
  className,
  style,
  media,
  user,
  options,
  headline,
  value,
  badge,
  message,
}: {
  className: string;
  style?: CSSProperties;
  media: ReactNode;
  user: StreamUser;
  options: CardOptions;
  headline: string;
  value: string;
  badge?: ReactNode;
  message: string | null;
}): JSX.Element {
  return (
    <div className={`gs-card ${className}`} style={style}>
      <div className="gs-stage">
        {media}
        {badge}
      </div>
      <div className="gs-who">
        <Avatar user={user} show={options.showAvatar} />
        <AnimatedText className="gs-name" text={nameOf(user)} effect={options.nameEffect} />
      </div>
      <div className="gs-headline">{headline}</div>
      {options.showValue && value ? (
        <div className="gs-value">
          <AnimatedText text={value} effect={options.valueEffect} />
        </div>
      ) : null}
      <Message text={message} show={options.showMessage} />
    </div>
  );
}

/* ---------------------------------------------------------------- TikTok */

function TikTokGiftCard({ event, mediaUrl, options }: CardProps<Extract<GiftDetail, { kind: 'tiktok-gift' }>>): JSX.Element {
  return (
    <StandardCard
      className="gs-tiktok"
      media={<Media url={mediaUrl} size={options.mediaSize} alt={event.giftName} />}
      badge={
        event.repeatCount > 1 ? (
          // Keyed on the count so a new combo total replays the pop.
          <span key={event.repeatCount} className="gs-combo">
            ×{event.repeatCount}
          </span>
        ) : null
      }
      user={event.user}
      options={options}
      headline={`sent ${event.giftName}`}
      value={giftTotalLabel(event)}
      message={null}
    />
  );
}

/* ---------------------------------------------------------------- Twitch */

function TwitchCheerCard({ event, detail, mediaUrl, options }: CardProps<Extract<GiftDetail, { kind: 'twitch-cheer' }>>): JSX.Element {
  const color = detail.colors?.primary ?? PLATFORM_INFO.twitch.color;
  return (
    <StandardCard
      className="gs-twitch-cheer"
      style={{ '--gs-tier': color } as CSSProperties}
      media={<Media url={mediaUrl} size={options.mediaSize} alt={`${detail.prefix} ${detail.tier}`} />}
      user={event.user}
      options={options}
      headline="cheered"
      // Always shown for a cheer: the amount *is* the event.
      value={formatUnit(event.totalDiamonds, 'bits')}
      message={detail.displayMessage}
    />
  );
}

function TwitchPowerUpCard({ event, detail, mediaUrl, options }: CardProps<Extract<GiftDetail, { kind: 'twitch-power-up' }>>): JSX.Element {
  const gigantify = detail.effect === 'gigantify';
  return (
    <StandardCard
      className={`gs-twitch-powerup ${gigantify ? 'gs-gigantify' : 'gs-effect'}`}
      media={
        mediaUrl ? (
          <Media url={mediaUrl} size={options.mediaSize * (gigantify ? 1.3 : 1)} />
        ) : (
          <div className="gs-sparkle" style={{ fontSize: options.mediaSize * 0.6 }} aria-hidden="true">
            ✦
          </div>
        )
      }
      user={event.user}
      options={options}
      headline={gigantify ? 'gigantified an emote' : 'powered up their message'}
      value={detail.value.known ? detail.value.label : ''}
      message={detail.displayMessage}
    />
  );
}

/* --------------------------------------------------------------- YouTube */

/**
 * A Super Chat, as YouTube draws one: a header band with the name and amount,
 * and the message on a lighter body of the same colour.
 */
function SuperChatCard({ event, detail, mediaUrl, options }: CardProps<Extract<GiftDetail, { kind: 'youtube-super-chat' }>>): JSX.Element {
  const colors = detail.colors;
  const message = options.showMessage ? detail.displayMessage : null;
  return (
    <div
      className={`gs-card gs-superchat gs-tier-${detail.tier}`}
      style={
        {
          '--gs-head': colors?.primary,
          '--gs-body': colors?.secondary,
          '--gs-ink': colors?.text,
        } as CSSProperties
      }
    >
      {mediaUrl ? (
        <div className="gs-stage">
          <Media url={mediaUrl} size={options.mediaSize} />
        </div>
      ) : null}
      <div className="gs-sc">
        <div className="gs-sc-head">
          <Avatar user={event.user} show={options.showAvatar} />
          <div className="gs-sc-who">
            <AnimatedText className="gs-name" text={nameOf(event.user)} effect={options.nameEffect} />
            <AnimatedText className="gs-sc-amount" text={detail.value.label} effect={options.valueEffect} />
          </div>
        </div>
        {message ? <div className="gs-sc-body">{message}</div> : null}
      </div>
    </div>
  );
}

function SuperStickerCard({ event, detail, mediaUrl, options }: CardProps<Extract<GiftDetail, { kind: 'youtube-super-sticker' }>>): JSX.Element {
  return (
    <StandardCard
      className="gs-supersticker"
      style={{ '--gs-body': detail.colors?.secondary, '--gs-ink': detail.colors?.text } as CSSProperties}
      media={<Media url={mediaUrl} size={options.mediaSize} alt={detail.stickerLabel ?? 'Super Sticker'} />}
      user={event.user}
      options={options}
      headline="sent a Super Sticker"
      value={detail.value.label}
      message={null}
    />
  );
}

function JewelsCard({ event, detail, mediaUrl, options }: CardProps<Extract<GiftDetail, { kind: 'youtube-jewels' }>>): JSX.Element {
  return (
    <StandardCard
      className="gs-jewels"
      media={<Media url={mediaUrl} size={options.mediaSize} alt={event.giftName} />}
      user={event.user}
      options={options}
      headline={`sent ${event.giftName}`}
      value={detail.value.known ? detail.value.label : ''}
      message={null}
    />
  );
}

/* ------------------------------------------------------------ Gifted subs */

function GiftedSubsCard({
  event,
  mediaUrl,
  options,
}: {
  event: SubscribeEvent;
  mediaUrl: string | null;
  options: CardOptions;
}): JSX.Element {
  const count = event.giftCount ?? 1;
  const info = PLATFORM_INFO[event.platform];
  return (
    <StandardCard
      className="gs-giftsubs"
      style={{ '--gs-tier': info.color } as CSSProperties}
      media={
        mediaUrl ? (
          <Media url={mediaUrl} size={options.mediaSize} />
        ) : (
          <div className="gs-gift-icon" style={{ fontSize: options.mediaSize * 0.62 }} aria-hidden="true">
            🎁
          </div>
        )
      }
      badge={count > 1 ? <span className="gs-combo">×{count}</span> : null}
      user={event.user}
      options={options}
      headline={describeSubscribe(event)}
      value=""
      message={null}
    />
  );
}

/* --------------------------------------------------------------- Registry */

type AnyCard = (props: CardProps<GiftDetail>) => JSX.Element;

const RENDERERS: { [K in GiftKind]: (props: CardProps<Extract<GiftDetail, { kind: K }>>) => JSX.Element } = {
  'tiktok-gift': TikTokGiftCard,
  'twitch-cheer': TwitchCheerCard,
  'twitch-power-up': TwitchPowerUpCard,
  'youtube-super-chat': SuperChatCard,
  'youtube-super-sticker': SuperStickerCard,
  'youtube-jewels': JewelsCard,
};

export function GiftCard({
  event,
  mediaUrl,
  options,
}: {
  event: GiftShowcaseEvent;
  mediaUrl: string | null;
  options: CardOptions;
}): JSX.Element {
  if (event.type === 'subscribe') {
    return <GiftedSubsCard event={event} mediaUrl={mediaUrl} options={options} />;
  }
  const Card = RENDERERS[event.detail.kind] as AnyCard;
  return <Card event={event} detail={event.detail} mediaUrl={mediaUrl} options={options} />;
}
