import { EventEmitter } from 'node:events';
import type { LogEntry } from '@streaming/shared';
import { env } from './env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const threshold = LEVELS[env.logLevel] ?? LEVELS.info;

const COLORS: Record<LogEntry['level'], string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

/** Emits every log line so the dashboard can show a live console. */
export const logBus = new EventEmitter();

/** Ring buffer so a freshly opened dashboard has recent context. */
const recent: LogEntry[] = [];
const RECENT_MAX = 300;

function write(level: LogEntry['level'], scope: string, message: string): void {
  const entry: LogEntry = { ts: Date.now(), level, scope, message };
  recent.push(entry);
  if (recent.length > RECENT_MAX) recent.shift();
  logBus.emit('log', entry);

  if (LEVELS[level] < threshold) return;
  const time = new Date(entry.ts).toLocaleTimeString();
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${COLORS[level]}${time} [${scope}] ${message}\x1b[0m\n`);
}

export function recentLogs(): LogEntry[] {
  return [...recent];
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m) => write('debug', scope, m),
    info: (m) => write('info', scope, m),
    warn: (m) => write('warn', scope, m),
    error: (m, error) => write('error', scope, error ? `${m}: ${describeError(error)}` : m),
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
