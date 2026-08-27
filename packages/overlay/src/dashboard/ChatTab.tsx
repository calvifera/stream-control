import type { AppConfig } from '@streaming/shared';
import { ChatLog } from './ChatLog.js';
import { Panel } from './controls.js';
import { PlatformsPanel } from './PlatformsPanel.js';
import { ChatPanelSettings } from './ChatPanelSettings.js';
import { HighlightsPanel } from './HighlightsPanel.js';

interface Props {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}

/**
 * Everything about live chat in one place: which services are connected, what
 * each one can do, and the merged log itself.
 */
export function ChatTab({ config, patch }: Props): JSX.Element {
  return (
    <section className="panel-stack">
      <PlatformsPanel config={config} patch={patch} />
      <ChatPanelSettings config={config} patch={patch} />
      <HighlightsPanel config={config} patch={patch} />

      <Panel
        title="Chat"
        description="Pop it out from the button in the header — it stays open across tabs and floats above other windows."
      >
        <p className="muted chatlog-hint">
          Click a message to pin it, or a name to copy the handle. Hover for mute and trust.
        </p>
        <ChatLog />
      </Panel>
    </section>
  );
}
