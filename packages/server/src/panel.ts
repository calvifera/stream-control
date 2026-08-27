import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.js';

const log = createLogger('panel');

/**
 * Launching the desktop chat panel from the dashboard.
 *
 * This is the one place the server starts a program, so it is deliberately
 * narrow: there is no path parameter, no argument passing, and no shell. The
 * only thing it can ever run is the panel binary, found at a fixed set of
 * locations relative to this repo. A request cannot influence *what* runs —
 * only whether the one known executable is started.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** packages/server/src -> repo root */
const ROOT = path.resolve(here, '..', '..', '..');

const EXE = process.platform === 'win32' ? 'streaming-chat-panel.exe' : 'streaming-chat-panel';

/**
 * Where the binary might be, best first.
 *
 * Release before debug so a built panel is preferred over a leftover debug
 * build — it starts faster and uses less memory, which is the entire point of
 * a window you keep open while gaming.
 */
const CANDIDATES = [
  path.join(ROOT, 'packages', 'desktop', 'src-tauri', 'target', 'release', EXE),
  path.join(ROOT, 'packages', 'desktop', 'src-tauri', 'target', 'debug', EXE),
];

export interface PanelStatus {
  /** A binary exists and could be launched. */
  available: boolean;
  /** Whether it is the optimised build. */
  release: boolean;
  /** True once this server has started one that has not exited. */
  running: boolean;
}

let child: ReturnType<typeof spawn> | null = null;

function findBinary(): { file: string; release: boolean } | null {
  for (const file of CANDIDATES) {
    if (fs.existsSync(file)) return { file, release: file.includes(`${path.sep}release${path.sep}`) };
  }
  return null;
}

export function panelStatus(): PanelStatus {
  const found = findBinary();
  return {
    available: found !== null,
    release: found?.release ?? false,
    // Only ever true for a panel *this* server started. One launched by hand
    // is invisible here, which is fine — the single-instance plugin means a
    // second launch focuses the first rather than duplicating it.
    running: child !== null && child.exitCode === null,
  };
}

export function openPanel(): { ok: true } | { ok: false; error: string } {
  const found = findBinary();
  if (!found) {
    return {
      ok: false,
      error:
        'The desktop panel has not been built yet. Run "npm run panel:build" once, then try again.',
    };
  }

  try {
    // `detached` plus `unref` so the panel outlives a server restart. Nothing
    // is more annoying than a chat window vanishing because a dev server
    // reloaded mid-stream.
    const started = spawn(found.file, [], {
      detached: true,
      stdio: 'ignore',
      // No shell. The path is one of two constants, but running it through a
      // shell would still be an unnecessary parsing layer between here and
      // the executable.
      shell: false,
    });
    started.unref();
    started.on('error', (error) => log.warn(`Panel exited badly: ${String(error)}`));

    child = started;
    log.info(`Opened the chat panel (${found.release ? 'release' : 'debug'} build)`);
    return { ok: true };
  } catch (error) {
    log.error('Could not start the chat panel', error);
    return { ok: false, error: 'Could not start the panel. See the server log.' };
  }
}
