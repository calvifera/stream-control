import { useCallback, useEffect, useState } from 'react';
import { api, type CredentialStatus, type ServerMeta } from '../lib/api.js';
import { Button, CopyButton, Panel, TextInput } from './controls.js';

/**
 * Entering the API keys the app needs, without a text editor.
 *
 * This screen is the difference between software one person can run and
 * software anyone can. Every credential here has to be created by hand on
 * somebody else's website, and most of those journeys are five to ten steps
 * through a developer console built for developers. A blank field labelled
 * `GOOGLE_CLIENT_ID` is not a setup experience; it is a quiz.
 *
 * So each one carries the steps, the exact values to paste, and — most
 * importantly — an honest statement of what you get and what it costs. Two
 * of these are genuinely optional and one of them is a personal account
 * cookie, and burying that in a hint would be the wrong call.
 *
 * Values are never displayed. The server reports whether a key is set, where
 * it came from and how long it is, and that is all this screen ever knows.
 */

interface Props {
  /** The address this dashboard was loaded from, for the redirect URLs. */
  origin: string;
}

interface Field {
  key: string;
  label: string;
  placeholder: string;
  /** Roughly how long the real value is, so a bad paste is obvious. */
  expect?: number;
  /**
   * The exact hosts this value is transmitted to, and when.
   *
   * Named hosts rather than a reassurance. "We never share your data" is both
   * unfalsifiable and untrue of a credential whose entire purpose is being
   * sent somewhere — what someone actually needs is *which* somewhere, so
   * they can decide whether they mind. Kept honest by `check:network`, which
   * fails if the code ever reaches a host not listed here.
   */
  sentTo: string;
  when: string;
}

