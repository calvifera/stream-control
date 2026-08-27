import {
  nameColor,
  PLATFORM_INFO,
  PLATFORMS,
  STREAM_EVENT_LABELS,
  STREAM_EVENT_TYPES,
  type ChatOverlaySettings,
  type OverlaySettings,
  type OverlaySource,
  type Platform,
  type StreamEventType,
} from '@streaming/shared';
import {
  Button,
  ChipSelect,
  CopyButton,
  Field,
  NumberInput,
  Panel,
  Row,
  Select,
  Slider,
  TextArea,
  TextInput,
  Toggle,
} from './controls.js';
import { PlatformLogo } from '../lib/PlatformLogo.js';
import { SlideshowSettings } from './SlideshowSettings.js';

const ANIMATIONS = ['fade', 'slide-left', 'slide-right', 'slide-up', 'pop', 'none'] as const;

const EVENT_OPTIONS = STREAM_EVENT_TYPES.filter(
  (type) => !['roomStats', 'system'].includes(type),
).map((type) => ({ value: type, label: STREAM_EVENT_LABELS[type] }));

export function SourceEditor({
  overlay,
  onChange,
  onDelete,
  onReset,
}: {
  overlay: OverlaySource;
  onChange: (next: Partial<OverlaySource>) => void;
  onDelete: () => void;
  onReset: () => void;
}): JSX.Element {
  const url = `${window.location.origin}/overlay/${overlay.id}`;
  const style = overlay.style;
  const setStyle = (next: Partial<OverlaySource['style']>): void =>
    onChange({ style: { ...style, ...next } });

  return (
    <>
      <Panel
        title={overlay.name}
        description={`${overlay.type} source · add at ${overlay.width}×${overlay.height}`}
        actions={
          <div className="button-row">
            <CopyButton text={url} label="Copy URL" />
            <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
              Preview
            </a>
            <Button onClick={onReset}>Reset settings</Button>
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
          </div>
        }
      >
        <Row>
          <Field label="Name">
            <TextInput value={overlay.name} onChange={(name) => onChange({ name })} />
          </Field>
          <Field label="Width">
            <NumberInput value={overlay.width} onChange={(width) => onChange({ width })} min={16} max={7680} />
          </Field>
          <Field label="Height">
            <NumberInput value={overlay.height} onChange={(height) => onChange({ height })} min={16} max={4320} />
          </Field>
          <Field label=" ">
            <Toggle label="Enabled" checked={overlay.enabled} onChange={(enabled) => onChange({ enabled })} />
          </Field>
        </Row>

        <Row>
          <Field label="Horizontal align">
            <Select
              value={overlay.align}
              onChange={(align) => onChange({ align })}
              options={[
                { value: 'start', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'end', label: 'Right' },
              ]}
            />
          </Field>
          <Field label="Vertical align">
            <Select
              value={overlay.justify}
              onChange={(justify) => onChange({ justify })}
              options={[
                { value: 'start', label: 'Top' },
                { value: 'center', label: 'Middle' },
                { value: 'end', label: 'Bottom' },
              ]}
            />
          </Field>
        </Row>
      </Panel>

      <Panel title="Appearance">
        <Row>
          <Field label="Font family">
            <TextInput value={style.fontFamily} onChange={(fontFamily) => setStyle({ fontFamily })} />
          </Field>
          <Field label="Font size">
            <NumberInput value={style.fontSize} onChange={(fontSize) => setStyle({ fontSize })} min={6} max={200} />
          </Field>
          <Field label="Font weight">
            <NumberInput
              value={style.fontWeight}
              onChange={(fontWeight) => setStyle({ fontWeight })}
              min={100}
              max={900}
              step={100}
            />
          </Field>
        </Row>

        <Row>
          <ColorField label="Text" value={style.textColor} onChange={(textColor) => setStyle({ textColor })} />
          <ColorField label="Accent" value={style.accentColor} onChange={(accentColor) => setStyle({ accentColor })} />
          <Field label="Page background" hint="Keep transparent for OBS">
            <TextInput value={style.backgroundColor} onChange={(backgroundColor) => setStyle({ backgroundColor })} />
          </Field>
          <Field label="Item background">
            <TextInput value={style.itemBackground} onChange={(itemBackground) => setStyle({ itemBackground })} />
          </Field>
        </Row>

        <Row>
          <Field label="Corner radius">
            <NumberInput value={style.borderRadius} onChange={(borderRadius) => setStyle({ borderRadius })} min={0} max={200} />
          </Field>
          <Field label="Padding">
            <NumberInput value={style.padding} onChange={(padding) => setStyle({ padding })} min={0} max={200} />
          </Field>
          <Field label="Gap">
            <NumberInput value={style.gap} onChange={(gap) => setStyle({ gap })} min={0} max={200} />
          </Field>
          <Field label="Opacity">
            <Slider value={style.opacity} onChange={(opacity) => setStyle({ opacity })} />
          </Field>
        </Row>

        <Row>
          <Field label="Text outline width" hint="Helps text stay readable over busy footage">
            <NumberInput value={style.textStroke} onChange={(textStroke) => setStyle({ textStroke })} min={0} max={20} />
          </Field>
          <ColorField
            label="Outline colour"
            value={style.textStrokeColor}
            onChange={(textStrokeColor) => setStyle({ textStrokeColor })}
          />
          <Field label=" ">
            <Toggle label="Drop shadow" checked={style.shadow} onChange={(shadow) => setStyle({ shadow })} />
          </Field>
        </Row>

        <Field label="Custom CSS" hint="Injected into this source only. Target .chat-row, .alert-card, etc.">
          <TextArea
            monospace
            rows={5}
            value={style.customCss}
            onChange={(customCss) => setStyle({ customCss })}
            placeholder=".chat-row { border-left: 3px solid #fe2c55; }"
          />
        </Field>
      </Panel>

      <Panel title="Behaviour">
        <SettingsEditor
          settings={overlay.settings}
          onChange={(settings) => onChange({ settings })}
        />
      </Panel>
    </>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <Field label={label}>
      <div className="color-field">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
          onChange={(event) => onChange(event.target.value)}
        />
        <TextInput value={value} onChange={onChange} />
      </div>
    </Field>
  );
}

