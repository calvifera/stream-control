import { useMemo, useState } from 'react';
import {
  DEFAULT_TRUST,
  displayHandle,
  listKey,
  PLATFORM_INFO,
  PLATFORMS,
  readViewerKey,
  NEUTRAL_VOICE_PROFILE,
  settingsFor,
  type AppConfig,
  type PenaltyEntry,
  type Platform,
  type TrustConfig,
  type TtsProvider,
  type UserVoiceProfile,
  type VoiceSettings,
} from '@streaming/shared';
import { api, type UserSearchResult, type VoiceProfilePatch } from '../lib/api.js';
import { AvatarPanel } from './AvatarPanel.js';
import { useKnownUsers } from '../lib/useKnownUsers.js';
import { useVoices } from '../lib/useVoices.js';
import {
  Button,
  Field,
  ListEditor,
  NumberInput,
  Panel,
  Row,
  ScrollNumber,
  Select,
  TextInput,
  Toggle,
} from './controls.js';
import { UserPicker } from './UserPicker.js';
import { PlatformLogo } from '../lib/PlatformLogo.js';
import { Page, SubTabs, useSubTab } from './layout.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
}

const SUBS = ['viewers', 'automatic', 'enforcement'] as const;

export function PeopleTab({ config, patch }: Props): JSX.Element {
  const [sub, setSub] = useSubTab('people', 'viewers', SUBS);
  const users = config.users;
  const [error, setError] = useState<string | null>(null);

  const run = (action: Promise<unknown>): void => {
    setError(null);
    void action.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <Page
      title="Viewers"
      lead="Who is allowed, who is muted, and who has their own voice, all in one list. Everyone is identified by platform and handle, so a mute on Twitch never silences a TikTok stranger with the same name."
    >
      {error ? <div className="banner banner-error app-banner">{error}</div> : null}

      <SubTabs
        label="Viewer sections"
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'viewers', label: 'Viewers', note: countViewers(users) || null },
          { id: 'automatic', label: 'Automatic protection' },
          { id: 'enforcement', label: 'Platform enforcement' },
        ]}
      />

      {sub === 'viewers' ? (
        <>
          <ViewersTable config={config} run={run} />
          <AvatarPanel />
        </>
      ) : null}

      {sub === 'automatic' ? (
        <>
          <TrustPanel config={config} patch={patch} />
          <AutoPenaltyPanel config={config} patch={patch} />
          <SevereTermsPanel config={config} patch={patch} />
        </>
      ) : null}

      {sub === 'enforcement' ? (
        <>
          <TwitchModerationPanel config={config} patch={patch} />
          <YouTubeModerationPanel config={config} patch={patch} />
        </>
      ) : null}
    </Page>
  );
}

function viewerKeys(users: AppConfig['users']): string[] {
  const keys = new Set<string>();
  for (const entry of users.trusted) keys.add(listKey(entry));
  for (const entry of users.penaltyBox) keys.add(listKey(entry.username));
  for (const profile of users.voiceProfiles) keys.add(listKey(profile.username));
  return [...keys];
}

function countViewers(users: AppConfig['users']): number {
  return viewerKeys(users).length;
}

/* ------------------------------------------------------------------ *
 * The viewers table
 *
 * Three lists used to live on three tabs: the allow list, the penalty box and
 * per-user voices. They were all the same thing, a viewer with something set
 * on them, so a person who was allowed, had their own voice and had once been
 * muted appeared in three places. This is one list of people; what is set on
 * each of them is a column and, once a row is open, a form.
 * ------------------------------------------------------------------ */

interface ViewerRow {
  key: string;
  platform: Platform;
  name: string;
  handle: string;
  avatarUrl: string | null;
  allowed: boolean;
  penalty: PenaltyEntry | null;
  profile: UserVoiceProfile | null;
  detail: UserSearchResult | undefined;
}

type StatusFilter = 'all' | 'allowed' | 'muted' | 'voice';
type AddAs = 'allowed' | 'muted' | 'voice';