interface Group {
  id: string;
  title: string;
  /** What this unlocks, in one line. */
  unlocks: string;
  required: 'required' | 'optional' | 'recommended';
  /** The honest cost or catch. Rendered as a warning when present. */
  caveat?: string;
  steps: (origin: string) => (string | { copy: string; label: string })[];
  link: { href: string; label: string };
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    id: 'tiktok',
    title: 'TikTok',
    unlocks: 'Steadier connections, and the TikTok voices for speech.',
    required: 'optional',
    caveat:
      'The session ID is your own tiktok.com login cookie — treat it exactly like your password. It is only needed for the TikTok TTS voices; without it speech falls back to your browser’s built-in voices, and chat is unaffected either way.',
    link: { href: 'https://www.eulerstream.com', label: 'Euler Stream (free key)' },
    steps: () => [
      'Sign-key: make a free Euler Stream account and copy the API key. Without one you share a public, rate-limited quota — fine for testing, shaky on a busy stream.',
      'Session ID: log in to tiktok.com, open DevTools (F12) → Application → Cookies → https://tiktok.com, and copy the value of "sessionid".',
    ],
    fields: [
      {
        key: 'SIGN_API_KEY',
        label: 'Euler Stream key',
        placeholder: 'optional',
        sentTo: 'api.eulerstream.com',
        when: 'once per connection, to sign the stream URL. Carries the room being watched, not your account',
      },
      {
        key: 'TIKTOK_SESSION_ID',
        label: 'Session ID',
        placeholder: 'the sessionid cookie',
        sentTo: 'tiktok.com and tiktokv.com — TikTok itself, nowhere else',
        when: 'as a cookie when connecting, and on each request for a TikTok TTS voice. It is never sent to the signing service above: that needs a setting this app does not enable, and the connector refuses to do it without a separate opt-in',
      },
    ],
  },
  {
    id: 'google',
    title: 'YouTube',
    unlocks: 'Reading YouTube live chat. There is no anonymous access — this one is all or nothing.',
    required: 'required',
    caveat:
      'Leave the consent screen in "Testing" and Google revokes your sign-in every 7 days. Publish it to "In Production" — step 6 — and it lasts indefinitely. Nobody else needs to use your app for this; you are publishing it to yourself.',
    link: { href: 'https://console.cloud.google.com/', label: 'Google Cloud Console' },
    steps: (origin) => [
      'Create a project — the name is only for you.',
      'APIs & Services → Library → enable "YouTube Data API v3".',
      'APIs & Services → OAuth consent screen → External. Fill in the app name and your own email; skip everything optional.',
      'Add the scope ".../auth/youtube.force-ssl" when it asks. Ignore the "unverified app" warning — that is about other people using it, not you.',
      'Credentials → Create Credentials → OAuth client ID → Web application.',
      { label: 'Authorized redirect URI — paste exactly:', copy: `${origin}/api/auth/youtube/callback` },
      'Back on the OAuth consent screen, press "Publish app". This is the step that stops the weekly sign-out.',
    ],
    fields: [
      {
        key: 'GOOGLE_CLIENT_ID',
        label: 'Client ID',
        placeholder: 'ends in .apps.googleusercontent.com',
        sentTo: 'accounts.google.com, oauth2.googleapis.com',
        when: 'when signing in and when refreshing the token',
      },
      {
        key: 'GOOGLE_CLIENT_SECRET',
        label: 'Client Secret',
        placeholder: 'starts with GOCSPX-',
        sentTo: 'oauth2.googleapis.com',
        when: 'only when exchanging a sign-in code or refreshing a token',
      },
    ],
  },
  {
    id: 'twitch',
    title: 'Twitch',
    unlocks: 'Chat avatars, and — once you sign in — timing people out from the penalty box.',
    required: 'optional',
    caveat:
      'Twitch chat already works with none of this. Anonymous IRC reads any public channel; these only add avatars and moderation.',
    link: { href: 'https://dev.twitch.tv/console/apps', label: 'Twitch developer console' },
    steps: (origin) => [
      'Sign in and choose "Register Your Application".',
      'Name it anything — the name is only shown to you.',
      { label: 'Set the OAuth Redirect URL to exactly:', copy: `${origin}/api/auth/twitch/callback` },
      'Category: "Chat Bot". Client Type: "Confidential".',
      'Create, then open it again — the secret is only shown once, behind "New Secret".',
    ],
    fields: [
      {
        key: 'TWITCH_CLIENT_ID',
        label: 'Client ID',
        placeholder: '30 characters',
        expect: 30,
        sentTo: 'id.twitch.tv, api.twitch.tv',
        when: 'when signing in, and when looking up chat avatars',
      },
      {
        key: 'TWITCH_CLIENT_SECRET',
        label: 'Client Secret',
        placeholder: '30 characters',
        expect: 30,
        sentTo: 'id.twitch.tv',
        when: 'only when exchanging a sign-in code or refreshing a token',
      },
    ],
  },
  {
    id: 'tts',
    title: 'Google speech',
    unlocks: 'Higher-quality text-to-speech voices than the browser provides.',
    required: 'optional',
    caveat:
      'Free in practice: the monthly allowance is far more than a stream reads aloud. Restrict the key to the Text-to-Speech API — an unrestricted key works for anything on the project if it ever leaks.',
    link: { href: 'https://console.cloud.google.com/apis/credentials', label: 'Google Cloud credentials' },
    steps: () => [
      'Same project as YouTube above, if you made one.',
      'Library → enable "Cloud Text-to-Speech API".',
      'Credentials → Create Credentials → API key.',
      'Edit the key → Restrict key → select only "Cloud Text-to-Speech API".',
    ],
    fields: [
      {
        key: 'GOOGLE_TTS_API_KEY',
        label: 'API key',
        placeholder: 'starts with AIza',
        sentTo: 'texttospeech.googleapis.com',
        when: 'on each line of speech synthesized',
      },
    ],
  },
  {
    id: 'ngrok',
    title: 'Public tunnel',
    unlocks: 'Overlay URLs reachable from another machine.',
    required: 'optional',
    caveat: 'Only needed if your capture software runs on a different computer to this one.',
    link: {
      href: 'https://dashboard.ngrok.com/get-started/your-authtoken',
      label: 'ngrok authtoken',
    },
    steps: () => ['Make a free account and copy the authtoken.'],
    fields: [
      {
        key: 'NGROK_AUTHTOKEN',
        label: 'Authtoken',
        placeholder: 'optional',
        sentTo: 'ngrok.com',
        when: 'only while a tunnel is running',
      },
    ],
  },
];

