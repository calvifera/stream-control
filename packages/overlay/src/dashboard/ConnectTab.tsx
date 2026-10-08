import { useEffect, useState } from 'react';
import {
  PLATFORMS,
  viewerSourceNote,
  type AppConfig,
  type SourceHostCheck,
} from '@streaming/shared';
import { api, type OverlayWithUrls, type ServerMeta } from '../lib/api.js';
import { useLive } from '../lib/store.js';
import { Button, CopyButton, Field, Panel, Row, TextInput, Toggle } from './controls.js';
import { CredentialField, credentialField, useCredentials } from './CredentialsTab.js';
import { Page, SubTabs, useSubTab } from './layout.js';
import { PlatformsPanel } from './PlatformsPanel.js';
import { SignalPath, useStations, type Station } from './SignalPath.js';
import { formatNumber } from '../overlay/style.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
  meta: ServerMeta | null;
  go: (target: Station['go']) => void;
}

const SUBS = ['platforms', 'sources', 'remote', 'session'] as const;

export function ConnectTab({ config, patch, meta, go }: Props): JSX.Element {
  const { snapshot, stats, tts } = useLive();
  const stations = useStations(config, meta);
  const [sub, setSub] = useSubTab('setup', 'platforms', SUBS);
  const { statusOf, reload: reloadCredentials } = useCredentials();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<OverlayWithUrls[]>([]);
  const [hostCheck, setHostCheck] = useState<SourceHostCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const connections = snapshot?.connections ?? {};
  const tunnel = snapshot?.tunnel;

  useEffect(() => {
    void api.overlays().then(setOverlays).catch(() => undefined);
  }, [config.overlays, tunnel?.url, config.sources.host]);

  const runHostCheck = (): void => {
    setChecking(true);
    void api
      .checkSourceHost()
      .then(setHostCheck)
      .catch(() => setHostCheck(null))
      .finally(() => setChecking(false));
  };

  // Re-verify whenever the hostname changes. The check is a DNS lookup plus a
  // request to ourselves, so it is cheap enough to run unprompted — and a
  // hostname that has silently stopped pointing here is exactly the thing you
  // want to find out about now rather than mid-stream.
  useEffect(runHostCheck, [config.sources.host]);

  const toggleTunnel = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = tunnel?.url ? await api.stopTunnel() : await api.startTunnel();
      if (result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const enabledSources = overlays.filter((overlay) => overlay.enabled).length;

  return (
    <Page
      title="Go live"
      lead="Chat from every platform runs through the same five stops. Fix the first one that is not ready, then copy your overlay URLs into your streaming software."
    >
      <SignalPath stations={stations} onGo={go} />

      <SubTabs
        label="Go live sections"
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'platforms', label: 'Platforms' },
          { id: 'sources', label: 'Browser sources', note: enabledSources || null },
          { id: 'remote', label: 'Remote access', note: tunnel?.url ? 'on' : null },
          { id: 'session', label: 'This session' },
        ]}
      />

      {sub === 'platforms' ? <PlatformsPanel config={config} patch={patch} meta={meta} /> : null}

      {sub === 'sources' ? (
        <Panel
          title="Browser source URLs"
          description="Add each one to your streaming software as a browser source at the size shown. When it runs on this machine, no tunnel is needed."
        >
          {(tts?.overlayListeners ?? 0) === 0 ? (
            <div className="banner banner-warn">
              No TTS audio source is open yet. Add the <strong>TTS audio</strong> source below to
              your streaming software, or your viewers will not hear speech.
            </div>
          ) : null}

          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Size</th>
                <th>URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {overlays.map((overlay) => {
                const url = overlay.sourceUrl;
                return (
                  <tr key={overlay.id} className={overlay.enabled ? '' : 'row-disabled'}>
                    <td>
                      <strong>{overlay.name}</strong>
                      <div className="muted">
                        {overlay.type}
                        {overlay.enabled ? '' : ' (off)'}
                      </div>
                    </td>
                    <td className="mono nowrap">
                      {overlay.width}×{overlay.height}
                    </td>
                    <td className="mono url-cell">{url}</td>
                    <td className="nowrap">
                      <CopyButton text={url} />
                      <a className="btn btn-ghost" href={overlay.localUrl} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3>Hostname for copied links</h3>
          <Row>
            <Field
              label="Source hostname"
              hint={
                config.sources.host
                  ? `Copied links use http://${config.sources.host}:… instead of this page's address.`
                  : 'Leave blank for most software. Set it if yours rejects the URL — some refuse localhost and bare IP addresses alike, and want a hostname.'
              }
            >
              <TextInput
                value={config.sources.host}
                onChange={(host) => patch({ sources: { host } })}
                placeholder="(this page's address)"
              />
            </Field>
            <Field label=" ">
              <div className="button-row">
                <Button
                  onClick={() => patch({ sources: { host: 'stream.localhost.direct' } })}
                  title="A public DNS name that resolves to 127.0.0.1, so the link stays on this machine"
                  disabled={config.sources.host === 'stream.localhost.direct'}
                >
                  Use stream.localhost.direct
                </Button>
                {config.sources.host ? (
                  <Button onClick={runHostCheck} disabled={checking}>
                    {checking ? 'Checking…' : 'Re-check'}
                  </Button>
                ) : null}
              </div>
            </Field>
          </Row>

          <HostCheckBanner check={hostCheck} checking={checking} />
        </Panel>
      ) : null}

      {sub === 'remote' ? (
        <Panel
          title="Public tunnel (ngrok)"
          description="Exposes this server on a public URL so streaming software on another machine, or a co-host, can load the overlays."
          actions={
            <Button variant={tunnel?.url ? 'danger' : 'primary'} onClick={toggleTunnel} disabled={busy}>
              {tunnel?.url ? 'Stop tunnel' : 'Start tunnel'}
            </Button>
          }
        >
          {tunnel?.url ? (
            <div className="banner banner-ok">
              Public URL: <code>{tunnel.url}</code> <CopyButton text={tunnel.url} />
              {tunnel.external ? (
                <span className="muted">
                  {' '}
                  — from the ngrok agent already running on this machine. Stopping here only
                  detaches; your agent keeps running.
                </span>
              ) : null}
            </div>
          ) : null}
          {error ? <div className="banner banner-error">{error}</div> : null}
          {tunnel?.error ? <div className="banner banner-error">{tunnel.error}</div> : null}

          {/* An agent that is up but pointed elsewhere looks like a working
              tunnel right until nothing loads, so name it explicitly. */}
          {tunnel?.mismatch ? (
            <div className="banner banner-warn">
              That agent is forwarding: <code>{tunnel.mismatch}</code>
            </div>
          ) : null}

          {meta && !meta.env.hasNgrokToken ? (
            <div className="banner banner-warn">
              Add your ngrok authtoken on the Keys tab before starting the tunnel. Free tokens come
              from dashboard.ngrok.com.
            </div>
          ) : null}

          <Row>
            <Field label="Reserved domain" hint="Optional, e.g. my-stream.ngrok.app">
              <TextInput
                value={config.tunnel.domain}
                onChange={(domain) => patch({ tunnel: { domain } })}
                placeholder="(random URL)"
              />
            </Field>
          </Row>

          <CredentialField
            field={credentialField('TUNNEL_BASIC_AUTH')}
            status={statusOf('TUNNEL_BASIC_AUTH')}
            onSaved={reloadCredentials}
          />
          {tunnel?.external ? (
            <div className="banner">
              The tunnel login does not apply right now — this tunnel is your own agent. Restart it
              as <code>ngrok http 4700 --basic-auth "user:pass"</code>.
            </div>
          ) : null}
          <Toggle
            label="Open the tunnel on startup"
            checked={config.tunnel.enabled}
            onChange={(enabled) => patch({ tunnel: { enabled } })}
          />
        </Panel>
      ) : null}

      {sub === 'session' ? (
        <Panel title="This session">
          <div className="stat-grid">
            <Stat
              label="Viewers"
              value={stats?.viewerCount ?? 0}
              sub={viewerSourceNote(
                stats?.viewerCounts,
                PLATFORMS.filter((platform) => connections[platform]?.status === 'connected'),
              )}
            />
            <Stat label="Peak" value={stats?.peakViewerCount ?? 0} />
            <Stat label="Likes" value={stats?.likes ?? 0} />
            <Stat label="Diamonds" value={stats?.diamonds ?? 0} />
            <Stat label="Gifts" value={stats?.gifts ?? 0} />
            <Stat label="New follows" value={stats?.followers ?? 0} />
            <Stat label="Shares" value={stats?.shares ?? 0} />
            <Stat label="Comments" value={stats?.comments ?? 0} />
            <Stat label="Chatters" value={stats?.uniqueChatters ?? 0} />
          </div>
        </Panel>
      ) : null}
    </Page>
  );
}

/**
 * Verdict on the source hostname.
 *
 * Three outcomes are worth distinguishing, not two: reaching this machine over
 * loopback is ideal, reaching it over a real interface still works but means
 * the traffic leaves the loopback adapter, and reaching something that is not
 * this server at all is an emergency — the URLs are pointing at a stranger.
 */
function HostCheckBanner({
  check,
  checking,
}: {
  check: SourceHostCheck | null;
  checking: boolean;
}): JSX.Element | null {
  if (!check || !check.configured) return null;
  if (checking) return <div className="banner">Checking {check.host}…</div>;

  if (check.error) {
    return (
      <div className="banner banner-error">
        {check.error}
        {check.addresses.length > 0 ? (
          <>
            {' '}
            Resolved to <code>{check.addresses.join(', ')}</code>.
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="banner banner-ok">
      <code>{check.host}</code> resolves to <code>{check.addresses.join(', ')}</code> and reaches
      this server.
      {check.loopbackOnly
        ? ' Loopback only, so these URLs never leave this machine.'
        : ' Note this is not a loopback address, so the traffic goes over a real network interface.'}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string | null;
}): JSX.Element {
  return (
    <div className="stat">
      <span className="stat-value">{formatNumber(value)}</span>
      <span className="stat-label">{label}</span>
      {sub ? <span className="stat-sub muted">{sub}</span> : null}
    </div>
  );
}
