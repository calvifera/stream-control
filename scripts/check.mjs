#!/usr/bin/env node
/**
 * Runs every check that needs no server and no network, and typechecks.
 *
 * `npm test` used to run a single check, so the others only ran when somebody
 * remembered them — and two of them went stale without anyone noticing. This
 * is the one command that runs them all.
 *
 * It also refuses to let a check go unregistered: every `check:*` script in
 * the server package must be listed below as either offline (run here) or live
 * (needs a running server or the network, run on purpose). Adding a script and
 * forgetting to classify it fails this run, which is the point.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Self-contained: no server, no network, no credentials. */
const OFFLINE = [
  'filters',
  'display',
  'innertube',
  'youtube-moderation',
  'phonetic',
  'bypass',
  'wordlist',
  'trust',
  'hub-chat',
  'auth',
  'auth-platforms',
  'preview',
  'cooldown',
  'test-events',
  'roles',
  'palette',
  'highlights',
  'session',
  'retention',
  'archive',
  'twitch',
  'gifts',
  'youtube',
  'moderation',
  'secrets',
  'network',
];

/**
 * Run on purpose. The first three talk to a running server (see `test:live`);
 * the rest call a platform's real endpoint and may need a key.
 */
const LIVE = [
  'api',
  'penalty',
  'listeners',
  'live',
  'twitch-live',
  'google',
  'google-legacy',
  'synth',
];

const serverPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/server/package.json'), 'utf8'));
const declared = Object.keys(serverPackage.scripts)
  .filter((name) => name.startsWith('check:'))
  .map((name) => name.slice('check:'.length));
const classified = new Set([...OFFLINE, ...LIVE]);

const unclassified = declared.filter((name) => !classified.has(name));
const missing = [...classified].filter((name) => !declared.includes(name));
if (unclassified.length > 0 || missing.length > 0) {
  if (unclassified.length > 0) {
    console.error(`check:${unclassified.join(', check:')} exist but are not listed in scripts/check.mjs.`);
  }
  if (missing.length > 0) {
    console.error(`scripts/check.mjs lists ${missing.join(', ')}, which no longer exist.`);
  }
  process.exit(1);
}

/** Runs one npm script quietly. Returns its combined output and whether it passed. */
function run(script) {
  const result = spawnSync(`npm run -s ${script}`, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const steps = [
  { label: 'typecheck', script: 'typecheck' },
  ...OFFLINE.map((name) => ({ label: `check:${name}`, script: `check:${name} -w @streaming/server` })),
];

const failures = [];
for (const { label, script } of steps) {
  const started = Date.now();
  const { ok, output } = run(script);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? '\x1b[32mpass\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label.padEnd(28)} ${seconds}s`);
  if (!ok) failures.push({ label, output });
}

for (const { label, output } of failures) {
  console.log(`\n\x1b[31m── ${label}\x1b[0m`);
  console.log(output.trimEnd().split('\n').slice(-40).join('\n'));
}

console.log(
  failures.length === 0
    ? `\nAll ${steps.length} passed.`
    : `\n${failures.length} of ${steps.length} failed.`,
);
process.exit(failures.length === 0 ? 0 : 1);
