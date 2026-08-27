import { useEffect, useMemo, useRef, useState } from 'react';
import {
  nameColor,
  PLATFORM_INFO,
  tierFor,
  tierStyle,
  type ChatOverlaySettings,
  type HighlightTier,
  type StreamEvent,
  type StreamUser,
} from '@streaming/shared';
import { onStreamEvent, useLive } from '../../lib/store.js';
import { PlatformLogo } from '../../lib/PlatformLogo.js';
import { ANIMATION_CLASS } from '../style.js';

interface Props {
  settings: ChatOverlaySettings;
}

/**
 * One chat source for every platform at once.
 *
 * Events already arrive merged — the hub does not care which connection a
 * message came in on — so the work here is entirely about making a merged
 * stream *readable*: the platform has to be visible without being loud, and a
 * message has to cost as little vertical space as it can while still being
 * scannable at a glance, over gameplay, in peripheral vision.
 */

/** Events a chat overlay can show, depending on its toggles. */
function isRelevant(event: StreamEvent, settings: ChatOverlaySettings): boolean {
  // An empty list is "every platform", which is what makes one source able to
  // replace three. Naming one turns this into a dedicated source for it.
  if (settings.platforms.length > 0 && !settings.platforms.includes(event.platform)) return false;

  switch (event.type) {
    case 'chat':
      // A dropped message has no text left to render.
      return !(settings.hideFiltered && event.displayText === null);
    case 'gift':
      return settings.showGifts && event.repeatEnd;
    case 'follow':
      return settings.showFollows;
    case 'join':
      return settings.showJoins;
    case 'subscribe':
      return settings.showFollows;
    default:
      return false;
  }
}

/**
 * What to call someone.
 *
 * Display name first, because that is the name they chose and the one their
 * regulars recognise — but only when there actually is one. The old code took
 * `nickname` and fell straight to "Unknown", so anyone whose platform had not
 * supplied a display name yet appeared as a literal Unknown next to their real
 * avatar. The handle is always present and is never the wrong answer.
 */
function nameOf(user: StreamUser | null): string {
  if (!user) return 'Unknown';
  const display = user.nickname.trim();
  if (display) return display;
  return user.uniqueId.trim() || 'Unknown';
}

