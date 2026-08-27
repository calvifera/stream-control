import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@streaming/shared';
import { env, ensureDirs, DATA_DIR, MEDIA_DIR, OVERLAY_DIST } from './env.js';
import { createLogger, logBus } from './logger.js';
import { Hub } from './hub.js';
import { createApiRouter } from './http/api.js';
import { AVATAR_DIR } from './state/avatars.js';
import { TunnelController } from './tunnel.js';

const log = createLogger('server');

async function main(): Promise<void> {
  ensureDirs();

  const hub = new Hub();
  const app = express();
  const server = http.createServer(app);

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    // Overlays are loaded by streaming software from a different origin than the dashboard
    // when the tunnel is on, so the socket has to accept any origin.
    cors: { origin: '*' },
    serveClient: false,
  });

  hub.attach(io);
  const tunnel = new TunnelController(hub, env.port);

  logBus.on('log', (entry) => io.emit('log', entry));

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createApiRouter(hub, tunnel));

  // Drop your own alert sounds and images in data/media to reference them
  // from overlay settings as /media/<filename>.
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }));

  // Cached profile pictures. Served from here rather than linked to TikTok
  // because their avatar URLs are signed and expire in about 48 hours — a
  // browser source pointed at one would go blank mid-stream two days later.
  app.use('/avatars', express.static(AVATAR_DIR, { maxAge: '10m' }));

  // Output of `npm run match:voices` — audio clips plus a page for comparing
  // them side by side. Only present after that script has been run.
  app.use('/voice-match', express.static(path.join(DATA_DIR, 'voice-match')));

  if (fs.existsSync(OVERLAY_DIST)) {
    app.use(express.static(OVERLAY_DIST, { index: false }));
    // The dashboard and every /overlay/<id> route are client-side routes.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
      res.sendFile(path.join(OVERLAY_DIST, 'index.html'));
    });
  } else {
    log.warn(
      `No built UI at ${OVERLAY_DIST}. Run "npm run dev" for the Vite dev server, ` +
        'or "npm run build" to serve the UI from this process.',
    );
    app.get('/', (_req, res) => {
      res.status(503).send('UI not built. Run "npm run build", or use the Vite dev server.');
    });
  }

  await new Promise<void>((resolve) => server.listen(env.port, env.host, resolve));

  const local = `http://localhost:${env.port}`;
  log.info(`Listening on ${local}`);
  log.info(`Dashboard:  ${local}/`);
  log.info(`Overlays:   ${local}/overlay/<id>`);
  if (!env.signApiKey) {
    log.info(
      'No SIGN_API_KEY set — using the connector\'s shared signing quota. ' +
        'Get a free key at eulerstream.com if connections start failing.',
    );
  }

  const config = hub.config.get();
  if (config.tunnel.enabled) await tunnel.start();
  if (config.connection.connectOnStartup && config.connection.username) {
    await hub.tiktok.connect().catch(() => {
      /* logged and retried by the manager */
    });
  }

  // Twitch had this setting in its schema from the start and nothing ever read
  // it, so turning it on did nothing at all. `enabled` is checked too because
  // it is Twitch's master switch — it already gates auto-reconnect, and a
  // disabled platform reconnecting itself at boot would be the one place that
  // switch did not hold.
  if (
    config.twitch.connectOnStartup &&
    config.twitch.enabled &&
    config.twitch.channel
  ) {
    hub.twitch.connect();
  }

  // No videoId check, unlike Twitch's channel: YouTube finds whichever
  // broadcast on your own channel is live, so blank is the normal case rather
  // than a missing setting.
  if (config.youtube.connectOnStartup && config.youtube.enabled) {
    hub.youtube.connect();
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down`);

    await tunnel.stop().catch(() => undefined);
    await hub.dispose().catch(() => undefined);
    io.close();
    server.close();

    // Don't let a wedged socket hang the process forever.
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', reason);
  });
}

main().catch((error: unknown) => {
  log.error('Fatal error during startup', error);
  process.exit(1);
});
