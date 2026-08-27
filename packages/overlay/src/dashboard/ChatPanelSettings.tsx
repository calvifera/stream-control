import { DEFAULT_CHAT_PANEL, type AppConfig } from '@streaming/shared';
import { Field, Panel, Row, Slider, Toggle } from './controls.js';

/**
 * Settings for the desktop chat panel.
 *
 * Lives in the dashboard rather than inside the panel itself for a practical
 * reason: while you are adjusting the background you want to *see* the panel
 * over your game, and a settings form covering it would defeat the point.
 * Changes broadcast over the socket, so the panel restyles live.
 */
export function ChatPanelSettings({
  config,
  patch,
}: {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}): JSX.Element {
  const panel = config.chatPanel ?? DEFAULT_CHAT_PANEL;
  const set = (over: Partial<typeof panel>): void => patch({ chatPanel: { ...panel, ...over } });

  return (
    <Panel
      title="Desktop panel"
      description="The always-on-top chat window for playing behind. Run it with npm run panel — the settings here apply live."
    >
      <Row>
        <Field
          label="Background opacity"
          hint="Applies to the background only — text and avatars stay fully solid at every setting."
        >
          <Slider
            value={panel.opacity}
            onChange={(opacity) => set({ opacity })}
            min={0}
            max={1}
            step={0.02}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Field>
        <Field label="Text size">
          <Slider
            value={panel.fontScale}
            onChange={(fontScale) => set({ fontScale })}
            min={0.6}
            max={2.5}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Field>
      </Row>

      <Row>
        <Toggle
          label="Always on top"
          hint="Stays above a borderless-windowed game. An exclusive-fullscreen game will still cover it — that is the game taking the whole display, and nothing can float over it."
          checked={panel.alwaysOnTop}
          onChange={(alwaysOnTop) => set({ alwaysOnTop })}
        />

      </Row>

      {panel.opacity < 0.25 ? (
        <p className="muted archive-note">
          Below about 25% the background stops separating the text from whatever is moving behind
          it. Readable over a dark game, much less so over a bright one.
        </p>
      ) : null}
    </Panel>
  );
}
