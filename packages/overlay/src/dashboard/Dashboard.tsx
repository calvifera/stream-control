import { useCallback, useEffect, useState } from 'react';
import { PLATFORMS, PLATFORM_INFO, type AppConfig, type ConnectionState, type Platform } from '@streaming/shared';
import { api, type ServerMeta } from '../lib/api.js';
import { identify, useLive } from '../lib/store.js';
import { PlatformLogo } from '../lib/PlatformLogo.js';
import { setPersisted, usePersistentState } from '../lib/usePersistentState.js';
import { useTtsPlayer } from '../lib/useTtsPlayer.js';
import { ArchiveTab } from './ArchiveTab.js';
import { ChatPopoutButton } from './ChatPopout.js';
import { ChatTab } from './ChatTab.js';
import { CredentialsTab } from './CredentialsTab.js';
import { ConnectTab } from './ConnectTab.js';
import { GalleryTab } from './GalleryTab.js';
import { TtsTab } from './TtsTab.js';
import { RulesTab } from './RulesTab.js';
import { FiltersTab } from './FiltersTab.js';
import { PeopleTab } from './PeopleTab.js';
import { LogTab } from './LogTab.js';
import { StatusDot } from './controls.js';
import { Icon, type IconName } from './icons.js';
import '../styles/system.css';
import '../styles/shell.css';
import '../styles/dashboard.css';
import '../styles/pages.css';

const TABS = ['Setup', 'Keys', 'Chat', 'Sources', 'TTS', 'Rules', 'Filters', 'People', 'Archive', 'Log'] as const;
type Tab = (typeof TABS)[number];

/**
 * The areas, grouped by the job they do. The order follows a first setup:
 * connect, add keys, add overlays and a voice, write the rules, then the places
 * you watch things happen.
 */
const NAV: Array<{ group: string; items: Array<{ id: Tab; label: string; icon: IconName }> }> = [
  {
    group: 'Set up',
    items: [
      { id: 'Setup', label: 'Go live', icon: 'live' },
      { id: 'Keys', label: 'Keys', icon: 'key' },
      { id: 'Sources', label: 'Overlays', icon: 'layers' },
      { id: 'TTS', label: 'Voice', icon: 'audio' },
    ],
  },
  {
    group: 'Rules',
    items: [
      { id: 'Rules', label: 'Speech rules', icon: 'speech' },
      { id: 'Filters', label: 'Filters', icon: 'filter' },
      { id: 'People', label: 'Viewers', icon: 'people' },
    ],
  },
  {
    group: 'Activity',
    items: [
      { id: 'Chat', label: 'Chat', icon: 'chat' },
      { id: 'Archive', label: 'Archive', icon: 'archive' },
      { id: 'Log', label: 'Log', icon: 'log' },
    ],
  },
];

