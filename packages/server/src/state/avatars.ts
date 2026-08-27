import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDirs } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('avatars');

export const AVATAR_DIR = path.join(DATA_DIR, 'avatars');

/** Anything bigger than this is not a profile picture; refuse it. */
const MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

/**
 * Local copies of profile pictures, served from this server.
 *
 * Caching rather than storing the remote URL is not an optimisation — TikTok's
 * avatar URLs are signed and carry `x-expires` about 48 hours out. Handing one
 * to a browser source means the picture silently 403s two days later,
 * usually mid-stream. A local copy keeps `/avatars/<user>.jpg` stable forever,
 * and overlays never depend on TikTok being reachable at render time.
 */
export class AvatarStore {
  constructor() {
    ensureDirs();
    if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
  }

  /** Filename is derived from the handle, so it is stable across refetches. */
  private safeName(username: string): string {
    return username.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 40);
  }

  /** The public path for a cached avatar, or null when we have none. */
  publicPath(username: string): string | null {
    const base = this.safeName(username);
    for (const ext of ALLOWED_TYPES.values()) {
      if (fs.existsSync(path.join(AVATAR_DIR, base + ext))) return `/avatars/${base}${ext}`;
    }
    return null;
  }

  has(username: string): boolean {
    return this.publicPath(username) !== null;
  }

  /**
   * Downloads `url` and stores it for `username`. Returns the public path, or
   * null if the fetch failed or returned something that is not an image.
   */
  async store(username: string, url: string, timeoutMs = 8000): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        log.debug(`@${username}: avatar fetch returned ${response.status}`);
        return null;
      }

      const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
      const ext = ALLOWED_TYPES.get(type);
      if (!ext) {
        log.debug(`@${username}: refusing avatar of type "${type}"`);
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_BYTES) {
        log.debug(`@${username}: refusing avatar of ${buffer.length} bytes`);
        return null;
      }

      const base = this.safeName(username);
      // Drop any copy under a different extension so one handle never has two.
      for (const other of ALLOWED_TYPES.values()) {
        if (other === ext) continue;
        const stale = path.join(AVATAR_DIR, base + other);
        if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
      }

      const target = path.join(AVATAR_DIR, base + ext);
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, target);

      return `/avatars/${base}${ext}`;
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        log.debug(`@${username}: avatar download failed — ${String(error).slice(0, 120)}`);
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  remove(username: string): void {
    const base = this.safeName(username);
    for (const ext of ALLOWED_TYPES.values()) {
      const file = path.join(AVATAR_DIR, base + ext);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
  }

  count(): number {
    try {
      return fs.readdirSync(AVATAR_DIR).filter((f) => !f.endsWith('.tmp')).length;
    } catch {
      return 0;
    }
  }
}
