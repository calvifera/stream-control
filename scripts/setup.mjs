#!/usr/bin/env node
/**
 * First-run setup: install, build, then connect each platform.
 *
 * Uses only Node built-ins so it runs before `npm install` has. Every question
 * is skippable with Enter and the whole thing can be re-run: answers already
 * saved are offered back as the default.
 *
 * Writes to the same two files the dashboard does — `data/config.json` for the
 * channel names and `data/secrets.json` for credentials — so nothing here is
 * a second source of truth. `data/` is gitignored and `DATA_DIR` is honoured.
 *
 * Flags:
 *   --no-prompts   install and build only
 *   --no-start     do not offer to start the server at the end
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SECRETS_PATH = path.join(DATA_DIR, 'secrets.json');

const args = new Set(process.argv.slice(2));
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !args.has('--no-prompts');

const say = (text = '') => process.stdout.write(`${text}\n`);
const heading = (text) => say(`\n\x1b[36m${text}\x1b[0m`);
const good = (text) => say(`  \x1b[32m✓\x1b[0m ${text}`);
const warn = (text) => say(`  \x1b[33m!\x1b[0m ${text}`);
const bad = (text) => say(`\x1b[31m${text}\x1b[0m`);
const dim = (text) => `\x1b[2m${text}\x1b[0m`;

/* ------------------------------------------------------------------ *
 * Node version
 * ------------------------------------------------------------------ */

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  bad(`This needs Node 20 or newer, and you have ${process.versions.node}.`);
  say('Download the current LTS from https://nodejs.org, install it, then run this again.');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Install and build
 * ------------------------------------------------------------------ */

/**
 * Runs npm as one shell string: on Windows npm is `npm.cmd`, which Node will
 * not spawn without a shell. Every argument here is a literal in this file.
 */
function npm(argString) {
  const result = spawnSync(`npm ${argString}`, { cwd: ROOT, stdio: 'inherit', shell: true });
  return result.status === 0;
}

const installed = fs.existsSync(path.join(ROOT, 'node_modules', '@streaming', 'server'));
const built = fs.existsSync(path.join(ROOT, 'packages', 'overlay', 'dist', 'index.html'));

heading('1/3  Installing');
if (installed) {
  say('  already installed');
} else {
  say('  This downloads about 250 packages and takes a minute or two.');
  if (!npm('install --no-audit --no-fund')) {
    bad('\nThe install failed. The error above says why; the usual causes are:');
    say('  - no internet connection, or a proxy blocking npm');
    say('  - an old Node (you have ' + process.versions.node + '; 20 or newer is needed)');
    say('  - a half-finished earlier attempt: delete the node_modules folder and run this again');
    process.exit(1);
  }
}

heading('2/3  Building the dashboard');
if (built) {
  say('  already built');
} else if (!npm('run build')) {
  bad('\nThe build failed. Copy the error above if you ask for help.');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Saved state
 * ------------------------------------------------------------------ */

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write-then-rename so a crash cannot leave half a file. */
function writeJson(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode });
  fs.renameSync(tmp, file);
}

const saved = { config: {}, secrets: {} };
// Pending changes are collected and written once at the end, so quitting
// halfway (Ctrl+C) leaves what was there before rather than half an answer.
const patch = {};
const secretPatch = {};

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */

let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});

let rl = null;

async function ask(question) {
  muted = false;
  return (await rl.question(`  ${question} `)).trim();
}

/** Reads a credential without echoing it: people stream and screen-share. */
async function askSecret(question) {
  process.stdout.write(`  ${question} `);
  muted = true;
  try {
    return (await rl.question('')).trim();
  } finally {
    muted = false;
    process.stdout.write('\n');
  }
}

/** Accepts a name, an @name or a pasted link and returns the bare name. */
function bareName(input, hosts) {
  let value = input.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      value = url.pathname.split('/').filter(Boolean)[0] ?? '';
    }
  } catch {
    // Not a URL, which is the normal case.
  }
  return value.replace(/^@/, '').trim();
}

