import { useCallback, useEffect, useState } from 'react';
import { api, type CredentialStatus } from '../lib/api.js';
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
      { key: 'TWITCH_CLIENT_ID', label: 'Client ID', placeholder: '30 characters', expect: 30 },
      { key: 'TWITCH_CLIENT_SECRET', label: 'Client Secret', placeholder: '30 characters', expect: 30 },
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
      },
      { key: 'GOOGLE_CLIENT_SECRET', label: 'Client Secret', placeholder: 'starts with GOCSPX-' },
    ],
  },
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
      { key: 'SIGN_API_KEY', label: 'Euler Stream key', placeholder: 'optional' },
      { key: 'TIKTOK_SESSION_ID', label: 'Session ID', placeholder: 'the sessionid cookie' },
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
    fields: [{ key: 'GOOGLE_TTS_API_KEY', label: 'API key', placeholder: 'starts with AIza' }],
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
    fields: [{ key: 'NGROK_AUTHTOKEN', label: 'Authtoken', placeholder: 'optional' }],
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
        <p className="muted cred-intro">
          Saved keys take effect immediately; no restart. They are written to{' '}
          <code>data/secrets.json</code>, never to <code>config.json</code> — that file is
          broadcast to every overlay. Values are never shown again once saved, including here.
        </p>
        {error ? <div className="banner banner-error">{error}</div> : null}
      </Panel>

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

      {error ? <div className="banner banner-error">{error}</div> : null}
    </div>
  );
}
