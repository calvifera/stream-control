import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('slideshows');

export const SLIDESHOW_DIR = path.join(MEDIA_DIR, 'slideshows');

const MAX_BYTES = 12 * 1024 * 1024;

const ALLOWED = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
]);

export interface SlideshowFolder {
  name: string;
  images: string[];
  bytes: number;
}

/**
 * Image folders for slideshow sources, under data/media/slideshows.
 *
 * Everything here is deliberately paranoid about names: these come from
 * uploaded filenames, and a browser will happily send `../../` in a directory
 * upload. Names are sanitised to a flat, known-safe form and then checked
 * again against the resolved path, so nothing can be written or read outside
 * the slideshow directory.
 */
export class SlideshowStore {
  constructor() {
    if (!fs.existsSync(SLIDESHOW_DIR)) fs.mkdirSync(SLIDESHOW_DIR, { recursive: true });
  }

  /** Flattens any path into one safe segment. Returns '' when unusable. */
  safeSegment(value: string): string {
    // A directory upload sends "folder/sub/file.jpg"; keep only the last part.
    const base = value.split(/[\\/]/).pop() ?? '';
    const cleaned = base
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 80);
    return cleaned === '.' || cleaned === '..' ? '' : cleaned;
  }

  /** Resolves a folder, refusing anything that escapes the root. */
  private resolveFolder(folder: string): string | null {
    const safe = this.safeSegment(folder);
    if (!safe) return null;
    const target = path.join(SLIDESHOW_DIR, safe);
    const rel = path.relative(SLIDESHOW_DIR, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return target;
  }

  list(): SlideshowFolder[] {
    if (!fs.existsSync(SLIDESHOW_DIR)) return [];
    return fs
      .readdirSync(SLIDESHOW_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.folder(entry.name))
      .filter((f): f is SlideshowFolder => f !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  folder(name: string): SlideshowFolder | null {
    const dir = this.resolveFolder(name);
    if (!dir || !fs.existsSync(dir)) return null;

    let bytes = 0;
    const images = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ALLOWED.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => {
        try {
          bytes += fs.statSync(path.join(dir, entry.name)).size;
        } catch {
          /* ignore */
        }
        return entry.name;
      })
      // Natural-ish sort so "img2" comes before "img10".
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    return { name: this.safeSegment(name), images, bytes };
  }

  /** Writes one image. Returns the stored filename, or null if refused. */
  save(folder: string, filename: string, data: Buffer): string | null {
    const dir = this.resolveFolder(folder);
    if (!dir) return null;

    const safeName = this.safeSegment(filename);
    const ext = path.extname(safeName).toLowerCase();
    if (!safeName || !ALLOWED.has(ext)) {
      log.debug(`Refusing "${filename}" — not an accepted image type`);
      return null;
    }
    if (data.length === 0 || data.length > MAX_BYTES) {
      log.debug(`Refusing "${filename}" — ${data.length} bytes`);
      return null;
    }
    if (!looksLikeImage(data, ext)) {
      log.debug(`Refusing "${filename}" — contents are not a ${ext} image`);
      return null;
    }

    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, safeName);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
    return safeName;
  }

  removeImage(folder: string, filename: string): boolean {
    const dir = this.resolveFolder(folder);
    const safeName = this.safeSegment(filename);
    if (!dir || !safeName) return false;
    const target = path.join(dir, safeName);
    if (!fs.existsSync(target)) return false;
    fs.rmSync(target, { force: true });
    return true;
  }

  removeFolder(folder: string): boolean {
    const dir = this.resolveFolder(folder);
    if (!dir || !fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
}

/**
 * Magic-number check. The extension says what a file claims to be; this says
 * what it is. Cheap insurance against a renamed script landing in a folder
 * that overlays load from.
 */
function looksLikeImage(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 12) return false;
  const hex = buffer.subarray(0, 12);

  const isJpeg = hex[0] === 0xff && hex[1] === 0xd8 && hex[2] === 0xff;
  const isPng =
    hex[0] === 0x89 && hex[1] === 0x50 && hex[2] === 0x4e && hex[3] === 0x47;
  const isGif = hex.subarray(0, 3).toString('ascii') === 'GIF';
  const riff = hex.subarray(0, 4).toString('ascii') === 'RIFF';
  const isWebp = riff && hex.subarray(8, 12).toString('ascii') === 'WEBP';
  const isAvif = hex.subarray(4, 8).toString('ascii') === 'ftyp';

  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return isJpeg;
    case '.png':
      return isPng;
    case '.gif':
      return isGif;
    case '.webp':
      return isWebp;
    case '.avif':
      return isAvif;
    default:
      return false;
  }
}