/** Per-type settings form. Every branch narrows the discriminated union. */
export function SettingsEditor({
  settings,
  onChange,
}: {
  settings: OverlaySettings;
  onChange: (settings: OverlaySettings) => void;
}): JSX.Element {
  switch (settings.type) {
    case 'chat': {
      const s = settings.chat;
      const set = (next: Partial<typeof s>): void => onChange({ type: 'chat', chat: { ...s, ...next } });
      return (
        <>
          <Row>
            <Field label="Max messages">
              <NumberInput value={s.maxMessages} onChange={(maxMessages) => set({ maxMessages })} min={1} max={200} />
            </Field>
            <Field label="Message lifetime (s)" hint="0 keeps them until pushed off">
              <NumberInput value={s.messageTtl} onChange={(messageTtl) => set({ messageTtl })} min={0} max={3600} />
            </Field>
            <Field label="Animation">
              <Select
                value={s.animation}
                onChange={(animation) => set({ animation })}
                options={ANIMATIONS.map((a) => ({ value: a, label: a }))}
              />
            </Field>
          </Row>
          <Row>
            <Field label="Density" hint="Compact is one line per message">
              <Select
                value={s.density}
                onChange={(density) => set({ density })}
                options={[
                  { value: 'comfortable', label: 'Comfortable — card per message' },
                  { value: 'compact', label: 'Compact — one line' },
                ]}
              />
            </Field>
            <Field
              label="Platforms"
              hint="None selected shows all of them in one merged chat"
            >
              <ChipSelect
                values={s.platforms}
                options={PLATFORMS.map((id) => ({ value: id, label: PLATFORM_INFO[id].label }))}
                onChange={(platforms) => set({ platforms: platforms as Platform[] })}
              />
            </Field>
          </Row>
          <Row>
            <Toggle label="Avatars" checked={s.showAvatars} onChange={(showAvatars) => set({ showAvatars })} />
            <Toggle label="Platform logo" checked={s.showPlatform} onChange={(showPlatform) => set({ showPlatform })} />
            <Toggle label="Badges" checked={s.showBadges} onChange={(showBadges) => set({ showBadges })} />
            <Toggle label="Newest first" checked={s.newestFirst} onChange={(newestFirst) => set({ newestFirst })} />
          </Row>
          <Row>
            <Toggle
              label="Colourful names"
              hint="Hashed from the handle, inside that platform's band of the colour wheel — so the colour says who and which platform at once"
              checked={s.colorfulNames}
              onChange={(colorfulNames) => set({ colorfulNames })}
            />
            <Toggle
              label="Merge runs"
              hint="Hide the name on back-to-back messages from the same person"
              checked={s.mergeRuns}
              onChange={(mergeRuns) => set({ mergeRuns })}
            />
          </Row>
          <NamePreview settings={s} />
          <Row>
            <Toggle label="Show gifts" checked={s.showGifts} onChange={(showGifts) => set({ showGifts })} />
            <Toggle label="Show follows" checked={s.showFollows} onChange={(showFollows) => set({ showFollows })} />
            <Toggle label="Show joins" checked={s.showJoins} onChange={(showJoins) => set({ showJoins })} />
            <Toggle
              label="Hide filtered messages"
              checked={s.hideFiltered}
              onChange={(hideFiltered) => set({ hideFiltered })}
            />
          </Row>
        </>
      );
    }

    case 'alerts': {
      const s = settings.alerts;
      const set = (next: Partial<typeof s>): void => onChange({ type: 'alerts', alerts: { ...s, ...next } });
      return (
        <>
          <Field label="Alert on">
            <ChipSelect
              values={s.eventTypes}
              options={EVENT_OPTIONS}
              onChange={(eventTypes) => set({ eventTypes: eventTypes as StreamEventType[] })}
            />
          </Field>
          <Row>
            <Field label="Duration (ms)">
              <NumberInput value={s.durationMs} onChange={(durationMs) => set({ durationMs })} min={500} max={60000} step={250} />
            </Field>
            <Field label="Animation">
              <Select
                value={s.animation}
                onChange={(animation) => set({ animation })}
                options={ANIMATIONS.map((a) => ({ value: a, label: a }))}
              />
            </Field>
            <Field label="Min diamonds for gift alerts">
              <NumberInput value={s.minDiamonds} onChange={(minDiamonds) => set({ minDiamonds })} min={0} />
            </Field>
          </Row>
          <Row>
            <Toggle label="Show avatar" checked={s.showAvatar} onChange={(showAvatar) => set({ showAvatar })} />
            <Toggle label="Show gift image" checked={s.showGiftImage} onChange={(showGiftImage) => set({ showGiftImage })} />
          </Row>
          <Row>
            <Field label="Sound URL" hint="Drop files in data/media, then use /media/yourfile.mp3">
              <TextInput value={s.soundUrl} onChange={(soundUrl) => set({ soundUrl })} placeholder="/media/alert.mp3" />
            </Field>
            <Field label="Sound volume">
              <Slider value={s.soundVolume} onChange={(soundVolume) => set({ soundVolume })} />
            </Field>
          </Row>
          <Field label="Templates" hint="One per event type. Same placeholders as TTS.">
            <div className="template-grid">
              {s.eventTypes.map((type) => (
                <Field key={type} label={STREAM_EVENT_LABELS[type]}>
                  <TextInput
                    value={s.templates[type] ?? ''}
                    onChange={(value) => set({ templates: { ...s.templates, [type]: value } })}
                    placeholder="{{nickname}} did something"
                  />
                </Field>
              ))}
            </div>
          </Field>
        </>
      );
    }

    case 'tts': {
      const s = settings.tts;
      const set = (next: Partial<typeof s>): void => onChange({ type: 'tts', tts: { ...s, ...next } });
      return (
        <>
          <div className="banner">
            This source is the audio sink. Add it in OBS once, and leave it running — it plays every
            TTS clip.
          </div>
          <Row>
            <Toggle label="Show caption" checked={s.showCaption} onChange={(showCaption) => set({ showCaption })} />
            <Field label="Caption max characters">
              <NumberInput value={s.captionMaxChars} onChange={(captionMaxChars) => set({ captionMaxChars })} min={10} max={1000} />
            </Field>
            <Toggle label="Show queue" checked={s.showQueue} onChange={(showQueue) => set({ showQueue })} />
            <Field label="Queue preview size">
              <NumberInput value={s.queueSize} onChange={(queueSize) => set({ queueSize })} min={0} max={20} />
            </Field>
          </Row>
        </>
      );
    }

    case 'goal': {
      const s = settings.goal;
      const set = (next: Partial<typeof s>): void => onChange({ type: 'goal', goal: { ...s, ...next } });
      return (
        <>
          <Row>
            <Field label="Metric">
              <Select
                value={s.metric}
                onChange={(metric) => set({ metric })}
                options={[
                  { value: 'likes', label: 'Likes' },
                  { value: 'diamonds', label: 'Diamonds' },
                  { value: 'followers', label: 'New followers' },
                  { value: 'shares', label: 'Shares' },
                  { value: 'viewers', label: 'Viewers' },
                  { value: 'subscribers', label: 'Subscribers' },
                ]}
              />
            </Field>
            <Field label="Label">
              <TextInput value={s.label} onChange={(label) => set({ label })} />
            </Field>
            <Field label="Target">
              <NumberInput value={s.target} onChange={(target) => set({ target })} min={1} />
            </Field>
            <Field label="Start value" hint="Offset, e.g. your existing follower count">
              <NumberInput value={s.startValue} onChange={(startValue) => set({ startValue })} min={0} />
            </Field>
          </Row>
          <Row>
            <Toggle label="Show numbers" checked={s.showNumbers} onChange={(showNumbers) => set({ showNumbers })} />
            <Toggle label="Show percent" checked={s.showPercent} onChange={(showPercent) => set({ showPercent })} />
            <Field label="Bar height">
              <NumberInput value={s.barHeight} onChange={(barHeight) => set({ barHeight })} min={2} max={200} />
            </Field>
          </Row>
        </>
      );
    }

    case 'ticker': {
      const s = settings.ticker;
      const set = (next: Partial<typeof s>): void => onChange({ type: 'ticker', ticker: { ...s, ...next } });
      return (
        <>
          <Field label="Include">
            <ChipSelect
              values={s.eventTypes}
              options={EVENT_OPTIONS}
              onChange={(eventTypes) => set({ eventTypes: eventTypes as StreamEventType[] })}
            />
          </Field>
          <Row>
            <Field label="Scroll speed (px/s)">
              <NumberInput value={s.speedPxPerSecond} onChange={(speedPxPerSecond) => set({ speedPxPerSecond })} min={5} max={600} />
            </Field>
            <Field label="Separator">
              <TextInput value={s.separator} onChange={(separator) => set({ separator })} />
            </Field>
            <Field label="Max items">
              <NumberInput value={s.maxItems} onChange={(maxItems) => set({ maxItems })} min={1} max={200} />
            </Field>
          </Row>
        </>
      );
    }

    case 'leaderboard': {
      const s = settings.leaderboard;
      const set = (next: Partial<typeof s>): void =>
        onChange({ type: 'leaderboard', leaderboard: { ...s, ...next } });
      return (
        <Row>
          <Field label="Rank by">
            <Select
              value={s.metric}
              onChange={(metric) => set({ metric })}
              options={[
                { value: 'diamonds', label: 'Diamonds' },
                { value: 'gifts', label: 'Gift count' },
                { value: 'likes', label: 'Likes' },
                { value: 'comments', label: 'Comments' },
              ]}
            />
          </Field>
          <Field label="Title">
            <TextInput value={s.title} onChange={(title) => set({ title })} />
          </Field>
          <Field label="Rows">
            <NumberInput value={s.size} onChange={(size) => set({ size })} min={1} max={25} />
          </Field>
          <Field label=" ">
            <div className="button-row">
              <Toggle label="Avatars" checked={s.showAvatars} onChange={(showAvatars) => set({ showAvatars })} />
              <Toggle label="Values" checked={s.showValues} onChange={(showValues) => set({ showValues })} />
            </div>
          </Field>
        </Row>
      );
    }

    case 'counter': {
      const s = settings.counter;
      const set = (next: Partial<typeof s>): void => onChange({ type: 'counter', counter: { ...s, ...next } });
      return (
        <>
          <Field label="Metrics">
            <ChipSelect
              values={s.metrics}
              options={[
                { value: 'viewers' as const, label: 'Viewers' },
                { value: 'likes' as const, label: 'Likes' },
                { value: 'diamonds' as const, label: 'Diamonds' },
                { value: 'followers' as const, label: 'New follows' },
                { value: 'shares' as const, label: 'Shares' },
                { value: 'comments' as const, label: 'Comments' },
              ]}
              onChange={(metrics) => set({ metrics })}
            />
          </Field>
          <Row>
            <Field label="Layout">
              <Select
                value={s.layout}
                onChange={(layout) => set({ layout })}
                options={[
                  { value: 'row', label: 'Row' },
                  { value: 'column', label: 'Column' },
                ]}
              />
            </Field>
            <Toggle label="Labels" checked={s.showLabels} onChange={(showLabels) => set({ showLabels })} />
            <Toggle label="Icons" checked={s.showIcons} onChange={(showIcons) => set({ showIcons })} />
          </Row>
        </>
      );
    }

    case 'slideshow': {
      const s = settings.slideshow;
      return (
        <SlideshowSettings
          settings={s}
          onChange={(next) => onChange({ type: 'slideshow', slideshow: { ...s, ...next } })}
        />
      );
    }

    case 'custom': {
      const s = settings.custom;
      const set = (next: Partial<typeof s>): void => onChange({ type: 'custom', custom: { ...s, ...next } });
      return (
        <>
          <Field label="Render on">
            <ChipSelect
              values={s.eventTypes}
              options={EVENT_OPTIONS}
              onChange={(eventTypes) => set({ eventTypes: eventTypes as StreamEventType[] })}
            />
          </Field>
          <Field
            label="HTML template"
            hint="Placeholders are HTML-escaped before substitution, so viewer text can't inject markup"
          >
            <TextArea monospace rows={6} value={s.html} onChange={(html) => set({ html })} />
          </Field>
          <Field label="CSS">
            <TextArea monospace rows={6} value={s.css} onChange={(css) => set({ css })} />
          </Field>
          <Row>
            <Field label="Max items on screen">
              <NumberInput value={s.maxItems} onChange={(maxItems) => set({ maxItems })} min={1} max={100} />
            </Field>
            <Field label="Item lifetime (ms)">
              <NumberInput value={s.itemTtlMs} onChange={(itemTtlMs) => set({ itemTtlMs })} min={0} max={600000} step={500} />
            </Field>
          </Row>
        </>
      );
    }
  }
}

/**
 * What the name colours actually look like, for the settings that produce them.
 *
 * A hashed palette is impossible to judge from a description — "each platform
 * gets a band of the wheel" says nothing about whether two of your regulars
 * end up the same shade of cyan. Real handles from the sample below, rendered
 * with the exact function the overlay uses, answers that in one glance.
 */
function NamePreview({ settings }: { settings: ChatOverlaySettings }): JSX.Element {
  const shown = settings.platforms.length > 0 ? settings.platforms : PLATFORMS;
  const handles = ['viewerson', 'katie', 'bigmike', 'qq', 'streamfan_02', 'zebra'];

  return (
    <div className={settings.density === 'compact' ? 'name-preview compact' : 'name-preview'}>
      {shown.map((platform) =>
        handles.map((handle) => (
          <span key={`${platform}:${handle}`} className="name-preview-row">
            {settings.showPlatform ? <PlatformLogo platform={platform} size="1em" labelled /> : null}
            <span
              style={{
                color: settings.colorfulNames ? nameColor(platform, handle) : 'var(--accent)',
                fontWeight: 800,
              }}
            >
              {handle}
            </span>
          </span>
        )),
      )}
    </div>
  );
}
