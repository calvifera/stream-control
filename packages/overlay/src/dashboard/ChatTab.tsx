import type { AppConfig } from '@streaming/shared';
import { ChatLog } from './ChatLog.js';
import { Panel } from './controls.js';
import { ChatPanelSettings } from './ChatPanelSettings.js';
import { HighlightsPanel } from './HighlightsPanel.js';
import { Page, SubTabs, useSubTab } from './layout.js';

interface Props {
  config: AppConfig;
  patch: (partial: Record<string, unknown>) => void;
}

const SUBS = ['live', 'panel', 'highlights'] as const;

/**
 * Live chat: the merged log first, since that is what you open this area to
 * watch, then how the chat panel and notable viewers look. Connecting the
 * services lives on Go live.
 */
export function ChatTab({ config, patch }: Props): JSX.Element {
  const [sub, setSub] = useSubTab('chat', 'live', SUBS);

  return (
    <Page
      title="Chat"
      lead="Every platform in one log. The window buttons at the bottom of the sidebar float it above your game."
    >
      <SubTabs
        label="Chat sections"
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'live', label: 'Live chat' },
          { id: 'panel', label: 'Desktop panel' },
          { id: 'highlights', label: 'Notable viewers' },
        ]}
      />

      {sub === 'live' ? (
        <Panel title="Merged chat">
          <p className="muted chatlog-hint">
            Click a message to pin it, or a name to copy the handle. Hover for mute and trust.
          </p>
          <ChatLog />
        </Panel>
      ) : null}

      {sub === 'panel' ? <ChatPanelSettings config={config} patch={patch} /> : null}
      {sub === 'highlights' ? <HighlightsPanel config={config} patch={patch} /> : null}
    </Page>
  );
}
