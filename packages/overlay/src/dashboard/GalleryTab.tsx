import { useState } from 'react';
import {
  OVERLAY_TYPES,
  overlayUrl,
  type AppConfig,
  type OverlaySource,
  type OverlayType,
} from '@streaming/shared';
import { api } from '../lib/api.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { Button, CopyButton, Field, Modal, Panel, Row, Select, TextInput } from './controls.js';
import { SourceEditor } from './SourceEditor.js';

interface Props {
  config: AppConfig;
  patch: (patch: Record<string, unknown>) => void;
}

/** What each source type is for, in one line. */
const BLURB: Record<OverlayType, string> = {
  chat: 'Scrolling comments, with badges and avatars.',
  alerts: 'Full-size pop-ups for gifts, follows and subs.',
  tts: 'Plays speech into the stream. Add it once — it has no visuals to speak of.',
  goal: 'A progress bar toward a like, follow or diamond target.',
  ticker: 'A single-line crawl of recent events.',
  leaderboard: 'Top gifters for the session, ranked.',
  counter: 'Big numbers: viewers, likes, follows, diamonds.',
  slideshow: 'Cycles a folder of images, with a choice of transitions.',
  custom: 'Your own HTML and CSS, driven by the same event data.',
};

const CARD_WIDTH = 340;
const UNGROUPED = 'Ungrouped';

/**
 * The single place sources are managed: preview, URL, and every setting.
 *
 * Style used to live on a separate tab from layout, which meant editing one
 * source in two places. Everything is here now, opened inline under whichever
 * card you picked.
 */
