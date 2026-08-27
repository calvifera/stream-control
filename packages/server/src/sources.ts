import dns from 'node:dns/promises';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { SourceHostCheck } from '@streaming/shared';
import { createLogger, describeError } from './logger.js';

const log = createLogger('sources');

/**
 * Identifies this process. The point of the reachability probe is to prove the
 * hostname reaches *us* — resolving to some address that happens to answer on
 * the right port is exactly the failure we are looking for, so a plain 200 is
 * not good enough.
 */
export const INSTANCE_ID = randomUUID();

const isLoopback = (address: string): boolean =>
  address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.');

/** Every address currently bound to a local interface. */
function ownAddresses(): Set<string> {
  const found = new Set<string>();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) found.add(entry.address);
  }
  return found;
}

/**
 * Verifies the configured source hostname still points at this machine.
 *
 * Worth doing automatically because the failure is silent and badly timed: a
 * name like `stream.localhost.direct` depends on someone else's DNS, and if
 * that record ever changes, every browser source keeps its URL and quietly
 * starts loading a stranger's page — which you would discover on stream.
 */
export async function checkSourceHost(host: string, port: number): Promise<SourceHostCheck> {
  const trimmed = host.trim();
  const base: SourceHostCheck = {
    host: trimmed,
    configured: trimmed.length > 0,
    addresses: [],
    loopbackOnly: false,
    offMachine: false,
    reachable: false,
    checkedAt: Date.now(),
    error: null,
  };

  if (!base.configured) return base;

  let addresses: string[];
  try {
    const records = await dns.lookup(trimmed, { all: true });
    addresses = records.map((r) => r.address);
  } catch (error) {
    return {
      ...base,
      error: `${trimmed} does not resolve (${describeError(error)}). Browser sources using it will not load.`,
    };
  }

  const mine = ownAddresses();
  const loopbackOnly = addresses.every(isLoopback);
  const offMachine = addresses.some((a) => !isLoopback(a) && !mine.has(a));

  /*
   * Bail out before probing if the name points somewhere else. This is the
   * diagnosis that matters most, and it would otherwise be reported as the
   * vaguer "nothing answered" — but more importantly, probing would mean
   * sending a request to a third party's server to find out.
   */
  if (offMachine) {
    return {
      ...base,
      addresses,
      loopbackOnly,
      offMachine,
      error:
        `${trimmed} resolves to ${addresses.join(', ')}, which is not this machine. ` +
        `Browser sources using it are loading someone else's server — stop using these URLs.`,
    };
  }

  // The decisive test: does a request to that name actually land here?
  let reachable = false;
  let error: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`http://${trimmed}:${port}/api/ping`, {
        signal: controller.signal,
      });
      const body = (await response.json()) as { instanceId?: string };
      reachable = body.instanceId === INSTANCE_ID;
      if (!reachable) {
        error =
          `${trimmed}:${port} answered, but it is not this server. ` +
          `Something else is listening on that address — do not use these URLs.`;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error = `${trimmed} resolves but nothing answered on port ${port} (${describeError(err)}).`;
  }

  if (error) log.warn(error);

  return { ...base, addresses, loopbackOnly, offMachine, reachable, error };
}