/** Strips what people copy along with a cookie: `sessionid=`, quotes, `;`. */
function cleanCookie(input) {
  return input
    .trim()
    .replace(/^sessionid\s*[=:]\s*/i, '')
    .replace(/^["']|["'];?$/g, '')
    .replace(/;$/, '')
    .trim();
}

/* ------------------------------------------------------------------ *
 * TikTok login cookie
 * ------------------------------------------------------------------ */

/**
 * Finds a Chromium-based browser already on the machine. Edge ships with
 * Windows and Chrome is on nearly everything else, so this almost always hits.
 */
function findBrowser() {
  const env = process.env;
  const candidates =
    process.platform === 'win32'
      ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
          .filter(Boolean)
          .flatMap((base) => [
            path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
          ])
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'].flatMap(
            (name) => (env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, name)),
          );
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

async function webSocketClass() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    // Present once dependencies are installed (socket.io pulls it in).
    return (await import('ws')).WebSocket;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens a throwaway browser window, waits for you to log in to TikTok, and
 * reads the `sessionid` cookie out of it.
 *
 * The cookie is HttpOnly, so no bookmarklet or console snippet can read it;
 * the browser's own debugging channel is the one way to do it automatically.
 * A fresh temporary profile keeps your real browser out of it, and the window
 * and profile are deleted afterwards. Nothing leaves this machine.
 */
async function captureTikTokCookie() {
  const browser = findBrowser();
  const WebSocketImpl = await webSocketClass();
  if (!browser || !WebSocketImpl) return null;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-control-login-'));
  const child = spawn(
    browser,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      'https://www.tiktok.com/login',
    ],
    { stdio: 'ignore', detached: false },
  );
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  child.on('error', () => {
    exited = true;
  });

  let socket = null;
  try {
    // With port 0 the browser picks a free port and records it in this file.
    const portFile = path.join(profile, 'DevToolsActivePort');
    const startedAt = Date.now();
    while (!fs.existsSync(portFile)) {
      if (exited || Date.now() - startedAt > 20_000) return null;
      await sleep(250);
    }
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    socket = new WebSocketImpl(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error('could not reach the browser'));
    });

    let nextId = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      pending.get(message.id)?.(message.result);
      pending.delete(message.id);
    };
    const send = (method) =>
      new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method }));
      });

    say('  A browser window opened. Log in to TikTok there — this finishes by itself.');
    say(dim('  (Waiting up to 5 minutes. Close the window to cancel.)'));

    const deadline = Date.now() + 5 * 60_000;
    while (!exited && Date.now() < deadline) {
      const result = await Promise.race([send('Storage.getCookies'), sleep(2000).then(() => null)]);
      const cookies = (result?.cookies ?? []).filter((c) => /(^|\.)tiktok\.com$/.test(c.domain.replace(/^\./, '')));
      const session = cookies.find((c) => c.name === 'sessionid' && c.value);
      if (session) {
        const idc = cookies.find((c) => c.name === 'tt-target-idc' && c.value);
        return { sessionId: session.value, targetIdc: idc?.value ?? null };
      }
      await sleep(1500);
    }
    return null;
  } catch {
    return null;
  } finally {
    try {
      socket?.close();
    } catch {
      /* already closed */
    }
    if (!exited) child.kill();
    // The browser holds files in the profile briefly after it exits.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(500);
      }
    }
  }
}

async function tiktokVoices() {
  const has = Boolean(saved.secrets.TIKTOK_SESSION_ID);
  say('');
  say('  TikTok voices need your TikTok login cookie. Chat works without it, and');
  say('  skipping just means speech uses your browser\'s built-in voices.');
  const choice = (
    await ask(
      has
        ? 'Already saved. [b]rowser login to replace it, [p]aste, or Enter to keep:'
        : '[b]rowser login (easiest), [p]aste it yourself, or Enter to skip:',
    )
  ).toLowerCase();

  let sessionId = '';
  if (choice.startsWith('b')) {
    const captured = await captureTikTokCookie();
    if (captured) {
      sessionId = captured.sessionId;
      if (captured.targetIdc) secretPatch.TIKTOK_TARGET_IDC = captured.targetIdc;
    } else {
      warn('Could not read it automatically (no Chrome/Edge found, or the window was closed).');
    }
  }
  if (!sessionId && (choice.startsWith('p') || choice.startsWith('b'))) {
    say('');
    say('  In your normal browser: log in to tiktok.com, press F12, open the');
    say('  Application tab (Storage in Firefox), then Cookies → https://www.tiktok.com,');
    say('  and copy the Value of the row named "sessionid".');
    sessionId = cleanCookie(await askSecret('Paste it here (hidden, Enter to skip):'));
  }
  if (sessionId) {
    secretPatch.TIKTOK_SESSION_ID = sessionId;
    good(`TikTok login saved (${sessionId.length} characters, not shown)`);
  }
}

/* ------------------------------------------------------------------ *
 * The questions
 * ------------------------------------------------------------------ */