export function GalleryTab({ config, patch }: Props): JSX.Element {
  const [openId, setOpenId] = usePersistentState<string | null>('gallery.open', null, (stored) =>
    stored === null || config.overlays.some((o) => o.id === stored),
  );
  const [collapsed, setCollapsed] = usePersistentState<string[]>('gallery.collapsed', []);
  const [error, setError] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const [newType, setNewType] = usePersistentState<OverlayType>('gallery.newType', 'chat', (t) =>
    OVERLAY_TYPES.includes(t),
  );
  const [newName, setNewName] = usePersistentState('gallery.newName', '');

  const updateOverlay = (id: string, next: Partial<OverlaySource>): void => {
    patch({ overlays: config.overlays.map((o) => (o.id === id ? { ...o, ...next } : o)) });
  };

  const run = (action: Promise<unknown>): void => {
    setError(null);
    void action.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const add = (): void => {
    run(
      api.addOverlay(newType, newName || undefined).then((created) => {
        setOpenId(created.id);
        setNewName('');
      }),
    );
  };

  // Group name -> sources, preserving config order inside each group.
  const groups = new Map<string, OverlaySource[]>();
  for (const overlay of config.overlays) {
    const key = overlay.group.trim() || UNGROUPED;
    const list = groups.get(key) ?? [];
    list.push(overlay);
    groups.set(key, list);
  }
  // Named groups first, alphabetically; the ungrouped bucket last.
  const groupNames = [...groups.keys()]
    .filter((g) => g !== UNGROUPED)
    .sort((a, b) => a.localeCompare(b));
  if (groups.has(UNGROUPED)) groupNames.push(UNGROUPED);

  const existingGroups = [...new Set(config.overlays.map((o) => o.group.trim()).filter(Boolean))];
  const open = config.overlays.find((o) => o.id === openId) ?? null;
  const missingTypes = OVERLAY_TYPES.filter((t) => !config.overlays.some((o) => o.type === t));

  const toggleGroup = (name: string): void =>
    setCollapsed(collapsed.includes(name) ? collapsed.filter((g) => g !== name) : [...collapsed, name]);

  return (
    <>
      <Panel
        title="Sources"
        description="Every browser source, previewed against invented data — the same components OBS renders. Previews never connect to the room, so nothing here competes with your live sources for audio."
        actions={
          <Button onClick={() => setNudge((n) => n + 1)} title="Reload every preview">
            Refresh previews
          </Button>
        }
      >
        {error ? <div className="banner banner-error">{error}</div> : null}

        <Row>
          <Field label="Add a source">
            <Select
              value={newType}
              onChange={setNewType}
              options={OVERLAY_TYPES.map((type) => ({ value: type, label: type }))}
            />
          </Field>
          <Field label="Name" hint="Also becomes the URL slug">
            <TextInput value={newName} onChange={setNewName} placeholder="Main chat" />
          </Field>
          <Field label=" ">
            <Button variant="primary" onClick={add}>
              Add
            </Button>
          </Field>
        </Row>

        {missingTypes.length > 0 ? (
          <div className="chips">
            <span className="field-hint" style={{ alignSelf: 'center' }}>
              Not set up yet:
            </span>
            {missingTypes.map((type) => (
              <button
                key={type}
                type="button"
                className="chip"
                title={BLURB[type]}
                onClick={() => run(api.addOverlay(type).then((c) => setOpenId(c.id)))}
              >
                + {type}
              </button>
            ))}
          </div>
        ) : null}

        {groupNames.map((name) => {
          const sources = groups.get(name) ?? [];
          const isCollapsed = collapsed.includes(name);
          return (
            <section key={name} className="gallery-group">
              <button
                type="button"
                className="gallery-group-head"
                onClick={() => toggleGroup(name)}
                aria-expanded={!isCollapsed}
              >
                <span className={isCollapsed ? 'gallery-caret' : 'gallery-caret gallery-caret-open'}>
                  ▸
                </span>
                <strong>{name}</strong>
                <span className="muted">
                  {sources.length} source{sources.length === 1 ? '' : 's'}
                </span>
              </button>

              {!isCollapsed ? (
                <div className="gallery-grid">
                  {sources.map((overlay) => (
                    <GalleryCard
                      key={`${overlay.id}-${nudge}`}
                      overlay={overlay}
                      host={config.sources.host}
                      open={openId === overlay.id}
                      onToggle={() => setOpenId(openId === overlay.id ? null : overlay.id)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </Panel>

      {open ? (
        <Modal
          title={open.name}
          subtitle={`${open.type} source · add in OBS at ${open.width}×${open.height}`}
          onClose={() => setOpenId(null)}
          actions={
            <CopyButton
              text={overlayUrl(window.location.origin, config.sources.host, open.id)}
              label="Copy URL"
            />
          }
        >
          <Panel
            title="Organisation"
            description="Groups are for your own sanity when the list gets long; they change nothing about what a source renders."
          >
            <Row>
              <Field
                label="Group"
                hint={
                  existingGroups.length > 0
                    ? `Existing: ${existingGroups.join(', ')}`
                    : 'e.g. Main scene, Starting soon, Just chatting'
                }
              >
                <TextInput
                  value={open.group}
                  onChange={(group) => updateOverlay(open.id, { group })}
                  placeholder="Ungrouped"
                />
              </Field>
              {existingGroups.length > 0 ? (
                <Field label="Or pick one">
                  <Select
                    value={open.group}
                    onChange={(group) => updateOverlay(open.id, { group })}
                    options={[
                      { value: '', label: UNGROUPED },
                      ...existingGroups.map((g) => ({ value: g, label: g })),
                    ]}
                  />
                </Field>
              ) : null}
            </Row>
          </Panel>

          <SourceEditor
            overlay={open}
            onChange={(next) => updateOverlay(open.id, next)}
            onDelete={() =>
              run(
                api.deleteOverlay(open.id).then(() => {
                  setOpenId(null);
                }),
              )
            }
            onReset={() => run(api.resetOverlay(open.id))}
          />
        </Modal>
      ) : null}
    </>
  );
}

function GalleryCard({
  overlay,
  host,
  open,
  onToggle,
}: {
  overlay: OverlaySource;
  host: string;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  // What gets copied honours the source hostname; the preview iframe and the
  // Open link stay on this page's origin, since they load right here.
  const url = overlayUrl(window.location.origin, host, overlay.id);
  const localUrl = `${window.location.origin}/overlay/${overlay.id}`;
  // Scale the real dimensions down into the card, keeping aspect.
  const scale = Math.min(1, CARD_WIDTH / overlay.width);
  const frameHeight = Math.min(overlay.height * scale, 260);

  return (
    <div className={open ? 'gallery-card gallery-card-on' : 'gallery-card'}>
      <div className="gallery-stage" style={{ height: frameHeight }}>
        <iframe
          className="gallery-frame"
          src={`/overlay/${overlay.id}?demo=1`}
          title={`${overlay.name} preview`}
          width={overlay.width}
          height={overlay.height}
          style={{ transform: `scale(${scale})` }}
          sandbox="allow-scripts allow-same-origin"
          loading="lazy"
        />
        {!overlay.enabled ? <span className="gallery-disabled">disabled</span> : null}
      </div>

      <div className="gallery-meta">
        <div className="gallery-title">
          <strong>{overlay.name}</strong>
          <span className="muted">
            {overlay.type} · {overlay.width}×{overlay.height}
          </span>
        </div>
        <p className="muted gallery-blurb">{BLURB[overlay.type]}</p>
        <code className="gallery-url mono">/overlay/{overlay.id}</code>
        <div className="button-row">
          <CopyButton text={url} label="Copy URL" />
          <a className="btn btn-ghost" href={localUrl} target="_blank" rel="noreferrer">
            Open
          </a>
          <Button variant={open ? 'primary' : 'default'} onClick={onToggle}>
            Edit
          </Button>
        </div>
      </div>
    </div>
  );
}
