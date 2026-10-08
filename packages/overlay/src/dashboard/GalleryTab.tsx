import { useEffect, useRef, useState } from 'react';
import {
  OVERLAY_TYPES,
  overlayUrl,
  type AppConfig,
  type OverlaySource,
  type OverlayType,
} from '@streaming/shared';
import { api } from '../lib/api.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { Button, CopyButton, Field, Panel, Row, Select, StatusDot, TextInput } from './controls.js';
import { Disclosure, Page, SubTabs } from './layout.js';
import { SettingsEditor, SourceLayoutFields, SourceLookFields } from './SourceEditor.js';

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
  giftSpotlight: 'One animated card per gift, drawn the way each platform draws it: cheermotes, Super Chats, combos.',
  giftRain: 'Gift pictures raining across the screen, one per gift in a combo.',
  custom: 'Your own HTML and CSS, driven by the same event data.',
};

const UNGROUPED = 'Ungrouped';
const EDIT_TABS = ['layout', 'look', 'behaviour'] as const;
type EditTab = (typeof EDIT_TABS)[number];

/**
 * Every browser source in one place: pick one on the left, see it running on
 * the right, and edit it in three tabs (where it sits, how it looks, what it
 * does). There is no dialog: the preview and the settings stay side by side so
 * a change can be judged as it is made.
 */
