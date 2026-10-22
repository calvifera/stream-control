import { useState } from 'react';
import { type AppConfig } from '@streaming/shared';
import { api, type ServerMeta, type VoiceProbeResult } from '../lib/api.js';
import { useVoices } from '../lib/useVoices.js';
import { CredentialField, credentialField, useCredentials } from './CredentialsTab.js';
import { useLive } from '../lib/store.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { Button, Field, NumberInput, Panel, Row, Select, Slider, TextInput, Toggle } from './controls.js';
import { Page, SubTabs, useSubTab } from './layout.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
  meta: ServerMeta | null;
  /** Called after a key is saved, so the server-reported "is it set" is re-read. */
  onCredentialsChanged: () => void;
}

const SUBS = ['engine', 'test'] as const;

export function TtsTab({ config, patch, meta, onCredentialsChanged }: Props): JSX.Element {
  const { tts: ttsState } = useLive();
  const { statusOf, reload: reloadCredentials } = useCredentials();
  const [sub, setSub] = useSubTab('speech', 'engine', SUBS);
  // Bumped when a key is saved, so the voice list — which a Google key is what
  // makes fetchable in the first place — is asked for again.
  const [credentialVersion, setCredentialVersion] = useState(0);
  const credentialsSaved = (): void => {
    reloadCredentials();
    setCredentialVersion((version) => version + 1);
    onCredentialsChanged();
  };
  const tts = config.tts;
  const [testText, setTestText] = usePersistentState('tts.testText', 'Testing one two three');
  const [testVoice, setTestVoice] = usePersistentState('tts.testVoice', '');
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<VoiceProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  // Voice lists differ per backend, so every dropdown here follows the
  // currently selected provider rather than a hardcoded catalogue.
  const { options: voiceOptions, loading: voicesLoading } = useVoices(tts.provider, credentialVersion);
  const providerStatus = meta?.providers.find((p) => p.id === tts.provider);

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
  const runTest = async (): Promise<void> => {
    setTestMessage('Fetching audio…');
    const result = await api.testTts(testText, testVoice);
    setTestMessage(
      result.playing
        ? `Playing now${result.filtered ? ' (the filter changed the text)' : ''}`
        : (result.reason ?? 'Nothing played'),
    );
  };

  const engineBroken = Boolean(providerStatus && !providerStatus.configured);
  const listeners = ttsState?.overlayListeners ?? 0;

  return (
    <Page
      title="Voice"
      lead="Pick the voice engine, set how loudly and how fast clips play, and try a voice. What gets spoken is decided under Speech rules."
      actions={
        <Toggle label="Speech on" checked={tts.enabled} onChange={(enabled) => setTts({ enabled })} />
      }
    >
      <SubTabs
        label="Speech sections"
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'engine', label: 'Engine', attention: engineBroken || mismatchedRules.length > 0 },
          { id: 'test', label: 'Test and queue', note: ttsState?.queue.length ? ttsState.queue.length : null },
        ]}
      />

      {sub === 'engine' ? (
        <>
          <Panel
            title="Voice engine"
            description="This server generates the speech, and the TTS audio overlay plays it, so your streaming software can capture the sound."
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

            {providerStatus && !providerStatus.configured ? (
              <div className="banner banner-error">{providerStatus.hint}</div>
            ) : null}

            {mismatchedRules.length > 0 ? (
              <div className="banner banner-warn">
                {mismatchedRules.length} speech rule{mismatchedRules.length === 1 ? '' : 's'}{' '}
                {mismatchedRules.length === 1 ? 'uses a voice' : 'use voices'} that this provider
                doesn't have (<code>{mismatchedRules.map((r) => r.voice).join('</code>, <code>')}</code>).{' '}
                {mismatchedRules.length === 1 ? 'It speaks' : 'They speak'} in the default voice until
                you pick a new one under Speech rules.
              </div>
            ) : null}

            {tts.provider === 'google' ? (
              <>
                <CredentialField
                  field={credentialField('GOOGLE_TTS_API_KEY')}
                  status={statusOf('GOOGLE_TTS_API_KEY')}
                  onSaved={credentialsSaved}
                />
                <Row>
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
                  stream reads perhaps 50k in a session, so this should cost nothing. Pitch and speed
                  are applied by Google rather than in the browser, which sounds cleaner.
                </div>
              </>
            ) : null}

            {tts.provider === 'google-legacy' ? (
              <>
                <Row>
                  <Field label="Default voice" hint="This provider offers two voices per language, one male and one female">
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
                <div className="banner banner-warn">
                  These are the "default male/female" voices many other stream tools use. They need no
                  key because they borrow a key that Google publishes inside Chromium, so the quota
                  isn't yours. Google can limit or revoke it at any time, and using it goes against
                  Google's terms. Speed and pitch work, but each language has only two voices. Set up{' '}
                  <strong>Google Cloud TTS</strong> as a backup.
                </div>
              </>
            ) : null}

            {tts.provider === 'tiktok' ? (
              <>
                <CredentialField
                  field={credentialField('TIKTOK_SESSION_ID')}
                  status={statusOf('TIKTOK_SESSION_ID')}
                  onSaved={credentialsSaved}
                />
                <Row>
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
              </>
            ) : null}
          </Panel>

          <Panel
            title="Loudness and delivery"
            description="How loud speech is, how many messages can wait to be read, and what happens when something goes wrong."
          >
            <Row>
              <Toggle
                label="Make speech louder and more even"
                hint="Generated speech is quiet on average, so game audio drowns it out even at full volume. This evens out the quiet and loud parts and raises the overall level. Turning the volume up alone would distort it."
                checked={tts.normalizeLoudness}
                onChange={(normalizeLoudness) => setTts({ normalizeLoudness })}
              />
              {tts.normalizeLoudness ? (
                <Field
                  label="Loudness boost (dB)"
                  hint="Make-up gain after compression. 8 dB measured about twice as loud with nothing clipped; raise it if speech still sits under your game."
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

            <h3>Queue</h3>
            <Row>
              <Field label="Most messages waiting">
                <NumberInput
                  value={tts.maxQueueLength}
                  onChange={(maxQueueLength) => setTts({ maxQueueLength })}
                  min={1}
                  max={500}
                />
              </Field>
              <Field label="Skip messages waiting longer than (seconds)">
                <NumberInput
                  value={tts.itemTtlSeconds}
                  onChange={(itemTtlSeconds) => setTts({ itemTtlSeconds })}
                  min={5}
                  max={3600}
                />
              </Field>
              <Field label="Pause between messages (milliseconds)">
                <NumberInput value={tts.gapMs} onChange={(gapMs) => setTts({ gapMs })} min={0} max={10000} step={50} />
              </Field>
              <Field
                label="Cooldown per viewer (seconds)"
                hint={
                  tts.userCooldownSeconds > 0
                    ? `After someone is read aloud, they are skipped for ${tts.userCooldownSeconds} seconds, whichever rule matches. Allowed viewers are exempt.`
                    : 'Off. Set it above 0 to stop one viewer taking over the queue by triggering several rules in a row.'
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

            <h3>When things go wrong</h3>
            <Toggle
              label="Fall back to browser speech"
              hint="Uses your browser's built-in voice when the chosen provider fails, for example with an expired TikTok session or a regional block"
              checked={tts.fallbackToBrowser}
              onChange={(fallbackToBrowser) => setTts({ fallbackToBrowser })}
            />
            <Toggle
              label="Skip speech while the TTS audio overlay is closed"
              hint="When this is off, messages wait in the queue and all play at once when you open the overlay"
              checked={tts.skipWhenNoListener}
              onChange={(skipWhenNoListener) => setTts({ skipWhenNoListener })}
            />
            <Toggle
              label="Also play speech in this dashboard"
              hint={
                listeners > 0
                  ? 'Lets you hear what viewers hear. You will hear it twice if your streaming software also plays the TTS audio overlay through your speakers'
                  : 'No TTS audio overlay is open, so speech already plays here. This matters once an overlay is running'
              }
              checked={tts.monitorInDashboard}
              onChange={(monitorInDashboard) => setTts({ monitorInDashboard })}
            />
          </Panel>
        </>
      ) : null}

      {sub === 'test' ? (
        <>
          <Panel
            title="Try a voice"
            description="Runs through the same text filter a real message does, then speaks it."
          >
            <Row>
              <Field label="Text">
                <TextInput value={testText} onChange={setTestText} />
              </Field>
              <Field label="Voice" hint={voicesLoading ? 'Loading voices…' : undefined}>
                <Select value={testVoice || (voiceOptions[0]?.value ?? '')} onChange={setTestVoice} options={voiceOptions} />
              </Field>
            </Row>
            <div className="button-row">
              <Button variant="primary" onClick={() => void runTest()}>
                Speak
              </Button>
              <Button onClick={() => void api.skipTts()}>Skip current</Button>
              <Button variant="danger" onClick={() => void api.clearTts()}>
                Clear queue
              </Button>
            </div>
            {testMessage ? <div className="banner">{testMessage}</div> : null}
          </Panel>

          <Panel title="Queue now">
            <div className="status-line">
              <strong>{listeners}</strong>
              <span className="muted">TTS browser {listeners === 1 ? 'source' : 'sources'} open</span>
              <strong>{ttsState?.queue.length ?? 0}</strong>
              <span className="muted">queued</span>
              {ttsState?.speaking ? (
                <span className="muted">speaking: “{ttsState.speaking.text.slice(0, 50)}”</span>
              ) : null}
              {ttsState?.lastError ? <span className="error-text">{ttsState.lastError}</span> : null}
            </div>

            {listeners === 0 ? (
              <div className="banner banner-warn">
                No TTS browser source is open, so speech plays through this dashboard tab instead.
                Fine for testing — but add the <strong>TTS audio</strong> browser source before going
                live, or your viewers won't hear any of it.
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Check which voices your account can use"
            description="There is no TikTok endpoint that lists voices: the catalogue is a fixed set of speaker codes. What can be checked is which of them your session is actually allowed to synthesize, by trying each one."
            actions={
              <Button
                variant="primary"
                disabled={probing}
                onClick={() => {
                  setProbing(true);
                  setProbeError(null);
                  void api
                    .probeVoices()
                    .then(setProbe)
                    .catch((err: unknown) => setProbeError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setProbing(false));
                }}
              >
                {probing ? 'Testing…' : 'Test voices'}
              </Button>
            }
          >
            {probing ? <p className="muted">Synthesizing one word per voice. This takes a minute.</p> : null}
            {probeError ? <div className="banner banner-error">{probeError}</div> : null}

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
                      {voiceOptions.find((v) => v.value === result.code)?.label ?? result.code}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </Panel>
        </>
      ) : null}
    </Page>
  );
}