export function Dashboard(): JSX.Element {
  const { config, snapshot, socketConnected, tts } = useLive();
  const [tab, setTab] = usePersistentState<Tab>('tab', 'Setup', (stored) =>
    TABS.includes(stored),
  );
  const [meta, setMeta] = useState<ServerMeta | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [killed, setKilled] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const player = useTtsPlayer({
    enabled: config?.tts.normalizeLoudness ?? true,
    gainDb: config?.tts.loudnessGainDb ?? 8,
  });

  // Registering as a fallback listener means speech is audible here before any
  // TTS browser source exists. A real source always takes priority, so this
  // never pulls audio out of the stream once a live overlay is running.
  useEffect(() => {
    identify({ role: 'dashboard', listener: true, fallback: true });
    void api
      .authStatus()
      .then(({ required }) => setAuthRequired(required))
      .catch(() => undefined);
  }, []);

  // Asked for again whenever the tab changes: which keys are set is what several
  // screens warn about, and a key pasted on Keys should stop the warning on
  // Setup the moment you go back, not at the next reload.
  const refreshMeta = useCallback(() => {
    void api.meta().then(setMeta).catch(() => undefined);
  }, []);

  useEffect(refreshMeta, [refreshMeta, tab]);

  /**
   * Sends a partial config to the server, which deep-merges it and broadcasts
   * the result. The UI never holds its own copy, so two open dashboards stay
   * in sync automatically.
   */
  const patch = useCallback((partial: Record<string, unknown>) => {
    setSaveError(null);
    void api.patchConfig(partial as Partial<AppConfig>).catch((error: unknown) => {
      setSaveError(error instanceof Error ? error.message : String(error));
    });
  }, []);

  /** Opens an area, optionally already on one of its in-page tabs. */
  const go = useCallback(
    (target: { tab: string; area?: string; sub?: string }) => {
      if (target.area && target.sub) setPersisted(`sub.${target.area}`, target.sub);
      setTab(target.tab as Tab);
      window.scrollTo({ top: 0 });
    },
    [setTab],
  );

  if (!config) {
    return (
      <div className="app-loading">
        {socketConnected ? 'Loading configuration…' : 'Connecting to the stream server…'}
      </div>
    );
  }

  const connections = snapshot?.connections ?? {};
  // Anything speaking counts too, not just what is waiting behind it.
  const queued = (tts?.queue.length ?? 0) + (tts?.speaking ? 1 : 0);
  // Audio lands here only when no real TTS source is open.
  const playingHere = (tts?.overlayListeners ?? 0) === 0;
  const monitoring = config.tts.monitorInDashboard;
  const sourceCount = tts?.overlayListeners ?? 0;

  return (
    <div className="app">
      <audio ref={player.audioRef} onEnded={player.onEnded} onError={player.onError} />

      <aside className="rail">
        <div className="rail-top">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Stream Control</span>
        </div>

        <ul className="onair" aria-label="Connections">
          {PLATFORMS.map((platform) => {
            const state = connections[platform];
            const status = state?.status ?? 'idle';
            return (
              <li key={platform}>
                <button
                  type="button"
                  className="onair-row"
                  onClick={() => go({ tab: 'Setup', area: 'setup', sub: 'platforms' })}
                  title={`${PLATFORM_INFO[platform].label}: ${status}`}
                >
                  <PlatformLogo platform={platform} size={14} />
                  <span className="onair-name">{PLATFORM_INFO[platform].label}</span>
                  <span className="onair-state">
                    <StatusDot status={status} />
                    {chipLabel(platform, state)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <nav className="nav" aria-label="Areas">
          {NAV.map((section) => (
            <div className="nav-group" key={section.group}>
              <p className="nav-group-label">{section.group}</p>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === tab ? 'nav-item nav-item-on' : 'nav-item'}
                  aria-current={item.id === tab ? 'page' : undefined}
                  onClick={() => go({ tab: item.id })}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        </div>

        <div className="rail-foot">
          {/* Clickable, because this is a mid-stream decision. Streaming
              software is commonly set up to send a browser source into the
              stream without monitoring it to your own speakers, so you cannot
              hear your own TTS, and wanting to hear it in order to answer
              someone happens while you are live, not while you are in a
              settings tab. */}
          <button
            type="button"
            className={`rail-audio${playingHere ? ' rail-audio-warn' : ''}`}
            title={audioHint(sourceCount, monitoring)}
            onClick={() => patch({ tts: { monitorInDashboard: !monitoring } })}
          >
            <Icon name="audio" />
            <span className="rail-audio-text">
              <strong>
                {playingHere
                  ? 'Audio: this tab only'
                  : monitoring
                    ? 'Audio: stream and here'
                    : 'Audio: to the stream'}
              </strong>
              <span>
                {playingHere
                  ? 'Your stream will not hear it'
                  : monitoring
                    ? 'Click to stop monitoring'
                    : 'Click to also hear it here'}
              </span>
            </span>
          </button>

          {player.blocked ? (
            <button type="button" className="btn btn-primary rail-wide" onClick={player.unlock}>
              Enable audio in this tab
            </button>
          ) : null}

          {/* Lives in the rail rather than a tab because it is mounted here
              for good: inside a tab it was torn down the moment you switched,
              which closed the pop-out window with it. */}
          <div className="rail-chat">
            <ChatPopoutButton />
          </div>

          {/* Never disabled: if the state shown here is stale, the button
              still has to work. Outline until pointed at, so it is findable
              without being the loudest thing on every screen. */}
          <button
            type="button"
            className="kill"
            title="Stop what is speaking now and drop everything queued"
            onClick={() => {
              setKilled(true);
              window.setTimeout(() => setKilled(false), 1600);
              void api.clearTts().catch(() => undefined);
            }}
          >
            <Icon name="stop" size={16} />
            <span>{killed ? 'Stopped' : 'Kill TTS'}</span>
            {!killed && queued > 0 ? <span className="kill-count">{queued}</span> : null}
          </button>

          {authRequired ? (
            <button
              type="button"
              className="rail-signout"
              title="Sign out of this dashboard"
              onClick={() => {
                void api.logout().then(() => window.location.reload());
              }}
            >
              <Icon name="signout" size={16} />
              Sign out
            </button>
          ) : null}
        </div>
      </aside>

      <main className="main">
        {!socketConnected ? (
          <div className="banner banner-error app-banner">
            Lost the connection to the stream server. Changes will not save until it is back.
          </div>
        ) : null}
        {saveError ? <div className="banner banner-error app-banner">{saveError}</div> : null}

        {tab === 'Setup' ? <ConnectTab config={config} patch={patch} meta={meta} go={go} /> : null}
        {tab === 'Keys' ? <CredentialsTab origin={window.location.origin} /> : null}
        {tab === 'Chat' ? <ChatTab config={config} patch={patch} /> : null}
        {tab === 'Sources' ? <GalleryTab config={config} patch={patch} /> : null}
        {tab === 'TTS' ? <TtsTab config={config} patch={patch} meta={meta} onCredentialsChanged={refreshMeta} /> : null}
        {tab === 'Rules' ? <RulesTab config={config} patch={patch} go={go} /> : null}
        {tab === 'Filters' ? <FiltersTab config={config} patch={patch} /> : null}
        {tab === 'People' ? <PeopleTab config={config} patch={patch} /> : null}
        {tab === 'Archive' ? <ArchiveTab config={config} patch={patch} /> : null}
        {tab === 'Log' ? <LogTab /> : null}
      </main>
    </div>
  );
}

/** Three platform gels running into one line: what the product does. */
function BrandMark(): JSX.Element {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      <path d="M2 6h9l5 8" fill="none" stroke="var(--gel-tiktok)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 14h14" fill="none" stroke="var(--gel-youtube)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M2 22h9l5-8" fill="none" stroke="var(--gel-twitch)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 14h10" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** The name when there is one worth showing, otherwise the state. */
function chipLabel(platform: Platform, state: ConnectionState | undefined): string {
  if (state?.status !== 'connected') return statusWord(state?.status);
  // YouTube's "name" is a video id or a stream title, which says nothing here.
  if (platform === 'tiktok' && state.username) return `@${state.username}`;
  if (platform === 'twitch' && state.username) return state.username;
  return 'Connected';
}

function statusWord(status: ConnectionState['status'] | undefined): string {
  switch (status) {
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Retrying';
    case 'error':
      return 'Problem';
    case 'connected':
      return 'Connected';
    default:
      return 'Not connected';
  }
}

function audioHint(overlayListeners: number, monitoring: boolean): string {
  if (overlayListeners === 0) {
    return 'No TTS browser source is open — speech plays in this tab so you can hear it, but it is not going into your stream. Add the TTS audio source and it takes over.';
  }
  return monitoring
    ? 'Speech is going to your TTS browser source and also playing here. Click to stop monitoring.'
    : 'Speech is going to your TTS browser source, so your streaming software captures it. Click to also hear it here.';
}
