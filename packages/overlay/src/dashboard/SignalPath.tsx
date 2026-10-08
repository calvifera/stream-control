import { PLATFORM_INFO, PLATFORMS, type AppConfig } from '@streaming/shared';
import type { ServerMeta } from '../lib/api.js';
import { useLive } from '../lib/store.js';
import { StatusDot } from './controls.js';
import { Icon } from './icons.js';

/**
 * Where a message goes, and whether each stop is ready.
 *
 * Chat from every platform runs through the same five stations in the same
 * order, so the list doubles as a setup checklist: the first station that is
 * not ready is the next thing to fix, and each one links to where it is fixed.
 */

export type StationState = 'ready' | 'attention' | 'idle' | 'error';

export interface Station {
  id: string;
  name: string;
  state: StationState;
  /** One short phrase: what is true right now. */
  detail: string;
  /** Where "fix it" goes. */
  go: { tab: string; sub?: string; area?: string };
  action: string;
}

const MARK: Record<StationState, string> = {
  ready: 'connected',
  attention: 'connecting',
  idle: 'idle',
  error: 'error',
};

const WORD: Record<StationState, string> = {
  ready: 'Ready',
  attention: 'Check',
  idle: 'Not set',
  error: 'Problem',
};

export function useStations(config: AppConfig, meta: ServerMeta | null): Station[] {
  const { snapshot, tts } = useLive();
  const connections = snapshot?.connections ?? {};

  const connected = PLATFORMS.filter((platform) => connections[platform]?.status === 'connected');
  const trying = PLATFORMS.filter((platform) => {
    const status = connections[platform]?.status;
    return status === 'connecting' || status === 'reconnecting';
  });
  const failed = PLATFORMS.filter((platform) => connections[platform]?.status === 'error');

  const platforms: Station = {
    id: 'platforms',
    name: 'Platforms',
    state: connected.length > 0 ? (failed.length > 0 ? 'attention' : 'ready') : failed.length > 0 ? 'error' : trying.length > 0 ? 'attention' : 'idle',
    detail:
      connected.length > 0
        ? connected.map((platform) => PLATFORM_INFO[platform].label).join(', ')
        : trying.length > 0
          ? 'Connecting…'
          : failed.length > 0
            ? `${PLATFORM_INFO[failed[0] as (typeof PLATFORMS)[number]].label} failed`
            : 'Nothing connected',
    go: { tab: 'Setup', area: 'setup', sub: 'platforms' },
    action: connected.length > 0 ? 'Manage' : 'Connect',
  };

  const filters = config.filters;
  const entries =
    filters.blockedWords.length +
    filters.blockedPhrases.length +
    filters.blockedRegex.length +
    filters.blockedUsers.length;
  const filterStation: Station = {
    id: 'filters',
    name: 'Filters',
    state: !filters.enabled ? 'attention' : 'ready',
    detail: !filters.enabled
      ? 'Switched off'
      : entries === 0
        ? 'On, no entries yet'
        : `On, ${entries} ${entries === 1 ? 'entry' : 'entries'}`,
    go: { tab: 'Filters', area: 'filters', sub: 'lists' },
    action: 'Edit',
  };

  const enabledRules = config.tts.rules.filter((rule) => rule.enabled).length;
  const rules: Station = {
    id: 'rules',
    name: 'Rules',
    state: !config.tts.enabled ? 'idle' : enabledRules === 0 ? 'attention' : 'ready',
    detail: !config.tts.enabled
      ? 'Speech is off'
      : enabledRules === 0
        ? 'No rule is on'
        : `${enabledRules} of ${config.tts.rules.length} on`,
    go: { tab: 'Rules' },
    action: 'Edit',
  };

  const provider = meta?.providers.find((candidate) => candidate.id === config.tts.provider);
  const voice: Station = {
    id: 'voice',
    name: 'Voice',
    state: !config.tts.enabled ? 'idle' : provider && !provider.configured ? 'error' : 'ready',
    detail: !config.tts.enabled
      ? 'Speech is off'
      : provider && !provider.configured
        ? 'Needs a key'
        : providerLabel(config.tts.provider),
    go: { tab: 'TTS', area: 'speech', sub: 'engine' },
    action: provider && !provider.configured ? 'Fix' : 'Change',
  };

  const sources = config.overlays.filter((overlay) => overlay.enabled).length;
  const listeners = tts?.overlayListeners ?? 0;
  const overlays: Station = {
    id: 'overlays',
    name: 'Overlays',
    state: sources === 0 ? 'idle' : listeners === 0 ? 'attention' : 'ready',
    detail:
      sources === 0
        ? 'No sources'
        : listeners === 0
          ? `${sources} ${sources === 1 ? 'source' : 'sources'}, no audio source open`
          : `${sources} ${sources === 1 ? 'source' : 'sources'}, audio source open`,
    go: { tab: 'Setup', area: 'setup', sub: 'sources' },
    action: 'Get URLs',
  };

  return [platforms, filterStation, rules, voice, overlays];
}

function providerLabel(provider: AppConfig['tts']['provider']): string {
  switch (provider) {
    case 'google':
      return 'Google Cloud';
    case 'tiktok':
      return 'TikTok voices';
    case 'google-legacy':
      return 'Google Translate';
    default:
      return 'Browser speech';
  }
}

export function SignalPath({
  stations,
  onGo,
}: {
  stations: Station[];
  onGo: (go: Station['go']) => void;
}): JSX.Element {
  const next = stations.find((station) => station.state === 'error' || station.state === 'idle' || station.state === 'attention');

  return (
    <section className="signal" aria-label="Signal path">
      <ol className="signal-list">
        {stations.map((station, index) => (
          <li key={station.id} className={`station station-${station.state}${station === next ? ' station-next' : ''}`}>
            <div className="station-top">
              <span className="station-num">{index + 1}</span>
              <span className="station-name">{station.name}</span>
              <span className="station-state">
                <StatusDot status={MARK[station.state]} />
                {WORD[station.state]}
              </span>
            </div>
            <p className="station-detail">{station.detail}</p>
            <button type="button" className="station-go" onClick={() => onGo(station.go)}>
              {station.action}
              <Icon name="arrow" size={14} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
