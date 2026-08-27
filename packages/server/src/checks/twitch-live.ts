/**
 * Live Twitch smoke test.
 *
 * Talks to the real service, so it is deliberately kept OUT of the hub: the
 * manager is driven directly and nothing it observes reaches `users.json`.
 * Pointing the full pipeline at someone else's channel would file their
 * viewers into your own archive, which is not a thing a test should do.
 *
 *   npm run check:twitch-live --workspace @streaming/server -- <channel>
 */
import { TwitchManager } from '../twitch/manager.js';
import type { StreamEvent } from '@streaming/shared';

const channel = process.argv[2] ?? 'xqc';
const WINDOW_MS = 15_000;

const manager = new TwitchManager({
  channel,
  enabled: true,
  // A smoke test that silently reconnects would hide the failure it exists
  // to surface.
  autoReconnect: false,
  reconnectDelaySeconds: 10,
  connectOnStartup: false,
    moderation: { enabled: false, timeoutSeconds: 600, includeAutomatic: false },
});

const counts = new Map<string, number>();
let samples = 0;
let connected = false;

manager.on('state', (state: { status: string; lastError: string | null }) => {
  if (state.status === 'connected') connected = true;
  console.log(`  [state] ${state.status}${state.lastError ? ` — ${state.lastError}` : ''}`);
});

manager.on('event', (event: StreamEvent) => {
  counts.set(event.type, (counts.get(event.type) ?? 0) + 1);

  if (event.type === 'chat' && samples < 6) {
    samples += 1;
    const badges = `${event.user.isSubscriber ? ' ★' : ''}${event.user.isModerator ? ' 🛡' : ''}`;
    console.log(
      `  ${event.platform} | ${event.user.nickname} (@${event.user.uniqueId})${badges}: ` +
        event.text.slice(0, 66),
    );
  }
  if (event.type === 'gift') {
    console.log(`  CHEER  ${event.user.nickname} — ${event.totalDiamonds} bits`);
  }
  if (event.type === 'subscribe') {
    console.log(`  SUB    ${event.user.nickname} — ${event.subMonths}mo gifted=${event.isGifted}`);
  }
  if (event.type === 'share') {
    console.log(`  RAID   ${event.user.nickname} — ${event.shareCount} viewers`);
  }
});

console.log(`\nWatching #${channel} for ${WINDOW_MS / 1000}s\n`);
manager.connect();

setTimeout(() => {
  manager.disconnect();

  const chat = counts.get('chat') ?? 0;
  console.log(`\n  counts: ${JSON.stringify(Object.fromEntries(counts))}`);
  console.log(`  connected: ${connected}`);

  // A quiet channel is not a failure; failing to connect is.
  if (!connected) {
    console.log('\nFAILED — never reached the connected state\n');
    process.exit(1);
  }
  console.log(
    chat > 0
      ? `\nOK — connected and parsed ${chat} chat message(s)\n`
      : '\nOK — connected, but the channel was silent (try a busier one)\n',
  );
  process.exit(0);
}, WINDOW_MS);
