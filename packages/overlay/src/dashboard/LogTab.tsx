import { useEffect, useState } from 'react';
import { STREAM_EVENT_LABELS, type StreamEvent } from '@streaming/shared';
import { TestEventPanel } from './TestEventPanel.js';
import { useLive } from '../lib/store.js';
import { Panel } from './controls.js';

interface Rejection {
  ruleId: string;
  ruleName: string;
  reason: string;
  username: string;
  ts: number;
}

export function LogTab(): JSX.Element {
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
    <>
      <TestEventPanel />

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
    </>
  );
}

function summarize(event: StreamEvent): string {
  const who = event.user ? `@${event.user.uniqueId}` : '';
  switch (event.type) {
    case 'chat':
      return event.displayText === null
        ? `${who} — dropped (${event.filterReason ?? 'filtered'})`
        : `${who}: ${event.displayText}${event.filtered ? ' (filtered)' : ''}`;
    case 'gift':
      return `${who} sent ${event.repeatCount}x ${event.giftName} (${event.totalDiamonds} diamonds)`;
    case 'follow':
      return `${who} followed`;
    case 'share':
      return `${who} shared`;
    case 'like':
      return `${who} sent ${event.likeCount} likes`;
    case 'join':
      return `${who} joined`;
    case 'subscribe':
      return `${who} subscribed (${event.subMonths}mo)`;
    case 'envelope':
      return `${who} dropped a ${event.coins}-coin treasure box`;
    case 'question':
      return `${who} asked: ${event.text}`;
    case 'roomStats':
      return `${event.viewerCount} viewers`;
    case 'streamEnd':
      return event.reason;
    case 'system':
      return event.text;
    case 'emote':
      return `${who} sent an emote`;
  }
}
