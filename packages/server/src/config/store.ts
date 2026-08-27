import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createDefaultConfig, type AppConfig } from '@streaming/shared';
import { CONFIG_PATH, ensureDirs } from '../env.js';
import { createLogger, describeError } from '../logger.js';
import { appConfigSchema } from './schema.js';

const log = createLogger('config');

type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Deep-merges a stored config over the current defaults. Arrays are replaced
 * wholesale (a user who deleted every overlay should get zero overlays back,
 * not the defaults), objects merge key by key so fields added in a later
 * version appear without a migration step.
 */
function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return patch === undefined ? base : (patch as T);
  if (!isPlainObject(base)) return patch as T;

  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = (base as Plain)[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? mergeDeep(current, value) : value;
  }
  return out as T;
}

export class ConfigStore extends EventEmitter {
  private current: AppConfig;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.current = this.load();
  }

  get(): AppConfig {
    return this.current;
  }

  private load(): AppConfig {
    ensureDirs();
    const defaults = createDefaultConfig();

    if (!fs.existsSync(CONFIG_PATH)) {
      log.info(`No config found, writing defaults to ${CONFIG_PATH}`);
      this.persistNow(defaults);
      return defaults;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as unknown;
      const merged = mergeDeep(defaults, raw);
      const parsed = appConfigSchema.parse(merged);
      log.info(`Loaded config (${parsed.overlays.length} overlays, ${parsed.tts.rules.length} TTS rules)`);
      return parsed as AppConfig;
    } catch (error) {
      const backup = `${CONFIG_PATH}.broken-${Date.now()}.json`;
      log.error(`Config at ${CONFIG_PATH} is invalid, falling back to defaults`, error);
      try {
        fs.copyFileSync(CONFIG_PATH, backup);
        log.warn(`Kept a copy of the bad config at ${backup}`);
      } catch {
        /* the copy is a nicety; never block startup on it */
      }
      return defaults;
    }
  }

  /**
   * Validates and applies a full or partial config. Throws a ZodError with
   * field paths when validation fails, which the API surfaces to the UI.
   */
  update(patch: unknown): AppConfig {
    const merged = mergeDeep(this.current, patch);
    const parsed = appConfigSchema.parse(merged) as AppConfig;

    const duplicates = findDuplicateOverlayIds(parsed);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate overlay ids: ${duplicates.join(', ')}`);
    }

    this.current = parsed;
    this.emit('change', parsed);
    this.schedulePersist();
    return parsed;
  }

  /** Replaces the config wholesale, e.g. when the user hits "reset". */
  replace(config: unknown): AppConfig {
    const parsed = appConfigSchema.parse(config) as AppConfig;
    this.current = parsed;
    this.emit('change', parsed);
    this.schedulePersist();
    return parsed;
  }

  /**
   * Back to defaults — but never without a copy first.
   *
   * A reset throws away credentials that can't be regenerated from anything
   * on disk (the TikTok session cookie, the Google API key), and it is
   * reachable from both the dashboard and the API. The backup is what makes
   * an accidental reset annoying rather than destructive.
   */
  reset(): AppConfig {
    this.backup('reset');
    return this.replace(createDefaultConfig(this.current.connection.username));
  }

  /** Writes a timestamped copy of the current config next to the live one. */
  backup(reason: string): string | null {
    try {
      ensureDirs();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = `${CONFIG_PATH}.${reason}-${stamp}.bak.json`;
      fs.writeFileSync(target, JSON.stringify(this.current, null, 2), 'utf8');
      log.info(`Backed up config to ${target}`);
      this.pruneBackups();
      return target;
    } catch (error) {
      log.warn(`Could not back up the config: ${describeError(error)}`);
      return null;
    }
  }

  /** Keeps the ten most recent backups so this can't grow without bound. */
  private pruneBackups(): void {
    try {
      const dir = path.dirname(CONFIG_PATH);
      const base = `${path.basename(CONFIG_PATH)}.`;
      const backups = fs
        .readdirSync(dir)
        .filter((name) => name.startsWith(base) && name.endsWith('.bak.json'))
        .sort()
        .reverse();

      for (const stale of backups.slice(10)) {
        fs.unlinkSync(path.join(dir, stale));
      }
    } catch {
      // Pruning is housekeeping; never let it break a reset.
    }
  }

  /** Debounced so slider drags in the dashboard don't hammer the disk. */
  private schedulePersist(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persistNow(this.current);
    }, 300);
  }

  private persistNow(config: AppConfig): void {
    try {
      ensureDirs();
      const tmp = `${CONFIG_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
      fs.renameSync(tmp, CONFIG_PATH);
    } catch (error) {
      log.error(`Could not write ${CONFIG_PATH}`, error);
    }
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.persistNow(this.current);
  }
}

function findDuplicateOverlayIds(config: AppConfig): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const overlay of config.overlays) {
    if (seen.has(overlay.id)) dupes.add(overlay.id);
    seen.add(overlay.id);
  }
  return [...dupes];
}

export function formatConfigError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    return issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ');
  }
  return describeError(error);
}