export function GalleryTab({ config, patch }: Props): JSX.Element {
  const [pickedId, setPickedId] = usePersistentState<string | null>('gallery.open', null, (stored) =>
    stored === null || config.overlays.some((o) => o.id === stored),
  );
  const [tab, setTab] = usePersistentState<EditTab>('gallery.tab', 'layout', (stored) =>
    EDIT_TABS.includes(stored),
  );
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
        setPickedId(created.id);
        setTab('layout');
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
  // Always show something: with nothing picked, the first source is open.
  const active = config.overlays.find((o) => o.id === pickedId) ?? config.overlays[0] ?? null;
  const missingTypes = OVERLAY_TYPES.filter((t) => !config.overlays.some((o) => o.type === t));
  const showGroupNames = groupNames.length > 1 || (groupNames[0] !== undefined && groupNames[0] !== UNGROUPED);

  return (
    <Page
      title="Overlays"
      lead="Each overlay is a browser source for your streaming software. Pick one to see it running against invented data, then adjust where it sits, how it looks and what it does."
      actions={
        <Button onClick={() => setNudge((n) => n + 1)} title="Reload the preview">
          Refresh preview
        </Button>
      }
    >
      {error ? <div className="banner banner-error app-banner">{error}</div> : null}

      <div className="split overlays-split">
        <div className="stack">
          <Panel title="Your overlays" description={`${config.overlays.length} browser ${config.overlays.length === 1 ? 'source' : 'sources'}`}>
            {config.overlays.length === 0 ? (
              <p className="muted">None yet. Add one below.</p>
            ) : (
              groupNames.map((name) => (
                <section key={name} className="src-group">
                  {showGroupNames ? <h3 className="src-group-name">{name}</h3> : null}
                  <ul className="src-list">
                    {(groups.get(name) ?? []).map((overlay) => (
                      <li key={overlay.id}>
                        <button
                          type="button"
                          className={overlay.id === active?.id ? 'src-item src-item-on' : 'src-item'}
                          aria-pressed={overlay.id === active?.id}
                          onClick={() => setPickedId(overlay.id)}
                        >
                          <span className="src-main">
                            <span className={overlay.enabled ? 'src-name' : 'src-name src-name-off'}>{overlay.name}</span>
                            <span className="src-meta">
                              {overlay.type} · {overlay.width}×{overlay.height}
                            </span>
                          </span>
                          <span className="src-state">
                            <StatusDot status={overlay.enabled ? 'connected' : 'idle'} />
                            {overlay.enabled ? 'On' : 'Off'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </Panel>

          <Panel title="Add an overlay">
            <Row>
              <Field label="Type">
                <Select
                  value={newType}
                  onChange={setNewType}
                  options={OVERLAY_TYPES.map((type) => ({ value: type, label: type }))}
                />
              </Field>
              <Field label="Name">
                <TextInput value={newName} onChange={setNewName} placeholder="Main chat" />
              </Field>
            </Row>
            <p className="muted src-blurb">{BLURB[newType]}</p>
            <div className="button-row">
              <Button variant="primary" onClick={add}>
                Add overlay
              </Button>
            </div>

            {missingTypes.length > 0 ? (
              <Disclosure summary="Types you have not set up yet">
                <div className="chips">
                  {missingTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="chip chip-action"
                      title={BLURB[type]}
                      onClick={() => run(api.addOverlay(type).then((c) => setPickedId(c.id)))}
                    >
                      Add {type}
                    </button>
                  ))}
                </div>
              </Disclosure>
            ) : null}
          </Panel>
        </div>

        {active ? (
          <Workspace
            key={active.id}
            overlay={active}
            host={config.sources.host}
            nudge={nudge}
            tab={tab}
            onTab={setTab}
            existingGroups={existingGroups}
            onChange={(next) => updateOverlay(active.id, next)}
            onDelete={() =>
              run(
                api.deleteOverlay(active.id).then(() => {
                  setPickedId(null);
                }),
              )
            }
            onReset={() => run(api.resetOverlay(active.id))}
          />
        ) : (
          <div className="empty">
            <strong>No overlays yet</strong>
            <p>Add a chat overlay to start. You can add alerts, goals and the TTS audio source after.</p>
          </div>
        )}
      </div>
    </Page>
  );
}

function Workspace({
  overlay,
  host,
  nudge,
  tab,
  onTab,
  existingGroups,
  onChange,
  onDelete,
  onReset,
}: {
  overlay: OverlaySource;
  host: string;
  nudge: number;
  tab: EditTab;
  onTab: (tab: EditTab) => void;
  existingGroups: string[];
  onChange: (next: Partial<OverlaySource>) => void;
  onDelete: () => void;
  onReset: () => void;
}): JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // What gets copied honours the source hostname; the preview and the Open
  // link stay on this page's origin, since they load right here.
  const url = overlayUrl(window.location.origin, host, overlay.id);
  const localUrl = `${window.location.origin}/overlay/${overlay.id}`;

  return (
    <section className="panel workspace">
      <header className="panel-head">
        <div>
          <h2>{overlay.name}</h2>
          <p className="muted">
            {overlay.type} source. Add it to your streaming software at {overlay.width}×{overlay.height}.
          </p>
        </div>
        <div className="panel-actions">
          <CopyButton text={url} label="Copy URL" />
          <a className="btn btn-ghost" href={localUrl} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>
      </header>

      <PreviewStage overlay={overlay} nudge={nudge} />

      <div className="workspace-tabs">
        <SubTabs
          label="Overlay settings"
          value={tab}
          onChange={onTab}
          tabs={[
            { id: 'layout', label: 'Layout' },
            { id: 'look', label: 'Look' },
            { id: 'behaviour', label: 'Behaviour' },
          ]}
        />
      </div>

      <div className="panel-body">
        {tab === 'layout' ? (
          <SourceLayoutFields overlay={overlay} existingGroups={existingGroups} onChange={onChange} />
        ) : null}
        {tab === 'look' ? <SourceLookFields overlay={overlay} onChange={onChange} /> : null}
        {tab === 'behaviour' ? (
          <SettingsEditor settings={overlay.settings} onChange={(settings) => onChange({ settings })} />
        ) : null}
      </div>

      <footer className="form-foot">
        {confirmDelete ? (
          <>
            <span className="muted">Delete “{overlay.name}”? Its URL will stop working.</span>
            <div className="button-row">
              <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
              <Button variant="danger" onClick={onDelete}>
                Delete overlay
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button onClick={onReset}>Reset to defaults</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete overlay…
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}

/**
 * The real overlay page in a frame, scaled to fit the space it is given.
 *
 * Previews never connect to the room (`demo=1`), so nothing here competes with
 * a live source for audio. A checkerboard sits behind it so a transparent
 * overlay reads as transparent, the way streaming software shows it.
 */
function PreviewStage({ overlay, nudge }: { overlay: OverlaySource; nudge: number }): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const maxHeight = 340;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (): void => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = width > 0 ? Math.min(1, width / overlay.width, maxHeight / overlay.height) : 0;
  const height = Math.max(120, overlay.height * scale);

  return (
    <div className="preview-stage" ref={box} style={{ height }}>
      {scale > 0 ? (
        <iframe
          key={`${overlay.id}-${nudge}`}
          className="gallery-frame"
          src={`/overlay/${overlay.id}?demo=1`}
          title={`${overlay.name} preview`}
          width={overlay.width}
          height={overlay.height}
          style={{
            transform: `scale(${scale})`,
            left: Math.max(0, (width - overlay.width * scale) / 2),
          }}
          sandbox="allow-scripts allow-same-origin"
        />
      ) : null}
      {!overlay.enabled ? <span className="gallery-disabled">Off</span> : null}
    </div>
  );
}