export function CredentialsTab({ origin }: Props): JSX.Element {
  const [status, setStatus] = useState<CredentialStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api
      .credentials()
      .then((response) => setStatus(response.credentials))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(reload, [reload]);

  const statusOf = (key: string): CredentialStatus | undefined =>
    status.find((entry) => entry.key === key);

  return (
    <section className="panel-stack">
      <Panel
        title="Credentials"
        description="Keys for the services this connects to. Each one is created on that service's own site — the steps are below. Nothing here is sent anywhere except back to the service it belongs to."
      >
        <div className="cred-privacy">
          <p>
            <strong>This app has no server of its own.</strong> It runs entirely on this machine
            and talks only to the platforms themselves — TikTok, Twitch, Google and, if you use a
            tunnel, ngrok. There is no account to make, no telemetry, and nothing is reported to
            whoever wrote this.
          </p>
          <p>
            Every credential below says exactly which hosts it reaches and when, because a key is
            useless unless it goes <em>somewhere</em> — the useful question is where. That list is
            enforced by a test that fails if the code ever contacts a host not named on this
            screen.
          </p>
          <p className="cred-privacy-note">
            Keys are stored in <code>data/secrets.json</code> on this machine, never in{' '}
            <code>config.json</code> — that one is broadcast to every overlay browser source. Once
            saved a value is never displayed again, including here: the server reports only whether
            a key is set, where it came from and how long it is. Saved keys apply immediately, with
            no restart.
          </p>
        </div>
        {error ? <div className="banner banner-error">{error}</div> : null}
      </Panel>

      <AccessPanel statusOf={statusOf} onSaved={reload} />

      {GROUPS.map((group) => (
        <CredentialGroup
          key={group.id}
          group={group}
          origin={origin}
          statusOf={statusOf}
          onSaved={reload}
        />
      ))}
    </section>
  );
}

function CredentialGroup({
  group,
  origin,
  statusOf,
  onSaved,
}: {
  group: Group;
  origin: string;
  statusOf: (key: string) => CredentialStatus | undefined;
  onSaved: () => void;
}): JSX.Element {
  const configured = group.fields.every((field) => statusOf(field.key)?.configured);

  return (
    <Panel title={group.title} description={group.unlocks}>
      <div className="cred-head">
        <span className={`cred-tag cred-tag-${group.required}`}>{group.required}</span>
        {configured ? <span className="cred-done">configured</span> : null}
        <a className="cred-link" href={group.link.href} target="_blank" rel="noreferrer noopener">
          {group.link.label} ↗
        </a>
      </div>

      {group.caveat ? <div className="banner banner-warn cred-caveat">{group.caveat}</div> : null}

      <ol className="cred-steps">
        {group.steps(origin).map((step, index) =>
          typeof step === 'string' ? (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index}>{step}</li>
          ) : (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index}>
              {step.label}
              <span className="cred-copy">
                <code>{step.copy}</code>
                <CopyButton text={step.copy} />
              </span>
            </li>
          ),
        )}
      </ol>

      {group.fields.map((field) => (
        <CredentialField
          key={field.key}
          field={field}
          status={statusOf(field.key)}
          onSaved={onSaved}
        />
      ))}
    </Panel>
  );
}

