import type { TunnelState } from '@streaming/shared';
import { createLogger, describeError } from './logger.js';
import { env } from './env.js';
import type { Hub } from './hub.js';

const log = createLogger('ngrok');

/** Minimal shape of the listener returned by `@ngrok/ngrok`. */
interface NgrokListener {
  url(): string | null;
  close(): Promise<void>;
}

/**
 * Publishes the local server through an ngrok tunnel so overlay URLs work from
 * another machine — a phone, a second PC running your encoder, or a co-host.
 *
 * The tunnel is off by default: it exposes the dashboard (which holds your
 * session id) to anyone with the URL, so `tunnel.basicAuth` should be set
 * whenever it is on.
 */
/** The local API every ngrok agent serves while it is running. */
const AGENT_API = 'http://127.0.0.1:4040/api/tunnels';

interface AgentTunnel {
  public_url?: string;
  proto?: string;
  config?: { addr?: string };
}

/** Pulls the port out of the many shapes an agent reports an address in. */
function addressPort(addr: string | undefined): string | null {
  if (!addr) return null;
  const match = /(?::|^)(\d{2,5})$/.exec(addr.trim());
  return match?.[1] ?? null;
}

export interface LocalAgent {
  /** Public URL of a tunnel already pointing at our port, if there is one. */
  matching: string | null;
  /** Everything else the agent is forwarding, for reporting a mismatch. */
  others: Array<{ url: string; addr: string }>;
}

/**
 * Asks a locally running agent what it is forwarding.
 *
 * Returns null when no agent is running, which is the normal case — 4040 only
 * answers while `ngrok` is open in another window. Worth checking first
 * because the free plan allows a single agent session, so starting our own
 * while one is already up fails with an error that does not explain itself.
 */
async function inspectLocalAgent(port: number, timeoutMs = 1500): Promise<LocalAgent | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(AGENT_API, { signal: controller.signal });
    if (!response.ok) return null;

    const body = (await response.json()) as { tunnels?: AgentTunnel[] };
    const tunnels = body.tunnels ?? [];

    let matching: string | null = null;
    const others: Array<{ url: string; addr: string }> = [];

    for (const tunnel of tunnels) {
      const url = tunnel.public_url ?? '';
      const addr = tunnel.config?.addr ?? '';
      if (!url) continue;
      // Prefer https when an agent exposes both for the same address.
      if (addressPort(addr) === String(port)) {
        if (!matching || url.startsWith('https:')) matching = url;
      } else {
        others.push({ url, addr });
      }
    }

    return { matching, others };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class TunnelController {
  private listener: NgrokListener | null = null;
  private state: TunnelState = { enabled: false, url: null, error: null };

  constructor(
    private readonly hub: Hub,
    private readonly port: number,
  ) {}

  getState(): TunnelState {
    return { ...this.state };
  }

  private publish(next: TunnelState): TunnelState {
    this.state = next;
    this.hub.setTunnelState(next);
    return next;
  }

  async start(): Promise<TunnelState> {
    if (this.listener) return this.getState();

    const config = this.hub.config.get().tunnel;

    /*
     * Adopt an agent that is already running before trying to start one.
     * The free plan permits a single agent session, so starting a second
     * fails — and if someone already has `ngrok http <port>` open, the tunnel
     * they want is right there.
     */
    const agent = await inspectLocalAgent(this.port);
    if (agent?.matching) {
      log.info(`Using the ngrok agent already running on this machine: ${agent.matching}`);
      return this.publish({
        enabled: true,
        url: agent.matching,
        error: null,
        external: true,
        mismatch: null,
      });
    }

    if (agent && agent.others.length > 0) {
      // An agent is up but pointed elsewhere. Starting our own would hit the
      // session limit, and saying so beats a raw ERR_NGROK_108.
      const forwarding = agent.others.map((t) => `${t.url} → ${t.addr}`).join(', ');
      const message =
        `An ngrok agent is already running, but it forwards to ${agent.others[0]?.addr} ` +
        `rather than port ${this.port}. Restart it as \`ngrok http ${this.port}\` and press ` +
        `Start tunnel again, or stop it to let this server open its own.`;
      log.warn(message);
      return this.publish({
        enabled: false,
        url: null,
        error: message,
        external: false,
        mismatch: forwarding,
      });
    }

    if (!env.ngrokAuthToken) {
      const message =
        'No NGROK_AUTHTOKEN set. Create a free token at dashboard.ngrok.com and put it in .env';
      log.warn(message);
      return this.publish({ enabled: false, url: null, error: message });
    }

    if (!config.basicAuth) {
      log.warn(
        'Tunnel starting without basic auth — anyone with the URL can reach your dashboard. ' +
          'Set tunnel.basicAuth to "user:password" to lock it down.',
      );
    }

    try {
      // Imported lazily: the native binding is a large download and is only
      // needed when the tunnel is actually switched on.
      const ngrok = await import('@ngrok/ngrok');

      const options: Record<string, unknown> = {
        addr: this.port,
        authtoken: env.ngrokAuthToken,
      };
      if (config.domain.trim()) options.domain = config.domain.trim();
      if (config.basicAuth.trim()) options.basic_auth = [config.basicAuth.trim()];

      const listener = (await ngrok.forward(options as never)) as unknown as NgrokListener;
      this.listener = listener;

      const url = listener.url();
      log.info(`Tunnel open at ${url}`);
      return this.publish({ enabled: true, url, error: null });
    } catch (error) {
      const message = describeError(error);
      log.error('Could not open the ngrok tunnel', error);
      this.listener = null;
      return this.publish({ enabled: false, url: null, error: message });
    }
  }

  async stop(): Promise<TunnelState> {
    // An agent we merely adopted is someone else's process; detach, don't kill.
    if (!this.listener && this.state.external) {
      log.info('Detaching from the external ngrok agent (leaving it running)');
      return this.publish({ enabled: false, url: null, error: null, external: false, mismatch: null });
    }

    if (this.listener) {
      try {
        await this.listener.close();
        log.info('Tunnel closed');
      } catch (error) {
        log.warn(`Error closing the tunnel: ${describeError(error)}`);
      }
      this.listener = null;
    }
    return this.publish({ enabled: false, url: null, error: null });
  }
}
