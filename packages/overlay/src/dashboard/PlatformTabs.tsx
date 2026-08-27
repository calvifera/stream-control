import { PLATFORM_INFO, PLATFORMS, type Platform } from '@streaming/shared';
import { PlatformLogo } from '../lib/PlatformLogo.js';

/**
 * The platform switcher, shared by every list that spans services.
 *
 * "All" is first and merges every service; the rest narrow to one. A platform
 * with nothing in it still gets a tab — an absent tab reads as "not
 * supported", which is a different and wrong message from "nobody from there
 * yet".
 *
 * Lives here rather than inside one tab because a second copy would drift:
 * two switchers that look alike but count, highlight or order differently are
 * worse than one that is used twice.
 */

/** "All" is a view, not a platform, so it gets its own sentinel. */
export type PlatformTab = Platform | 'all';

export function PlatformTabs({
  counts,
  total,
  active,
  onPick,
}: {
  /** Per-platform totals. Omit entirely while loading to hide every count. */
  counts?: Record<Platform, number> | null;
  /**
   * The "All" count. Not summed from `counts` — the two can legitimately
   * differ once a list is filtered, and guessing would show a number that
   * disagrees with the rows underneath it.
   */
  total?: number | null;
  active: PlatformTab;
  onPick: (tab: PlatformTab) => void;
}): JSX.Element {
  return (
    <div className="platform-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'all'}
        className={active === 'all' ? 'platform-tab platform-tab-on' : 'platform-tab'}
        onClick={() => onPick('all')}
      >
        All
        {total === null || total === undefined ? null : (
          <span className="platform-tab-count">{total.toLocaleString()}</span>
        )}
      </button>

      {PLATFORMS.map((platform) => {
        const count = counts?.[platform];
        const on = active === platform;
        return (
          <button
            key={platform}
            type="button"
            role="tab"
            aria-selected={on}
            className={on ? 'platform-tab platform-tab-on' : 'platform-tab'}
            style={on ? { borderBottomColor: PLATFORM_INFO[platform].color } : undefined}
            onClick={() => onPick(platform)}
          >
            <PlatformLogo platform={platform} size={14} />
            {PLATFORM_INFO[platform].label}
            {count === undefined ? null : (
              <span className="platform-tab-count">{count.toLocaleString()}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
