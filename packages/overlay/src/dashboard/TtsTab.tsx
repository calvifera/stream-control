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
            description="Clips are made on the server and played by the TTS browser source, so your streaming software captures the audio."
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
                {mismatchedRules.length} rule{mismatchedRules.length === 1 ? '' : 's'} still
                {mismatchedRules.length === 1 ? ' uses a voice' : ' use voices'} from another backend
                (<code>{mismatchedRules.map((r) => r.voice).join('</code>, <code>')}</code>). They'll
                fall back to the default voice until you repick them under Speech rules.
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
                <div className="banner banner-warn">
                  This is the engine behind other tools' "default male/female" voices. It needs no key
                  because it rides <strong>Chromium's public API key</strong> — the quota isn't yours,
                  so Google can throttle or revoke it without warning, and using it sits outside their
                  terms. Speed and pitch are real parameters here, but there are only two voices per
                  language. Keep <strong>Google Cloud TTS</strong> configured as your fallback.
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
            description="How clips are levelled, how long the queue may grow, and what happens when something goes wrong."
          >
            <Row>
              <Toggle
                label="Match loudness to your stream"
                hint="Speech arrives peak-normalised but quiet on average, so it sits under game audio even at full volume. This compresses it and makes up the difference — turning the volume up alone would only clip."
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

            <h3>When things go wrong</h3>
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
            <Toggle
              label="Also play speech in this dashboard"
              hint={
                listeners > 0
                  ? 'A monitor feed for hearing what your viewers hear. Doubles up only if your streaming software also monitors that source to your speakers'
                  : 'No source is open, so speech already plays here. This only matters once one is running'
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
