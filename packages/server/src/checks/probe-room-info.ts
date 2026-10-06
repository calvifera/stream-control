/**
 * Shows what TikTok reports about a live room beyond chat.
 *   npm run probe:room-info -w @streaming/server -- <handle> [--all]
 *
 * Connects the way the app does, waits briefly for the first viewer-count
 * update, prints what TikTok sent, and disconnects. It exists to answer one
 * question before anything is built on it: which platform-side numbers
 * (totals, start time, title) are actually there to be shown?
 *
 * The room has to be live — TikTok has no room to describe otherwise.
 *
 * The room information is mostly noise: hundreds of fields TikTok has
 * deprecated, and permission flags for features nobody asked about. So the
 * likely candidates are printed first, then everything else with zeros, falses
 * and known-noise groups left out. `--all` puts the zeros back.
 *
 * Prints field names and numbers, never raw data. Room information can carry
 * signed stream links and image URLs, so strings that look like links or like
 * credentials are skipped and long strings are reduced to their length.
 * Nothing is written to disk.
 */
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import { env } from '../env.js';

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const handle = (args.find((arg) => !arg.startsWith('--')) ?? '').trim().replace(/^@/, '');
if (!handle) {
  console.error('\n  Usage: npm run probe:room-info -w @streaming/server -- <handle> [--all]\n');
  process.exit(1);
}

/** Keys whose values are links, pictures, secrets or other people — named, not printed. */
const PRIVATE_KEY = /ranks|seats|url|uri|avatar|image|cover|icon|badge|token|cookie|secret|sign|sdk|pull|flv|hls|rtmp|stream_data|sec_uid/i;

/** Groups that are permissions, layout or leftovers rather than facts about the stream. */
const NOISE_KEY =
  /^deprecated\d*$|^room_auth$|^link_mic$|^linkmic|^commerce_info$|^enlarge_view_info$|^living_room_attrs$|^partnership_info$|^age_restricted$|^paid_event$|^feed_room_label$|^room_create_ab_param$|_style$|^live_type_|^has_|^is_|^allow_|^push_|^show_/;

/** Fields worth looking for by name, anywhere in `data`, whatever their value. */
const HEADLINE =
  /^(stats|user_count|like_count|share_count|comment_count|enter_count|total_user|room_pcu|title|start_time|create_time|finish_time|finish_reason|status|replay|live_room_mode|follow_count|digg_count|gift_count|popularity|view_count)$/;

const MAX_DEPTH = 5;
const MAX_LINES = 250;
let lines = 0;

function print(path: string, text: string): void {
  if (lines > MAX_LINES) return;
  lines += 1;
  console.log(`  ${path.padEnd(52)} ${text}`);
  if (lines > MAX_LINES) console.log('  … output capped; use --all for more or ask for a specific group');
}

/** Prints one value. `force` keeps zeros and falses, for the headline section. */
function show(path: string, value: unknown, depth: number, force: boolean): void {
  const key = path.replace(/\[\d+\]$/, '').split('.').pop() ?? '';

  if (value === null || value === undefined) return;

  if (typeof value === 'number' || typeof value === 'boolean') {
    if (!force && !showAll && (value === 0 || value === false)) return;
    print(path, String(value));
    return;
  }

  if (typeof value === 'string') {
    if (PRIVATE_KEY.test(key) || /^https?:|^\/\//.test(value)) {
      print(path, '(link or image, not shown)');
    } else if (value.length > 80) {
      print(path, `(text, ${value.length} chars)`);
    } else if (value !== '') {
      print(path, JSON.stringify(value));
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return;
    print(path, `[${value.length} item${value.length === 1 ? '' : 's'}]`);
    const first = value[0];
    if (typeof first === 'object' && first !== null && depth < MAX_DEPTH && !PRIVATE_KEY.test(key)) {
      show(`${path}[0]`, first, depth + 1, force);
    }
    return;
  }

  if (typeof value === 'object') {
    if (PRIVATE_KEY.test(key)) {
      print(path, '(links, images or other people, not shown)');
      return;
    }
    if (!showAll && !force && NOISE_KEY.test(key)) {
      print(path, `(${Object.keys(value).length} fields, mostly flags — use --all)`);
      return;
    }
    if (depth >= MAX_DEPTH) {
      print(path, '{…}');
      return;
    }
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      show(path ? `${path}.${childKey}` : childKey, child, depth + 1, force);
    }
  }
}

/** Finds likely-useful fields wherever they sit, so none can be pushed out by noise. */
function headlines(root: unknown): void {
  const found: Array<[string, unknown]> = [];
  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > 4 || value === null || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (HEADLINE.test(key) && !PRIVATE_KEY.test(key)) found.push([here, child]);
      else if (!PRIVATE_KEY.test(key) && !NOISE_KEY.test(key)) walk(child, here, depth + 1);
    }
  };
  walk(root, '', 0);
  if (found.length === 0) console.log('  none of the usual names were present');
  for (const [path, value] of found) show(path, value, 0, true);
}

console.log(`\nRoom information for @${handle}\n`);

// The session id is deliberately not passed: this reads what any viewer can see,
// which is also what the app gets without an account.
const connection = new TikTokLiveConnection(handle, {
  processInitialData: false,
  fetchRoomInfoOnConnect: true,
  ...(env.signApiKey ? { signApiKey: env.signApiKey } : {}),
});

let roomUser: unknown = null;
connection.on(WebcastEvent.ROOM_USER, (message) => {
  roomUser ??= message;
});

try {
  const state = await connection.connect();
  console.log(`connected, room ${state.roomId}`);

  // The viewer-count message arrives on its own schedule; give it a few seconds.
  for (let waited = 0; waited < 10_000 && roomUser === null; waited += 500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\nviewer-count message (sent repeatedly while live)\n');
  if (roomUser === null) console.log('  none arrived within 10 seconds');
  else show('', roomUser, 0, true);

  console.log('\nlikely candidates in the room information (zeros shown)\n');
  headlines(state.roomInfo);

  console.log('\neverything else in the room information (zeros, flags and noise left out)\n');
  show('', state.roomInfo, 0, false);
} catch (error) {
  console.error(`\n  Could not read the room: ${error instanceof Error ? error.message : String(error)}`);
  console.error('  The room has to be live, and the handle has to be spelled exactly.\n');
  process.exitCode = 1;
} finally {
  connection.disconnect();
}

console.log('');
process.exit(process.exitCode ?? 0);
