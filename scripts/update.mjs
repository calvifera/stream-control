#!/usr/bin/env node
/**
 * Updates a checkout from the repo.
 *
 * The three commands this replaces have to happen in order, and the failure
 * that motivated it is silent: `git pull` brings new source, but the dashboard
 * is served from `packages/overlay/dist`, which is gitignored and therefore
 * untouched by the pull. Skip the rebuild and the server runs new code behind
 * the old UI, with nothing on screen to say so.
 *
 * So this refuses to leave a checkout half-updated. It stops before pulling if
 * the tree is dirty, it only reinstalls when the lockfile actually moved, and
 * if the build fails it says plainly which half landed and what to do about it.
 *
 * Nothing here touches `data/` or `.env`. Both are gitignored, so an update
 * cannot reach your config, your credentials or your viewer archive.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const say = (text = '') => process.stdout.write(`${text}\n`);
const step = (text) => say(`\n\x1b[36m${text}\x1b[0m`);
const bad = (text) => say(`\x1b[31m${text}\x1b[0m`);

/** Runs a command, showing its output. Returns whether it succeeded. */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  // A command that never started leaves status null, which is not a failing
  // exit code and would otherwise be reported as a mysterious empty failure.
  if (result.error) bad(`  could not run ${command}: ${result.error.message}`);
  return result.status === 0;
}

/**
 * Runs npm.
 *
 * As one shell string rather than a command plus an args array, because on
 * Windows npm is `npm.cmd` and Node refuses to spawn a `.cmd` without a shell
 * at all — it fails with EINVAL before npm ever runs. Passing an args array
 * alongside `shell: true` is the other way through and is deprecated, since
 * the arguments get concatenated rather than escaped. Every argument here is
 * a literal in this file, so the string form is both safe and the only one
 * that behaves the same on every platform.
 */
function runNpm(argString) {
  const result = spawnSync(`npm ${argString}`, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (result.error) bad(`  could not run npm: ${result.error.message}`);
  return result.status === 0;
}

/** Runs a command quietly and returns its stdout, or null if it failed. */
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: false });
  return result.status === 0 ? result.stdout.trim() : null;
}

const lockHash = () => {
  try {
    return createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex');
  } catch {
    return null;
  }
};

// A ZIP download has no history to pull from, and telling someone to run
// `git pull` in a directory that was never a clone is the kind of advice that
// wastes an hour.
if (capture('git', ['rev-parse', '--git-dir']) === null) {
  bad('This is not a git checkout, so there is nothing to pull.');
  say('');
  say('If you downloaded the ZIP, download it again over this folder, then run:');
  say('  npm install');
  say('  npm run build');
  say('');
  say('Your data/ folder and .env are not part of the download and will be left alone.');
  process.exit(1);
}

step('Checking the working tree');
const dirty = capture('git', ['status', '--porcelain']);
if (dirty === null) {
  bad('Could not read the git status.');
  process.exit(1);
}
if (dirty !== '') {
  bad('You have uncommitted changes, so pulling could conflict. Nothing has been changed.');
  say('');
  // Pad the two-character status code so untracked (`??`) and modified (` M`)
  // entries line their filenames up in the same column.
  for (const line of dirty.split('\n').slice(0, 20)) {
    say(`  ${line.slice(0, 2).trim().padEnd(2)}  ${line.slice(2).trim()}`);
  }
  if (dirty.split('\n').length > 20) say(`  … and ${dirty.split('\n').length - 20} more`);
  say('');
  say('Commit them, or set them aside with:');
  say('  git stash');
  process.exit(1);
}
say('  clean');

const before = capture('git', ['rev-parse', 'HEAD']);
const lockBefore = lockHash();

step('Pulling');
// --ff-only so an update never silently invents a merge commit in someone's
// checkout. If history has diverged that is a real decision, not a step to
// automate past.
if (!run('git', ['pull', '--ff-only'])) {
  bad('\nThe pull failed, so nothing else ran — the checkout is exactly as it was.');
  say('');
  say('If git mentioned diverged history, your branch has commits the repo does not.');
  say('Inspect them with:  git log --oneline origin/main..HEAD');
  process.exit(1);
}

const after = capture('git', ['rev-parse', 'HEAD']);
const changed = before !== after;
const files = changed ? (capture('git', ['diff', '--name-only', `${before}..${after}`]) ?? '') : '';
const fileCount = files === '' ? 0 : files.split('\n').length;

if (changed) {
  const commits = capture('git', ['rev-list', '--count', `${before}..${after}`]) ?? '?';
  say(`\n  ${commits} commit(s), ${fileCount} file(s) changed`);
} else {
  say('\n  already up to date');
}

step('Dependencies');
if (lockHash() !== lockBefore) {
  say('  package-lock.json moved — installing');
  if (!runNpm('install')) {
    bad('\nThe install failed. The new source is in place but its dependencies are not,');
    bad('so the app will not start. Fix the error above and run this again.');
    process.exit(1);
  }
} else {
  say('  lockfile unchanged — skipping install');
}

step('Building');
if (!runNpm('run build')) {
  bad('\nThe build failed. This is the half-updated state worth knowing about:');
  bad('the source is new, but the dashboard being served is still the old build.');
  say('');
  say('Fix the error above and run this again. To go back to the previous version:');
  say(`  git reset --hard ${before}`);
  say('  npm install && npm run build');
  process.exit(1);
}

step('Done');
if (changed) {
  say('  Restart the server for the new version to take effect:');
  say('    npm start');
} else {
  say('  Nothing changed, but the build is fresh.');
}
say('');
