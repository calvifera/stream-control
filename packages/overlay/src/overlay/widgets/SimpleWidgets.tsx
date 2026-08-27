import { useEffect, useRef, useState } from 'react';
import {
  buildTemplateVars,
  renderHtmlTemplate,
  type CounterOverlaySettings,
  type CustomOverlaySettings,
  type GoalOverlaySettings,
  type LeaderboardOverlaySettings,
  type SessionStats,
  type StreamEvent,
  type TickerOverlaySettings,
} from '@streaming/shared';
import { onStreamEvent, useLive } from '../../lib/store.js';
import { formatNumber } from '../style.js';

/* ------------------------------------------------------------------ *
 * Goal bar
 * ------------------------------------------------------------------ */

function metricValue(stats: SessionStats | null, metric: GoalOverlaySettings['metric']): number {
  if (!stats) return 0;
  switch (metric) {
    case 'likes':
      return stats.likes;
    case 'diamonds':
      return stats.diamonds;
    case 'followers':
      return stats.followers;
    case 'shares':
      return stats.shares;
    case 'viewers':
      return stats.viewerCount;
    case 'subscribers':
      return stats.subscribers;
  }
}

export function GoalWidget({ settings }: { settings: GoalOverlaySettings }): JSX.Element {
  const { stats } = useLive();
  const value = settings.startValue + metricValue(stats, settings.metric);
  const percent = Math.min(100, (value / Math.max(1, settings.target)) * 100);

  return (
    <div className="goal-widget">
      <div className="goal-header">
        <span className="goal-label">{settings.label}</span>
        {settings.showNumbers ? (
          <span className="goal-value">
            {formatNumber(value)} / {formatNumber(settings.target)}
          </span>
        ) : null}
        {settings.showPercent ? (
          <span className="goal-percent">{Math.floor(percent)}%</span>
        ) : null}
      </div>
      <div className="goal-track" style={{ height: settings.barHeight }}>
        <div className="goal-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Leaderboard
 * ------------------------------------------------------------------ */

export function LeaderboardWidget({
  settings,
}: {
  settings: LeaderboardOverlaySettings;
}): JSX.Element {
  const { leaderboard } = useLive();

  const ranked = [...leaderboard]
    .sort((a, b) => b[settings.metric] - a[settings.metric])
    .filter((entry) => entry[settings.metric] > 0)
    .slice(0, settings.size);

  return (
    <div className="leaderboard-widget">
      {settings.title ? <div className="leaderboard-title">{settings.title}</div> : null}
      {ranked.map((entry, index) => (
        <div key={entry.user.userId} className="leaderboard-row anim-fade">
          <span className="leaderboard-rank">{index + 1}</span>
          {settings.showAvatars && entry.user.avatarUrl ? (
            <img className="leaderboard-avatar" src={entry.user.avatarUrl} alt="" />
          ) : null}
          <span className="leaderboard-name">{entry.user.nickname}</span>
          {settings.showValues ? (
            <span className="leaderboard-value">{formatNumber(entry[settings.metric])}</span>
          ) : null}
        </div>
      ))}
      {ranked.length === 0 ? <div className="leaderboard-empty">No activity yet</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Counters
 * ------------------------------------------------------------------ */

const COUNTER_META: Record<
  CounterOverlaySettings['metrics'][number],
  { label: string; icon: string; read: (stats: SessionStats) => number }
> = {
  viewers: { label: 'Viewers', icon: '👀', read: (s) => s.viewerCount },
  likes: { label: 'Likes', icon: '❤️', read: (s) => s.likes },
  diamonds: { label: 'Diamonds', icon: '💎', read: (s) => s.diamonds },
  followers: { label: 'New follows', icon: '➕', read: (s) => s.followers },
  shares: { label: 'Shares', icon: '🔁', read: (s) => s.shares },
  comments: { label: 'Comments', icon: '💬', read: (s) => s.comments },
};

export function CounterWidget({ settings }: { settings: CounterOverlaySettings }): JSX.Element {
  const { stats } = useLive();

  return (
    <div className={`counter-widget counter-${settings.layout}`}>
      {settings.metrics.map((metric) => {
        const meta = COUNTER_META[metric];
        return (
          <div key={metric} className="counter-item">
            {settings.showIcons ? <span className="counter-icon">{meta.icon}</span> : null}
            <span className="counter-value">{formatNumber(stats ? meta.read(stats) : 0)}</span>
            {settings.showLabels ? <span className="counter-label">{meta.label}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Ticker
 * ------------------------------------------------------------------ */

export function TickerWidget({ settings }: { settings: TickerOverlaySettings }): JSX.Element {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    return onStreamEvent((event) => {
      if (!settings.eventTypes.includes(event.type)) return;
      if (event.type === 'gift' && !event.repeatEnd) return;

      const text = tickerText(event);
      if (!text) return;
      setItems((current) => [...current, text].slice(-settings.maxItems));
    });
  }, [settings]);

  const content = items.join(settings.separator);
  // Duration is derived from length so scroll speed stays constant as the
  // strip grows, rather than the whole thing speeding up.
  const durationSeconds = Math.max(6, (content.length * 12) / settings.speedPxPerSecond);

  return (
    <div className="ticker-widget">
      <div
        className="ticker-track"
        style={{ animationDuration: `${durationSeconds}s` }}
        key={content}
      >
        <span>{content || 'Waiting for events…'}</span>
        <span aria-hidden="true">{settings.separator}</span>
        <span aria-hidden="true">{content}</span>
      </div>
    </div>
  );
}

function tickerText(event: StreamEvent): string | null {
  const name = event.user?.nickname ?? '';
  switch (event.type) {
    case 'follow':
      return `${name} followed`;
    case 'share':
      return `${name} shared`;
    case 'subscribe':
      return `${name} subscribed`;
    case 'gift':
      return `${name} sent ${event.repeatCount}x ${event.giftName}`;
    case 'chat':
      return event.displayText ? `${name}: ${event.displayText}` : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Custom HTML
 * ------------------------------------------------------------------ */

interface CustomItem {
  id: string;
  html: string;
  expiresAt: number;
}

/**
 * Renders user-authored HTML per event.
 *
 * Placeholders are HTML-escaped before substitution, so a viewer can't inject
 * markup through their nickname or message. The template itself is trusted —
 * it comes from the dashboard, i.e. from you.
 */
export function CustomWidget({ settings }: { settings: CustomOverlaySettings }): JSX.Element {
  const [items, setItems] = useState<CustomItem[]>([]);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    return onStreamEvent((event) => {
      if (!settings.eventTypes.includes(event.type)) return;
      if (event.type === 'gift' && !event.repeatEnd) return;

      const html = renderHtmlTemplate(settings.html, buildTemplateVars(event));
      setItems((current) =>
        [...current, { id: event.id, html, expiresAt: Date.now() + settings.itemTtlMs }].slice(
          -settings.maxItems,
        ),
      );
    });
  }, [settings]);

  useEffect(() => {
    if (settings.itemTtlMs <= 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setItems((current) => current.filter((item) => item.expiresAt > now));
    }, 500);
    return () => clearInterval(timer);
  }, [settings.itemTtlMs]);

  return (
    <div className="custom-widget">
      <style ref={styleRef}>{settings.css}</style>
      {items.map((item) => (
        <div
          key={item.id}
          className="custom-item anim-fade"
          // Safe: values were escaped by renderHtmlTemplate, markup is the
          // host's own template.
          dangerouslySetInnerHTML={{ __html: item.html }}
        />
      ))}
    </div>
  );
}
