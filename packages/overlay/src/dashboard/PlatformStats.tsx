import { formatNumber } from '../overlay/style.js';
import { formatElapsed, useElapsed } from '../lib/useElapsed.js';
import {
  emptyPlatformStats,
  type Platform,
  type SessionStats,
} from '@streaming/shared';

/**
 * One platform's session at a glance, for the strip under the chat tabs.
 *
 * Only shown on a specific platform's tab, never on All — the All tab already
 * has a combined total everywhere else in the app, and the entire reason for
 * this strip is the question a combined total cannot answer: is anyone
 * actually watching on *this* one.
 *
 * Every figure is a session figure. Nothing here survives a reconnect, which
 * is worth knowing before reading "12 viewers" as a verdict on the stream.
 */

interface Props {
  platform: Platform;
  stats: SessionStats | null;
  /** True when the platform has a live connection right now. */
  connected: boolean;
  /**
   * When the broadcast went live, or null when it is not.
   *
   * Not when the connection opened. On Twitch those are different questions
   * and only one of them is worth a timer.
   */
  liveSince?: number | null;
}

export function PlatformStats({ platform, stats, connected, liveSince }: Props): JSX.Element {
  // Counts the broadcast, not the connection. Twitch IRC will happily sit in
  // an idle channel for hours, and a timer running through that says only
  // that the app has been open.
  const liveFor = useElapsed(liveSince ?? null);
  /*
   * Defaults merged in field by field, not just when the whole slice is
   * missing.
   *
   * A server one version behind sends a slice that is present but short a
   * key, and `?? emptyPlatformStats()` does nothing for that case — the slice
   * is there, so the fallback never fires and the missing field arrives as
   * undefined. Spreading the empty shape underneath means a new stat renders
   * as unknown until the server catches up, rather than as NaN.
   */
  const slice = { ...emptyPlatformStats(), ...(stats?.platforms?.[platform] ?? {}) };

  /*
   * A null viewer count is not zero.
   *
   * Twitch over IRC never reports one, and neither does a platform that has
   * simply not sent its first update yet. Printing 0 would be inventing a
   * fact — and the one it invents is "nobody is watching", which is the most
   * misleading possible answer.
   */
  const viewers =
    slice.viewers === null ? (connected ? 'not reported' : '—') : formatNumber(slice.viewers);

  return (
    <div className="pstats">
      <Stat label="Watching" value={viewers} wide={slice.viewers === null} title="People watching right now" />
      {liveFor !== null ? (
        <Stat
          label="Live"
          value={formatElapsed(liveFor)}
          title="How long this platform has been broadcasting"
        />
      ) : null}
      <Stat label="Peak" value={slice.peakViewers > 0 ? formatNumber(slice.peakViewers) : '—'} />
      {/* Only where the platform reports one. We cannot count this ourselves: we
          only ever see people who do something, which most of an audience never
          does, so a total of our own would understate the stream badly. */}
      {typeof slice.reportedTotal === 'number' ? (
        <Stat
          label="Total viewers"
          value={formatNumber(slice.reportedTotal)}
          title="Everyone who tuned in at any point, as the platform counts it"
        />
      ) : null}
      <Stat label="Chatters" value={formatNumber(slice.chatters)} title="People who sent at least one message" />
      <Stat label="Messages" value={formatNumber(slice.messages)} />
      {slice.diamonds > 0 ? <Stat label="Diamonds" value={formatNumber(slice.diamonds)} /> : null}
      {slice.followers > 0 ? <Stat label="Follows" value={formatNumber(slice.followers)} /> : null}
      {slice.subscribers > 0 ? <Stat label="Subs" value={formatNumber(slice.subscribers)} /> : null}
      {!connected ? <span className="pstats-note">not connected</span> : null}
    </div>
  );
}

function Stat({
  label,
  value,
  title,
  wide = false,
}: {
  label: string;
  value: string;
  title?: string;
  wide?: boolean;
}): JSX.Element {
  return (
    <span className={wide ? 'pstat pstat-wide' : 'pstat'} title={title}>
      <span className="pstat-value">{value}</span>
      <span className="pstat-label">{label}</span>
    </span>
  );
}
