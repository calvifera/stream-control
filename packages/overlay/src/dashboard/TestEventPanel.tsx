import { useState } from 'react';
import {
  gateWarning,
  PLATFORM_INFO,
  PLATFORMS,
  STREAM_EVENT_LABELS,
  TEST_PERSONAS,
  type Platform,
  type StreamEventType,
  type TestEventOutcome,
  type TestEventSpec,
} from '@streaming/shared';
import { api } from '../lib/api.js';
import { Button, Field, NumberInput, Panel, Row, Select, TextInput, Toggle } from './controls.js';
import { PlatformLogo } from '../lib/PlatformLogo.js';

/**
 * Spoofing an event precisely enough to answer a real question.
 *
 * The question is almost never "does an overlay render" — it is "will my rule
 * fire for this kind of person on this platform", and that cannot be answered
 * by a button that invents a random viewer. A gate keyed on subscribers needs
 * a subscriber to test it, and waiting for a real one is not a debugging
 * strategy.
 *
 * So: pick who, pick where, fire, and read back whether anything spoke and
 * which gate turned it away if not.
 */

const TESTABLE: StreamEventType[] = [
  'chat',
  'gift',
  'follow',
  'share',
  'like',
  'join',
  'subscribe',
  'question',
];

export function TestEventPanel(): JSX.Element {
  const [type, setType] = useState<StreamEventType>('chat');
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [text, setText] = useState('');
  const [username, setUsername] = useState('');
  const [persona, setPersona] = useState<string>('stranger');
  const [count, setCount] = useState(1);
  const [record, setRecord] = useState(false);
  const [diamonds, setDiamonds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestEventOutcome | null>(null);
  const [fired, setFired] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const roles = TEST_PERSONAS.find((p) => p.id === persona)?.roles ?? {};

  // The persona is a claim about a viewer; whether the platform could actually
  // *tell* you that is a separate question, and the difference is what makes a
  // rule work in testing and never fire live.
  const unreportable =
    persona === 'follower'
      ? gateWarning('follower', [platform])
      : persona === 'mutual'
        ? gateWarning('friend', [platform])
        : persona === 'subscriber'
          ? gateWarning('subscriber', [platform])
          : null;

  const fire = (): void => {
    setBusy(true);
    setError(null);
    const spec: TestEventSpec = {
      type,
      platform,
      ...roles,
      ...(text.trim() ? { text: text.trim() } : {}),
      ...(username.trim() ? { username: username.trim() } : {}),
      ...(diamonds > 0 ? { diamonds } : {}),
      count,
      intervalMs: count > 1 ? 350 : 0,
      recordToArchive: record,
    };

    void api
      .testEvent(spec)
      .then((response) => {
        setResult(response.outcome ?? null);
        setFired(response.fired ?? 0);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <Panel
      title="Fire a test event"
      description="Runs a synthetic event through the whole pipeline — filters, gates, TTS and every overlay — and reports what happened to it."
    >
      <Row>
        <Field label="Event type">
          <Select
            value={type}
            onChange={setType}
            options={TESTABLE.map((id) => ({ value: id, label: STREAM_EVENT_LABELS[id] }))}
          />
        </Field>
        <Field label="Platform" hint="Decides which gates can even be satisfied">
          <Select
            value={platform}
            onChange={(value) => setPlatform(value as Platform)}
            options={PLATFORMS.map((id) => ({ value: id, label: PLATFORM_INFO[id].label }))}
          />
        </Field>
        <Field label="Send as" hint="Which kind of viewer — this is what gates check">
          <Select
            value={persona}
            onChange={setPersona}
            options={TEST_PERSONAS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Field>
      </Row>

      {unreportable ? (
        <div className="banner banner-warn gate-reach">
          <p>{unreportable}</p>
          <p className="muted">
            You can still fire it — it shows what would happen if the platform could tell you. It
            just will not happen live.
          </p>
        </div>
      ) : null}

      <Row>
        <Field label="Handle" hint="Blank for a random fake name">
          <TextInput value={username} onChange={setUsername} placeholder="(random)" />
        </Field>
        <Field label="Message" hint="Chat and question events">
          <TextInput value={text} onChange={setText} placeholder="(random)" />
        </Field>
        {type === 'gift' ? (
          <Field label="Diamonds each" hint="0 for a random gift">
            <NumberInput value={diamonds} onChange={setDiamonds} min={0} max={50000} />
          </Field>
        ) : null}
        <Field label="How many" hint="Fires a burst, for cooldowns and queueing">
          <NumberInput value={count} onChange={setCount} min={1} max={50} />
        </Field>
      </Row>

      <Row>
        <Toggle
          label="Record in the viewer archive"
          hint="Off by default. Leaving it off means testing a rule fifty times does not invent fifty regulars who then sit in your archive for ever."
          checked={record}
          onChange={setRecord}
        />
        <Field label=" ">
          <Button variant="primary" disabled={busy} onClick={fire}>
            {busy ? 'Firing…' : count > 1 ? `Fire ${count}` : 'Fire'}
          </Button>
        </Field>
      </Row>

      {error ? <div className="banner banner-error">{error}</div> : null}
      {result ? <Outcome outcome={result} fired={fired} platform={platform} /> : null}
    </Panel>
  );
}

/** What happened to the event, in the order you would ask about it. */
function Outcome({
  outcome,
  fired,
  platform,
}: {
  outcome: TestEventOutcome;
  fired: number;
  platform: Platform;
}): JSX.Element {
  const nothing = outcome.spoke.length === 0 && outcome.declined.length === 0;

  return (
    <div className="test-outcome">
      <div className="test-outcome-head">
        <PlatformLogo platform={platform} size={13} />
        <span>
          Fired {fired} {fired === 1 ? 'event' : 'events'}
        </span>
        {outcome.synthetic ? (
          <span className="muted">· nothing written to the archive</span>
        ) : (
          <span className="muted">· recorded in the archive</span>
        )}
      </div>

      {outcome.filtered ? (
        <p className="test-line test-bad">
          Filtered — {outcome.filterReason ?? 'blocked'}. It never reached the rules.
        </p>
      ) : null}

      {outcome.spoke.length > 0 ? (
        <p className="test-line test-good">Spoke: {outcome.spoke.join(', ')}</p>
      ) : null}

      {outcome.declined.length > 0 ? (
        <ul className="test-declined">
          {outcome.declined.map((entry) => (
            <li key={`${entry.rule}-${entry.reason}`}>
              <strong>{entry.rule}</strong> declined — {entry.reason}
            </li>
          ))}
        </ul>
      ) : null}

      {nothing && !outcome.filtered ? (
        <p className="test-line muted">
          No rule matched this event type on {PLATFORM_INFO[platform].label}. Check the rule is
          enabled and that its platform list includes this one.
        </p>
      ) : null}
    </div>
  );
}
