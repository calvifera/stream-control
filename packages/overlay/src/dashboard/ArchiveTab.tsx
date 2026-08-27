import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listKey,
  meanVisitMs,
  PLATFORM_INFO,
  PLATFORMS,
  RETENTION_BUCKETS,
  retentionRates,
  type AppConfig,
  type ArchiveAnalytics,
  type ArchiveEntry,
  type ArchiveFilter,
  type ArchiveSort,
  type Platform,
  type PlatformBreakdown,
  type RetentionCurve,
} from '@streaming/shared';
import { api } from '../lib/api.js';
import { Panel } from './controls.js';
import { PlatformLogo } from '../lib/PlatformLogo.js';
import { PlatformTabs, type PlatformTab } from './PlatformTabs.js';

const PAGE_SIZE = 50;

const FILTERS: Array<{ id: ArchiveFilter; label: string; hint: string }> = [
  { id: 'all', label: 'Everyone', hint: 'Every viewer the server has ever recorded' },
  { id: 'chatters', label: 'Chatters', hint: 'Sent at least one message' },
  { id: 'lurkers', label: 'Lurkers', hint: 'Seen in the room but never spoke' },
  {
    id: 'regulars',
    label: 'Regulars',
    hint: 'Turned up on more than one day. Anyone recorded before the archive shipped counts as 2 at most until their next visit, so this undercounts rather than overstates.',
  },
  { id: 'gifters', label: 'Gifters', hint: 'Sent at least one gift since tracking began' },
  { id: 'trusted', label: 'Trusted', hint: 'On your trusted list' },
  { id: 'penalized', label: 'Penalty box', hint: 'Currently muted' },
  { id: 'flagged', label: 'Flagged', hint: 'Has filter-evasion strikes on record' },
];

const SORTS: Array<{ id: ArchiveSort; label: string }> = [
  { id: 'lastSeen', label: 'Last seen' },
  { id: 'firstSeen', label: 'First seen' },
  { id: 'daysSeen', label: 'Days seen' },
  { id: 'messages', label: 'Messages' },
  { id: 'diamonds', label: 'Diamonds' },
  { id: 'strikes', label: 'Strikes' },
  { id: 'username', label: 'Name' },
];

interface Props {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}

