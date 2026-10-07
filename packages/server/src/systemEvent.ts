import { randomUUID } from 'node:crypto';
import type { Platform, SystemEvent } from '@streaming/shared';

/**
 * A line for the event log that is about the connection rather than a viewer:
 * "Connected to Twitch #name", "YouTube: not signed in".
 *
 * One builder for all three platforms, so the shape cannot drift between them.
 */
export const systemEvent = (
  platform: Platform,
  level: SystemEvent['level'],
  text: string,
): SystemEvent => ({
  id: randomUUID(),
  ts: Date.now(),
  platform,
  type: 'system',
  user: null,
  level,
  text,
});