async function prompts() {
  const config = readJson(CONFIG_PATH);
  const secrets = readJson(SECRETS_PATH);
  if (config === null || secrets === null) {
    warn('data/config.json or data/secrets.json could not be read, so setup will not touch them.');
    warn('Set things up on the dashboard instead.');
    return;
  }
  saved.config = config;
  saved.secrets = secrets;

  rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  rl.on('SIGINT', () => {
    say('\n\nStopped. Nothing from this step was saved; run `npm run setup` to try again.');
    process.exit(130);
  });

  heading('3/3  Connect your platforms');
  say('  Press Enter to skip any question. You can change all of it later on the');
  say('  dashboard, or run `npm run setup` again.');

  const current = (section, key) => (typeof config[section]?.[key] === 'string' ? config[section][key] : '');
  const withCurrent = (label, value) => (value ? `${label} [${value}]:` : `${label}:`);

  say('\n  \x1b[1mTikTok\x1b[0m');
  const tiktokUser = bareName(
    await ask(withCurrent('Your TikTok @username (or the one you want to watch), Enter to skip', current('connection', 'username'))),
    ['tiktok.com'],
  );
  if (tiktokUser) {
    patch.connection = { username: tiktokUser, connectOnStartup: true };
    good(`Will connect to @${tiktokUser} on start`);
  }
  await tiktokVoices();

  say('\n  \x1b[1mTwitch\x1b[0m');
  const twitch = bareName(
    await ask(withCurrent('Twitch channel name, Enter to skip', current('twitch', 'channel'))),
    ['twitch.tv'],
  );
  if (twitch) {
    patch.twitch = { channel: twitch.toLowerCase(), enabled: true, connectOnStartup: true };
    good(`Will join #${twitch.toLowerCase()} on start`);
  }

  say('\n  \x1b[1mYouTube\x1b[0m');
  const ytCurrent = current('youtube', 'videoId') || current('youtube', 'handle');
  const youtube = (
    await ask(withCurrent('YouTube @handle or a video link, Enter to skip', ytCurrent))
  ).trim();
  if (youtube) {
    // Same rule the dashboard applies to this field.
    const isVideo = /(?:v=|youtu\.be\/|\/live\/)[\w-]{11}/.test(youtube) || /^[\w-]{11}$/.test(youtube);
    // A pasted channel link carries its @handle in the path.
    const linked = youtube.match(/youtube\.com\/(@[^/?#\s]+)/i)?.[1];
    const handle = linked ?? (youtube.startsWith('@') ? youtube : `@${youtube}`);
    patch.youtube = {
      enabled: true,
      connectOnStartup: true,
      videoId: isVideo ? youtube : '',
      handle: isVideo ? '' : handle,
    };
    good(isVideo ? 'Will read that video\'s chat on start' : `Will read ${patch.youtube.handle}'s live chat on start`);
  }

  say('\n  \x1b[1mBetter voices (optional)\x1b[0m');
  say('  Google Cloud text-to-speech sounds best and is free at stream volumes. It');
  say('  takes about five minutes to get a key; the Keys tab on the dashboard walks you');
  say('  through it, so you can just skip this now.');
  const googleKey = await askSecret(
    saved.secrets.GOOGLE_TTS_API_KEY
      ? 'API key already saved. Paste a new one to replace it, or Enter to keep:'
      : 'Paste a Google TTS API key (hidden), or Enter to skip:',
  );
  if (googleKey) {
    secretPatch.GOOGLE_TTS_API_KEY = googleKey;
    good('Google key saved');
  }

  rl.close();
}

/** Writes everything at once. Sections merge one level deep, like the config store. */
function persist() {
  if (Object.keys(patch).length > 0) {
    const config = { ...saved.config };
    for (const [section, values] of Object.entries(patch)) {
      config[section] = { ...(config[section] ?? {}), ...values };
    }
    writeJson(CONFIG_PATH, config);
  }
  if (Object.keys(secretPatch).length > 0) {
    writeJson(SECRETS_PATH, { ...saved.secrets, ...secretPatch }, 0o600);
  }
}

/* ------------------------------------------------------------------ *
 * Finish
 * ------------------------------------------------------------------ */

function openInBrowser(url) {
  const [command, commandArgs] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, commandArgs, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

if (interactive) {
  await prompts();
  persist();
} else {
  say('\nSkipping the platform questions (no terminal to ask in).');
}

heading('Done');
const port = process.env.PORT || '4700';
say(`  Start it with:  npm start`);
say(`  Then open:      http://localhost:${port}`);
say('  (Put your TikTok connection key, ngrok and the rest on the dashboard\'s Keys tab.)');

if (interactive && !args.has('--no-start')) {
  const closer = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await closer.question('\n  Start it now? [Y/n] ')).trim().toLowerCase();
  closer.close();
  if (answer === '' || answer.startsWith('y')) {
    say('');
    const server = spawn('npm start', { cwd: ROOT, stdio: 'inherit', shell: true });
    setTimeout(() => openInBrowser(`http://localhost:${port}`), 4000);
    server.on('exit', (code) => process.exit(code ?? 0));
  }
}