function CredentialField({
  field,
  status,
  onSaved,
}: {
  field: Field;
  status: CredentialStatus | undefined;
  onSaved: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    setBusy(true);
    setError(null);
    void api
      .setCredential(field.key, draft)
      .then(() => {
        // Cleared rather than left in the box: the value is saved, and leaving
        // a secret sitting in an input where a screen share would catch it
        // serves no purpose once it is stored.
        setDraft('');
        onSaved();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    setBusy(true);
    void api
      .clearCredential(field.key)
      .then(onSaved)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  /*
   * A length mismatch is the one piece of feedback possible without showing
   * the value, and it catches the most common paste error by far — a trailing
   * space, or half a selection.
   */
  const wrongLength =
    status?.configured && field.expect !== undefined && status.length !== field.expect;

  return (
    <div className="cred-field">
      <div className="cred-field-head">
        <span className="cred-field-label">{field.label}</span>
        {status?.configured ? (
          <span className={wrongLength ? 'cred-state cred-state-warn' : 'cred-state'}>
            set · {status.length} chars
            {status.source === 'env' ? ' · from .env' : ''}
            {wrongLength ? ` · expected ${field.expect}` : ''}
          </span>
        ) : (
          <span className="cred-state cred-state-missing">not set</span>
        )}
      </div>

      <div className="cred-field-row">
        <TextInput
          value={draft}
          onChange={setDraft}
          placeholder={status?.configured ? 'enter a new value to replace it' : field.placeholder}
          type="password"
          // No debounce: the default one waits 300ms after the last keystroke,
          // and pasting a key then immediately clicking Save is exactly the
          // sequence that would drop the tail of it.
          delay={0}
        />
        <Button variant="primary" disabled={busy || !draft.trim()} onClick={save}>
          Save
        </Button>
        {status?.source === 'dashboard' ? (
          <Button disabled={busy} onClick={remove}>
            Clear
          </Button>
        ) : null}
      </div>

      <p className="cred-usage">
        <span className="cred-usage-label">Sent to</span> {field.sentTo}
        <br />
        <span className="cred-usage-label">When</span> {field.when}
      </p>

      {error ? <div className="banner banner-error">{error}</div> : null}
    </div>
  );
}

/**
 * Who can reach this dashboard, and what a password does about it.
 *
 * Two separate things get confused constantly, and the confusion runs in the
 * dangerous direction — people assume a password means nobody can reach it.
 *
 *   - The **binding** decides who can open the page at all. `0.0.0.0` means
 *     anyone on the same network: a flatmate, a hotel, a café.
 *   - The **password** decides who can change anything once they have.
 *
 * Neither substitutes for the other, and there is a third fact that surprises
 * people: overlay URLs stay open either way, because streaming software cannot
 * log in.
 */
function AccessPanel({
  statusOf,
  onSaved,
}: {
  statusOf: (key: string) => CredentialStatus | undefined;
  onSaved: () => void;
}): JSX.Element {
  const [meta, setMeta] = useState<ServerMeta | null>(null);

  useEffect(() => {
    void api
      .meta()
      .then(setMeta)
      .catch(() => undefined);
  }, [statusOf('DASHBOARD_PASSWORD')?.configured]);

  const net = meta?.network;
  const exposed = net ? !net.loopbackOnly : false;
  const passworded = statusOf('DASHBOARD_PASSWORD')?.configured ?? false;

  return (
    <Panel
      title="Access to this dashboard"
      description="Everything here runs on this machine. This is about who else can open it."
    >
      {net ? (
        <div className={exposed && !passworded ? 'banner banner-warn' : 'banner'}>
          {exposed ? (
            <>
              <strong>Anyone on your network can open this dashboard.</strong> It is bound to{' '}
              <code>{net.host}</code>, which means every device on the same Wi-Fi or LAN can reach{' '}
              <code>
                {'http://<this machine>:'}
                {net.port}
              </code>
              .{' '}
              {passworded
                ? 'They will need the password to change anything.'
                : 'With no password set, they can change anything you can — connections, filters, the penalty box.'}
            </>
          ) : (
            <>
              <strong>Only this machine can open this dashboard.</strong> It is bound to{' '}
              <code>{net.host}</code>, so nothing on your network can reach it at all. A password
              adds little on top of that.
            </>
          )}
        </div>
      ) : null}

      <div className="access-grid">
        <div>
          <h4>A password</h4>
          <p>
            Controls who can <em>change</em> things once they can reach the page. Set one if you
            stream from shared Wi-Fi, or if anyone else uses this machine.
          </p>
        </div>
        <div>
          <h4>The network binding</h4>
          <p>
            Controls who can <em>reach</em> the page at all — a stronger guarantee, and not
            something a password can give you. Set <code>HOST=127.0.0.1</code> in your{' '}
            <code>.env</code> and restart to close it to everything but this computer.
          </p>
        </div>
        <div>
          <h4>Overlays either way</h4>
          <p>
            Overlay URLs stay reachable with or without a password, because streaming software has no
            way to log in. A password protects control, never the event stream.
          </p>
        </div>
      </div>

      <CredentialField
        field={{
          key: 'DASHBOARD_PASSWORD',
          label: 'Dashboard password',
          placeholder: passworded ? 'enter a new password to replace it' : 'leave empty for none',
          sentTo: 'nowhere — it never leaves this machine',
          when: 'compared locally when someone logs in. It is the one credential here that is not sent to any service',
        }}
        status={statusOf('DASHBOARD_PASSWORD')}
        onSaved={onSaved}
      />

      <p className="muted access-note">
        Setting a password takes effect at once, and you stay signed in on this browser. Anyone
        else — including you on another device — will be asked for it. Clearing it removes the
        login entirely.
      </p>
    </Panel>
  );
}
