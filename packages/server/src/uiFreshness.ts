import fs from 'node:fs';
import path from 'node:path';
import { OVERLAY_DIST, ROOT_DIR } from './env.js';

/**
 * Whether the built dashboard is older than the source it was built from.
 *
 * The failure this catches: `git pull` updates source but cannot update
 * `packages/overlay/dist`, which is gitignored. The server runs from source
 * via tsx and needs no build of its own, so `git pull && npm start` starts new
 * server code serving the previous build of the UI — and every symptom of that
 * looks like a bug in the app rather than a missing command.
 *
 * Modification times rather than a commit stamp, which was the first design.
 * A stamp compared against HEAD is wrong for the person developing the app:
 * building and then committing leaves the stamp behind HEAD forever, so the
 * warning fires on a checkout that is perfectly fresh. It also assumes git,
 * which a ZIP download does not have. Times answer the question directly —
 * was anything the build consumes touched after the build ran — and a pull
 * only rewrites the files it actually changes, so a server-only update stays
 * quiet.
 */

/** Everything `vite build` reads. A change to any of it makes dist stale. */
const SOURCE_DIRS = [
  path.join(ROOT_DIR, 'packages', 'overlay', 'src'),
  path.join(ROOT_DIR, 'packages', 'overlay', 'public'),
  // Bundled into the UI, not merely imported by it, so its changes count too.
  path.join(ROOT_DIR, 'packages', 'shared', 'src'),
];

const SOURCE_FILES = [
  path.join(ROOT_DIR, 'packages', 'overlay', 'index.html'),
  path.join(ROOT_DIR, 'packages', 'overlay', 'vite.config.ts'),
];

const BUILT = path.join(OVERLAY_DIST, 'index.html');

function newestIn(dir: string): number {
  let newest = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestIn(full));
      continue;
    }
    try {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    } catch {
      /* a file that vanished mid-walk cannot be the newest one that matters */
    }
  }
  return newest;
}

function mtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Returns how far behind the build is, or null when it is current.
 *
 * Null when there is no build at all: that case has its own message, and two
 * warnings about the same missing step is one too many.
 */
export function staleUi(): { behindMs: number } | null {
  const built = mtime(BUILT);
  if (built === 0) return null;

  const newest = Math.max(
    ...SOURCE_DIRS.map(newestIn),
    ...SOURCE_FILES.map(mtime),
  );
  if (newest <= built) return null;
  return { behindMs: newest - built };
}

/** "3 days", "2 hours", "just now" — enough to judge, not a precise duration. */
export function describeGap(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return 'moments';
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}
