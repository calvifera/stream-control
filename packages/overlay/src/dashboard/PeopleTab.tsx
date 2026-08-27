import { useMemo, useState } from 'react';
import {
  displayHandle,
  listKey,
  PLATFORM_INFO,
  PLATFORMS,
  readViewerKey,
  NEUTRAL_VOICE_PROFILE,
  settingsFor,
  type AppConfig,
  type TtsProvider,
  type UserVoiceProfile,
  type VoiceSettings,
} from '@streaming/shared';
import { api, type VoiceProbeResult, type VoiceProfilePatch } from '../lib/api.js';
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
import { PlatformTabs, type PlatformTab } from './PlatformTabs.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
}

export function PeopleTab({ config, patch }: Props): JSX.Element {
  const users = config.users;
  // Only the voice-probe panel at the bottom needs the globally selected
  // backend's list; each profile editor loads the list for whichever backend
  // it is currently editing.
  const { options: providerVoices } = useVoices(config.tts.provider);
  const [probe, setProbe] = useState<VoiceProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [trustedTab, setTrustedTab] = useState<PlatformTab>('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const trustedDetail = useKnownUsers(users.trusted);

  /**
   * The trusted list, split by service and ordered by when each person was
   * added.
   *
   * That order is the array's own: every write appends and every removal
   * filters, so position *is* add order. It is the only record of when
   * somebody was trusted — unlike the penalty box, a trusted entry carries no
   * timestamp — so it is worth not scrambling.
   */
  const trustedRows = useMemo(() => {
    const rows = users.trusted.map((entry) => ({
      entry,
      platform: readViewerKey(entry).platform,
    }));
    const scoped =
      trustedTab === 'all' ? rows : rows.filter((row) => row.platform === trustedTab);
    return newestFirst ? scoped.slice().reverse() : scoped;
  }, [users.trusted, trustedTab, newestFirst]);

  const trustedCounts = useMemo(() => {
    const counts = Object.fromEntries(PLATFORMS.map((platform) => [platform, 0])) as Record<
      (typeof PLATFORMS)[number],
      number
    >;
    for (const entry of users.trusted) counts[readViewerKey(entry).platform] += 1;
    return counts;
  }, [users.trusted]);

  const run = (action: Promise<unknown>): void => {
    setError(null);
    void action.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const profileFor = (username: string): UserVoiceProfile =>
    users.voiceProfiles.find((p) => listKey(p.username) === listKey(username)) ?? {
      ...NEUTRAL_VOICE_PROFILE,
      username,
      // Never the raw key — a placeholder name of "tiktok:someone" would get
      // saved the moment the editor is touched.
      displayName: displayHandle(username).slice(1),
    };

  return (
    <>
      {error ? <div className="banner banner-error">{error}</div> : null}

      <Panel
        title="Trusted"
        description="Regulars who bypass every rule gate and per-user cooldown. Trusting someone also lifts a mute and clears their strikes."
      >
        <Field label="Add someone">
          <UserPicker
            placeholder="Search your chat history…"
            onPick={(user) => run(api.trustUser(user.key, user.displayName))}
          />
        </Field>

        <PlatformTabs
          counts={trustedCounts}
          total={users.trusted.length}
          active={trustedTab}
          onPick={setTrustedTab}
        />

        <div className="list-controls">
          <label className="list-sort">
            Order
            <select
              value={newestFirst ? 'desc' : 'asc'}
              onChange={(event) => setNewestFirst(event.target.value === 'desc')}
            >
              <option value="desc">Recently added</option>
              <option value="asc">Longest trusted</option>
            </select>
          </label>
          <span className="muted people-count">
            {trustedRows.length} {trustedRows.length === 1 ? 'person' : 'people'}
            {trustedTab === 'all' ? '' : ` on ${PLATFORM_INFO[trustedTab].label}`}
          </span>
        </div>

        {trustedRows.length === 0 ? (
          <p className="muted">
            {users.trusted.length === 0
              ? 'No trusted users yet.'
              : `Nobody trusted on ${
                  trustedTab === 'all' ? 'any platform' : PLATFORM_INFO[trustedTab].label
                } yet.`}
          </p>
        ) : (
          <div className="people-list">
            {trustedRows.map(({ entry: username, platform }) => {
              // The stored entry may be a qualified `platform:handle` or a
              // bare legacy one; `listKey` collapses both to what the map is
              // keyed on. The handle shown is always the bare one — nobody
              // wants to read "@tiktok:someone".
              const detail = trustedDetail.get(listKey(username));
              const handle = displayHandle(username);
              const open = editingProfile === username;
              return (
                <div key={username} className="person-block">
                  <div className={open ? 'person-row person-row-open' : 'person-row'}>
                    {detail?.avatarUrl ? (
                      <img src={detail.avatarUrl} alt="" className="person-avatar" />
                    ) : (
                      <span className="person-avatar person-avatar-blank" />
                    )}
                    <div className="person-detail">
                      <span className="person-name">
                        {detail && `@${detail.displayName}` !== handle ? (
                          <>
                            {detail.displayName} <span className="muted">{handle}</span>
                          </>
                        ) : (
                          handle
                        )}
                      </span>
                      {/* Only on the merged view — inside a platform tab
                          every row would say the same thing. */}
                      {trustedTab === 'all' ? (
                        <span className="muted person-platform">
                          <PlatformLogo platform={platform} size={11} />
                          {PLATFORM_INFO[platform].label}
                        </span>
                      ) : null}
                      {detail ? (
                        <span className="muted">
                          {detail.messages} msg{detail.messages === 1 ? '' : 's'}
                          {detail.lastSeen
                            ? ` · last seen ${new Date(detail.lastSeen).toLocaleDateString()}`
                            : ''}
                        </span>
                      ) : null}
                    </div>
                    <div className="button-row">
                      <Button
                        variant={open ? 'primary' : 'default'}
                        onClick={() => {
                          // Creating the profile up front means the editor edits
                          // a real record rather than a phantom default.
                          if (
                            !open &&
                            !users.voiceProfiles.some((p) => listKey(p.username) === listKey(username))
                          ) {
                            run(
                              api.setUserVoice({
                                username,
                                displayName: detail?.displayName ?? username,
                              }),
                            );
                          }
                          setEditingProfile(open ? null : username);
                        }}
                      >
                        {open ? 'Done' : 'Voice'}
                      </Button>
                      <Button variant="ghost" onClick={() => run(api.untrustUser(username))}>
                        Remove
                      </Button>
                    </div>
                  </div>

                  {/* Opens right here rather than in the panel below, which
                      looked like the button had done nothing. */}
                  {open ? (
                    <VoiceProfileEditor
                      profile={profileFor(username)}
                      globalProvider={config.tts.provider}
                      onChange={(next) => run(api.setUserVoice({ ...next, username }))}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="Penalty box"
        description="Muted from TTS only — their messages still show in chat overlays and still count toward stats. This is where the auto-penalty puts people who route a severe term around the filter."
      >
        <Field label="Mute someone">
          <UserPicker
            placeholder="Search your chat history…"
            onPick={(user) =>
              run(api.penalizeUser(user.key, 'Added manually', user.displayName))
            }
          />
        </Field>

        {users.penaltyBox.length === 0 ? (
          <p className="muted">Nobody is muted.</p>
        ) : (
          <div className="people-list">
            {users.penaltyBox.map((entry) => (
              <div key={entry.username} className="person-row person-row-penalty">
                <div className="person-detail">
                  <span className="person-name">
                    {entry.displayName} <span className="muted">{displayHandle(entry.username)}</span>
                  </span>
                  <span className="muted">
                    {entry.automatic ? 'Automatic' : 'Manual'} ·{' '}
                    {new Date(entry.addedAt).toLocaleString()} · {entry.reason}
                  </span>
                  {entry.evidence ? (
                    <span className="person-evidence mono">“{entry.evidence}”</span>
                  ) : null}
                </div>
                <div className="button-row">
                  <Button variant="ghost" onClick={() => run(api.pardonUser(entry.username))}>
                    Unmute
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Automatic penalties"
        description="Strikes are only recorded for the severe list below, and by default only when someone disguises the term to get past the filter. Ordinary swearing never lands anyone here."
      >
        <Row>
          <Toggle
            label="Enabled"
            checked={users.autoPenalty.enabled}
            onChange={(enabled) => patch({ users: { autoPenalty: { ...users.autoPenalty, enabled } } })}
          />
          <Toggle
            label="Only count disguised attempts"
            hint="Cross-script, homoglyph or mixed-script spellings. Off means plainly typing a severe term also counts."
            checked={users.autoPenalty.onlyCountEvasion}
            onChange={(onlyCountEvasion) =>
              patch({ users: { autoPenalty: { ...users.autoPenalty, onlyCountEvasion } } })
            }
          />
          <Toggle
            label="Trusted users are exempt"
            checked={users.autoPenalty.exemptTrusted}
            onChange={(exemptTrusted) =>
              patch({ users: { autoPenalty: { ...users.autoPenalty, exemptTrusted } } })
            }
          />
          <Field label="Strikes before muting" hint="1 mutes on the first attempt">
            <NumberInput
              value={users.autoPenalty.strikesBeforePenalty}
              onChange={(strikesBeforePenalty) =>
                patch({ users: { autoPenalty: { ...users.autoPenalty, strikesBeforePenalty } } })
              }
              min={1}
              max={20}
            />
          </Field>
        </Row>
      </Panel>

      <TwitchModerationPanel config={config} patch={patch} />

      <Panel
        title="Severe terms"
        description="The zero-tolerance list. Separate from the ordinary word list on purpose: these are the terms worth tracking a person over. Matches always drop the whole message, never censor it."
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

      <Panel
        title="Per-user voices"
        description="Give specific people their own voice, speed and pitch. Anything left at the neutral value inherits from whichever rule fired."
      >
        <Field label="Set up a voice for someone">
          <UserPicker
            placeholder="Search your chat history…"
            onPick={(user) => {
              // `key`, not `username`: a profile filed under a bare handle
              // would apply to whoever holds that name on every platform.
              run(
                api.setUserVoice({
                  username: user.key,
                  displayName: user.displayName,
                }),
              );
              setEditingProfile(user.key);
            }}
          />
        </Field>

        {users.voiceProfiles.length === 0 ? (
          <p className="muted">No custom voices set.</p>
        ) : (
          <div className="people-list">
            {users.voiceProfiles.map((profile) => (
              <div key={profile.username} className="person-block">
                <div
                  className={
                    editingProfile === profile.username ? 'person-row person-row-open' : 'person-row'
                  }
                >
                  <div className="person-detail">
                    <span className="person-name">
                      {profile.displayName}{' '}
                      <span className="muted">{displayHandle(profile.username)}</span>
                    </span>
                    <span className="muted">{summarize(profile, config.tts.provider)}</span>
                  </div>
                  <div className="button-row">
                    <Button
                      variant={editingProfile === profile.username ? 'primary' : 'default'}
                      onClick={() =>
                        setEditingProfile(editingProfile === profile.username ? null : profile.username)
                      }
                    >
                      {editingProfile === profile.username ? 'Done' : 'Edit'}
                    </Button>
                    <Button variant="ghost" onClick={() => run(api.clearUserVoice(profile.username))}>
                      Remove
                    </Button>
                  </div>
                </div>

                {editingProfile === profile.username ? (
                  <VoiceProfileEditor
                    profile={profile}
                    globalProvider={config.tts.provider}
                    onChange={(next) => run(api.setUserVoice({ ...next, username: profile.username }))}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Covers the gap between creating a profile and the config broadcast
            coming back. Trusted users edit inline in their own panel, so they
            are excluded or the editor would briefly appear twice. */}
        {editingProfile &&
        !users.voiceProfiles.some((p) => listKey(p.username) === listKey(editingProfile)) &&
        !users.trusted.some((u) => listKey(u) === listKey(editingProfile)) ? (
          <VoiceProfileEditor
            profile={profileFor(editingProfile)}
            globalProvider={config.tts.provider}
            onChange={(next) => run(api.setUserVoice({ ...next, username: editingProfile }))}
          />
        ) : null}
      </Panel>

      <AvatarPanel />

      <Panel
        title="Check which voices your account can use"
        description="There is no TikTok endpoint that lists voices — the catalogue is a fixed set of speaker codes. What can be checked is which of them your session is actually allowed to synthesize, by trying each one."
        actions={
          <Button
            variant="primary"
            disabled={probing}
            onClick={() => {
              setProbing(true);
              setError(null);
              void api
                .probeVoices()
                .then(setProbe)
                .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setProbing(false));
            }}
          >
            {probing ? 'Testing…' : 'Test voices'}
          </Button>
        }
      >
        {probing ? <p className="muted">Synthesizing one word per voice — this takes a minute.</p> : null}

        {probe ? (
          <>
            <div className="banner banner-ok">
              {probe.available} of {probe.tested} voices available on this session
            </div>
            <div className="chips">
              {probe.results.map((result) => (
                <span
                  key={result.code}
                  className={result.ok ? 'chip chip-on chip-static' : 'chip chip-strike chip-static'}
                  title={result.error ?? 'Available'}
                >
                  {providerVoices.find((v) => v.value === result.code)?.label ?? result.code}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </Panel>
    </>
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
    : `${PROVIDER_LABELS[globalProvider] ?? globalProvider} (following the TTS tab)`;

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
              ? 'This person only — everyone else follows the TTS tab'
              : `Following the TTS tab (${PROVIDER_LABELS[globalProvider] ?? globalProvider})`
          }
        >
          <Select
            value={profile.provider}
            onChange={(provider) => {
              onChange({ provider: provider as TtsProvider | '' });
              if (provider) setEditing(provider as TtsProvider);
            }}
            options={[
              { value: '', label: `Follow the TTS tab (${PROVIDER_LABELS[globalProvider] ?? globalProvider})` },
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
          No Twitch channel is set, so there is nothing to moderate. Set one on the Setup tab.
        </div>
      ) : null}

      <p className="muted">
        Releasing someone from the penalty box, or trusting them, lifts the timeout as well.
        Twitch removes a timed-out viewer&rsquo;s recent messages for you.
      </p>
    </Panel>
  );
}
