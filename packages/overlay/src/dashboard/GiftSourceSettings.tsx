import {
  GIFT_KIND_LABELS,
  GIFT_MEDIA_KINDS,
  GIFT_RAIN_DIRECTIONS,
  isVideoUrl,
  PLATFORM_GIFT_UNIT,
  PLATFORM_INFO,
  PLATFORMS,
  type GiftMediaKind,
  type GiftMediaRule,
  type GiftRainOverlaySettings,
  type GiftSpotlightOverlaySettings,
  type OverlayAnimation,
  type Platform,
} from '@streaming/shared';
import {
  Button,
  ChipSelect,
  Field,
  NumberInput,
  Row,
  Select,
  Slider,
  TextInput,
  Toggle,
} from './controls.js';
import { SoundBracketsEditor, SoundSampler, TextEffectEditor } from './EffectControls.js';

/**
 * Settings for the two gift sources.
 *
 * Kept out of `SourceEditor` because most of it is shared between them — the
 * platform filter, the per-platform minimums and the media rules — and
 * because the rules editor is a small form of its own.
 */

const ANIMATIONS: OverlayAnimation[] = ['fade', 'slide-left', 'slide-right', 'slide-up', 'pop', 'none'];

const KIND_LABELS: Record<GiftMediaKind, string> = {
  ...GIFT_KIND_LABELS,
  'gifted-subs': 'Gifted subs / memberships',
};

const UNIT_HINT: Record<Platform, string> = {
  tiktok: 'diamonds',
  twitch: 'bits (100 ≈ $1)',
  youtube: 'cents (500 = $5.00)',
};

function PlatformFilter({
  platforms,
  onChange,
}: {
  platforms: Platform[];
  onChange: (platforms: Platform[]) => void;
}): JSX.Element {
  return (
    <Field label="Platforms" hint="None selected shows every platform">
      <ChipSelect
        values={platforms}
        options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_INFO[p].label }))}
        onChange={onChange}
      />
    </Field>
  );
}

/**
 * One minimum per platform, each in that platform's unit.
 *
 * Kept as three boxes on purpose: 100 bits, 100 diamonds and 100 cents are
 * three different amounts, and one shared box made that invisible.
 */
function Minimums({
  value,
  onChange,
}: {
  value: Record<Platform, number>;
  onChange: (value: Record<Platform, number>) => void;
}): JSX.Element {
  return (
    <Row>
      {PLATFORMS.map((platform) => (
        <Field
          key={platform}
          label={`Minimum on ${PLATFORM_INFO[platform].label}`}
          hint={`In ${UNIT_HINT[platform]}`}
        >
          <NumberInput
            value={value[platform]}
            min={0}
            onChange={(amount) => onChange({ ...value, [platform]: amount })}
          />
        </Field>
      ))}
    </Row>
  );
}

