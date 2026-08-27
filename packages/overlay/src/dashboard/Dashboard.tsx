import { useCallback, useEffect, useState } from 'react';
import type { AppConfig } from '@streaming/shared';
import { api, type ServerMeta } from '../lib/api.js';
import { identify, useLive } from '../lib/store.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { useTtsPlayer } from '../lib/useTtsPlayer.js';
import { ArchiveTab } from './ArchiveTab.js';
import { ChatPopoutButton } from './ChatPopout.js';
import { ChatTab } from './ChatTab.js';
import { CredentialsTab } from './CredentialsTab.js';
import { ConnectTab } from './ConnectTab.js';
import { GalleryTab } from './GalleryTab.js';
import { TtsTab } from './TtsTab.js';
import { FiltersTab } from './FiltersTab.js';
import { PeopleTab } from './PeopleTab.js';
import { LogTab } from './LogTab.js';
import { StatusDot } from './controls.js';
import '../styles/dashboard.css';

const TABS = ['Setup', 'Keys', 'Chat', 'Sources', 'TTS', 'Filters', 'People', 'Archive', 'Log'] as const;
type Tab = (typeof TABS)[number];

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
    void api.meta().then(setMeta).catch(() => undefined);
    void api
      .authStatus()
      .then(({ required }) => setAuthRequired(required))
      .catch(() => undefined);
  }, []);

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

  if (!config) {
    return (
      <div className="app-loading">
        {socketConnected ? 'Loading configuration…' : 'Connecting to the stream server…'}
      </div>
    );
  }

  const status = snapshot?.connection.status ?? 'idle';
  // Anything speaking counts too, not just what is waiting behind it.
  const queued = (tts?.queue.length ?? 0) + (tts?.speaking ? 1 : 0);
  // Audio lands here only when no real TTS source is open.
  const playingHere = (tts?.overlayListeners ?? 0) === 0;

  return (
    <div className="app">
      <audio ref={player.audioRef} onEnded={player.onEnded} onError={player.onError} />
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>Stream Control</h1>
            <p className="muted">Multi-platform live chat, overlays, TTS and moderation</p>
          </div>
        </div>

        <div className="header-status">
          <span className="header-chip">
            <StatusDot status={status} />
            {status === 'connected' && snapshot?.connection.username
              ? `@${snapshot.connection.username}`
              : status}
          </span>
          <span className="header-chip">
            <StatusDot status={socketConnected ? 'connected' : 'error'} />
            {socketConnected ? 'server online' : 'server offline'}
          </span>
          <span className="header-chip" title={audioHint(tts?.overlayListeners ?? 0)}>
            <StatusDot status={playingHere ? 'connecting' : 'connected'} />
            {playingHere
              ? 'audio: this tab'
              : `audio: ${tts?.overlayListeners} browser source${tts?.overlayListeners === 1 ? '' : 's'}`}
          </span>

          {/* Lives in the header, not the Chat tab: mounted there it was
              torn down the moment you switched tabs, which closed the
              pop-out window with it. */}
          <ChatPopoutButton />

          {player.blocked ? (
            <button type="button" className="header-chip header-chip-action" onClick={player.unlock}>
              🔇 Click to enable audio
            </button>
          ) : null}

          {/* Lives in the header rather than the TTS tab on purpose: during an
              incident you should not have to find the right tab and scroll.
              Never disabled — if the state shown here is stale, the button
              still has to work. */}
          <button
            type="button"
            className="header-chip header-kill"
            title="Stop what is speaking now and drop everything queued"
            onClick={() => {
              setKilled(true);
              window.setTimeout(() => setKilled(false), 1600);
              void api.clearTts().catch(() => undefined);
            }}
          >
            {killed ? '■ Killed' : '■ Kill TTS'}
            {!killed && queued > 0 ? <span className="kill-count">{queued}</span> : null}
          </button>

          {authRequired ? (
            <button
              type="button"
              className="header-chip"
              title="Sign out of this dashboard"
              onClick={() => {
                void api.logout().then(() => window.location.reload());
              }}
            >
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      {playingHere ? (
        <div className="banner app-banner">
          No TTS browser source is open, so speech is playing through this tab —
          handy for testing, but <strong>your stream won't hear it</strong>. Add the{' '}
          <strong>TTS audio</strong> browser source and it takes over automatically.
        </div>
      ) : null}

      <nav className="tabs">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            className={name === tab ? 'tab tab-on' : 'tab'}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>

      {saveError ? <div className="banner banner-error app-banner">{saveError}</div> : null}

      <main className="app-main">
        {tab === 'Setup' ? <ConnectTab config={config} patch={patch} meta={meta} /> : null}
        {tab === 'Keys' ? <CredentialsTab origin={window.location.origin} /> : null}
        {tab === 'Chat' ? <ChatTab config={config} patch={patch} /> : null}
        {tab === 'Sources' ? <GalleryTab config={config} patch={patch} /> : null}
        {tab === 'TTS' ? <TtsTab config={config} patch={patch} meta={meta} /> : null}
        {tab === 'Filters' ? <FiltersTab config={config} patch={patch} /> : null}
        {tab === 'People' ? <PeopleTab config={config} patch={patch} /> : null}
        {tab === 'Archive' ? <ArchiveTab config={config} patch={patch} /> : null}
        {tab === 'Log' ? <LogTab /> : null}
      </main>
    </div>
  );
}

function audioHint(overlayListeners: number): string {
  return overlayListeners === 0
    ? 'No TTS browser source is open — speech plays in this tab so you can hear it, but it is not going into your stream.'
    : 'Speech is going to your TTS browser source, so your streaming software captures it.';
}
