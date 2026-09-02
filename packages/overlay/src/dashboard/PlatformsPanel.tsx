import { useCallback, useEffect, useState } from 'react';
import {
  CAPABILITY_LABELS,
  MAX_CAPABILITIES,
  PLATFORM_INFO,
  PLATFORMS,
  type AppConfig,
  type AuthOverview,
  type ConnectionStatus,
  type Platform,
  type PlatformAuthState,
  type PlatformCapabilities,
} from '@streaming/shared';
import { api } from '../lib/api.js';
import { useLive } from '../lib/store.js';
import { Panel, StatusDot } from './controls.js';
import { PlatformLogo } from '../lib/PlatformLogo.js';

/**
 * One card per platform: connect, sign in, and see what that unlocks.
 *
 * Written once and driven by data rather than a card per service. The three
 * platforms differ in what they *can* do and what they need first, but the
 * shape of the answer is identical, so the shape of the UI is too.
 */

interface Props {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}

/** Everything a card needs that differs between platforms. */
interface PlatformWiring {
  /** Current handle/channel, from config. */
  handle: (config: AppConfig) => string;
  /** Persist a changed handle. */
  setHandle: (config: AppConfig, value: string) => Record<string, unknown>;
  connect: (handle: string) => Promise<unknown>;
  disconnect: () => Promise<unknown>;
  placeholder: string;
  /** Null when the platform is fully usable with no credentials. */
  note: string | null;
}

const WIRING: Record<Platform, PlatformWiring> = {
  tiktok: {
    handle: (config) => config.connection.username,
    setHandle: (config, username) => ({ connection: { ...config.connection, username } }),
    connect: (handle) => api.connect(handle),
    disconnect: () => api.disconnect(),
    placeholder: 'your TikTok @handle',
    note: 'No sign-in exists for TikTok — the live connection is read-only by nature.',
  },
  twitch: {
    handle: (config) => config.twitch.channel,
    setHandle: (config, channel) => ({ twitch: { ...config.twitch, channel } }),
    connect: (handle) => api.twitchConnect(handle),
    disconnect: () => api.twitchDisconnect(),
    placeholder: 'channel name',
    note: 'Chat reads without any sign-in. Registering an app adds avatars; signing in adds moderation.',
  },
  youtube: {
    // Optional for the same reason as the stats slice: between rebuilding the
    // dashboard and restarting the server, this section does not exist yet.
    // Reading straight through it would throw and take the whole tab down,
    // which is a far worse failure than an empty field.
    handle: (config) => config.youtube?.videoId ?? '',
    setHandle: (config, videoId) => ({ youtube: { ...(config.youtube ?? {}), videoId } }),
    connect: (handle) => api.youtubeConnect(handle),
    disconnect: () => api.youtubeDisconnect(),
    // Blank is the normal case: with no id it finds whichever broadcast on
    // your own channel is live.
    placeholder: 'blank = your live broadcast',
    note: 'Needs Google sign-in — live chat has no anonymous access. Chat is polled, so it spends daily API quota while connected.',
  },
};

export function PlatformsPanel({ config, patch }: Props): JSX.Element {
  const { snapshot } = useLive();
  const [auth, setAuth] = useState<AuthOverview | null>(null);

  const reload = useCallback(() => {
    void api
      .authPlatforms()
      .then(setAuth)
      .catch(() => undefined);
  }, []);

  useEffect(reload, [reload]);
  // The callback tab pushes an update over the socket when sign-in completes,
  // so the card flips without anyone reloading the dashboard.
  useEffect(() => {
    const unsub = api.onAuthChange(setAuth);
    return unsub;
  }, []);

  const connections = snapshot?.connections ?? {};

  return (
    <Panel
      title="Platforms"
      description="Connect each service and sign in where it unlocks more. Everything you connect feeds one chat log."
    >

      <div className="platform-grid">
        {PLATFORMS.map((platform) => (
          <PlatformCard
            key={platform}
            platform={platform}
            config={config}
            patch={patch}
            status={connections[platform]?.status ?? 'idle'}
            auth={auth?.[platform] ?? null}
            onAuthChanged={reload}
          />
        ))}
      </div>
    </Panel>
  );
}

