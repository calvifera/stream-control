import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PLATFORM_INFO,
  viewerKey,
  type StreamUser,
  type TrustBand,
  type ViewerProfile,
} from '@streaming/shared';
import { api } from '../lib/api.js';
import { PlatformLogo } from '../lib/PlatformLogo.js';
import { inPanelShell } from '../lib/panelWindow.js';

/**
 * What you see when you click someone in the chat log.
 *
 * Built for a glance while playing: who they are, whether to worry about
 * them, and what they have done this stream, with the moderation actions one
 * click away.
 */

const BAND_LABEL: Record<TrustBand, string> = {
  low: 'Low trust',
  new: 'New viewer',
  neutral: 'Neutral',
  regular: 'Regular',
  trusted: 'Trusted',
};

interface Props {
  user: StreamUser;
  /**
   * Changes whenever this viewer does something new, which refetches the
   * card so its numbers keep up while it stays open.
   */
  refreshKey: string | null;
  onClose: () => void;
}

export function ViewerCard({ user, refreshKey, onClose }: Props): JSX.Element {
  const key = viewerKey(user.platform, user.uniqueId);
  const [profile, setProfile] = useState<ViewerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const card = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    void api
      .viewerProfile(key)
      .then((next) => {
        setProfile(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [key]);

  useEffect(() => {
    setProfile(null);
    setNote(null);
  }, [key]);

  useEffect(load, [load, refreshKey]);

  // Escape or a press outside the card closes it. The card can live in the
  // pop-out window's document, so listen on whichever document holds it.
  useEffect(() => {
    const doc = card.current?.ownerDocument ?? document;
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (card.current && !card.current.contains(target)) onClose();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    // Deferred a tick, so the click that opened the card doesn't close it.
    const timer = window.setTimeout(() => doc.addEventListener('pointerdown', away), 0);
    doc.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(timer);
      doc.removeEventListener('pointerdown', away);
      doc.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  const act = (label: string, action: () => Promise<unknown>) => (): void => {
    setBusy(true);
    void action()
      .then(() => {
        setNote(label);
        window.setTimeout(() => setNote(null), 1400);
        load();
      })
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const openProfile = (): void => {
    if (!profile?.profileUrl) return;
    // The desktop panel can't open a browser tab itself, so the server opens
    // it on this machine. A browser tab opens the link directly.
    if (inPanelShell()) {
      void api.openViewerProfile(key).catch((err: unknown) =>
        setNote(err instanceof Error ? err.message : String(err)),
      );
    } else {
      window.open(profile.profileUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const copy = (): void => {
    void navigator.clipboard
      .writeText(`@${user.uniqueId}`)
      .then(() => {
        setNote('copied');
        window.setTimeout(() => setNote(null), 1200);
      })
      .catch(() => undefined);
  };

  const info = PLATFORM_INFO[user.platform];
  const avatar = profile?.avatarUrl ?? user.avatarUrl;
  const name = profile?.displayName ?? user.nickname;

  return (
    <div className="vcard" ref={card} role="dialog" aria-label={`${name} profile`}>
      <div className="vcard-head" style={{ borderTopColor: info.color }}>
        {avatar ? (
          <img className="vcard-avatar" src={avatar} alt="" decoding="async" />
        ) : (
          <span
            className="vcard-avatar vcard-avatar-fallback"
            style={{ background: info.color, color: info.contrast }}
            aria-hidden="true"
          >
            {(name || '?').trim().charAt(0).toUpperCase() || '?'}
          </span>
        )}
        <div className="vcard-who">
          <div className="vcard-name">{name}</div>
          <div className="vcard-handle">
            <PlatformLogo platform={user.platform} size={12} labelled />
            <span>@{user.uniqueId}</span>
          </div>
          <div className="vcard-badges">
            {profile?.trusted ? <span className="vcard-badge vcard-badge-good">Trusted</span> : null}
            {profile?.muted ? <span className="vcard-badge vcard-badge-bad">Muted</span> : null}
            {profile?.moderator ? <span className="vcard-badge">Mod</span> : null}
            {profile?.subscriber ? <span className="vcard-badge">Sub</span> : null}
            {profile?.follower ? <span className="vcard-badge">Follows</span> : null}
            {profile?.verified ? <span className="vcard-badge">Verified</span> : null}
            {profile && profile.followerCount > 0 ? (
              <span className="vcard-badge">{compact(profile.followerCount)} followers</span>
            ) : null}
          </div>
        </div>
        <button type="button" className="vcard-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>

      {error && !profile ? <p className="vcard-empty">{error}</p> : null}
      {!error && !profile ? <p className="vcard-empty">Loading…</p> : null}

      {profile ? (
        <div className="vcard-body">
          <TrustMeter profile={profile} />

          <section className="vcard-section">
            <h4>This stream</h4>
            <div className="vcard-stats">
              <Stat label="Messages" value={profile.session.messages} />
              <Stat label="Gifts" value={profile.session.gifts} />
              <Stat label="Diamonds" value={profile.session.diamonds} />
              <Stat label="Likes" value={profile.session.likes} />
              <Stat label="Filtered" value={profile.session.filtered} warn />
              <Stat label="Not read" value={profile.session.held} warn />
            </div>
            {profile.session.firstSeen ? (
              <p className="vcard-note">First message {ago(profile.session.firstSeen)}</p>
            ) : null}
          </section>

          {profile.lifetime ? (
            <section className="vcard-section">
              <h4>All streams</h4>
              <div className="vcard-stats">
                <Stat label="Days seen" value={profile.lifetime.daysSeen} />
                <Stat label="Messages" value={profile.lifetime.messages} />
                <Stat label="Diamonds" value={profile.lifetime.diamonds} />
                <Stat label="Strikes" value={profile.lifetime.strikes} warn />
              </div>
              <p className="vcard-note">First seen {formatDate(profile.lifetime.firstSeen)}</p>
            </section>
          ) : null}

          {profile.recent.length > 0 ? (
            <section className="vcard-section">
              <h4>Recent messages</h4>
              <ul className="vcard-recent">
                {profile.recent.map((message) => (
                  <li
                    key={message.ts}
                    className={
                      message.severity === 'severe'
                        ? 'vcard-msg vcard-msg-severe'
                        : message.filtered || message.held
                          ? 'vcard-msg vcard-msg-flagged'
                          : 'vcard-msg'
                    }
                    title={message.held ?? undefined}
                  >
                    <time>{clock(message.ts)}</time>
                    <span>{message.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="vcard-actions">
        {note ? <span className="vcard-flash">{note}</span> : null}
        <button type="button" onClick={openProfile} disabled={!profile?.profileUrl}>
          Open on {info.label}
        </button>
        <button type="button" onClick={copy}>
          Copy @
        </button>
        {profile ? (
          <>
            <button
              type="button"
              disabled={busy}
              className={profile.muted ? 'is-on' : undefined}
              onClick={
                profile.muted
                  ? act('unmuted', () => api.pardonUser(key))
                  : act('muted', () => api.penalizeUser(key, 'Muted from chat log', name))
              }
            >
              {profile.muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              disabled={busy}
              className={profile.trusted ? 'is-on' : undefined}
              onClick={
                profile.trusted
                  ? act('untrusted', () => api.untrustUser(key))
                  : act('trusted', () => api.trustUser(key, name))
              }
            >
              {profile.trusted ? 'Untrust' : 'Trust'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TrustMeter({ profile }: { profile: ViewerProfile }): JSX.Element {
  const { score, band, strict, factors } = profile.trust;
  return (
    <section className="vcard-section">
      <div className="vcard-trust-head">
        <h4>Trust</h4>
        <span className={`vcard-trust-band vcard-trust-${band}`}>
          {BAND_LABEL[band]} · {score}
        </span>
      </div>
      <div className="vcard-trust-track" aria-hidden="true">
        <span className={`vcard-trust-fill vcard-trust-${band}`} style={{ width: `${score}%` }} />
      </div>
      {strict ? (
        <p className="vcard-note">
          Strict mode: oddly spelled messages and sound-alikes of severe terms aren't read aloud.
        </p>
      ) : null}
      {factors.length > 0 ? (
        <ul className="vcard-factors">
          {factors.slice(0, 6).map((factor) => (
            <li key={factor.label}>
              <span>{factor.label}</span>
              <em className={factor.delta > 0 ? 'vcard-plus' : 'vcard-minus'}>
                {factor.delta > 0 ? `+${factor.delta}` : factor.delta}
              </em>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: number; warn?: boolean }): JSX.Element {
  return (
    <div className={warn && value > 0 ? 'vcard-stat vcard-stat-warn' : 'vcard-stat'}>
      <strong>{compact(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

const compact = (value: number): string =>
  value >= 10_000 ? new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value) : String(value);

const clock = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const formatDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function ago(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min ago`;
}
