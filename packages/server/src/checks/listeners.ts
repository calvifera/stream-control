/**
 * Verifies TTS clip routing against a running server.
 *   npm run check:listeners -w @streaming/server
 *
 * The rule under test: a real TTS browser source always wins over a fallback
 * listener (the dashboard), so opening the dashboard next to OBS never pulls
 * audio out of the stream — but with no source open, the dashboard still gets
 * the clip so you can hear it.
 */
import { io, type Socket } from 'socket.io-client';

// Point at an isolated instance (PORT=4799 npm start) so other open dashboards
// and overlay tabs don't intercept the clips this test is watching for.
import { BASE } from './harness.js';

let passed = 0;
let failed = 0;

const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Listener {
  socket: Socket;
  received: string[];
  close: () => void;
}

/** Connects a client and records every clip the server sends it. */
async function connect(role: 'overlay' | 'dashboard', fallback: boolean): Promise<Listener> {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  const received: string[] = [];

  socket.on('tts:play', (item: { id: string; text: string }) => {
    received.push(item.text);
    // Ack immediately so the queue advances to the next item.
    socket.emit('tts:done', item.id);
  });

  await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  socket.emit('hello', { role, listener: true, fallback, overlayId: fallback ? undefined : 'tts' });
  await wait(300);

  return { socket, received, close: () => socket.disconnect() };
}

async function speak(text: string): Promise<void> {
  await fetch(`${BASE}/api/tts/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: 'en_us_002' }),
  });
  await wait(1200);
}

async function main(): Promise<void> {
  console.log('TTS clip routing\n');

  // A fallback listener on its own must still receive clips.
  const dashboard = await connect('dashboard', true);
  await speak('first line');
  check(
    'with no TTS source open, the fallback listener gets the clip',
    dashboard.received.includes('first line'),
    JSON.stringify(dashboard.received),
  );

  // Adding a real source must take over.
  const overlay = await connect('overlay', false);
  const dashboardBefore = dashboard.received.length;
  await speak('second line');
  check(
    'a real TTS source takes priority over the fallback',
    overlay.received.includes('second line'),
    JSON.stringify(overlay.received),
  );
  check(
    'the fallback receives nothing while a real source is open',
    dashboard.received.length === dashboardBefore,
    `fallback got ${JSON.stringify(dashboard.received.slice(dashboardBefore))}`,
  );

  // Closing the source hands control back.
  overlay.close();
  await wait(500);
  await speak('third line');
  check(
    'closing the source returns audio to the fallback',
    dashboard.received.includes('third line'),
    JSON.stringify(dashboard.received),
  );

  dashboard.close();
  await wait(200);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('harness error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
