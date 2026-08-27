import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IMAGE_FIT,
  SLIDESHOW_TRANSITIONS,
  type SlideshowOverlaySettings,
} from '@streaming/shared';
import { api, type SlideshowFolder } from '../lib/api.js';
import { Button, Field, NumberInput, Row, Select, TextInput, Toggle } from './controls.js';

interface Props {
  settings: SlideshowOverlaySettings;
  onChange: (next: Partial<SlideshowOverlaySettings>) => void;
}

const TRANSITION_LABELS: Record<string, string> = {
  fade: 'Fade in',
  crossfade: 'Crossfade',
  'slide-left': 'Slide sideways',
  'slide-up': 'Slide up',
  zoom: 'Zoom',
  kenburns: 'Ken Burns (slow drift)',
  none: 'Cut (no transition)',
};

export function SlideshowSettings({ settings, onChange }: Props): JSX.Element {
  const [folders, setFolders] = useState<SlideshowFolder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(() => {
    void api.slideshows().then(setFolders).catch(() => undefined);
  }, []);

  useEffect(reload, [reload]);

  const current = folders.find((f) => f.name === settings.folder) ?? null;

  /**
   * Uploads sequentially rather than all at once: a folder can be hundreds of
   * files, and firing hundreds of parallel requests at a local server just
   * makes progress unreportable and the failures harder to read.
   */
  const upload = async (files: FileList | null, intoFolder: string): Promise<void> => {
    if (!files || files.length === 0) return;
    const target = intoFolder.trim();
    if (!target) {
      setError('Name the folder first');
      return;
    }

    setError(null);
    setSkipped([]);
    setBusy(target);
    const rejected: string[] = [];
    const list = [...files];
    setProgress({ done: 0, total: list.length });

    for (const [i, file] of list.entries()) {
      try {
        await api.uploadSlide(target, file.name, file);
      } catch {
        rejected.push(file.name);
      }
      setProgress({ done: i + 1, total: list.length });
    }

    setBusy(null);
    setProgress(null);
    setSkipped(rejected);
    onChange({ folder: target });
    reload();
  };

  const set = <K extends keyof SlideshowOverlaySettings>(
    key: K,
    value: SlideshowOverlaySettings[K],
  ): void => onChange({ [key]: value } as Partial<SlideshowOverlaySettings>);

  return (
    <>
      {error ? <div className="banner banner-error">{error}</div> : null}

      <Row>
        <Field
          label="Folder"
          hint={
            current
              ? `${current.images.length} image${current.images.length === 1 ? '' : 's'} · ${formatBytes(current.bytes)}`
              : 'Pick one, or type a new name and upload into it'
          }
        >
          <TextInput
            value={settings.folder}
            onChange={(folder) => set('folder', folder)}
            placeholder="my-slideshow"
          />
        </Field>
        {folders.length > 0 ? (
          <Field label="Or pick an existing one">
            <Select
              value={settings.folder}
              onChange={(folder) => set('folder', folder)}
              options={[
                { value: '', label: '— none —' },
                ...folders.map((f) => ({
                  value: f.name,
                  label: `${f.name} (${f.images.length})`,
                })),
              ]}
            />
          </Field>
        ) : null}
      </Row>

      <Row>
        <Field label="Upload" hint="A whole folder, or pick individual files">
          <div className="button-row">
            <Button
              disabled={Boolean(busy)}
              onClick={() => folderInput.current?.click()}
              title="Upload every image in a folder"
            >
              Choose folder…
            </Button>
            <Button disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
              Choose images…
            </Button>
            {current && current.images.length > 0 ? (
              <Button
                variant="danger"
                disabled={Boolean(busy)}
                onClick={() => {
                  void api.deleteSlideshow(current.name).then(() => {
                    set('folder', '');
                    reload();
                  });
                }}
              >
                Delete folder
              </Button>
            ) : null}
          </div>
        </Field>
      </Row>

      {/* webkitdirectory is what makes the picker offer a folder. */}
      <input
        ref={folderInput}
        type="file"
        hidden
        multiple
        accept="image/*"
        // @ts-expect-error non-standard but supported everywhere this runs
        webkitdirectory=""
        directory=""
        onChange={(event) => {
          const files = event.target.files;
          // Default the folder name to the one they picked.
          const first = files?.[0] as (File & { webkitRelativePath?: string }) | undefined;
          const guessed = first?.webkitRelativePath?.split('/')[0] ?? '';
          void upload(files, settings.folder || guessed);
          event.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept="image/*"
        onChange={(event) => {
          void upload(event.target.files, settings.folder);
          event.target.value = '';
        }}
      />

      {progress ? (
        <div className="banner">
          Uploading {progress.done} of {progress.total}…
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div className="banner banner-error">
          Skipped {skipped.length} file{skipped.length === 1 ? '' : 's'} that were not usable images:{' '}
          {skipped.slice(0, 5).join(', ')}
          {skipped.length > 5 ? ' …' : ''}
        </div>
      ) : null}

      {current && current.images.length > 0 ? (
        <div className="slide-strip">
          {current.images.slice(0, 24).map((name) => (
            <div key={name} className="slide-thumb" title={name}>
              <img src={`/media/slideshows/${encodeURIComponent(current.name)}/${encodeURIComponent(name)}`} alt="" />
              <button
                type="button"
                className="slide-remove"
                title={`Remove ${name}`}
                onClick={() => {
                  void api.deleteSlide(current.name, name).then(reload);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {current.images.length > 24 ? (
            <span className="muted">+{current.images.length - 24} more</span>
          ) : null}
        </div>
      ) : null}

      <Row>
        <Field label="Seconds per image">
          <NumberInput
            value={settings.intervalSeconds}
            onChange={(intervalSeconds) => set('intervalSeconds', intervalSeconds)}
            min={0.5}
            max={3600}
            step={0.5}
          />
        </Field>
        <Field label="Transition">
          <Select
            value={settings.transition}
            onChange={(transition) => set('transition', transition)}
            options={SLIDESHOW_TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABELS[t] ?? t }))}
          />
        </Field>
        <Field label="Transition (ms)" hint="Ken Burns runs its own longer drift">
          <NumberInput
            value={settings.transitionMs}
            onChange={(transitionMs) => set('transitionMs', transitionMs)}
            min={0}
            max={10000}
            step={50}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Fit" hint="Cover fills the box and crops; contain shows the whole image">
          <Select
            value={settings.fit}
            onChange={(fit) => set('fit', fit)}
            options={IMAGE_FIT.map((f) => ({ value: f, label: f }))}
          />
        </Field>
        <Field label="Corner radius">
          <NumberInput
            value={settings.cornerRadius}
            onChange={(cornerRadius) => set('cornerRadius', cornerRadius)}
            min={0}
            max={200}
          />
        </Field>
      </Row>

      <Row>
        <Toggle
          label="Shuffle"
          hint="Random order, reshuffled each time it runs out"
          checked={settings.shuffle}
          onChange={(shuffle) => set('shuffle', shuffle)}
        />
        <Toggle
          label="Show filename"
          checked={settings.showCaption}
          onChange={(showCaption) => set('showCaption', showCaption)}
        />
        <Toggle
          label="Play once"
          hint="Stop on the last image instead of looping"
          checked={settings.once}
          onChange={(once) => set('once', once)}
        />
      </Row>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
