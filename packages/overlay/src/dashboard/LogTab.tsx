import { useEffect, useState } from 'react';
import { describeEvent, type StreamEvent } from '@streaming/shared';
import { TestEventPanel } from './TestEventPanel.js';
import { useLive } from '../lib/store.js';
import { Panel } from './controls.js';
import { Page, SubTabs, useSubTab } from './layout.js';

interface Rejection {
  ruleId: string;
  ruleName: string;
  reason: string;
  username: string;
  ts: number;
}

const SUBS = ['why', 'events', 'server', 'test'] as const;

export function LogTab(): JSX.Element {
  const [sub, setSub] = useSubTab('log', 'why', SUBS);
  const { events, logs } = useLive();
  const [rejections, setRejections] = useState<Rejection[]>([]);

  // Rejections aren't pushed over the socket; poll them while this tab is open.
  useEffect(() => {
    const load = (): void => {
      void fetch('/api/rejections')
        .then((r) => r.json() as Promise<Rejection[]>)
        .then(setRejections)
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Page
      title="Log"
      lead="What happened, and why. Start with why a message was not read: it is the fastest way to find a rule or gate that is too tight."
    >
      <SubTabs
        label="Log sections"
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'why', label: 'Not read', note: rejections.length || null },
          { id: 'events', label: 'Live events' },
          { id: 'server', label: 'Server log' },
          { id: 'test', label: 'Send a test event' },
        ]}
      />

      {sub === 'test' ? <TestEventPanel /> : null}

      {sub === 'why' ? (
      <Panel
        title="Why didn't that get read?"
        description="Rules that matched an event type but declined it — the fastest way to debug a gate."
      >
        {rejections.length === 0 ? (
          <p className="muted">Nothing declined recently.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Rule</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rejections.map((rejection, index) => (
                <tr key={`${rejection.ts}-${index}`}>
                  <td className="mono">{new Date(rejection.ts).toLocaleTimeString()}</td>
                  <td>@{rejection.username}</td>
                  <td>{rejection.ruleName}</td>
                  <td className="muted">{rejection.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      ) : null}

      {sub === 'events' ? (
      <Panel title="Live events">
        <div className="event-log">
          {[...events].reverse().slice(0, 80).map((event) => (
            <div key={event.id} className="event-row">
              <span className="mono muted">{new Date(event.ts).toLocaleTimeString()}</span>
              <span className={`tag tag-${event.type}`}>{event.type}</span>
              <span>{summarize(event)}</span>
            </div>
          ))}
          {events.length === 0 ? <p className="muted">No events yet.</p> : null}
        </div>
      </Panel>
      ) : null}

      {sub === 'server' ? (
      <Panel title="Server log">
        <div className="event-log">
          {[...logs].reverse().slice(0, 80).map((entry, index) => (
            <div key={`${entry.ts}-${index}`} className="event-row">
              <span className="mono muted">{new Date(entry.ts).toLocaleTimeString()}</span>
              <span className={`tag tag-${entry.level}`}>{entry.level}</span>
              <span className="muted">[{entry.scope}]</span>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      </Panel>
      ) : null}
    </Page>
  );
}

function summarize(event: StreamEvent): string {
  const who = event.user ? `@${event.user.uniqueId}` : '';
  if (event.type === 'chat') {
    return event.displayText === null
      ? `${who} — dropped (${event.filterReason ?? 'filtered'})`
      : `${who}: ${event.displayText}${event.filtered ? ' (filtered)' : ''}`;
  }
  // Events with nobody behind them, like the viewer count, have no name to lead with.
  return [who, describeEvent(event)].filter(Boolean).join(' ');
}