function ViewersTable({
  config,
  run,
}: {
  config: AppConfig;
  run: (action: Promise<unknown>) => void;
}): JSX.Element {
  const users = config.users;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [search, setSearch] = useState('');
  const [addAs, setAddAs] = useState<AddAs>('allowed');

  const keys = useMemo(() => viewerKeys(users), [users]);
  const known = useKnownUsers(keys);

  const rows = useMemo<ViewerRow[]>(() => {
    const trusted = new Set(users.trusted.map(listKey));
    const penalties = new Map(users.penaltyBox.map((entry) => [listKey(entry.username), entry]));
    const profiles = new Map(users.voiceProfiles.map((profile) => [listKey(profile.username), profile]));

    return keys
      .map((key) => {
        const detail = known.get(key);
        const penalty = penalties.get(key) ?? null;
        const profile = profiles.get(key) ?? null;
        const handle = displayHandle(key);
        return {
          key,
          platform: readViewerKey(key).platform,
          name: detail?.displayName ?? penalty?.displayName ?? profile?.displayName ?? handle.replace(/^@/, ''),
          handle,
          avatarUrl: detail?.avatarUrl ?? null,
          allowed: trusted.has(key),
          penalty,
          profile,
          detail,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [keys, known, users]);

  const counts = {
    all: rows.length,
    allowed: rows.filter((row) => row.allowed).length,
    muted: rows.filter((row) => row.penalty).length,
    voice: rows.filter((row) => row.profile).length,
  };

  const needle = search.trim().toLowerCase();
  const shown = rows
    .filter((row) => (platform === 'all' ? true : row.platform === platform))
    .filter((row) =>
      status === 'all'
        ? true
        : status === 'allowed'
          ? row.allowed
          : status === 'muted'
            ? row.penalty !== null
            : row.profile !== null,
    )
    .filter((row) => (needle ? `${row.name} ${row.handle}`.toLowerCase().includes(needle) : true));

  const add = (picked: { key: string; displayName: string }): void => {
    const key = listKey(picked.key);
    if (addAs === 'allowed') run(api.trustUser(picked.key, picked.displayName));
    else if (addAs === 'muted') run(api.penalizeUser(picked.key, 'Added manually', picked.displayName));
    else {
      run(api.setUserVoice({ username: picked.key, displayName: picked.displayName }));
      setOpenKey(key);
    }
    setStatus('all');
    setPlatform('all');
    setSearch('');
  };

  return (
    <Panel
      title="Viewers"
      description="Anyone with an access setting or a voice of their own. Open a row to change what is set on them."
    >
      <div className="viewers-add">
        <Field label="Add someone as">
          <Select
            value={addAs}
            onChange={setAddAs}
            options={[
              { value: 'allowed', label: 'Allowed (allow list)' },
              { value: 'muted', label: 'Muted from speech' },
              { value: 'voice', label: 'Own voice' },
            ]}
          />
        </Field>
        <Field label="Find in your chat history">
          <UserPicker placeholder="Search by name or handle…" onPick={add} />
        </Field>
      </div>

      <div className="viewers-toolbar">
        <input
          className="input"
          type="search"
          value={search}
          placeholder="Search these viewers"
          aria-label="Search these viewers"
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="input viewers-platform"
          aria-label="Platform"
          value={platform}
          onChange={(event) => setPlatform(event.target.value as Platform | 'all')}
        >
          <option value="all">All platforms</option>
          {PLATFORMS.map((id) => (
            <option key={id} value={id}>
              {PLATFORM_INFO[id].label}
            </option>
          ))}
        </select>
        <div className="chips" role="group" aria-label="Show">
          {(
            [
              ['all', 'Everyone'],
              ['allowed', 'Allowed'],
              ['muted', 'Muted'],
              ['voice', 'Own voice'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={status === id ? 'chip chip-on' : 'chip'} onClick={() => setStatus(id)}>
              {label} {counts[id]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted">Nobody yet. Add someone above, or use the Allow and Mute buttons beside a message in the chat log.</p>
      ) : shown.length === 0 ? (
        <p className="muted">Nobody matches.</p>
      ) : (
        <div className="table-wrap">
          <table className="table viewers-table">
            <thead>
              <tr>
                <th scope="col">Viewer</th>
                <th scope="col">Platform</th>
                <th scope="col">Access</th>
                <th scope="col">Voice</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const open = openKey === row.key;
                return [
                  <tr key={row.key} className={open ? 'viewer-row viewer-row-open' : 'viewer-row'}>
                    <td data-label="Viewer">
                      <div className="viewer-cell">
                        {row.avatarUrl ? (
                          <img src={row.avatarUrl} alt="" className="person-avatar" />
                        ) : (
                          <span className="person-avatar person-avatar-blank" />
                        )}
                        <div className="viewer-names">
                          <button type="button" className="rules-name" aria-expanded={open} onClick={() => setOpenKey(open ? null : row.key)}>
                            {row.name}
                          </button>
                          <span className="rules-cell-sub">{row.handle}</span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Platform">
                      <span className="viewer-platform">
                        <PlatformLogo platform={row.platform} size={13} />
                        {PLATFORM_INFO[row.platform].label}
                      </span>
                    </td>
                    <td data-label="Access">
                      <div className="vtags">
                        {row.allowed ? <span className="vtag">Allowed</span> : null}
                        {row.penalty ? (
                          <span className="vtag vtag-muted">{row.penalty.automatic ? 'Muted (automatic)' : 'Muted'}</span>
                        ) : null}
                        {!row.allowed && !row.penalty ? <span className="rules-cell-sub">Normal</span> : null}
                      </div>
                    </td>
                    <td data-label="Voice">
                      {row.profile ? <span className="vtag">Own voice</span> : <span className="rules-cell-sub">Follows the rule</span>}
                    </td>
                    <td className="viewer-col-open">
                      <Button variant={open ? 'primary' : 'default'} onClick={() => setOpenKey(open ? null : row.key)}>
                        {open ? 'Done' : 'Edit'}
                      </Button>
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${row.key}:detail`} className="viewer-detail-row">
                      <td colSpan={5}>
                        <ViewerDetail row={row} config={config} run={run} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ViewerDetail({
  row,
  config,
  run,
}: {
  row: ViewerRow;
  config: AppConfig;
  run: (action: Promise<unknown>) => void;
}): JSX.Element {
  const profile =
    row.profile ??
    ({ ...NEUTRAL_VOICE_PROFILE, username: row.key, displayName: row.name } as UserVoiceProfile);

  return (
    <div className="viewer-detail">
      {row.detail ? (
        <p className="muted viewer-seen">
          {row.detail.messages} message{row.detail.messages === 1 ? '' : 's'}
          {row.detail.lastSeen ? ` · last seen ${new Date(row.detail.lastSeen).toLocaleDateString()}` : ''}
          {row.detail.strikes > 0 ? ` · ${row.detail.strikes} strike${row.detail.strikes === 1 ? '' : 's'}` : ''}
        </p>
      ) : null}

      <div className="viewer-section">
        <h3>Access</h3>
        <Toggle
          label="On the allow list"
          hint="Skips every rule's viewer conditions and every cooldown, and is spoken even when only the allow list is. Adding someone also lifts a mute and clears their strikes."
          checked={row.allowed}
          onChange={(on) => run(on ? api.trustUser(row.key, row.name) : api.untrustUser(row.key))}
        />
        <Toggle
          label="Muted from speech"
          hint={
            row.penalty
              ? `${row.penalty.automatic ? 'Automatic' : 'Manual'} · ${new Date(row.penalty.addedAt).toLocaleString()} · ${row.penalty.reason}`
              : 'Their messages still show in chat and count toward stats; they are never read aloud. Muting also takes them off the allow list.'
          }
          checked={row.penalty !== null}
          onChange={(on) =>
            run(on ? api.penalizeUser(row.key, 'Muted from the viewers list', row.name) : api.pardonUser(row.key))
          }
        />
        {row.penalty?.evidence ? <span className="person-evidence mono">“{row.penalty.evidence}”</span> : null}
      </div>

      <div className="viewer-section">
        <h3>Voice</h3>
        <Toggle
          label="Own voice settings"
          hint={
            row.profile
              ? summarize(row.profile, config.tts.provider)
              : 'Off: this person is read with whatever voice the matching rule uses. Turning it on lets you pick a voice, speed and pitch for them.'
          }
          checked={row.profile !== null}
          onChange={(on) =>
            run(
              on
                ? api.setUserVoice({ username: row.key, displayName: row.name })
                : api.clearUserVoice(row.key),
            )
          }
        />
        {row.profile ? (
          <VoiceProfileEditor
            profile={profile}
            globalProvider={config.tts.provider}
            onChange={(next) => run(api.setUserVoice({ ...next, username: row.key }))}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Automatic protection
 * ------------------------------------------------------------------ */

function AutoPenaltyPanel({
  config,
  patch,
}: {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}): JSX.Element {
  const users = config.users;
  const set = (over: Partial<typeof users.autoPenalty>): void =>
    patch({ users: { autoPenalty: { ...users.autoPenalty, ...over } } });

  return (
    <Panel
      title="Automatic penalties"
      description="Strikes are only recorded for the severe list below, and by default only when someone disguises the term to get past the filter. Ordinary swearing never lands anyone here."
    >
      <Row>
        <Toggle label="Enabled" checked={users.autoPenalty.enabled} onChange={(enabled) => set({ enabled })} />
        <Toggle
          label="Only count disguised attempts"
          hint="Cross-script, homoglyph or mixed-script spellings. Off means plainly typing a severe term also counts."
          checked={users.autoPenalty.onlyCountEvasion}
          onChange={(onlyCountEvasion) => set({ onlyCountEvasion })}
        />
        <Toggle
          label="People on the allow list are exempt"
          checked={users.autoPenalty.exemptTrusted}
          onChange={(exemptTrusted) => set({ exemptTrusted })}
        />
        <Field label="Strikes before muting" hint="1 mutes on the first attempt">
          <NumberInput
            value={users.autoPenalty.strikesBeforePenalty}
            onChange={(strikesBeforePenalty) => set({ strikesBeforePenalty })}
            min={1}
            max={20}
          />
        </Field>
      </Row>
    </Panel>
  );
}

function SevereTermsPanel({
  config,
  patch,
}: {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}): JSX.Element {
  const users = config.users;

  return (
    <Panel
      title="Severe terms"
      description="The zero-tolerance list. Separate from the ordinary blocklist on purpose: these are the terms worth tracking a person over. Matches always drop the whole message, never censor it."
    >
      <Row>
        <Field label="Words" hint="Whole-word matches, checked against every romanized view">
          <ListEditor
            values={users.severe.words}
            onChange={(words) => patch({ users: { severe: { ...users.severe, words } } })}
            placeholder="one term per line"
          />
        </Field>
        <Field label="Phrases" hint="Matched anywhere, can span words">
          <ListEditor
            values={users.severe.phrases}
            onChange={(phrases) => patch({ users: { severe: { ...users.severe, phrases } } })}
          />
        </Field>
        <Field label="Regex" hint="One JS regex per line">
          <ListEditor
            values={users.severe.regex}
            onChange={(regex) => patch({ users: { severe: { ...users.severe, regex } } })}
          />
        </Field>
      </Row>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * 1-100 scale
 *
 * Speed and pitch are stored as multipliers from 0.5x to 2x, where 1x is
 * neutral. Mapping that to 1-100 linearly would put neutral at 34, so the
 * scale is bent at the midpoint instead: 50 is exactly 1.00x, below it runs
 * down to 0.5x and above it up to 2x. That keeps the important value on a
 * round number and makes each half behave predictably.
 * ------------------------------------------------------------------ */

const NEUTRAL = 50;

function multiplierToScale(multiplier: number): number {
  if (multiplier <= 1) return Math.round(1 + ((multiplier - 0.5) / 0.5) * (NEUTRAL - 1));
  return Math.round(NEUTRAL + ((multiplier - 1) / 1) * (100 - NEUTRAL));
}

function scaleToMultiplier(scale: number): number {
  if (scale <= NEUTRAL) {
    return Number((0.5 + ((scale - 1) / (NEUTRAL - 1)) * 0.5).toFixed(3));
  }
  return Number((1 + ((scale - NEUTRAL) / (100 - NEUTRAL))).toFixed(3));
}

/** One-line summary of a profile, describing the backend it will actually use. */
function summarize(profile: UserVoiceProfile, globalProvider: TtsProvider): string {
  const provider = profile.provider || globalProvider;
  const settings = settingsFor(profile, provider);
  const backend = profile.provider
    ? (PROVIDER_LABELS[profile.provider] ?? profile.provider)
    : `${PROVIDER_LABELS[globalProvider] ?? globalProvider} (following the Voice page)`;

  return [
    backend,
    settings.voice || 'rule default voice',
    `${settings.rate.toFixed(2)}x speed`,
    `${settings.pitch.toFixed(2)}x pitch`,
  ].join(' · ');
}

const PROVIDER_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  google: 'Google Cloud TTS',
  'google-legacy': 'Google Translate (no key)',
  browser: 'Browser speech',
};

/**
 * user -> provider -> that provider's parameters.
 *
 * Which backend is being edited is separate from which backend this person is
 * spoken with: you can set up a Google voice for someone while they are still
 * on TikTok, then flip them over in one click without re-entering anything.
 */
function VoiceProfileEditor({
  profile,
  globalProvider,
  onChange,
}: {
  profile: UserVoiceProfile;
  globalProvider: TtsProvider;
  onChange: (next: Omit<VoiceProfilePatch, 'username'>) => void;
}): JSX.Element {
  // Which backend's parameters are on screen. Starts at the one this person
  // is actually spoken with.
  const [editing, setEditing] = useState<TtsProvider>(profile.provider || globalProvider);
  const { options: providerVoices, loading } = useVoices(editing);

  const settings = settingsFor(profile, editing);
  const configured = Object.keys(profile.settings);

  const patch = (next: Partial<VoiceSettings>): void =>
    onChange({ settings: { [editing]: next } });

  const voiceOptions = [
    { value: '', label: 'Inherit from the rule', group: 'Default' },
    ...providerVoices,
  ];

  return (
    <div className="voice-profile-editor">
      <Row>
        <Field
          label="Spoken with"
          hint={
            profile.provider
              ? 'This person only — everyone else follows the Voice page'
              : `Following the Voice page (${PROVIDER_LABELS[globalProvider] ?? globalProvider})`
          }
        >
          <Select
            value={profile.provider}
            onChange={(provider) => {
              onChange({ provider: provider as TtsProvider | '' });
              if (provider) setEditing(provider as TtsProvider);
            }}
            options={[
              { value: '', label: `Follow the Voice page (${PROVIDER_LABELS[globalProvider] ?? globalProvider})` },
              ...Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </Field>
        <Field label="Editing settings for" hint="Each backend keeps its own voice and levels">
          <Select
            value={editing}
            onChange={(next) => setEditing(next as TtsProvider)}
            options={Object.entries(PROVIDER_LABELS).map(([value, label]) => ({
              value,
              label: profile.settings[value] ? `${label} ✓` : label,
            }))}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Voice" hint={loading ? 'Loading voices…' : `${PROVIDER_LABELS[editing]} voices`}>
          <Select
            value={settings.voice}
            onChange={(voice) => patch({ voice })}
            options={voiceOptions}
          />
        </Field>
        <Field label="Speed" hint="50 is normal · scroll to adjust, shift for 10">
          <ScrollNumber
            value={multiplierToScale(settings.rate)}
            onChange={(scale) => patch({ rate: scaleToMultiplier(scale) })}
            caption={`${settings.rate.toFixed(2)}x`}
          />
        </Field>
        <Field label="Pitch" hint="50 is normal · length is preserved">
          <ScrollNumber
            value={multiplierToScale(settings.pitch)}
            onChange={(scale) => patch({ pitch: scaleToMultiplier(scale) })}
            caption={`${settings.pitch.toFixed(2)}x`}
          />
        </Field>
        <Field label="Volume" hint="100 is full">
          <ScrollNumber
            value={Math.max(1, Math.round(settings.volume * 100))}
            onChange={(scale) => patch({ volume: Number((scale / 100).toFixed(2)) })}
            caption={`${Math.round(settings.volume * 100)}%`}
          />
        </Field>
      </Row>

      {configured.length > 0 ? (
        <span className="field-hint">
          Configured for:{' '}
          {configured
            .map((id) => (id === '*' ? 'earlier settings (all backends)' : PROVIDER_LABELS[id] ?? id))
            .join(' · ')}
        </span>
      ) : null}

      <Field label="Note" hint="For your own reference">
        <TextInput value={profile.note} onChange={(note) => onChange({ note })} />
      </Field>
    </div>
  );
}

/**
 * Whether the penalty box reaches YouTube itself.
 *
 * Its own panel for the same reason Twitch has one: this is a setting whose
 * effects are visible to an audience and land on somebody else's account.
 *
 * One difference is worth stating on the screen rather than only in the code.
 * YouTube bans by channel id, and a channel id is exactly what a viewer is
 * keyed on here — so unlike Twitch there is no name lookup in between that
 * could fail harmlessly on a bad handle. Whoever is in the penalty box is who
 * gets banned.
 */
function YouTubeModerationPanel({
  config,
  patch,
}: {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}): JSX.Element {
  const youtube = config.youtube;
  const mod = youtube.moderation;
  const set = (over: Partial<typeof mod>): void =>
    patch({ youtube: { ...youtube, moderation: { ...mod, ...over } } });

  const permanent = mod.timeoutSeconds === 0;

  return (
    <Panel
      title="YouTube enforcement"
      description="Off by default, the penalty box only mutes speech — someone you have penalised carries on posting to everyone watching. Turn this on and a penalty also bans them from the live chat."
    >
      <Row>
        <Toggle
          label="Penalties reach YouTube"
          checked={mod.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <Field
          label="Ban length (seconds)"
          hint={
            permanent
              ? 'Zero is a PERMANENT BAN, not a zero-second timeout'
              : `${Math.round(mod.timeoutSeconds / 60)} minute(s) — 300 is what YouTube's own timeout button uses`
          }
        >
          <NumberInput
            value={mod.timeoutSeconds}
            onChange={(timeoutSeconds) => set({ timeoutSeconds })}
            min={0}
            max={86400}
          />
        </Field>
      </Row>

      {permanent && mod.enabled ? (
        <div className="banner banner-warn">
          A ban length of zero bans permanently. Every penalty — including one added by a
          misclick — will remove that viewer from your chat until you undo it in YouTube Studio.
        </div>
      ) : null}

      <Row>
        <Toggle
          label="Automatic penalties too"
          hint="Off by default even when the above is on. Strikes fire on evasion heuristics and phonetic near misses, which have false positives — a wrong call that mutes speech is private, and one that bans a real viewer is not."
          checked={mod.includeAutomatic}
          onChange={(includeAutomatic) => set({ includeAutomatic })}
        />
      </Row>

      {mod.enabled ? (
        <p className="muted">
          Banning is done as you, so this needs the Google sign-in even when chat is being read
          without one. Releasing someone from the penalty box lifts the ban — but only one placed
          since the server last started, because YouTube gives no way to look a ban up afterwards.
          Anything older has to be lifted in YouTube Studio.
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * Viewer trust settings.
 *
 * Strict mode only ever holds messages back from speech. Nothing here hides a
 * message from chat, and a strike still needs a severe-list block to have
 * happened first.
 */
function TrustPanel({
  config,
  patch,
}: {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}): JSX.Element {
  const trust = config.trust ?? DEFAULT_TRUST;
  const set = (over: Partial<TrustConfig>): void => patch({ trust: { ...trust, ...over } });

  return (
    <Panel
      title="Trust score"
      description="Scores each viewer from 0 to 100 using how long they have been around, what they have given, and how they behave this stream. Click anyone in the chat log to see their score and why."
    >
      <Row>
        <Toggle
          label="Enabled"
          checked={trust.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <Field
          label="Strict mode below"
          hint="Viewers under this score don't get oddly spelled messages or sound-alikes of severe terms read aloud. A brand-new viewer starts at about 30."
        >
          <NumberInput
            value={trust.strictBelow}
            onChange={(strictBelow) => set({ strictBelow })}
            min={0}
            max={100}
          />
        </Field>
      </Row>

      <Row>
        <Toggle
          label="Strike retries after a severe block"
          hint="A strict-mode viewer who sends something similar soon after a severe term was blocked gets a strike. Uses the automatic penalty settings."
          checked={trust.strikeOnRetry}
          onChange={(strikeOnRetry) => set({ strikeOnRetry })}
        />
        <Field label="Retry window (seconds)">
          <NumberInput
            value={trust.retryWindowSeconds}
            onChange={(retryWindowSeconds) => set({ retryWindowSeconds })}
            min={10}
            max={600}
          />
        </Field>
      </Row>

      <Row>
        <Toggle
          label="Hold new viewers"
          hint="No speech for someone new until they reach either limit. Subscribers and anyone who has gifted skip the wait. Their messages still show in chat."
          checked={trust.holdNewViewers}
          onChange={(holdNewViewers) => set({ holdNewViewers })}
        />
        <Field label="Messages">
          <NumberInput
            value={trust.holdMessages}
            onChange={(holdMessages) => set({ holdMessages })}
            min={0}
            max={50}
          />
        </Field>
        <Field label="Minutes">
          <NumberInput
            value={trust.holdMinutes}
            onChange={(holdMinutes) => set({ holdMinutes })}
            min={0}
            max={120}
          />
        </Field>
      </Row>
    </Panel>
  );
}

/**
 * Whether the penalty box reaches Twitch itself.
 *
 * Given its own panel rather than a toggle tucked into the list above,
 * because it is the one setting on this tab whose effects are visible to an
 * audience and land on somebody else's account. The copy says plainly what
 * each state does, including the one where the timeout is zero.
 */
function TwitchModerationPanel({
  config,
  patch,
}: {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}): JSX.Element {
  const twitch = config.twitch;
  const mod = twitch.moderation;
  const set = (over: Partial<typeof mod>): void =>
    patch({ twitch: { ...twitch, moderation: { ...mod, ...over } } });

  const permanent = mod.timeoutSeconds === 0;

  return (
    <Panel
      title="Twitch enforcement"
      description="Off by default, the penalty box only mutes speech — someone you have penalised carries on posting to everyone watching. Turn this on and a penalty also times them out in your channel."
    >
      <Row>
        <Toggle
          label="Penalties reach Twitch"
          checked={mod.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        <Field
          label="Timeout (seconds)"
          hint={
            permanent
              ? 'Zero is a PERMANENT BAN, not a zero-second timeout'
              : `${Math.round(mod.timeoutSeconds / 60)} minute(s) — Twitch allows up to 14 days`
          }
        >
          <NumberInput
            value={mod.timeoutSeconds}
            onChange={(timeoutSeconds) => set({ timeoutSeconds })}
            min={0}
            max={1209600}
          />
        </Field>
      </Row>

      {permanent && mod.enabled ? (
        <div className="banner banner-warn">
          A timeout of zero bans permanently. Every penalty — including one added by a
          misclick — will remove that viewer from your channel until you undo it by hand.
        </div>
      ) : null}

      <Row>
        <Toggle
          label="Automatic penalties too"
          hint="Off by default even when the above is on. Strikes fire on evasion heuristics and phonetic near misses, which have false positives — a wrong call that mutes speech is private, and one that times out a real viewer is not."
          checked={mod.includeAutomatic}
          onChange={(includeAutomatic) => set({ includeAutomatic })}
        />
      </Row>

      {mod.enabled && !twitch.channel ? (
        <div className="banner banner-warn">
          No Twitch channel is set, so there is nothing to moderate. Set one on Go live.
        </div>
      ) : null}

      <p className="muted">
        Releasing someone from the penalty box, or trusting them, lifts the timeout as well.
        Twitch removes a timed-out viewer&rsquo;s recent messages for you.
      </p>
    </Panel>
  );
}
