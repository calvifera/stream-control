import { useState } from 'react';
import {
  DEFAULT_TTS_RULE,
  gateMeaning,
  gateWarning,
  PLATFORM_INFO,
  PLATFORMS,
  STREAM_EVENT_LABELS,
  STREAM_EVENT_TYPES,
  VIEWER_ROLES,
  type AppConfig,
  type Platform,
  type RuleCondition,
  type RuleConditionType,
  type StreamEventType,
  type TtsRule,
} from '@streaming/shared';
import { useVoices } from '../lib/useVoices.js';
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
import { Icon } from './icons.js';
import { Page } from './layout.js';
import {
  CONDITION_META,
  CONDITION_ORDER,
  CONDITION_ROW_LABEL,
  VIEWER_ROLE_LABELS,
  conditionApplies,
  conditionsBrief,
  describeEvents,
  describeRule,
  eventsLabel,
  newCondition,
  platformsLabel,
  signalOf,
} from './ruleSummary.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
  go: (target: { tab: string; area?: string; sub?: string }) => void;
}

const PLATFORM_OPTIONS = PLATFORMS.map((id) => ({ value: id, label: PLATFORM_INFO[id].label }));

const EVENT_OPTIONS = STREAM_EVENT_TYPES.filter(
  (type) => !['roomStats', 'streamEnd', 'system', 'emote'].includes(type),
).map((type) => ({ value: type, label: STREAM_EVENT_LABELS[type] }));

