import {
  HIGHLIGHT_CONDITIONS,
  HIGHLIGHT_SCOPES,
  PLATFORM_INFO,
  PLATFORMS,
  tierStyle,
  type AppConfig,
  type HighlightCondition,
  type HighlightTier,
  type Platform,
} from '@streaming/shared';
import { Button, ChipSelect, Field, NumberInput, Panel, Row, Select, TextInput, Toggle } from './controls.js';

/**
 * Editing the tiers that mark notable viewers.
 *
 * The hard part of this feature is not the gradient, it is knowing whether
 * you have set the threshold somewhere useful. An animated name works because
 * it is rare; set it too low and a third of chat is moving, at which point it
 * marks nobody and just makes chat harder to read. So every tier renders a
 * live sample of itself, and the editor says plainly what each condition will
 * and will not catch.
 */

interface Props {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}

const CONDITION_LABEL: Record<HighlightCondition, string> = {
  given: 'Has given at least…',
  subscriber: 'Is a subscriber / member',
  moderator: 'Is a moderator',
  host: 'Is the host',
};

/** What the platform actually calls the thing being counted. */
function unitFor(platforms: Platform[]): string {
  if (platforms.length === 1) {
    if (platforms[0] === 'tiktok') return 'diamonds';
    if (platforms[0] === 'twitch') return 'bits';
    return 'in Super Chats';
  }
  return "in each platform's own units";
}

const NEW_TIER = (): HighlightTier => ({
  id: `tier-${Date.now().toString(36)}`,
  label: 'New tier',
  enabled: true,
  platforms: [],
  condition: 'given',
  threshold: 1000,
  scope: 'session',
  colors: ['#7ef7d0', '#ffffff', '#3ba7ff'],
  speed: 4,
  priority: 0,
});

export function HighlightsPanel({ config, patch }: Props): JSX.Element {
  const tiers = config.highlights;

  const write = (next: HighlightTier[]): void => patch({ highlights: next });
  const update = (id: string, changes: Partial<HighlightTier>): void =>
    write(tiers.map((tier) => (tier.id === id ? { ...tier, ...changes } : tier)));

  return (
    <Panel
      title="Notable viewers"
      description="Gives a viewer an animated gradient name instead of their usual colour, so a gifter or a subscriber stands out from four hundred strangers. Applies to every chat overlay and to the pop-out panel."
    >
      {tiers.length === 0 ? (
        <p className="muted">
          No tiers. Every viewer gets their ordinary hashed colour, which is a perfectly reasonable
          way to run a chat.
        </p>
      ) : null}

      {tiers.map((tier) => (
        <TierEditor
          key={tier.id}
          tier={tier}
          onChange={(changes) => update(tier.id, changes)}
          onRemove={() => write(tiers.filter((entry) => entry.id !== tier.id))}
        />
      ))}

      <Row>
        <Button onClick={() => write([...tiers, NEW_TIER()])}>Add a tier</Button>
      </Row>

      <p className="muted highlight-note">
        Motion is the one thing that reliably pulls your eye off a game, which is the point — and
        also why it is worth rationing. If more than a handful of people per stream are animated,
        raise the thresholds rather than adding more tiers.
      </p>
    </Panel>
  );
}

function TierEditor({
  tier,
  onChange,
  onRemove,
}: {
  tier: HighlightTier;
  onChange: (changes: Partial<HighlightTier>) => void;
  onRemove: () => void;
}): JSX.Element {
  const setColor = (index: number, value: string): void => {
    const colors = [...tier.colors];
    colors[index] = value;
    onChange({ colors });
  };

  return (
    <div className={tier.enabled ? 'tier-card' : 'tier-card tier-card-off'}>
      <div className="tier-head">
        <span className="tier-sample" style={tierStyle(tier)}>
          {tier.label || 'Sample name'}
        </span>
        <Toggle label="On" checked={tier.enabled} onChange={(enabled) => onChange({ enabled })} />
        <Button variant="danger" onClick={onRemove}>
          Remove
        </Button>
      </div>

      <Row>
        <Field label="Name">
          <TextInput value={tier.label} onChange={(label) => onChange({ label })} />
        </Field>
        <Field label="Platforms" hint="None selected applies it everywhere">
          <ChipSelect
            values={tier.platforms}
            options={PLATFORMS.map((id) => ({ value: id, label: PLATFORM_INFO[id].label }))}
            onChange={(platforms) => onChange({ platforms: platforms as Platform[] })}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Applies when">
          <Select
            value={tier.condition}
            onChange={(condition) => onChange({ condition })}
            options={HIGHLIGHT_CONDITIONS.map((id) => ({ value: id, label: CONDITION_LABEL[id] }))}
          />
        </Field>
        {tier.condition === 'given' ? (
          <>
            <Field label="Amount" hint={unitFor(tier.platforms)}>
              <NumberInput
                value={tier.threshold}
                onChange={(threshold) => onChange({ threshold })}
                min={1}
                max={1000000}
              />
            </Field>
            <Field
              label="Counting"
              hint={
                tier.scope === 'session'
                  ? 'Resets when the stream does'
                  : 'Every stream, all the way back'
              }
            >
              <Select
                value={tier.scope}
                onChange={(scope) => onChange({ scope })}
                options={HIGHLIGHT_SCOPES.map((id) => ({
                  value: id,
                  label: id === 'session' ? 'This stream' : 'All time',
                }))}
              />
            </Field>
          </>
        ) : null}
        <Field label="Priority" hint="Higher wins when two tiers both match">
          <NumberInput
            value={tier.priority}
            onChange={(priority) => onChange({ priority })}
            min={-100}
            max={100}
          />
        </Field>
      </Row>

      <Row>
        {tier.colors.map((color, index) => (
          // Index keys are usually a mistake, but these are positions in a
          // gradient rather than identities: stop 2 stays stop 2 whatever
          // colour is in it, and reordering is not possible here.
          // eslint-disable-next-line react/no-array-index-key
          <Field key={index} label={index === 0 ? 'Gradient' : ' '}>
            <div className="tier-color">
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(index, event.target.value)}
              />
              <TextInput value={color} onChange={(value) => setColor(index, value)} />
            </div>
          </Field>
        ))}
        <Field label=" ">
          <div className="tier-stop-buttons">
            <Button
              onClick={() => onChange({ colors: [...tier.colors, '#ffffff'] })}
              disabled={tier.colors.length >= 8}
            >
              + stop
            </Button>
            <Button
              onClick={() => onChange({ colors: tier.colors.slice(0, -1) })}
              disabled={tier.colors.length <= 2}
            >
              − stop
            </Button>
          </div>
        </Field>
      </Row>

      <Row>
        <Field
          label="Sweep (seconds)"
          hint={
            tier.speed === 0
              ? 'Still — a gradient with no motion'
              : tier.speed < 2
                ? 'Below 2s this reads as flicker rather than movement'
                : 'One full pass of the gradient'
          }
        >
          <NumberInput value={tier.speed} onChange={(speed) => onChange({ speed })} min={0} max={60} />
        </Field>
      </Row>
    </div>
  );
}
