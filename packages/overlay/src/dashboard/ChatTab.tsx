import type { AppConfig } from '@streaming/shared';
import { ChatLog } from './ChatLog.js';
import { Panel } from './controls.js';
import { ChatPanelSettings } from './ChatPanelSettings.js';
import { HighlightsPanel } from './HighlightsPanel.js';

interface Props {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}

/**
 * Live chat: the merged log first, since that is what you open this tab to
 * watch, then how the chat panel and notable viewers look. Connecting the
 * services lives on Setup.
 */
export function ChatTab({ config, patch }: Props): JSX.Element {
  return (
    <section className="panel-stack">
      <Panel
        title="Chat"
        description="Pop it out from the button in the header — it stays open across tabs and floats above other windows."
      >
        <p className="muted chatlog-hint">
          Click a message to pin it, or a name to copy the handle. Hover for mute and trust.
        </p>
        <ChatLog />
      </Panel>
      <ChatPanelSettings config={config} patch={patch} />
      <HighlightsPanel config={config} patch={patch} />
    </section>
  );
}
