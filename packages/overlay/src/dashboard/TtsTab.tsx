import { useState } from 'react';
import {
  DEFAULT_TTS_RULE,
  gateWarning,
  PLATFORM_INFO,
  platformsMissing,
  PLATFORMS,
  STREAM_EVENT_LABELS,
  STREAM_EVENT_TYPES,
  type AppConfig,
  type Platform,
  type StreamEventType,
  type TtsRule,
} from '@streaming/shared';
import { api, type ServerMeta } from '../lib/api.js';
import { useVoices } from '../lib/useVoices.js';
import { useLive } from '../lib/store.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import {
  Button,
  ChipSelect,
  Field,
  ListEditor,
  NumberInput,
  Panel,
  Row,
  Select,
  Slider,
  TextArea,
  TextInput,
  Toggle,
} from './controls.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
  meta: ServerMeta | null;
}

const PLATFORM_OPTIONS = PLATFORMS.map((id) => ({ value: id, label: PLATFORM_INFO[id].label }));

const EVENT_OPTIONS = STREAM_EVENT_TYPES.filter(
  (type) => !['roomStats', 'streamEnd', 'system', 'emote'].includes(type),
).map((type) => ({ value: type, label: STREAM_EVENT_LABELS[type] }));

export function TtsTab({ config, patch, meta }: Props): JSX.Element {
  const { tts: ttsState } = useLive();
  const tts = config.tts;
  const [selectedId, setSelectedId] = usePersistentState<string | null>(
    'tts.selectedRule',
    tts.rules[0]?.id ?? null,
    (stored) => stored === null || tts.rules.some((rule) => rule.id === stored),
  );
  const [testText, setTestText] = usePersistentState('tts.testText', 'Testing one two three');
  const [testVoice, setTestVoice] = usePersistentState('tts.testVoice', '');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  // Voice lists differ per backend, so every dropdown here follows the
  // currently selected provider rather than a hardcoded catalogue.
  const { options: voiceOptions, loading: voicesLoading } = useVoices(tts.provider);
  const providerStatus = meta?.providers.find((p) => p.id === tts.provider);

  const voiceOptionsWithRandom = [
    { value: 'random', label: 'Random from pool', group: 'Special' },
    ...voiceOptions,
  ];

  // Voice codes are provider-specific, so switching backends leaves old rules
  // pointing at codes the new one has never heard of. Say so rather than
  // letting them quietly fall back to the default voice.
  const knownVoices = new Set(voiceOptions.map((option) => option.value));
  const mismatchedRules =
    voicesLoading || knownVoices.size === 0
      ? []
      : tts.rules.filter(
          (rule) => rule.enabled && rule.voice !== 'random' && !knownVoices.has(rule.voice),
        );

  const setTts = (next: Partial<AppConfig['tts']>): void => patch({ tts: next });
  const selected = tts.rules.find((rule) => rule.id === selectedId) ?? null;

  const updateRule = (id: string, next: Partial<TtsRule>): void => {
    setTts({ rules: tts.rules.map((rule) => (rule.id === id ? { ...rule, ...next } : rule)) });
  };

  const addRule = (): void => {
    const id = `rule-${Date.now().toString(36)}`;
    setTts({ rules: [...tts.rules, { ...DEFAULT_TTS_RULE, id }] });
    setSelectedId(id);
  };

  const deleteRule = (id: string): void => {
    setTts({ rules: tts.rules.filter((rule) => rule.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  const runTest = async (): Promise<void> => {
    setTestMessage('Fetching audio…');
    const result = await api.testTts(testText, testVoice);
    setTestMessage(
      result.playing
        ? `Playing now${result.filtered ? ' (the filter changed the text)' : ''}`
        : (result.reason ?? 'Nothing played'),
    );
  };

  return (
    <>
      <Panel
        title="Speech engine"
        description="Clips are synthesized on the server and played by the TTS browser source, so your streaming software captures the audio."
        actions={
          <Toggle label="Enabled" checked={tts.enabled} onChange={(enabled) => setTts({ enabled })} />
        }
      >
        <Row>
          <Field label="Provider">
            <Select
              value={tts.provider}
              onChange={(provider) => setTts({ provider })}
              options={[
                { value: 'google', label: 'Google Cloud TTS (official, 2000+ voices)' },
                { value: 'tiktok', label: "TikTok TTS (the app's own voices)" },
                { value: 'google-legacy', label: 'Google Translate voices (unofficial, no key)' },
                { value: 'browser', label: 'Browser speech synthesis' },
              ]}
            />
          </Field>
          <Field label="Master volume">
            <Slider
              value={tts.masterVolume}
              onChange={(masterVolume) => setTts({ masterVolume })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </Field>
        </Row>

        <Row>
          <Toggle
            label="Match loudness to your stream"
            hint="Speech arrives peak-normalised but quiet on average, so it sits under game audio even at full volume. This compresses it and makes up the difference — turning the volume up alone would only clip."
            checked={tts.normalizeLoudness}
            onChange={(normalizeLoudness) => setTts({ normalizeLoudness })}
          />
          {tts.normalizeLoudness ? (
            <Field
              label="Loudness boost"
              hint="Decibels of make-up gain after compression. 8 dB measured about twice as loud with nothing clipped; raise it if speech still sits under your game."
            >
              <NumberInput
                value={tts.loudnessGainDb}
                onChange={(loudnessGainDb) => setTts({ loudnessGainDb })}
                min={0}
                max={12}
                step={1}
              />
            </Field>
          ) : null}
        </Row>

        {providerStatus && !providerStatus.configured ? (
          <div className="banner banner-error">{providerStatus.hint}</div>
        ) : null}

        {mismatchedRules.length > 0 ? (
          <div className="banner banner-error">
            {mismatchedRules.length} rule{mismatchedRules.length === 1 ? '' : 's'} still
            {mismatchedRules.length === 1 ? ' uses a voice' : ' use voices'} from another backend
            (<code>{mismatchedRules.map((r) => r.voice).join('</code>, <code>')}</code>). They'll
            fall back to the default voice until you repick them below.
          </div>
        ) : null}

        {tts.provider === 'google' ? (
          <>
            <Row>
              <Field
                label="Google Cloud API key"
                hint={
                  meta?.env.hasGoogleTtsKey
                    ? 'Already set from the GOOGLE_TTS_API_KEY env var — leave blank to keep using it'
                    : 'A Google Cloud key with the Text-to-Speech API enabled. Restrict it to that API.'
                }
              >
                <TextInput
                  type="password"
                  value={tts.google.apiKey}
                  onChange={(apiKey) => setTts({ google: { ...tts.google, apiKey } })}
                  placeholder={meta?.env.hasGoogleTtsKey ? '(using env var)' : 'AIza…'}
                />
              </Field>
              <Field label="Default voice" hint="Used when a rule doesn't name one">
                <Select
                  value={tts.google.defaultVoice}
                  onChange={(defaultVoice) => setTts({ google: { ...tts.google, defaultVoice } })}
                  options={
                    voiceOptions.length > 0
                      ? voiceOptions
                      : [{ value: tts.google.defaultVoice, label: tts.google.defaultVoice, group: '' }]
                  }
                />
              </Field>
            </Row>
            <div className="banner">
              Free tier covers 4M characters a month on Standard voices and 1M on Neural2 — a busy
              stream reads perhaps 50k in a session, so this should cost nothing. Pitch and speed are
              applied by Google rather than in the browser, which sounds cleaner.
            </div>
          </>
        ) : null}

        {tts.provider === 'google-legacy' ? (
          <>
            <Row>
              <Field label="Default voice" hint="Two per language — this engine has no others">
                <Select
                  value={tts.googleLegacy.defaultVoice}
                  onChange={(defaultVoice) => setTts({ googleLegacy: { defaultVoice } })}
                  options={
                    voiceOptions.length > 0
                      ? voiceOptions
                      : [{ value: tts.googleLegacy.defaultVoice, label: tts.googleLegacy.defaultVoice, group: '' }]
                  }
                />
              </Field>
            </Row>
            <div className="banner banner-error">
              This is the engine behind other tools' "default male/female" voices. It needs no key
              because it rides <strong>Chromium's public API key</strong> — the quota isn't yours, so
              Google can throttle or revoke it without warning, and using it sits outside their
              terms. Speed and pitch are real parameters here, but there are only two voices per
              language. Keep <strong>Google Cloud TTS</strong> configured as your fallback.
            </div>
          </>
        ) : null}

        {tts.provider === 'tiktok' ? (
          <Row>
            <Field
              label="TikTok session id"
              hint={
                meta?.env.hasTikTokSession
                  ? 'Already set from the TIKTOK_SESSION_ID env var — leave blank to keep using it'
                  : 'The sessionid cookie from tiktok.com. Treat it like a password.'
              }
            >
              <TextInput
                type="password"
                value={tts.sessionId}
                onChange={(sessionId) => setTts({ sessionId })}
                placeholder={meta?.env.hasTikTokSession ? '(using env var)' : 'paste sessionid cookie'}
              />
            </Field>
            <Field label="Endpoint" hint="Change only if your region blocks the default">
              <Select
                value={tts.apiBaseUrl}
                onChange={(apiBaseUrl) => setTts({ apiBaseUrl })}
                options={(meta?.ttsEndpoints ?? [tts.apiBaseUrl]).map((url) => ({
                  value: url,
                  label: url.replace('https://', '').split('/')[0] ?? url,
                }))}
              />
            </Field>
          </Row>
        ) : null}

        <Row>
          <Field label="Max queue length">
            <NumberInput
              value={tts.maxQueueLength}
              onChange={(maxQueueLength) => setTts({ maxQueueLength })}
              min={1}
              max={500}
            />
          </Field>
          <Field label="Drop items older than (s)">
            <NumberInput
              value={tts.itemTtlSeconds}
              onChange={(itemTtlSeconds) => setTts({ itemTtlSeconds })}
              min={5}
              max={3600}
            />
          </Field>
          <Field label="Gap between clips (ms)">
            <NumberInput value={tts.gapMs} onChange={(gapMs) => setTts({ gapMs })} min={0} max={10000} step={50} />
          </Field>
        </Row>

        <Row>
          <Field
            label="Per-user cooldown (s)"
            hint={
              tts.userCooldownSeconds > 0
                ? `Anyone spoken is silent for ${tts.userCooldownSeconds}s afterwards, across every rule. Trusted users are exempt.`
                : 'Off. Set above 0 to stop one person holding the queue by triggering different rules back to back.'
            }
          >
            <NumberInput
              value={tts.userCooldownSeconds}
              onChange={(userCooldownSeconds) => setTts({ userCooldownSeconds })}
              min={0}
              max={3600}
            />
          </Field>
        </Row>

        <Row>
          <Toggle
            label="Fall back to browser speech"
            hint="Keeps talking when TikTok refuses a clip (expired session, region block)"
            checked={tts.fallbackToBrowser}
            onChange={(fallbackToBrowser) => setTts({ fallbackToBrowser })}
          />
          <Toggle
            label="Discard queue when no TTS overlay is open"
            hint="Off means the queue waits, and everything backs up the moment you open the source"
            checked={tts.skipWhenNoListener}
            onChange={(skipWhenNoListener) => setTts({ skipWhenNoListener })}
          />
        </Row>

        <Row>
          <Toggle
            label="Also play speech in this dashboard"
            hint={
              (ttsState?.overlayListeners ?? 0) > 0
                ? 'A monitor feed for hearing what your viewers hear. Doubles up only if your streaming software also monitors that source to your speakers'
                : 'No source is open, so speech already plays here. This only matters once one is running'
            }
            checked={tts.monitorInDashboard}
            onChange={(monitorInDashboard) => setTts({ monitorInDashboard })}
          />
        </Row>

        <div className="status-line">
          <strong>{ttsState?.overlayListeners ?? 0}</strong>
          <span className="muted">TTS browser source(s) open</span>
          <strong>{ttsState?.queue.length ?? 0}</strong>
          <span className="muted">queued</span>
          {ttsState?.speaking ? (
            <span className="muted">speaking: “{ttsState.speaking.text.slice(0, 50)}”</span>
          ) : null}
          {ttsState?.lastError ? <span className="error-text">{ttsState.lastError}</span> : null}
        </div>

        {(ttsState?.overlayListeners ?? 0) === 0 ? (
          <div className="banner">
            No TTS browser source is open, so speech plays through this dashboard tab instead. Fine
            for testing — but add the <strong>TTS audio</strong> browser source before going live, or
            your viewers won't hear any of it.
          </div>
        ) : null}

        <Row>
          <Field label="Test text">
            <TextInput value={testText} onChange={setTestText} />
          </Field>
          <Field label="Voice" hint={voicesLoading ? 'Loading voices…' : undefined}>
            <Select value={testVoice || (voiceOptions[0]?.value ?? '')} onChange={setTestVoice} options={voiceOptions} />
          </Field>
          <Field label=" ">
            <div className="button-row">
              <Button variant="primary" onClick={() => void runTest()}>
                Speak
              </Button>
              <Button onClick={() => void api.skipTts()}>Skip</Button>
              <Button variant="danger" onClick={() => void api.clearTts()}>
                Clear queue
              </Button>
            </div>
          </Field>
        </Row>
        {testMessage ? <div className="banner">{testMessage}</div> : null}
      </Panel>

      <Panel
        title="Rules"
        description="Each rule decides what gets spoken, by whom, and in which voice. Several rules can fire on the same event."
        actions={
          <Button variant="primary" onClick={addRule}>
            Add rule
          </Button>
        }
      >
        <div className="rule-layout">
          <ul className="rule-list">
            {tts.rules.map((rule) => (
              <li key={rule.id}>
                <button
                  type="button"
                  className={rule.id === selectedId ? 'rule-item rule-item-on' : 'rule-item'}
                  onClick={() => setSelectedId(rule.id)}
                >
                  <span className={rule.enabled ? 'dot dot-connected' : 'dot dot-idle'} />
                  <span className="rule-name">{rule.name}</span>
                  <span className="muted">{rule.eventTypes.join(', ')}</span>
                </button>
              </li>
            ))}
            {tts.rules.length === 0 ? <li className="muted">No rules yet.</li> : null}
          </ul>

          <div className="rule-editor">
            {selected ? (
              <RuleEditor
                rule={selected}
                voiceOptions={voiceOptionsWithRandom}
                onChange={(next) => updateRule(selected.id, next)}
                onDelete={() => deleteRule(selected.id)}
              />
            ) : (
              <p className="muted">Select a rule to edit it.</p>
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}

function RuleEditor({
  rule,
  voiceOptions,
  onChange,
  onDelete,
}: {
  rule: TtsRule;
  voiceOptions: Array<{ value: string; label: string; group: string }>;
  onChange: (next: Partial<TtsRule>) => void;
  onDelete: () => void;
}): JSX.Element {
  const isTextRule = rule.eventTypes.includes('chat') || rule.eventTypes.includes('question');
  const isGiftRule = rule.eventTypes.includes('gift');

  return (
    <div className="rule-form">
      <Row>
        <Field label="Rule name">
          <TextInput value={rule.name} onChange={(name) => onChange({ name })} />
        </Field>
        <Field label=" ">
          <div className="button-row">
            <Toggle label="Enabled" checked={rule.enabled} onChange={(enabled) => onChange({ enabled })} />
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </Field>
      </Row>

      <Field label="Fires on">
        <ChipSelect
          values={rule.eventTypes}
          options={EVENT_OPTIONS}
          onChange={(eventTypes) => onChange({ eventTypes: eventTypes as StreamEventType[] })}
        />
      </Field>

      <Field
        label="Platforms"
        hint="Leave empty for every connected platform. Pick some to scope this rule — e.g. read chat on TikTok but only announce gifts on Twitch."
      >
        <ChipSelect
          values={rule.platforms}
          options={PLATFORM_OPTIONS}
          onChange={(platforms) => onChange({ platforms: platforms as Platform[] })}
        />
      </Field>

      <Field
        label="Spoken text"
        hint="Placeholders: {{nickname}} {{username}} {{message}} {{gift}} {{count}} {{diamonds}} {{likes}} {{months}}"
      >
        <TextArea value={rule.template} onChange={(template) => onChange({ template })} rows={2} />
      </Field>

      <Row>
        <Field label="Voice">
          <Select
            value={rule.voice}
            onChange={(voice) => onChange({ voice })}
            options={voiceOptions}
          />
        </Field>
        <Field label="Priority" hint="Higher jumps the queue">
          <NumberInput value={rule.priority} onChange={(priority) => onChange({ priority })} min={-100} max={100} />
        </Field>
        <Field label="Per-user cooldown (s)">
          <NumberInput
            value={rule.cooldownSeconds}
            onChange={(cooldownSeconds) => onChange({ cooldownSeconds })}
            min={0}
            max={3600}
          />
        </Field>
        <Field label="Max characters">
          <NumberInput value={rule.maxChars} onChange={(maxChars) => onChange({ maxChars })} min={1} max={1000} />
        </Field>
      </Row>

      {rule.voice === 'random' ? (
        <Field label="Voice pool" hint="One voice code per line; a random one is picked each time">
          <ListEditor
            values={rule.voicePool}
            onChange={(voicePool) => onChange({ voicePool })}
            placeholder={'en_us_ghostface\nen_us_rocket'}
            rows={4}
          />
        </Field>
      ) : null}

      <Row>
        <Field label="Volume">
          <Slider value={rule.volume} onChange={(volume) => onChange({ volume })} format={(v) => `${Math.round(v * 100)}%`} />
        </Field>
        <Field label="Rate">
          <Slider
            value={rule.rate}
            onChange={(rate) => onChange({ rate })}
            min={0.5}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}x`}
          />
        </Field>
      </Row>

      <GateReach rule={rule} />

      <h3>Who can trigger this</h3>
      {/* You and your moderators bypass every gate below, so a gate no
          platform can satisfy is not silent — it just never lets anyone
          *else* through. That is the failure worth naming. */}
      <Row>
        <Toggle
          label="Followers only"
          hint={gateWarning('follower', rule.platforms) ?? undefined}
          checked={rule.gate.followersOnly}
          onChange={(followersOnly) => onChange({ gate: { ...rule.gate, followersOnly } })}
        />
        <Toggle
          label="Mutuals only"
          hint={gateWarning('friend', rule.platforms) ?? 'Stricter than followers'}
          checked={rule.gate.friendsOnly}
          onChange={(friendsOnly) => onChange({ gate: { ...rule.gate, friendsOnly } })}
        />
        <Toggle
          label="Subscribers only"
          hint={gateWarning('subscriber', rule.platforms) ?? undefined}
          checked={rule.gate.subscribersOnly}
          onChange={(subscribersOnly) => onChange({ gate: { ...rule.gate, subscribersOnly } })}
        />
        <Toggle
          label="Moderators only"
          checked={rule.gate.moderatorsOnly}
          onChange={(moderatorsOnly) => onChange({ gate: { ...rule.gate, moderatorsOnly } })}
        />
        <Toggle
          label="Must have gifted this session"
          checked={rule.gate.giftersOnly}
          onChange={(giftersOnly) => onChange({ gate: { ...rule.gate, giftersOnly } })}
        />
      </Row>

      <Row>
        <Field label="Min diamonds gifted this session">
          <NumberInput
            value={rule.gate.minSessionDiamonds}
            onChange={(minSessionDiamonds) => onChange({ gate: { ...rule.gate, minSessionDiamonds } })}
            min={0}
          />
        </Field>
        <Field
          label="Min follower count"
          hint={gateWarning('followerCount', rule.platforms) ?? undefined}
        >
          <NumberInput
            value={rule.gate.minFollowerCount}
            onChange={(minFollowerCount) => onChange({ gate: { ...rule.gate, minFollowerCount } })}
            min={0}
          />
        </Field>
        <Field
          label="Min fans club level"
          hint={gateWarning('fansClubLevel', rule.platforms) ?? undefined}
        >
          <NumberInput
            value={rule.gate.minFansClubLevel}
            onChange={(minFansClubLevel) => onChange({ gate: { ...rule.gate, minFansClubLevel } })}
            min={0}
          />
        </Field>
      </Row>

      <Field label="Always allowed" hint="@handles that bypass every gate above">
        <ListEditor
          values={rule.gate.allowUsers}
          onChange={(allowUsers) => onChange({ gate: { ...rule.gate, allowUsers } })}
          rows={3}
          placeholder={'bestfriend\nmoderator1'}
        />
      </Field>

      <h3>Conditions</h3>
      {isTextRule ? (
        <>
          <Row>
            <Field label="Required prefix" hint="e.g. !say — leave blank to match any message">
              <TextInput
                value={rule.conditions.requirePrefix}
                onChange={(requirePrefix) => onChange({ conditions: { ...rule.conditions, requirePrefix } })}
                placeholder="(any message)"
              />
            </Field>
            <Field label=" ">
              <Toggle
                label="Strip the prefix before speaking"
                checked={rule.conditions.stripPrefix}
                onChange={(stripPrefix) => onChange({ conditions: { ...rule.conditions, stripPrefix } })}
              />
            </Field>
            <Field label="Min message length">
              <NumberInput
                value={rule.conditions.minLength}
                onChange={(minLength) => onChange({ conditions: { ...rule.conditions, minLength } })}
                min={0}
              />
            </Field>
          </Row>
          <Field label="Must match regex" hint="Optional, case-insensitive">
            <TextInput
              monospace
              value={rule.conditions.matchRegex}
              onChange={(matchRegex) => onChange({ conditions: { ...rule.conditions, matchRegex } })}
              placeholder="(any)"
            />
          </Field>
        </>
      ) : null}

      {isGiftRule ? (
        <Row>
          <Field label="Min diamonds" hint="Gift value after the streak finishes">
            <NumberInput
              value={rule.conditions.minDiamonds}
              onChange={(minDiamonds) => onChange({ conditions: { ...rule.conditions, minDiamonds } })}
              min={0}
            />
          </Field>
          <Field label="Only these gifts" hint="Blank means any gift">
            <ListEditor
              values={rule.conditions.giftNames}
              onChange={(giftNames) => onChange({ conditions: { ...rule.conditions, giftNames } })}
              rows={3}
              placeholder={'Rose\nGalaxy'}
            />
          </Field>
        </Row>
      ) : null}
    </div>
  );
}

/**
 * Warns when a rule's gate cannot be satisfied on a platform it targets.
 *
 * The failure this prevents is entirely silent: a rule gated on "followers
 * only" is correct and useful on TikTok, and on Twitch it rejects every
 * ordinary viewer for ever, because Twitch's chat connection carries no follow
 * relationship to check. Nothing errors. Nothing is logged. The rule sits
 * there enabled, matching the right events, and never speaks.
 *
 * Deliberately worded as "only you and your moderators" rather than "nothing
 * will match", because the host and moderators bypass these gates and it would
 * otherwise be a lie you could disprove in ten seconds by typing in your own
 * chat — which is exactly how this went unnoticed in the first place.
 */
function GateReach({ rule }: { rule: TtsRule }): JSX.Element | null {
  const blocked: Array<{ signal: Parameters<typeof gateWarning>[0]; label: string }> = [];
  if (rule.gate.followersOnly) blocked.push({ signal: 'follower', label: 'Followers only' });
  if (rule.gate.friendsOnly) blocked.push({ signal: 'friend', label: 'Mutuals only' });
  if (rule.gate.subscribersOnly) blocked.push({ signal: 'subscriber', label: 'Subscribers only' });
  if (rule.gate.minFollowerCount > 0)
    blocked.push({ signal: 'followerCount', label: 'Min follower count' });
  if (rule.gate.minFansClubLevel > 0)
    blocked.push({ signal: 'fansClubLevel', label: 'Min fans club level' });

  const problems = blocked
    .map((entry) => ({ ...entry, missing: platformsMissing(entry.signal, rule.platforms) }))
    .filter((entry) => entry.missing.length > 0);

  if (problems.length === 0) return null;

  return (
    <div className="banner banner-warn gate-reach">
      {problems.map((problem) => (
        <p key={problem.signal}>
          <strong>{problem.label}</strong> — {gateWarning(problem.signal, rule.platforms)}
        </p>
      ))}
      <p className="muted">
        Scope this rule to the platforms it suits, and add a separate rule for the others.
      </p>
    </div>
  );
}