export function ChatWidget({ settings }: Props): JSX.Element {
  const { events, config } = useLive();
  // Read from the live config rather than baked into the source, so editing a
  // tier restyles every chat at once instead of only the overlays that happen
  // to be reopened afterwards.
  const tiers = settings.showHighlights ? (config?.highlights ?? []) : [];
  const [rows, setRows] = useState<StreamEvent[]>([]);
  const seeded = useRef(false);

  // Backfill once from history so a source opened mid-stream isn't empty.
  // Everything after that arrives through the subscription below.
  useEffect(() => {
    if (seeded.current || events.length === 0) return;
    seeded.current = true;
    setRows(events.filter((event) => isRelevant(event, settings)).slice(-settings.maxMessages));
  }, [events, settings]);

  useEffect(() => {
    return onStreamEvent((event) => {
      if (!isRelevant(event, settings)) return;
      setRows((current) => [...current, event].slice(-settings.maxMessages));
    });
  }, [settings]);

  // Expire rows once they age past the TTL.
  useEffect(() => {
    if (settings.messageTtl <= 0) return;
    const timer = setInterval(() => {
      const cutoff = Date.now() - settings.messageTtl * 1000;
      setRows((current) => current.filter((row) => row.ts >= cutoff));
    }, 1000);
    return () => clearInterval(timer);
  }, [settings.messageTtl]);

  // Worked out in display order so a run is still a run when the list is
  // reversed — deciding it beforehand would put the collapsed line at the top
  // of a run in one direction and at the bottom in the other.
  const ordered = useMemo(() => {
    const list = settings.newestFirst ? [...rows].reverse() : rows;
    return list.map((event, index) => ({
      event,
      // Resolved once per row here rather than in the JSX: it walks every
      // tier, and a chat overlay re-renders on every single message.
      tier: highlightOf(event, tiers),
      continues:
        settings.mergeRuns &&
        event.type === 'chat' &&
        sameSpeaker(event, list[index - 1]) &&
        // Only chat runs collapse. A gift or a follow is an event about a
        // person rather than something they said, and hiding whose it was
        // makes it unreadable.
        list[index - 1]?.type === 'chat',
    }));
  }, [rows, settings.newestFirst, settings.mergeRuns, tiers]);

  const animation = ANIMATION_CLASS[settings.animation];
  const density = settings.density === 'compact' ? 'chat-compact' : 'chat-comfortable';

  return (
    <div className={`chat-widget ${density}`}>
      {ordered.map(({ event, tier, continues }) => (
        <div key={event.id} className={`chat-row ${animation}`}>
          {/* Avatar and logo are row children rather than part of the text
              flow: both are block elements, and a continued run still needs
              their width reserved so the collapsed line starts under the one
              above it instead of jumping left. */}
          {settings.showAvatars ? <Avatar user={continues ? null : event.user} /> : null}
          {settings.showPlatform ? (
            <span className="chat-platform">
              {continues ? null : (
                // Sized in em so it tracks the overlay's font size: the logo
                // belongs to the line of text, not to a fixed icon scale that
                // goes wrong the moment the font is changed.
                <PlatformLogo platform={event.platform} size="1em" labelled />
              )}
            </span>
          ) : null}
          <div className="chat-body">
            {continues ? null : (
              <>
                {settings.showBadges && event.user ? <Badges user={event.user} /> : null}
                <span
                  className={tier ? 'chat-name chat-name-tier' : 'chat-name'}
                  title={tier?.label}
                  style={
                    tier
                      ? tierStyle(tier)
                      : {
                          color: settings.colorfulNames
                            ? nameColor(event.platform, event.user?.uniqueId ?? '')
                            : 'var(--accent-color)',
                        }
                  }
                >
                  {nameOf(event.user)}
                  {/* Inside the name, so it takes the name's colour. Only what
                      someone *said* gets one — "bob: followed the stream"
                      reads as a quotation of something they typed. */}
                  {event.type === 'chat' ? ':' : ''}
                </span>
              </>
            )}
            <span className="chat-text">{describe(event)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The tier a message's author qualifies for, if any.
 *
 * The giving totals come stamped on the event by the server; an event without
 * them (an old one from the replay buffer, or a spoofed one) reads as zero,
 * which correctly means "not notable" rather than throwing.
 */
function highlightOf(event: StreamEvent, tiers: readonly HighlightTier[]): HighlightTier | null {
  if (!event.user || tiers.length === 0) return null;
  return tierFor(tiers, {
    platform: event.user.platform,
    isSubscriber: event.user.isSubscriber,
    isModerator: event.user.isModerator,
    isHost: event.user.isHost,
    sessionGiven: event.giving?.session ?? 0,
    lifetimeGiven: event.giving?.lifetime ?? 0,
  });
}

/** Same person, for run collapsing. Keyed on the pair, never the handle. */
function sameSpeaker(event: StreamEvent, previous: StreamEvent | undefined): boolean {
  if (!previous?.user || !event.user) return false;
  return (
    previous.user.platform === event.user.platform &&
    previous.user.uniqueId === event.user.uniqueId
  );
}

/**
 * The avatar slot.
 *
 * Always rendered when avatars are on, even with nothing to show. A row whose
 * picture has not loaded yet would otherwise be a few pixels narrower than its
 * neighbours, and a fast chat where every line starts at a slightly different
 * x is much harder to read than one with a few blank circles in it.
 */
function Avatar({ user }: { user: StreamUser | null }): JSX.Element {
  if (!user?.avatarUrl) return <span className="chat-avatar chat-avatar-blank" aria-hidden="true" />;
  return <img className="chat-avatar" src={user.avatarUrl} alt="" />;
}

function Badges({ user }: { user: NonNullable<StreamEvent['user']> }): JSX.Element | null {
  const badges: string[] = [];
  if (user.isModerator) badges.push('MOD');
  if (user.isSubscriber) badges.push('SUB');
  if (user.isFriend) badges.push('FRIEND');
  else if (user.isFollower) badges.push('FOLLOWER');
  if (badges.length === 0) return null;

  return (
    <span className="chat-badges">
      {badges.map((badge) => (
        <span
          key={badge}
          className="chat-badge"
          // The badge takes the platform's colour, not the accent: it is a
          // claim *that platform* is making about this viewer, and a Twitch
          // SUB and a TikTok one are not the same thing.
          style={{ background: PLATFORM_INFO[user.platform].color, color: PLATFORM_INFO[user.platform].contrast }}
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

function describe(event: StreamEvent): string {
  switch (event.type) {
    case 'chat':
      return event.displayText ?? '';
    case 'gift':
      return `sent ${event.repeatCount}x ${event.giftName}`;
    case 'follow':
      return 'followed the stream';
    case 'subscribe':
      return 'subscribed';
    case 'join':
      return 'joined';
    default:
      return '';
  }
}