const newRule = (): GiftMediaRule => ({
  id: `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  enabled: true,
  platform: 'any',
  kinds: [],
  giftName: '',
  minValue: 0,
  mediaUrl: '',
  soundUrl: '',
});

/**
 * Your own GIFs, videos and sounds per gift.
 *
 * First match wins, so the list is shown in priority order with buttons to
 * reorder it — a catch-all rule above a specific one would silently swallow it.
 */
function MediaRules({
  rules,
  onChange,
}: {
  rules: GiftMediaRule[];
  onChange: (rules: GiftMediaRule[]) => void;
}): JSX.Element {
  const update = (index: number, next: Partial<GiftMediaRule>): void =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)));
  const move = (index: number, by: number): void => {
    const target = index + by;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target] as GiftMediaRule, next[index] as GiftMediaRule];
    onChange(next);
  };

  return (
    <Field
      label="Custom media"
      hint="Show your own GIF, WebP or video (and sound) for matching gifts. Put files in data/media and use /media/name.gif, or paste an https link. First matching rule wins."
    >
      <div className="gift-rules">
        {rules.length === 0 ? <p className="muted">No rules — every gift shows its platform's own art.</p> : null}
        {rules.map((rule, index) => (
          <div key={rule.id} className="gift-rule">
            <Row>
              <Toggle label={`Rule ${index + 1}`} checked={rule.enabled} onChange={(enabled) => update(index, { enabled })} />
              <Field label="Platform">
                <Select<Platform | 'any'>
                  value={rule.platform}
                  onChange={(platform) => update(index, { platform })}
                  options={[
                    { value: 'any', label: 'Any platform' },
                    ...PLATFORMS.map((p) => ({ value: p, label: PLATFORM_INFO[p].label })),
                  ]}
                />
              </Field>
              <Field label="Gift name contains" hint="Empty matches any name">
                <TextInput value={rule.giftName} onChange={(giftName) => update(index, { giftName })} placeholder="Galaxy" />
              </Field>
              <Field
                label="At least"
                hint={rule.platform === 'any' ? 'In each platform’s own unit' : `In ${UNIT_HINT[rule.platform]}`}
              >
                <NumberInput value={rule.minValue} min={0} onChange={(minValue) => update(index, { minValue })} />
              </Field>
            </Row>
            <Field label="Kinds" hint="None selected matches every kind">
              <ChipSelect
                values={rule.kinds}
                options={GIFT_MEDIA_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
                onChange={(kinds) => update(index, { kinds })}
              />
            </Field>
            <Row>
              <Field label="Media URL">
                <TextInput value={rule.mediaUrl} onChange={(mediaUrl) => update(index, { mediaUrl })} placeholder="/media/galaxy.gif" />
              </Field>
              <Field label="Sound URL">
                <TextInput value={rule.soundUrl} onChange={(soundUrl) => update(index, { soundUrl })} placeholder="/media/galaxy.mp3" />
              </Field>
              {rule.mediaUrl ? (
                isVideoUrl(rule.mediaUrl) ? (
                  <video className="gift-rule-preview" src={rule.mediaUrl} muted autoPlay loop playsInline />
                ) : (
                  <img className="gift-rule-preview" src={rule.mediaUrl} alt="" />
                )
              ) : null}
            </Row>
            <div className="button-row">
              <Button variant="ghost" onClick={() => move(index, -1)} disabled={index === 0}>
                Move up
              </Button>
              <Button variant="ghost" onClick={() => move(index, 1)} disabled={index === rules.length - 1}>
                Move down
              </Button>
              <Button variant="danger" onClick={() => onChange(rules.filter((_, i) => i !== index))}>
                Remove
              </Button>
            </div>
          </div>
        ))}
        <div className="button-row">
          <Button onClick={() => onChange([...rules, newRule()])}>Add rule</Button>
        </div>
      </div>
    </Field>
  );
}

export function GiftSpotlightSettings({
  settings: s,
  onChange,
}: {
  settings: GiftSpotlightOverlaySettings;
  onChange: (next: Partial<GiftSpotlightOverlaySettings>) => void;
}): JSX.Element {
  return (
    <>
      <PlatformFilter platforms={s.platforms} onChange={(platforms) => onChange({ platforms })} />
      <Minimums value={s.minValue} onChange={(minValue) => onChange({ minValue })} />
      <Row>
        <Field label="Duration (ms)">
          <NumberInput value={s.durationMs} onChange={(durationMs) => onChange({ durationMs })} min={500} max={60000} step={250} />
        </Field>
        <Field label="Animation">
          <Select value={s.animation} onChange={(animation) => onChange({ animation })} options={ANIMATIONS.map((a) => ({ value: a, label: a }))} />
        </Field>
        <Field label="Picture height (px)">
          <NumberInput value={s.mediaSize} onChange={(mediaSize) => onChange({ mediaSize })} min={16} max={2000} />
        </Field>
        <Field label="Max waiting" hint="Oldest dropped past this. 0 keeps all">
          <NumberInput value={s.maxQueue} onChange={(maxQueue) => onChange({ maxQueue })} min={0} max={500} />
        </Field>
      </Row>
      <Row>
        <Toggle label="Bigger gifts stay longer" checked={s.scaleDuration} onChange={(scaleDuration) => onChange({ scaleDuration })} />
        <Toggle label="Show avatar" checked={s.showAvatar} onChange={(showAvatar) => onChange({ showAvatar })} />
        <Toggle label="Show amount" checked={s.showValue} onChange={(showValue) => onChange({ showValue })} />
        <Toggle
          label="Show message"
          hint="Super Chat and cheer text, after your filters"
          checked={s.showMessage}
          onChange={(showMessage) => onChange({ showMessage })}
        />
        <Toggle label="Include gifted subs" checked={s.includeGiftedSubs} onChange={(includeGiftedSubs) => onChange({ includeGiftedSubs })} />
      </Row>
      <TextEffectEditor label="Name effect" effect={s.nameEffect} onChange={(nameEffect) => onChange({ nameEffect })} />
      <TextEffectEditor
        label="Amount effect"
        sample="1,000 bits"
        effect={s.valueEffect}
        onChange={(valueEffect) => onChange({ valueEffect })}
      />
      <SoundBracketsEditor settings={s.sounds} onChange={(sounds) => onChange({ sounds })} />
      <SoundSampler volume={s.sounds.volume} />
      {s.sounds.enabled ? null : (
        <Row>
          <Field label="Single sound URL" hint="Used for every gift while sounds by price are off">
            <TextInput value={s.soundUrl} onChange={(soundUrl) => onChange({ soundUrl })} placeholder="/media/gift.mp3" />
          </Field>
          <Field label="Sound volume">
            <Slider value={s.soundVolume} onChange={(soundVolume) => onChange({ soundVolume })} />
          </Field>
        </Row>
      )}
      <MediaRules rules={s.mediaRules} onChange={(mediaRules) => onChange({ mediaRules })} />
    </>
  );
}

export function GiftRainSettings({
  settings: s,
  onChange,
}: {
  settings: GiftRainOverlaySettings;
  onChange: (next: Partial<GiftRainOverlaySettings>) => void;
}): JSX.Element {
  return (
    <>
      <PlatformFilter platforms={s.platforms} onChange={(platforms) => onChange({ platforms })} />
      <Minimums value={s.minValue} onChange={(minValue) => onChange({ minValue })} />
      <Row>
        <Field label="Direction">
          <Select
            value={s.direction}
            onChange={(direction) => onChange({ direction })}
            options={GIFT_RAIN_DIRECTIONS.map((d) => ({ value: d, label: d === 'fall' ? 'Fall from the top' : 'Rise from the bottom' }))}
          />
        </Field>
        <Field label="Seconds to cross">
          <NumberInput value={s.fallSeconds} onChange={(fallSeconds) => onChange({ fallSeconds })} min={0.5} max={60} step={0.5} />
        </Field>
        <Field label="Sprite size (px)">
          <NumberInput value={s.spriteSize} onChange={(spriteSize) => onChange({ spriteSize })} min={8} max={1000} />
        </Field>
      </Row>
      <Row>
        <Field label="Most per gift" hint="A 99× combo rains at most this many">
          <NumberInput value={s.maxPerGift} onChange={(maxPerGift) => onChange({ maxPerGift })} min={1} max={200} />
        </Field>
        <Field label="Most on screen">
          <NumberInput value={s.maxOnScreen} onChange={(maxOnScreen) => onChange({ maxOnScreen })} min={1} max={500} />
        </Field>
        <Field label=" ">
          <Toggle label="Include gifted subs" checked={s.includeGiftedSubs} onChange={(includeGiftedSubs) => onChange({ includeGiftedSubs })} />
        </Field>
      </Row>
      <p className="muted">
        Units: TikTok counts {PLATFORM_GIFT_UNIT.tiktok}, Twitch {PLATFORM_GIFT_UNIT.twitch}, YouTube{' '}
        {PLATFORM_GIFT_UNIT.youtube}.
      </p>
      <SoundBracketsEditor
        settings={s.sounds}
        onChange={(sounds) => onChange({ sounds })}
        hint="Off by default: rain usually runs beside a spotlight that already plays sound, and doubling up gets loud."
      />
      <MediaRules rules={s.mediaRules} onChange={(mediaRules) => onChange({ mediaRules })} />
    </>
  );
}
