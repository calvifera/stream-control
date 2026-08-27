import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PLATFORM_INFO,
  PLATFORMS,
  tierFor,
  tierStyle,
  type HighlightTier,
  type Platform,
  type StreamEvent,
  type StreamUser,
} from '@streaming/shared';
import { api } from '../lib/api.js';
import { PlatformLogo } from '../lib/PlatformLogo.js';
import { PlatformStats } from './PlatformStats.js';
import { useLive } from '../lib/store.js';

/**
 * The unified chat log.
 *
 * Rendered both as a dashboard panel and inside the always-on-top pop-out, so
 * it takes no props that depend on either context.
 */

type Tab = 'all' | Platform;

/** Events worth showing in a chat log. Likes and joins would drown it. */
const SHOWN = new Set(['chat', 'gift', 'follow', 'subscribe', 'share', 'system']);

interface Props {
  /** Compact mode drops the header chrome for the pop-out window. */
  dense?: boolean;
}

export function ChatLog({ dense = false }: Props): JSX.Element {
  const { events, snapshot, config, stats } = useLive();
  const [tab, setTab] = useState<Tab>('all');
  const [pinned, setPinned] = useState<StreamEvent | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  /** Handle for the in-flight scroll animation; 0 when none is running. */
  const frameRef = useRef(0);

  const connections = snapshot?.connections ?? {};
  // The same list every chat overlay reads, so a viewer marked notable on stream
  // is marked notable here too.
  const tiers = config?.highlights ?? [];
  // A tab appears when the platform is connected, or when the buffer already
  // holds messages from it — otherwise test events and demo data would be
  // unfilterable. An always-visible tab that can never have content is just a
  // dead control, so neither condition alone is enough.
  const seen = useMemo(() => new Set(events.map((event) => event.platform)), [events]);
  const active = PLATFORMS.filter(
    (p) => seen.has(p) || (connections[p] && connections[p]!.status !== 'idle'),
  );

  const visible = useMemo(
    () =>
      events.filter(
        (event) => SHOWN.has(event.type) && (tab === 'all' || event.platform === tab),
      ),
    [events, tab],
  );

  /*
   * Newest at the bottom, like every chat client — but only auto-scroll when
   * the reader is already at the bottom. Yanking the view down while someone
   * is scrolled up reading is the single most annoying thing a chat log can
   * do, and it is exactly when they are trying to read something.
   */
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  /*
   * Eased scroll toward the bottom.
   *
   * Not `scrollTo({ behavior: 'smooth' })`: each call there starts a fresh
   * animation with its own duration, so a burst of messages queues several
   * that fight each other and the view stutters. Easing a fraction of the
   * remaining distance every frame retargets for free — new content just moves
   * the destination, and the motion stays continuous however fast chat moves.
   */
  const pin = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;

    // The rows live in the pop-out's document when portalled there, and that
    // is the window whose frame loop actually paints them. Driving the
    // animation from the dashboard tab's rAF would stall exactly when the
    // pop-out matters most — the dashboard hidden behind a fullscreen game.
    const view = el.ownerDocument.defaultView ?? window;
    const snap = (): void => {
      el.scrollTop = el.scrollHeight;
    };

    /*
     * A document that is not being rendered gets no animation frames at all —
     * measured, not assumed: `requestAnimationFrame` fired zero times in a
     * hidden tab. That is the normal state of the dashboard while you are
     * playing, so animating there would leave the log frozen partway down
     * until you looked at it again. Jump instead; nobody is watching the
     * motion anyway.
     */
    if (view.document.hidden || view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      snap();
      return;
    }

    // A loop already running retargets on its own — `step` recomputes the
    // destination every frame — so starting a second one would only make two
    // animations fight over the same scrollTop.
    if (frameRef.current) return;

    const step = (): void => {
      const target = el.scrollHeight - el.clientHeight;
      const delta = target - el.scrollTop;
      // Below a pixel there is nothing left to see; snap and stop so the loop
      // does not run forever chasing a fractional remainder.
      if (Math.abs(delta) < 1) {
        el.scrollTop = target;
        frameRef.current = 0;
        return;
      }
      el.scrollTop += delta * 0.22;
      frameRef.current = view.requestAnimationFrame(step);
    };

    frameRef.current = view.requestAnimationFrame(step);
  }, []);

  /*
   * Re-pin whenever new content arrives.
   *
   * Keyed on the newest row's id, *not* on how many rows there are. The
   * buffer holds a fixed 200 events, so once a stream has been running a
   * while every new message also drops an old one and the count stops
   * changing — at which point a length-keyed effect never fires again and the
   * log quietly stops following chat. That is the failure this replaces, and
   * it looks intermittent only because it takes 200 events to begin.
   */
  const newestId = visible.length > 0 ? visible[visible.length - 1]?.id : null;
  useEffect(() => {
    pin();
  }, [newestId, pin]);

  /*
   * Re-pin when the content or the box changes size without any new message.
   *
   * Several things do this and all of them left the log stranded a little way
   * off the bottom:
   *   - an avatar finishing loading, which makes a row taller after it has
   *     already been placed;
   *   - the per-platform stats strip wrapping onto another line as new
   *     figures appear, which shortens the scroll box under it;
   *   - dragging the text-size slider, or resizing the panel itself.
   *
   * `load` is captured rather than bubbled because image load events do not
   * bubble at all.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const view = el.ownerDocument.defaultView ?? window;
    const observer = new view.ResizeObserver(() => pin());
    observer.observe(el);
    /*
     * The newest row as well as the box, because the container's own size does
     * not change when a row reflows inside it — the text-size slider makes
     * every row taller while the scroll box stays exactly as tall as the
     * window.
     *
     * Only the last row, not all of them: this is re-established on every
     * message, and observing the whole buffer would mean up to two hundred
     * `observe` calls per message for no extra coverage. Rows further up grow
     * for one reason — an avatar arriving — and the `load` listener below
     * already catches that.
     */
    const newest = el.lastElementChild;
    if (newest) observer.observe(newest);

    el.addEventListener('load', pin, true);
    return () => {
      observer.disconnect();
      el.removeEventListener('load', pin, true);
    };
  }, [newestId, pin]);

  /*
   * Finish the job rather than leaving it stranded mid-animation if the
   * document is hidden partway down.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const view = el.ownerDocument.defaultView ?? window;

    const onHide = (): void => {
      if (!view.document.hidden || !atBottomRef.current) return;
      if (frameRef.current) view.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      el.scrollTop = el.scrollHeight;
    };

    view.document.addEventListener('visibilitychange', onHide);
    return () => {
      view.document.removeEventListener('visibilitychange', onHide);
      if (frameRef.current) view.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, []);

  /*
   * Any deliberate scroll hands control back to the reader immediately.
   *
   * The `scroll` handler alone cannot do this: the animation above moves
   * `scrollTop` itself, so it cannot tell its own movement from a person's.
   * These input events only fire for a real gesture.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const release = (): void => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    const options = { passive: true } as const;
    el.addEventListener('wheel', release, options);
    el.addEventListener('touchmove', release, options);
    el.addEventListener('pointerdown', release, options);
    return () => {
      el.removeEventListener('wheel', release);
      el.removeEventListener('touchmove', release);
      el.removeEventListener('pointerdown', release);
    };
  }, []);

  /*
   * Which rows are arriving for the first time.
   *
   * Only those animate. Without this, changing platform tab remounts every
   * visible row and the whole list cascades in — which looks like a bug, and
   * happens at the exact moment you are trying to read something specific.
   * The set covers the entire buffer rather than just what is on screen, so
   * opening a tab for the first time shows its history already settled.
   */
  const seenRef = useRef<Set<string>>(new Set());
  const settledRef = useRef(false);
  const isFresh = (id: string): boolean => settledRef.current && !seenRef.current.has(id);

  useEffect(() => {
    /*
     * Wait for a non-empty buffer before taking the baseline.
     *
     * History arrives over the socket a moment after mount, so the first pass
     * here sees an empty list. Marking that as "settled" made the entire
     * backlog count as new the instant it landed, and every row in it animated
     * at once — the exact cascade this flag exists to prevent.
     */
    if (events.length === 0) return;
    seenRef.current = new Set(events.map((event) => event.id));
    settledRef.current = true;
  }, [events]);

  const copyHandle = useCallback((user: StreamUser) => {
    const handle = `@${user.uniqueId}`;
    void navigator.clipboard
      .writeText(handle)
      .then(() => {
        setCopied(handle);
        window.setTimeout(() => setCopied(null), 1200);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className={dense ? 'chatlog chatlog-dense' : 'chatlog'}>
      <div className="chatlog-tabs">
        <button
          type="button"
          className={tab === 'all' ? 'chatlog-tab chatlog-tab-on' : 'chatlog-tab'}
          onClick={() => setTab('all')}
        >
          All
        </button>
        {active.map((platform) => {
          const info = PLATFORM_INFO[platform];
          const state = connections[platform];
          return (
            <button
              key={platform}
              type="button"
              title={`${info.label}: ${state?.status ?? 'idle'}`}
              className={tab === platform ? 'chatlog-tab chatlog-tab-on' : 'chatlog-tab'}
              style={tab === platform ? { color: info.color, borderColor: info.color } : undefined}
              onClick={() => setTab(platform)}
            >
              <PlatformLogo platform={platform} size={14} />
              {info.label}
            </button>
          );
        })}
      </div>

      {/* Only on a platform's own tab. On All this would be a second copy of
          numbers already shown as a combined total elsewhere, and the whole
          point of it is the per-platform split. */}
      {tab !== 'all' ? (
        <PlatformStats
          platform={tab}
          stats={stats}
          connected={connections[tab]?.status === 'connected'}
          connectedAt={connections[tab]?.connectedAt ?? null}
        />
      ) : null}

      {pinned ? (
        <div className="chatlog-pinned">
          <span className="chatlog-pinned-label">Pinned</span>
          <ChatRow
            event={pinned}
            tier={highlightOf(pinned, tiers)}
            onCopy={copyHandle}
            onPin={() => setPinned(null)}
            pinned
          />
        </div>
      ) : null}

      <div className="chatlog-scroll" ref={scrollRef} onScroll={onScroll}>
        {visible.length === 0 ? (
          <p className="chatlog-empty muted">
            {active.length === 0
              ? 'Nothing connected yet. Connect a platform and messages land here.'
              : 'Waiting for messages…'}
          </p>
        ) : (
          visible.map((event) => (
            <ChatRow
              key={event.id}
              event={event}
              tier={highlightOf(event, tiers)}
              fresh={isFresh(event.id)}
              onCopy={copyHandle}
              onPin={() => setPinned((current) => (current?.id === event.id ? null : event))}
            />
          ))
        )}
      </div>

      {copied ? <div className="chatlog-toast">Copied {copied}</div> : null}
    </div>
  );
}

/**
 * The highlight tier this message's author qualifies for, if any.
 *
 * The giving totals arrive stamped on the event by the server. One that never
 * got them — an older event still in the replay buffer — reads as zero, which
 * is the right answer: not notable, rather than an exception.
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

function ChatRow({
  event,
  tier,
  onCopy,
  onPin,
  pinned = false,
  fresh = false,
}: {
  event: StreamEvent;
  tier: HighlightTier | null;
  onCopy: (user: StreamUser) => void;
  onPin: () => void;
  pinned?: boolean;
  /** Just arrived, so it animates in. Rows already on screen must not. */
  fresh?: boolean;
}): JSX.Element {
  const info = PLATFORM_INFO[event.platform];
  const user = event.user;

  /*
   * Captured once, at mount.
   *
   * `fresh` is derived during the parent's render, so it flips to false on the
   * very next one — and the store re-renders constantly (stats, viewer counts,
   * connection state). Using it directly stripped the class within a frame or
   * two, before the browser had even started the animation, which is why the
   * rows appeared to pop in with no transition at all.
   */
  const [animate] = useState(fresh);

  /*
   * Anything that is not something a person typed renders as a notice.
   *
   * A follow and a message are not the same kind of thing, and giving them
   * the same avatar, the same name weight and the same two-line block made
   * chat read as though half of it were being said out loud. A notice is one
   * quiet line: it stays in the stack, in order, and stops competing.
   */
  const notice = event.type !== 'chat';

  if (notice) {
    return (
      <div
        className={`chatnotice${animate ? ' chatrow-fresh' : ''}`}
        style={{ borderLeftColor: info.color }}
        onClick={onPin}
      >
        <PlatformMark platform={event.platform} />
        {user ? (
          <button
            type="button"
            className="chatnotice-who"
            title={`Copy @${user.uniqueId}`}
            onClick={(e) => {
              e.stopPropagation();
              onCopy(user);
            }}
          >
            {user.nickname}
          </button>
        ) : null}
        <span className="chatnotice-text">{describe(event)}</span>
      </div>
    );
  }

  return (
    <div
      className={`chatrow${pinned ? ' chatrow-pinned' : ''}${animate ? ' chatrow-fresh' : ''}`}
      // The accent bar is the point: it reads peripherally while you are
      // playing, which a small logo glyph does not.
      style={{ borderLeftColor: info.color }}
      onClick={onPin}
    >
      <Avatar user={user} platform={event.platform} />

      <div className="chatrow-body">
        <div className="chatrow-head">
          <PlatformMark platform={event.platform} />
          {user ? (
            <button
              type="button"
              className={tier ? 'chatrow-handle chatrow-handle-tier' : 'chatrow-handle'}
              title={tier ? `${tier.label} — copy @${user.uniqueId}` : `Copy @${user.uniqueId}`}
              style={tier ? tierStyle(tier) : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onCopy(user);
              }}
            >
              {user.nickname}
            </button>
          ) : (
            <span className="chatrow-handle chatrow-handle-system">{info.label}</span>
          )}
          {user?.isModerator ? <span className="chatrow-badge" title="Moderator">🛡</span> : null}
          {user?.isSubscriber ? <span className="chatrow-badge" title="Subscriber">★</span> : null}
        </div>

        <div className="chatrow-text">{describe(event)}</div>

        {user ? <RowActions user={user} /> : null}
      </div>
    </div>
  );
}