export function ArchiveTab({ config }: Props): JSX.Element {
  const [platform, setPlatform] = useState<PlatformTab>('all');
  const [filter, setFilter] = useState<ArchiveFilter>('all');
  // Chronological by when someone was added is the default view: the archive
  // is a record of who has turned up, and that reads as a timeline.
  const [sort, setSort] = useState<ArchiveSort>('firstSeen');
  const [newestFirst, setNewestFirst] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ArchiveEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ArchiveAnalytics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ArchiveEntry | null>(null);

  // Typing a search should not fire a request per keystroke against a
  // 3,000-row scan. A short debounce keeps it feeling instant anyway.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Any change to what is being asked for resets to the first page: staying on
  // page 7 of a result set that now has two pages shows an empty table.
  useEffect(() => setPage(0), [filter, sort, debounced, platform, newestFirst]);

  const load = useCallback(() => {
    setBusy(true);
    void api
      .archive({
        q: debounced,
        ...(platform === 'all' ? {} : { platform }),
        sort,
        filter,
        // Name sorts read A-Z under "newest first", which is what everyone
        // expects from an alphabetical list.
        desc: sort === 'username' ? !newestFirst : newestFirst,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
      .then((result) => {
        setRows(result.entries);
        setTotal(result.total);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [debounced, sort, filter, page, platform, newestFirst]);

  useEffect(load, [load]);

  const loadStats = useCallback(() => {
    void api
      .archiveAnalytics()
      .then(setStats)
      .catch(() => undefined);
  }, []);
  useEffect(loadStats, [loadStats]);

  // Built from the analytics payload rather than summed from the table,
  // which only ever holds one page.
  const platformCounts = useMemo(() => {
    if (!stats) return null;
    return Object.fromEntries(
      stats.platforms.map((entry) => [entry.platform, entry.viewers]),
    ) as Record<Platform, number>;
  }, [stats]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilter = FILTERS.find((f) => f.id === filter);

  return (
    <section className="panel-stack">
      {stats ? <ArchiveSummary stats={stats} platform={platform} /> : null}

      <Panel
        title="Viewer archive"
        description="Everyone the server has recorded, kept across restarts and reconnects."
      >
        <PlatformTabs
          counts={platformCounts}
          total={stats?.totalViewers ?? null}
          active={platform}
          onPick={setPlatform}
        />

        <div className="archive-controls">
          <input
            type="search"
            className="archive-search"
            placeholder="Search handle or display name…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="archive-sort">
            Order
            <select
              value={newestFirst ? 'desc' : 'asc'}
              onChange={(event) => setNewestFirst(event.target.value === 'desc')}
            >
              <option value="desc">{sort === 'username' ? 'A → Z' : 'Newest first'}</option>
              <option value="asc">{sort === 'username' ? 'Z → A' : 'Oldest first'}</option>
            </select>
          </label>
          <label className="archive-sort">
            Sort by
            <select value={sort} onChange={(event) => setSort(event.target.value as ArchiveSort)}>
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="chips archive-filters">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              className={option.id === filter ? 'chip chip-on' : 'chip'}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error ? <div className="banner banner-error">{error}</div> : null}

        <p className="muted archive-count">
          {busy ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'person' : 'people'}`}
          {activeFilter && filter !== 'all' ? ` — ${activeFilter.hint.toLowerCase()}` : ''}
        </p>

        <div className="archive-table-wrap">
          <table className="archive-table">
            <thead>
              <tr>
                <th>Viewer</th>
                <th className="num">Msgs</th>
                <th className="num">Days</th>
                <th className="num">Diamonds</th>
                <th className="num">Strikes</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr
                  key={entry.key}
                  onClick={() => setSelected(entry)}
                  className={entry.penalized ? 'archive-row archive-row-muted' : 'archive-row'}
                >
                  <td>
                    <div className="archive-who">
                      {entry.avatarUrl ? (
                        <img src={entry.avatarUrl} alt="" className="archive-avatar" />
                      ) : (
                        <span className="archive-avatar archive-avatar-blank" />
                      )}
                      <div className="archive-names">
                        <span className="archive-display">{entry.displayName}</span>
                        <span className="muted archive-handle">
                          {/* Only worth the pixels on the merged view — inside
                              a platform tab every row says the same thing. */}
                          {platform === 'all' ? (
                            <PlatformLogo platform={entry.platform} size={11} />
                          ) : null}
                          @{entry.username}
                        </span>
                      </div>
                      <ArchiveBadges entry={entry} />
                    </div>
                  </td>
                  <td className="num">{entry.messages.toLocaleString()}</td>
                  <td className="num">{entry.daysSeen}</td>
                  <td className="num">{entry.diamonds ? entry.diamonds.toLocaleString() : '—'}</td>
                  <td className={entry.strikes > 0 ? 'num num-bad' : 'num'}>
                    {entry.strikes || '—'}
                  </td>
                  <td className="muted">{shortDate(entry.firstSeen)}</td>
                  <td className="muted">{relative(entry.lastSeen)}</td>
                </tr>
              ))}
              {rows.length === 0 && !busy ? (
                <tr>
                  <td colSpan={7} className="muted archive-empty">
                    {debounced
                      ? `Nobody matching "${debounced}".`
                      : platform === 'all'
                        ? 'Nobody recorded under this filter yet.'
                        : `Nobody recorded on ${PLATFORM_INFO[platform].label} yet — viewers appear here once that platform is connected and someone shows up.`}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {pages > 1 ? (
          <div className="archive-pager">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              ← Previous
            </button>
            <span className="muted">
              Page {page + 1} of {pages.toLocaleString()}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        ) : null}
      </Panel>

      {selected ? (
        <ViewerDetail
          entry={selected}
          config={config}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load();
            loadStats();
          }}
        />
      ) : null}
    </section>
  );
}

function ArchiveBadges({ entry }: { entry: ArchiveEntry }): JSX.Element | null {
  const badges: Array<[string, string]> = [];
  if (entry.trusted) badges.push(['trusted', '★']);
  if (entry.penalized) badges.push(['muted', '🔇']);
  if (entry.hasVoice) badges.push(['voice', '🎙']);
  if (entry.pinned && !entry.trusted && !entry.penalized) badges.push(['pinned', '📌']);
  if (badges.length === 0) return null;

  return (
    <span className="archive-badges">
      {badges.map(([label, glyph]) => (
        <span key={label} className="archive-badge" title={label}>
          {glyph}
        </span>
      ))}
    </span>
  );
}

/**
 * Headline numbers over the whole archive, not this session.
 *
 * Follows the platform tab: picking Twitch should not leave a panel of TikTok
 * totals sitting above a table of Twitch viewers, which is how you end up
 * reading one platform's numbers as another's.
 */
function ArchiveSummary({
  stats,
  platform,
}: {
  stats: ArchiveAnalytics;
  platform: PlatformTab;
}): JSX.Element {
  const scope = useMemo(
    () =>
      platform === 'all'
        ? null
        : (stats.platforms.find((entry) => entry.platform === platform) ?? null),
    [stats.platforms, platform],
  );

  const busiestHour = useMemo(() => {
    let best = 0;
    stats.arrivalsByHour.forEach((count, hour) => {
      if (count > (stats.arrivalsByHour[best] ?? 0)) best = hour;
    });
    return best;
  }, [stats.arrivalsByHour]);

  // One shape whether the view is scoped or global, so the grid below does not
  // have to branch on every single value.
  const view = scope
    ? {
        viewers: scope.viewers,
        chatters: scope.chatters,
        lurkers: scope.lurkers,
        regulars: scope.regulars,
        messages: scope.messages,
        messagesPerChatter: scope.messagesPerChatter,
        trusted: scope.trusted,
        penalized: scope.penalized,
        flagged: scope.flagged,
        strikes: scope.strikes,
        diamonds: scope.diamonds,
        newPerDay: scope.newPerDay,
        firstRecordAt: scope.firstRecordAt,
        retention: scope.retention,
      }
    : {
        viewers: stats.totalViewers,
        chatters: stats.chatters,
        lurkers: stats.lurkers,
        regulars: stats.regulars,
        messages: stats.totalMessages,
        messagesPerChatter: stats.messagesPerChatter,
        trusted: stats.trusted,
        penalized: stats.penalized,
        flagged: stats.flagged,
        strikes: stats.totalStrikes,
        diamonds: stats.totalDiamonds,
        newPerDay: stats.newPerDay,
        firstRecordAt: stats.firstRecordAt,
        retention: stats.retention,
      };

  const tops = scope ?? stats;
  const peak = Math.max(1, ...view.newPerDay.map((day) => day.count));
  const recentDays = view.newPerDay.slice(-14);
  const { capacity } = stats;
  const nearlyFull = capacity.daysUntilFull !== null && capacity.daysUntilFull <= 14;
  const label = scope ? PLATFORM_INFO[scope.platform].label : null;

  return (
    <Panel
      title={label ? `${label} analytics` : 'Analytics'}
      description={
        label
          ? `Everything recorded from ${label}${
              view.firstRecordAt ? `, since ${shortDate(view.firstRecordAt)}` : ''
            }.`
          : `Lifetime totals across ${stats.newPerDay.length} day${
              stats.newPerDay.length === 1 ? '' : 's'
            } of records${stats.firstRecordAt ? `, since ${shortDate(stats.firstRecordAt)}` : ''}.`
      }
    >
      {scope && scope.viewers === 0 ? (
        <p className="muted">
          Nothing recorded from {label} yet. Connect it in the Chat tab and these fill in as
          people show up.
        </p>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Total viewers" value={view.viewers} />
            <Stat label="Chatters" value={view.chatters} sub={`${view.lurkers} never spoke`} />
            <Stat label="Regulars" value={view.regulars} sub="seen on 2+ days (a floor)" />
            <Stat
              label="Messages"
              value={view.messages}
              sub={`${view.messagesPerChatter} per chatter`}
            />
            <Stat label="Trusted" value={view.trusted} />
            <Stat label="Penalty box" value={view.penalized} />
            <Stat label="Flagged" value={view.flagged} sub={`${view.strikes} strikes`} />
            {scope ? null : <Stat label="Busiest arrival hour" value={`${busiestHour}:00`} plain />}
          </div>

          {view.diamonds === 0 ? (
            <p className="muted archive-note">
              Gift and diamond totals start from zero — they were only added to the archive
              recently, so anything sent before that was counted per-session and is not
              recoverable.
            </p>
          ) : null}

          <RetentionChart curve={view.retention} scope={label} />

          <div className="archive-chart">
            <h3>New viewers per day</h3>
            {recentDays.length === 0 ? (
              <p className="muted">No arrivals recorded yet.</p>
            ) : (
              <div className="bar-chart">
                {recentDays.map((day) => (
                  <div key={day.day} className="bar-col" title={`${day.day}: ${day.count} new`}>
                    <div
                      className="bar"
                      style={{ height: `${Math.round((day.count / peak) * 100)}%` }}
                    />
                    <span className="bar-label">{day.day.slice(5)}</span>
                    <span className="bar-value">{day.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {platform === 'all' ? <PlatformCompare platforms={stats.platforms} /> : null}

      {/* Scoped to the tab, not global. A Twitch heading over a list of
          TikTok names is worse than no list at all. */}
      {tops.topChatters.length > 0 ||
      tops.topGifters.length > 0 ||
      tops.mostFlagged.length > 0 ? (
        <div className="archive-tops">
          {tops.topChatters.length > 0 ? (
            <TopList
              title="Top chatters"
              entries={tops.topChatters}
              pick={(e) => e.messages}
              unit="msgs"
            />
          ) : null}
          {tops.topGifters.length > 0 ? (
            <TopList
              title="Top gifters"
              entries={tops.topGifters}
              pick={(e) => e.diamonds}
              unit="diamonds"
            />
          ) : null}
          {tops.mostFlagged.length > 0 ? (
            <TopList
              title="Most flagged"
              entries={tops.mostFlagged}
              pick={(e) => e.strikes}
              unit="strikes"
            />
          ) : null}
        </div>
      ) : null}

      <div className={nearlyFull ? 'banner banner-error' : 'archive-capacity muted'}>
        Archive holds {capacity.size.toLocaleString()} of {capacity.max.toLocaleString()} people
        {capacity.perDay > 0 ? `, growing ~${capacity.perDay}/day` : ''}.
        {capacity.daysUntilFull !== null
          ? ` At that rate it fills in about ${capacity.daysUntilFull} day${
              capacity.daysUntilFull === 1 ? '' : 's'
            }, after which silent lurkers are dropped first — chatters, flagged users and anyone on a list are kept.`
          : ' Nothing is being discarded.'}
      </div>
    </Panel>
  );
}

/**
 * How long people stay.
 *
 * A survival curve rather than a single average, because the average hides the
 * shape: two audiences with the same mean watch time can be "most people leave
 * instantly, a few stay for hours" or "everybody watches for twenty minutes",
 * and those call for completely different things.
 */
function RetentionChart({
  curve,
  scope,
}: {
  curve: RetentionCurve;
  scope: string | null;
}): JSX.Element {
  const rates = retentionRates(curve);
  const mean = meanVisitMs(curve);

  return (
    <div className="archive-chart archive-retention">
      <h3>
        How long viewers stay{scope ? ` on ${scope}` : ''}
        {curve.open > 0 ? <span className="retention-live">{curve.open} here now</span> : null}
      </h3>

      {curve.visits === 0 ? (
        <p className="muted">
          No visits recorded yet. This starts filling in from the next stream — it is measured
          live, so it cannot be reconstructed from the archive.
        </p>
      ) : (
        <>
          <div className="retention-rows">
            {RETENTION_BUCKETS.map((minutes, index) => {
              const rate = rates[index] ?? 0;
              const count = curve.reached[index] ?? 0;
              return (
                <div key={minutes} className="retention-row">
                  <span className="retention-label">{formatMinutes(minutes)}</span>
                  <span className="retention-track">
                    <span className="retention-fill" style={{ width: `${rate * 100}%` }} />
                  </span>
                  <span className="retention-value">
                    {Math.round(rate * 100)}%
                    <span className="muted"> · {count.toLocaleString()}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <p className="muted archive-note">
            {curve.visits.toLocaleString()} visit{curve.visits === 1 ? '' : 's'} recorded · average{' '}
            {formatDuration(mean)} · longest {formatDuration(curve.longestMs)}. A visit ends after
            15 minutes with no activity. Only viewers who do something can be seen — a message, a
            like, a gift, a join — so this is retention among people who interact, not among
            everyone in the room.
          </p>
        </>
      )}
    </div>
  );
}

/** The three services side by side, so one can be read against another. */
function PlatformCompare({ platforms }: { platforms: PlatformBreakdown[] }): JSX.Element | null {
  const present = platforms.filter((entry) => entry.viewers > 0);
  // One platform is not a comparison; the numbers above already said it.
  if (present.length < 2) return null;

  return (
    <div className="archive-chart">
      <h3>By platform</h3>
      <div className="platform-compare">
        {present.map((entry) => {
          const info = PLATFORM_INFO[entry.platform];
          const rates = retentionRates(entry.retention);
          return (
            <div
              key={entry.platform}
              className="platform-compare-card"
              style={{ borderTopColor: info.color }}
            >
              <span className="platform-name" style={{ color: info.color }}>
                <PlatformLogo platform={entry.platform} size={15} />
                {info.label}
              </span>
              <dl className="platform-compare-rows">
                <div>
                  <dt>Viewers</dt>
                  <dd>{entry.viewers.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Chatters</dt>
                  <dd>{entry.chatters.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Messages</dt>
                  <dd>{entry.messages.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Regulars</dt>
                  <dd>{entry.regulars.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Past 15 min</dt>
                  <dd>
                    {entry.retention.visits === 0 ? '—' : `${Math.round((rates[2] ?? 0) * 100)}%`}
                  </dd>
                </div>
                <div>
                  <dt>Avg visit</dt>
                  <dd>
                    {entry.retention.visits === 0
                      ? '—'
                      : formatDuration(meanVisitMs(entry.retention))}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function Stat({
  label,
  value,
  sub,
  plain,
}: {
  label: string;
  value: number | string;
  sub?: string;
  plain?: boolean;
}): JSX.Element {
  return (
    <div className="stat">
      <span className="stat-value">
        {plain || typeof value === 'string' ? value : value.toLocaleString()}
      </span>
      <span className="stat-label">{label}</span>
      {sub ? <span className="stat-sub muted">{sub}</span> : null}
    </div>
  );
}

function TopList({
  title,
  entries,
  pick,
  unit,
}: {
  title: string;
  entries: ArchiveEntry[];
  pick: (entry: ArchiveEntry) => number;
  unit: string;
}): JSX.Element {
  return (
    <div className="top-list">
      <h3>{title}</h3>
      <ol>
        {entries.map((entry) => (
          <li key={entry.key}>
            <span className="top-name" title={`@${entry.username}`}>
              <PlatformLogo platform={entry.platform} size={11} />
              {entry.displayName}
            </span>
            <span className="top-value muted">
              {pick(entry).toLocaleString()} {unit}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Everything known about one person, plus the actions the People tab offers. */
function ViewerDetail({
  entry,
  config,
  onClose,
  onChanged,
}: {
  entry: ArchiveEntry;
  config: AppConfig;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [detail, setDetail] = useState<{
    evidence?: Array<{ ts: number; text: string; reason: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .getUser(entry.key)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [entry.key]);

  const act = (run: () => Promise<unknown>): void => {
    setBusy(true);
    void run()
      .then(onChanged)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const penalty = config.users.penaltyBox.find((item) => listKey(item.username) === entry.key);

  return (
    <div className="panel archive-detail">
      <header className="panel-head archive-detail-head">
        <div className="archive-who">
          {entry.avatarUrl ? (
            <img src={entry.avatarUrl} alt="" className="archive-avatar archive-avatar-big" />
          ) : (
            <span className="archive-avatar archive-avatar-big archive-avatar-blank" />
          )}
          <div className="archive-names">
            <h2>{entry.displayName}</h2>
            <p className="muted">
              <PlatformLogo platform={entry.platform} size={12} /> @{entry.username}
            </p>
          </div>
        </div>
        <button type="button" className="chip" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="panel-body">
        <div className="stat-grid">
          <Stat label="Messages" value={entry.messages} />
          <Stat label="Days seen" value={entry.daysSeen} />
          <Stat label="Diamonds" value={entry.diamonds} />
          <Stat label="Gifts" value={entry.gifts} />
          <Stat label="Likes" value={entry.likes} />
          <Stat label="Strikes" value={entry.strikes} />
          <Stat label="First seen" value={shortDate(entry.firstSeen)} plain />
          <Stat label="Last seen" value={relative(entry.lastSeen)} plain />
        </div>

      {penalty?.reason ? (
        <p className="muted archive-note">In the penalty box — {penalty.reason}</p>
      ) : null}

      <div className="chips">
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() =>
            act(() =>
              entry.trusted
                ? api.untrustUser(entry.key)
                : api.trustUser(entry.key, entry.displayName),
            )
          }
        >
          {entry.trusted ? 'Remove trust' : 'Trust'}
        </button>
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() =>
            act(() =>
              entry.penalized
                ? api.pardonUser(entry.key)
                : api.penalizeUser(entry.key, 'Added from the archive', entry.displayName),
            )
          }
        >
          {entry.penalized ? 'Release from penalty box' : 'Mute'}
        </button>
      </div>

      {detail?.evidence && detail.evidence.length > 0 ? (
        <div className="archive-evidence">
          <h3>Flagged messages</h3>
          <ul className="people-list">
            {detail.evidence.map((item) => (
              <li key={`${item.ts}-${item.text}`}>
                <span className="evidence-text">{item.text}</span>
                <span className="muted evidence-meta">
                  {item.reason} · {shortDate(item.ts)}
                </span>
              </li>
            ))}
          </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function relative(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(ts);
}
