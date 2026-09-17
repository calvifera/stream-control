import {
  BUILTIN_SOUNDS,
  builtinSound,
  builtinSoundId,
  DEFAULT_SOUND_BRACKETS,
  formatCents,
  TEXT_FILL_LABELS,
  TEXT_FILLS,
  TEXT_MOTION_LABELS,
  TEXT_MOTIONS,
  type GiftSoundBracket,
  type GiftSoundSettings,
  type TextEffect,
} from '@streaming/shared';
import { AnimatedText } from '../lib/AnimatedText.js';
import { playSound } from '../lib/giftSounds.js';
import { Button, Field, NumberInput, Row, Select, Slider, TextInput, Toggle } from './controls.js';

/**
 * Dashboard controls for text effects and price-bracket sounds.
 *
 * Both preview in place — the effect on a sample name, each sound on a
 * button — because neither can be judged from a dropdown label.
 */

export function TextEffectEditor({
  label,
  effect,
  onChange,
  sample = 'SparkleViewer',
}: {
  label: string;
  effect: TextEffect;
  onChange: (effect: TextEffect) => void;
  sample?: string;
}): JSX.Element {
  const set = (next: Partial<TextEffect>): void => onChange({ ...effect, ...next });
  const setColor = (index: number, color: string): void =>
    set({ colors: effect.colors.map((c, i) => (i === index ? color : c)) });

  return (
    <div className="fx-editor">
      <div className="fx-editor-head">
        <span className="field-label">{label}</span>
        <span className="fx-preview">
          <AnimatedText text={sample} effect={effect} />
        </span>
      </div>
      <Row>
        <Field label="Motion">
          <Select
            value={effect.motion}
            onChange={(motion) => set({ motion })}
            options={TEXT_MOTIONS.map((m) => ({ value: m, label: TEXT_MOTION_LABELS[m] }))}
          />
        </Field>
        <Field label="Colour">
          <Select
            value={effect.fill}
            onChange={(fill) => set({ fill })}
            options={TEXT_FILLS.map((f) => ({ value: f, label: TEXT_FILL_LABELS[f] }))}
          />
        </Field>
        <Field label="Height" hint="Small is subtle">
          <Slider value={effect.amplitude} min={0} max={0.4} step={0.01} onChange={(amplitude) => set({ amplitude })} />
        </Field>
        <Field label="Cycle (s)" hint="Lower is faster">
          <Slider
            value={effect.speed}
            min={0.6}
            max={5}
            step={0.1}
            format={(v) => `${v.toFixed(1)}s`}
            onChange={(speed) => set({ speed })}
          />
        </Field>
      </Row>
      {effect.fill === 'gradient' ? (
        <div className="fx-colors">
          {effect.colors.map((color, index) => (
            <span key={index} className="fx-color">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff'} onChange={(e) => setColor(index, e.target.value)} />
              {effect.colors.length > 2 ? (
                <button
                  type="button"
                  className="fx-color-remove"
                  title="Remove colour"
                  onClick={() => set({ colors: effect.colors.filter((_, i) => i !== index) })}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {effect.colors.length < 8 ? (
            <Button variant="ghost" onClick={() => set({ colors: [...effect.colors, '#ffffff'] })}>
              Add colour
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const CUSTOM = 'custom';

function SoundPicker({ sound, onChange }: { sound: string; onChange: (sound: string) => void }): JSX.Element {
  const builtin = builtinSoundId(sound);
  const choice = sound === '' ? '' : builtin ? sound : CUSTOM;
  return (
    <>
      <Select
        value={choice}
        onChange={(value) => onChange(value === CUSTOM ? '/media/' : value)}
        options={[
          ...BUILTIN_SOUNDS.map((s) => ({ value: builtinSound(s.id), label: s.label, group: 'Built in' })),
          { value: CUSTOM, label: 'Your own file or link…', group: 'Other' },
          { value: '', label: 'Silent', group: 'Other' },
        ]}
      />
      {choice === CUSTOM ? (
        <TextInput value={sound} onChange={onChange} placeholder="/media/gift.mp3" />
      ) : null}
    </>
  );
}

/**
 * Sounds by price bracket.
 *
 * Shown sorted by amount whatever order they were added in, since the
 * highest bracket a gift reaches wins and a list out of order would hide
 * that.
 */
export function SoundBracketsEditor({
  settings,
  onChange,
  hint,
}: {
  settings: GiftSoundSettings;
  onChange: (settings: GiftSoundSettings) => void;
  hint?: string;
}): JSX.Element {
  const set = (next: Partial<GiftSoundSettings>): void => onChange({ ...settings, ...next });
  const sorted = [...settings.brackets].sort((a, b) => a.minCents - b.minCents);
  const update = (id: string, next: Partial<GiftSoundBracket>): void =>
    set({ brackets: settings.brackets.map((b) => (b.id === id ? { ...b, ...next } : b)) });

  return (
    <Field
      label="Sounds by price"
      hint={
        hint ??
        'Bigger gifts get bigger sounds. Amounts are rough dollars on every platform: 100 diamonds, 100 bits and a $1 Super Chat all count as about $1.'
      }
    >
      <div className="fx-sounds">
        <Row>
          <Toggle label="Play sounds by price" checked={settings.enabled} onChange={(enabled) => set({ enabled })} />
          <Field label="Volume">
            <Slider value={settings.volume} onChange={(volume) => set({ volume })} />
          </Field>
        </Row>
        {settings.enabled ? (
          <>
            <div className="fx-bracket fx-bracket-head" aria-hidden="true">
              <span>From</span>
              <span>Sound</span>
              <span>Volume</span>
              <span />
            </div>
            {sorted.map((bracket) => (
              <div key={bracket.id} className="fx-bracket">
                <span className="fx-bracket-amount">
                  <span className="muted">$</span>
                  <NumberInput
                    value={bracket.minCents / 100}
                    min={0}
                    step={0.5}
                    onChange={(dollars) => update(bracket.id, { minCents: Math.round(dollars * 100) })}
                  />
                </span>
                <span className="fx-bracket-sound">
                  <SoundPicker sound={bracket.sound} onChange={(sound) => update(bracket.id, { sound })} />
                </span>
                <Slider value={bracket.volume} onChange={(volume) => update(bracket.id, { volume })} />
                <span className="button-row">
                  <Button
                    variant="ghost"
                    title={`Play the ${formatCents(bracket.minCents)}+ sound`}
                    disabled={!bracket.sound}
                    onClick={() => playSound(bracket.sound, settings.volume * bracket.volume)}
                  >
                    ▶
                  </Button>
                  <Button
                    variant="ghost"
                    title="Remove this bracket"
                    onClick={() => set({ brackets: settings.brackets.filter((b) => b.id !== bracket.id) })}
                  >
                    ×
                  </Button>
                </span>
              </div>
            ))}
            <div className="button-row">
              <Button
                onClick={() => {
                  const top = sorted[sorted.length - 1]?.minCents ?? 0;
                  set({
                    brackets: [
                      ...settings.brackets,
                      {
                        id: `b-${Date.now().toString(36)}`,
                        minCents: top > 0 ? top * 2 : 100,
                        sound: builtinSound('chime'),
                        volume: 0.9,
                      },
                    ],
                  });
                }}
              >
                Add bracket
              </Button>
              <Button
                variant="ghost"
                onClick={() => set({ brackets: DEFAULT_SOUND_BRACKETS.map((b) => ({ ...b })) })}
              >
                Reset to the default set
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Field>
  );
}

/** Every built-in sound on one row, for auditioning the set. */
export function SoundSampler({ volume = 0.7 }: { volume?: number }): JSX.Element {
  return (
    <div className="fx-sampler">
      {BUILTIN_SOUNDS.map((sound) => (
        <Button key={sound.id} variant="ghost" title={sound.blurb} onClick={() => playSound(builtinSound(sound.id), volume)}>
          ▶ {sound.label}
        </Button>
      ))}
    </div>
  );
}