function PlatformCard({
  platform,
  config,
  patch,
  status,
  auth,
  onAuthChanged,
}: {
  platform: Platform;
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
  status: ConnectionStatus;
  auth: PlatformAuthState | null;
  onAuthChanged: () => void;
}): JSX.Element {
  const info = PLATFORM_INFO[platform];
  const wiring = WIRING[platform];
  const [handle, setHandleLocal] = useState(() => wiring.handle(config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another dashboard (or the Connect tab) may change the handle underneath us.
  useEffect(() => setHandleLocal(wiring.handle(config)), [config, wiring]);

  const live = status === 'connected' || status === 'connecting' || status === 'reconnecting';

  const act = (run: () => Promise<unknown>): void => {
    setBusy(true);
    setError(null);
    void run()
      .then(onAuthChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const signIn = (): void => {
    setBusy(true);
    setError(null);
    void api
      .authStart(platform)
      .then(({ url }) => {
        // Opened in a tab rather than navigated: the provider's consent screen
        // is where the password gets typed, and it must be visibly on their
        // domain so it can be checked.
        window.open(url, '_blank', 'noopener');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="platform-card" style={{ borderTopColor: info.color }}>
      <div className="platform-card-head">
        <span className="platform-name" style={{ color: info.color }}>
          <PlatformLogo platform={platform} size={17} />
          {info.label}
        </span>
        <span className="platform-status">
          <StatusDot status={status} />
          {status}
        </span>
      </div>

      <input
        type="text"
        className="platform-input"
        placeholder={wiring.placeholder}
        value={handle}
        onChange={(event) => {
          setHandleLocal(event.target.value);
          patch(wiring.setHandle(config, event.target.value));
        }}
      />

      <div className="chips">
        {/*
          YouTube is the one platform with nothing to type: with no video id
          it finds whichever broadcast on your own channel is live, so an
          empty field is the normal case rather than an unfinished one.
        */}
        <button
          type="button"
          className="chip"
          disabled={busy || (platform !== 'youtube' && !handle.trim() && !live)}
          onClick={() => act(() => (live ? wiring.disconnect() : wiring.connect(handle.trim())))}
        >
          {live ? 'Disconnect' : 'Connect'}
        </button>

        {auth && platform !== 'tiktok' ? (
          auth.level === 'user' ? (
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => act(() => api.authSignOut(platform))}
            >
              Sign out{auth.account ? ` (${auth.account})` : ''}
            </button>
          ) : (
            <button
              type="button"
              className="chip chip-signin"
              disabled={busy || !auth.appConfigured}
              title={auth.appConfigured ? undefined : 'Needs client credentials in .env first'}
              onClick={signIn}
            >
              <PlatformLogo platform={platform} size={13} color="currentColor" />
              Sign in with {info.label}
            </button>
          )
        ) : null}
      </div>

      {error ? <p className="muted platform-note platform-error">{error}</p> : null}
      {platform === 'youtube' && live ? <QuotaMeter /> : null}
      {auth ? <CapabilityList platform={platform} capabilities={auth.capabilities} /> : null}
      {auth?.nextStep ? <p className="muted platform-note">{auth.nextStep}</p> : null}
      {!auth?.nextStep && wiring.note ? (
        <p className="muted platform-note">{wiring.note}</p>
      ) : null}
    </div>
  );
}

/**
 * What this connection has spent, while it is spending it.
 *
 * YouTube chat is the only connector with a budget: it is polled, every poll
 * costs quota, and a project's default allowance is 10,000 units a day shared
 * with everything else the app asks Google for. Run out and chat stops, with
 * nothing on screen having suggested it was coming.
 *
 * The call count is measured. The unit cost is not — Google does not publish
 * what the live-chat endpoints charge, and the widely repeated figure of 5 is
 * a community estimate. So the estimate is labelled as one, and the measured
 * number is the one shown first. A wrong estimate that looks like a fact is
 * worse than no estimate.
 */
function QuotaMeter(): JSX.Element | null {
  const [usage, setUsage] = useState<{ polls: number; minutes: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void api
        .youtubeUsage()
        .then((next) => {
          if (!cancelled) setUsage(next);
        })
        .catch(() => undefined);
    };
    load();
    // Half a minute: this moves slowly, and polling a quota meter quickly
    // would be its own small joke.
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!usage || usage.polls === 0) return null;

  const DAILY = 10_000;
  const PER_CALL = 5;
  const units = usage.polls * PER_CALL;
  const share = units / DAILY;
  // Per-hour from what has actually happened, not from the configured
  // interval: the API sets the real pace and it changes with chat volume.
  const perHour = usage.minutes > 0.5 ? Math.round((usage.polls / usage.minutes) * 60) : null;
  const level = share >= 0.9 ? 'error' : share >= 0.6 ? 'warn' : 'ok';

  return (
    <p className={`platform-note quota-meter quota-${level}`}>
      <strong>{usage.polls.toLocaleString()}</strong> API calls in{' '}
      {Math.round(usage.minutes)}m{perHour ? ` (~${perHour.toLocaleString()}/hr)` : ''} —{' '}
      <span title="Google does not publish the per-call cost of the live-chat endpoints; 5 units is the community estimate, so treat this as a rough guide.">
        an estimated {Math.round(share * 100)}% of a default daily quota
      </span>
      {share >= 0.6 ? '. Raise the poll interval to stretch it further.' : '.'}
    </p>
  );
}

/**
 * What this platform can do, and what it can't.
 *
 * Shows the unavailable ones too rather than hiding them — "Twitch has no
 * viewer count right now" is information; an absent row just looks like the
 * feature was forgotten. Anything the platform can never do is omitted
 * entirely, because that is not a gap you can close.
 */
function CapabilityList({
  platform,
  capabilities,
}: {
  platform: Platform;
  capabilities: PlatformCapabilities;
}): JSX.Element {
  const ceiling = MAX_CAPABILITIES[platform];
  const keys = (Object.keys(CAPABILITY_LABELS) as Array<keyof PlatformCapabilities>).filter(
    (key) => ceiling[key],
  );

  return (
    <ul className="capability-list">
      {keys.map((key) => (
        <li key={key} className={capabilities[key] ? 'cap cap-on' : 'cap cap-off'}>
          <span className="cap-mark">{capabilities[key] ? '✓' : '·'}</span>
          {CAPABILITY_LABELS[key]}
        </li>
      ))}
    </ul>
  );
}