/**
 * Avatar, or an initial when the platform does not supply one.
 *
 * Twitch chat over anonymous IRC carries no profile image, so rather than a
 * broken image or an empty hole this falls back to the first letter on the
 * platform's colour.
 */
function Avatar({ user, platform }: { user: StreamUser | null; platform: Platform }): JSX.Element {
  const info = PLATFORM_INFO[platform];
  if (user?.avatarUrl) {
    return <img className="chatrow-avatar" src={user.avatarUrl} alt="" loading="lazy" />;
  }
  const letter = (user?.nickname || user?.uniqueId || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="chatrow-avatar chatrow-avatar-fallback"
      style={{ background: info.color, color: info.contrast }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

function PlatformMark({ platform }: { platform: Platform }): JSX.Element {
  // The real brand mark, tinted with the brand colour. It carries its own
  // identity, so it needs no coloured chip behind it.
  return (
    <span className="chatrow-mark">
      <PlatformLogo platform={platform} size={13} labelled />
    </span>
  );
}

/** Mute / trust, revealed on hover so the row stays clean while reading. */
function RowActions({ user }: { user: StreamUser }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const key = `${user.platform}:${user.uniqueId}`;

  const run = (action: () => Promise<unknown>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    void action()
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <div className="chatrow-actions">
      <button
        type="button"
        disabled={busy}
        onClick={run(() => api.penalizeUser(key, 'Muted from chat log', user.nickname))}
      >
        Mute
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={run(() => api.trustUser(key, user.nickname))}
      >
        Trust
      </button>
    </div>
  );
}

/** One line of text for any event type the log shows. */
function describe(event: StreamEvent): string {
  switch (event.type) {
    case 'chat':
      // `displayText` is the filtered form; null means the filter dropped it.
      return event.displayText ?? '[removed by filter]';
    case 'gift':
      return `sent ${event.repeatCount}× ${event.giftName}${
        event.totalDiamonds > 0 ? ` (${event.totalDiamonds})` : ''
      }`;
    case 'follow':
      return 'followed';
    case 'subscribe':
      return event.isGifted ? 'was gifted a subscription' : `subscribed (${event.subMonths} mo)`;
    case 'share':
      // Twitch raids arrive as shares; the count is the raider count.
      return event.shareCount > 1 ? `brought ${event.shareCount} viewers` : 'shared the stream';
    case 'system':
      return event.text;
    default:
      return event.type;
  }
}
