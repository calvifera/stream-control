import { useEffect, useState } from 'react';
import {
  PLATFORMS,
  viewerSourceNote,
  type AppConfig,
  type SourceHostCheck,
} from '@streaming/shared';
import { api, type OverlayWithUrls, type ServerMeta } from '../lib/api.js';
import { useLive } from '../lib/store.js';
import { Button, CopyButton, Field, Panel, Row, StatusDot, TextInput, Toggle } from './controls.js';
import { formatNumber } from '../overlay/style.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
  meta: ServerMeta | null;
}

export function ConnectTab({ config, patch, meta }: Props): JSX.Element {
  const { snapshot, stats } = useLive();
  // Driven straight from the config rather than local state: the handle is a
  // stream setting, not a scratch value. "Connect on startup" reads it, so it
  // has to be saved when you type it, not only when you press Connect.
  const username = config.connection.username;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<OverlayWithUrls[]>([]);
  const [hostCheck, setHostCheck] = useState<SourceHostCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const connection = snapshot?.connection;
  const connections = snapshot?.connections ?? {};
  const tunnel = snapshot?.tunnel;
  const connected = connection?.status === 'connected';

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

  const handleConnect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (connected) await api.disconnect();
      else await api.connect(username.trim().replace(/^@/, ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <>
      <Panel
        title="TikTok connection"
        description="Connect to any live room by @handle. You do not need to be the host to read a room, but gating on followers and subscribers is most useful on your own stream."
      >
        <Row>
          <Field label="Username" hint="Without the @">
            <TextInput
              value={username}
              onChange={(next) => patch({ connection: { username: next.trim() } })}
              placeholder="yourhandle"
            />
          </Field>
          <Field label=" ">
            <Button variant={connected ? 'danger' : 'primary'} onClick={handleConnect} disabled={busy}>
              {connected ? 'Disconnect' : 'Connect'}
            </Button>
          </Field>
        </Row>

        <div className="status-line">
          <StatusDot status={connection?.status ?? 'idle'} />
          <strong>{connection?.status ?? 'idle'}</strong>
          {connection?.roomId ? <span className="muted">room {connection.roomId}</span> : null}
          {connection?.reconnectAttempts ? (
            <span className="muted">retry #{connection.reconnectAttempts}</span>
          ) : null}
          {connection?.lastError ? <span className="error-text">{connection.lastError}</span> : null}
        </div>

        {error ? <div className="banner banner-error">{error}</div> : null}

        <Row>
          <Toggle
            label="Reconnect automatically"
            hint="Also retries while the host is offline, so you can start this before going live"
            checked={config.connection.autoReconnect}
            onChange={(autoReconnect) => patch({ connection: { autoReconnect } })}
          />
          <Toggle
            label="Connect on startup"
            checked={config.connection.connectOnStartup}
            onChange={(connectOnStartup) => patch({ connection: { connectOnStartup } })}
          />
          <Toggle
            label="Fetch extended gift info"
            hint="Needed for diamond values and gift images"
            checked={config.connection.enableExtendedGiftInfo}
            onChange={(enableExtendedGiftInfo) => patch({ connection: { enableExtendedGiftInfo } })}
          />
        </Row>

        {meta && !meta.env.hasSignApiKey ? (
          <div className="banner">
            No <code>SIGN_API_KEY</code> set. The connector is using a shared, rate-limited signing
            quota — fine to start with, but get a free key at eulerstream.com if connecting starts
            failing.
          </div>
        ) : null}
      </Panel>

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

      <Panel
        title="Browser source URLs"
        description="Add these as Browser Sources at the listed size. When the capture software runs on this machine, no tunnel is needed."
      >
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
            <Button
              onClick={() => patch({ sources: { host: 'stream.localhost.direct' } })}
              title="A public DNS name that resolves to 127.0.0.1, so the link stays on this machine"
              disabled={config.sources.host === 'stream.localhost.direct'}
            >
              Use stream.localhost.direct
            </Button>
          </Field>
          {config.sources.host ? (
            <Field label=" ">
              <Button onClick={runHostCheck} disabled={checking}>
                {checking ? 'Checking…' : 'Re-check'}
              </Button>
            </Field>
          ) : null}
        </Row>

        <HostCheckBanner check={hostCheck} checking={checking} />

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
                    <div className="muted">{overlay.type}</div>
                  </td>
                  <td className="mono">
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
      </Panel>

      <Panel
        title="Public tunnel (ngrok)"
        description="Exposes this server on a public URL so streaming software on another machine — or a co-host — can load the overlays."
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
                — from the ngrok agent already running on this machine. Stopping here only
                detaches; your agent keeps running.
              </span>
            ) : null}
          </div>
        ) : null}
        {tunnel?.error ? <div className="banner banner-error">{tunnel.error}</div> : null}

        {/* An agent that is up but pointed elsewhere looks like a working
            tunnel right until nothing loads, so name it explicitly. */}
        {tunnel?.mismatch ? (
          <div className="banner">
            That agent is forwarding: <code>{tunnel.mismatch}</code>
          </div>
        ) : null}

        {meta && !meta.env.hasNgrokToken ? (
          <div className="banner">
            Set <code>NGROK_AUTHTOKEN</code> in <code>.env</code> before starting the tunnel. Free
            tokens come from dashboard.ngrok.com.
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
          <Field
            label="Basic auth"
            hint={
              tunnel?.external
                ? 'Does NOT apply right now — this tunnel is your own agent. Restart it as `ngrok http 4700 --basic-auth "user:pass"`.'
                : 'user:password — strongly recommended, this exposes the whole dashboard'
            }
          >
            <TextInput
              value={config.tunnel.basicAuth}
              onChange={(basicAuth) => patch({ tunnel: { basicAuth } })}
              placeholder="streamer:secret"
            />
          </Field>
        </Row>
        <Toggle
          label="Open the tunnel on startup"
          checked={config.tunnel.enabled}
          onChange={(enabled) => patch({ tunnel: { enabled } })}
        />
      </Panel>
    </>
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