export function RulesTab({ config, patch, go }: Props): JSX.Element {
  const tts = config.tts;
  const [editingId, setEditingId] = usePersistentState<string | null>(
    'rules.editing',
    null,
    (stored) => stored === null || tts.rules.some((rule) => rule.id === stored),
  );
  const [search, setSearch] = useState('');
  const { options: voiceOptions } = useVoices(tts.provider, 0);
  const voiceOptionsWithRandom = [
    { value: 'random', label: 'Random from pool', group: 'Special' },
    ...voiceOptions,
  ];
  const voiceLabelOf = (voice: string): string =>
    voiceOptionsWithRandom.find((option) => option.value === voice)?.label ?? voice;

  const setTts = (next: Partial<AppConfig['tts']>): void => patch({ tts: next });
  const updateRule = (id: string, next: Partial<TtsRule>): void => {
    setTts({ rules: tts.rules.map((rule) => (rule.id === id ? { ...rule, ...next } : rule)) });
  };
  const addRule = (): void => {
    const id = `rule-${Date.now().toString(36)}`;
    setTts({ rules: [...tts.rules, { ...DEFAULT_TTS_RULE, id, conditions: [], alwaysAllow: [] }] });
    setEditingId(id);
  };
  const duplicateRule = (rule: TtsRule): void => {
    const id = `rule-${Date.now().toString(36)}`;
    const copy: TtsRule = {
      ...rule,
      id,
      name: `${rule.name} copy`,
      conditions: rule.conditions.map((condition) => ({ ...condition, id: `${condition.id}-${id}` })),
    };
    setTts({ rules: [...tts.rules, copy] });
    setEditingId(id);
  };
  const deleteRule = (id: string): void => {
    setTts({ rules: tts.rules.filter((rule) => rule.id !== id) });
    setEditingId(null);
  };

  const editing = tts.rules.find((rule) => rule.id === editingId) ?? null;

  return (
    <Page
      title="Speech rules"
      lead="Each rule says which events to read out, which conditions must be true, and what to say."
      actions={
        <Toggle label="Speech on" checked={tts.enabled} onChange={(enabled) => setTts({ enabled })} />
      }
    >
      {editing ? (
        <RuleForm
          key={editing.id}
          rule={editing}
          voiceOptions={voiceOptionsWithRandom}
          voiceLabel={voiceLabelOf(editing.voice)}
          onChange={(next) => updateRule(editing.id, next)}
          onBack={() => setEditingId(null)}
          onDuplicate={() => duplicateRule(editing)}
          onDelete={() => deleteRule(editing.id)}
        />
      ) : (
        <>
          <Panel
            title="Who can be spoken"
            description="The rules below decide what is read. This decides whose messages are eligible at all."
          >
            <Toggle
              label="Only the allow list"
              hint={
                tts.onlyAllowList
                  ? 'On: nobody is spoken unless they are on the allow list. You are always allowed. Each person keeps their own voice settings.'
                  : 'Off: anyone can be spoken if a rule matches them.'
              }
              checked={tts.onlyAllowList}
              onChange={(onlyAllowList) => setTts({ onlyAllowList })}
            />
            <p className="muted rules-allow-line">
              <strong>{config.users.trusted.length}</strong> {config.users.trusted.length === 1 ? 'person' : 'people'} on the
              allow list.{' '}
              <button type="button" className="link" onClick={() => go({ tab: 'People', area: 'people', sub: 'viewers' })}>
                Edit the allow list
              </button>
            </p>
            {tts.onlyAllowList && config.users.trusted.length === 0 ? (
              <div className="banner banner-warn">
                The allow list is empty, so nobody except you will be spoken.
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Rules"
            description="Every enabled rule that matches an event speaks. Higher priority is read first."
            actions={
              <Button variant="primary" onClick={addRule}>
                New rule
              </Button>
            }
          >
            <RulesTable
              rules={tts.rules}
              search={search}
              onSearch={setSearch}
              voiceLabelOf={voiceLabelOf}
              onOpen={setEditingId}
              onToggle={(rule) => updateRule(rule.id, { enabled: !rule.enabled })}
            />
          </Panel>
        </>
      )}
    </Page>
  );
}

function RulesTable({
  rules,
  search,
  onSearch,
  voiceLabelOf,
  onOpen,
  onToggle,
}: {
  rules: TtsRule[];
  search: string;
  onSearch: (value: string) => void;
  voiceLabelOf: (voice: string) => string;
  onOpen: (id: string) => void;
  onToggle: (rule: TtsRule) => void;
}): JSX.Element {
  if (rules.length === 0) {
    return <p className="muted">No rules yet. Without one, nothing is spoken. Use New rule to add one.</p>;
  }

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? rules.filter((rule) =>
        [rule.name, eventsLabel(rule), platformsLabel(rule), rule.template].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : rules;

  return (
    <>
      {rules.length > 6 ? (
        <div className="rules-toolbar">
          <input
            className="input"
            type="search"
            value={search}
            placeholder="Search rules"
            aria-label="Search rules"
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="table rules-table">
          <thead>
            <tr>
              <th scope="col" className="rules-col-on">On</th>
              <th scope="col">Rule</th>
              <th scope="col">When</th>
              <th scope="col">Conditions</th>
              <th scope="col">Voice</th>
              <th scope="col" className="rules-col-num">Priority</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((rule) => {
              const brief = conditionsBrief(rule);
              return (
                <tr key={rule.id} className={rule.enabled ? undefined : 'rules-row-off'}>
                  <td className="rules-col-on">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      aria-label={`${rule.name} is ${rule.enabled ? 'on' : 'off'}`}
                      className={rule.enabled ? 'mini-switch mini-switch-on' : 'mini-switch'}
                      onClick={() => onToggle(rule)}
                    >
                      {rule.enabled ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="rules-name" onClick={() => onOpen(rule.id)}>
                      {rule.name || 'Untitled rule'}
                    </button>
                  </td>
                  <td>
                    <span className="rules-cell-main">{eventsLabel(rule)}</span>
                    <span className="rules-cell-sub">{platformsLabel(rule)}</span>
                  </td>
                  <td>
                    {brief ? (
                      <>
                        <span className="rules-cell-main">{brief.first}</span>
                        {brief.more > 0 ? <span className="rules-cell-sub">and {brief.more} more</span> : null}
                      </>
                    ) : (
                      <span className="rules-cell-sub">Always</span>
                    )}
                  </td>
                  <td>
                    <span className="rules-cell-main">{rule.voice === 'random' ? 'Random from pool' : voiceLabelOf(rule.voice)}</span>
                  </td>
                  <td className="rules-col-num">{rule.priority}</td>
                </tr>
              );
            })}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No rule matches “{search}”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RuleForm({
  rule,
  voiceOptions,
  voiceLabel,
  onChange,
  onBack,
  onDuplicate,
  onDelete,
}: {
  rule: TtsRule;
  voiceOptions: Array<{ value: string; label: string; group: string }>;
  voiceLabel: string;
  onChange: (next: Partial<TtsRule>) => void;
  onBack: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasViewerConditions = rule.conditions.some((condition) => CONDITION_META[condition.type].group === 'Viewer');

  const setCondition = (id: string, next: RuleCondition): void => {
    onChange({ conditions: rule.conditions.map((condition) => (condition.id === id ? next : condition)) });
  };
  const removeCondition = (id: string): void => {
    onChange({ conditions: rule.conditions.filter((condition) => condition.id !== id) });
  };
  const addCondition = (type: RuleConditionType): void => {
    onChange({ conditions: [...rule.conditions, newCondition(type)] });
  };

  // Offer what makes sense for the events chosen, but never hide a kind the
  // rule already uses.
  const addable = CONDITION_ORDER.filter((type) => conditionApplies(type, rule));

  return (
    <>
      <div className="rules-back">
        <Button variant="ghost" onClick={onBack}>
          <span className="rules-back-arrow">
            <Icon name="arrow" size={16} />
          </span>
          All rules
        </Button>
      </div>

      <Panel title="Rule">
        <div className="rules-name-row">
          <Field label="Name">
            <TextInput value={rule.name} onChange={(name) => onChange({ name })} />
          </Field>
          <Toggle label="Enabled" checked={rule.enabled} onChange={(enabled) => onChange({ enabled })} />
        </div>
        <p className="rules-summary">{describeRule(rule, voiceLabel)}</p>
      </Panel>

      <Panel title="When" description="Which events this rule listens to.">
        <Field label="Events">
          <ChipSelect
            values={rule.eventTypes}
            options={EVENT_OPTIONS}
            onChange={(eventTypes) => onChange({ eventTypes: eventTypes as StreamEventType[] })}
          />
        </Field>
        <Field
          label="Platforms"
          hint="Leave all unselected to cover every connected platform. Pick some to scope the rule, for example read chat on TikTok but only announce gifts on Twitch."
        >
          <ChipSelect
            values={rule.platforms}
            options={PLATFORM_OPTIONS}
            onChange={(platforms) => onChange({ platforms: platforms as Platform[] })}
          />
        </Field>
      </Panel>

      <Panel
        title="Conditions"
        description={
          rule.conditions.length === 0
            ? 'None: the rule speaks every time one of its events happens.'
            : 'All of these must be true.'
        }
        actions={
          <select
            className="input rules-add"
            aria-label="Add a condition"
            value=""
            onChange={(event) => {
              if (event.target.value) addCondition(event.target.value as RuleConditionType);
            }}
          >
            <option value="">Add condition…</option>
            {(['Message', 'Gift', 'Likes', 'Viewer'] as const).map((group) => {
              const items = addable.filter((type) => CONDITION_META[type].group === group);
              return items.length === 0 ? null : (
                <optgroup key={group} label={group}>
                  {items.map((type) => (
                    <option key={type} value={type}>
                      {CONDITION_META[type].label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        }
      >
        {rule.conditions.length > 0 ? (
          <ul className="cond-list">
            {rule.conditions.map((condition, index) => (
              <ConditionRow
                key={condition.id}
                index={index}
                condition={condition}
                rule={rule}
                onChange={(next) => setCondition(condition.id, next)}
                onRemove={() => removeCondition(condition.id)}
              />
            ))}
          </ul>
        ) : null}

        {hasViewerConditions ? (
          <Field
            label="Always allowed"
            hint="One @handle per line. These viewers skip the viewer conditions above. You and your moderators already do."
          >
            <ListEditor
              values={rule.alwaysAllow}
              onChange={(alwaysAllow) => onChange({ alwaysAllow })}
              rows={3}
              placeholder={'bestfriend\nmoderator1'}
            />
          </Field>
        ) : null}
      </Panel>

      <Panel title="Then speak">
        <Field
          label="Text"
          hint="Placeholders: {{nickname}} {{username}} {{message}} {{gift}} {{count}} {{diamonds}} {{likes}} {{months}}"
        >
          <TextArea value={rule.template} onChange={(template) => onChange({ template })} rows={2} />
        </Field>

        <Row>
          <Field label="Voice">
            <Select value={rule.voice} onChange={(voice) => onChange({ voice })} options={voiceOptions} />
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
          <Field label="Speed">
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
      </Panel>

      <Panel title="Limits">
        <Row>
          <Field label="Priority" hint="Higher is read first when the queue is busy">
            <NumberInput value={rule.priority} onChange={(priority) => onChange({ priority })} min={-100} max={100} />
          </Field>
          <Field label="Cooldown per viewer (seconds)" hint="0 turns it off">
            <NumberInput
              value={rule.cooldownSeconds}
              onChange={(cooldownSeconds) => onChange({ cooldownSeconds })}
              min={0}
              max={3600}
            />
          </Field>
        </Row>
      </Panel>

      {/* Set apart on purpose: nothing near it is a button you might hit by
          accident, and it asks twice. */}
      <footer className="rules-foot">
        <Button onClick={onDuplicate}>Duplicate</Button>
        {confirmDelete ? (
          <div className="rules-foot-confirm">
            <span className="muted">Delete “{rule.name}”? This cannot be undone.</span>
            <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="danger" onClick={onDelete}>
              Delete rule
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete rule…
          </Button>
        )}
      </footer>
    </>
  );
}

function ConditionRow({
  index,
  condition,
  rule,
  onChange,
  onRemove,
}: {
  index: number;
  condition: RuleCondition;
  rule: TtsRule;
  onChange: (next: RuleCondition) => void;
  onRemove: () => void;
}): JSX.Element {
  const applies = conditionApplies(condition.type, rule);
  const signal = signalOf(condition);
  // Which platforms in scope can never satisfy this, and what it means where
  // it can: the failure here is silent, so say it where the condition is set.
  const warning = signal ? gateWarning(signal, rule.platforms) : null;
  const meaning = signal && !warning ? gateMeaning(signal, rule.platforms) : null;
  const label = CONDITION_ROW_LABEL[condition.type];

  return (
    <li className={applies ? 'cond-row' : 'cond-row cond-row-idle'}>
      <span className="cond-index" aria-hidden="true">
        {index === 0 ? 'If' : 'And'}
      </span>
      <div className="cond-body">
        <div className="cond-line">
          <span className="cond-label">{label}</span>
          <div className="cond-inputs">{renderInputs(condition, onChange)}</div>
        </div>
        {!applies ? (
          <p className="cond-note">
            Not used: this rule does not listen to {conditionEvents(condition.type)}.
          </p>
        ) : null}
        {warning ? <p className="cond-note cond-note-warn">{warning}</p> : null}
        {meaning ? <p className="cond-note">{meaning}</p> : null}
      </div>
      <button type="button" className="icon-btn" aria-label={`Remove condition: ${label}`} onClick={onRemove}>
        <Icon name="close" size={16} />
      </button>
    </li>
  );
}

function conditionEvents(type: RuleConditionType): string {
  const events = CONDITION_META[type].events;
  if (events === 'any') return 'anything';
  return describeEvents({ eventTypes: [...events] } as TtsRule);
}

function renderInputs(condition: RuleCondition, onChange: (next: RuleCondition) => void): JSX.Element {
  switch (condition.type) {
    case 'startsWith':
      return (
        <>
          <TextInput
            value={condition.text}
            onChange={(text) => onChange({ ...condition, text })}
            placeholder="!say"
          />
          <Toggle
            label="Remove it before speaking"
            checked={condition.strip}
            onChange={(strip) => onChange({ ...condition, strip })}
          />
        </>
      );
    case 'matches':
      return (
        <TextInput
          monospace
          value={condition.pattern}
          onChange={(pattern) => onChange({ ...condition, pattern })}
          placeholder="regular expression, not case-sensitive"
        />
      );
    case 'minLength':
      return <NumberInput value={condition.chars} onChange={(chars) => onChange({ ...condition, chars })} min={0} />;
    case 'giftValue':
      return (
        <NumberInput
          value={condition.diamonds}
          onChange={(diamonds) => onChange({ ...condition, diamonds })}
          min={0}
        />
      );
    case 'giftIs':
      return (
        <ListEditor
          values={condition.names}
          onChange={(names) => onChange({ ...condition, names })}
          rows={3}
          placeholder={'Rose\nGalaxy'}
        />
      );
    case 'likeCount':
      return <NumberInput value={condition.count} onChange={(count) => onChange({ ...condition, count })} min={0} />;
    case 'viewerIs':
      return (
        <Select
          value={condition.role}
          onChange={(role) => onChange({ ...condition, role })}
          options={VIEWER_ROLES.map((role) => ({ value: role, label: VIEWER_ROLE_LABELS[role] }))}
        />
      );
    case 'viewerGifted':
      return (
        <NumberInput
          value={condition.diamonds}
          onChange={(diamonds) => onChange({ ...condition, diamonds })}
          min={0}
        />
      );
    case 'followerCount':
      return <NumberInput value={condition.count} onChange={(count) => onChange({ ...condition, count })} min={0} />;
    case 'fansClub':
      return <NumberInput value={condition.level} onChange={(level) => onChange({ ...condition, level })} min={0} />;
  }
}

