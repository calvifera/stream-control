import express, { Router, type Request, type Response } from 'express';
import {
  ARCHIVE_FILTERS,
  ARCHIVE_SORTS,
  isPlatform,
  listKey,
  readViewerKey,
  PLATFORMS,
  userKey,
  createOverlay,
  defaultSettingsFor,
  NEUTRAL_VOICE_PROFILE,
  NEUTRAL_VOICE_SETTINGS,
  settingsFor,
  OVERLAY_TYPES,
  overlayUrl,
  STREAM_EVENT_TYPES,
  TTS_VOICES,
  type ArchiveFilter,
  type ArchiveSort,
  type Platform,
  type OverlayType,
  type StreamEventType,
  type TestEventOutcome,
  type TestEventSpec,
  type UserVoiceProfile,
  type VoiceSettings,
} from '@streaming/shared';
import type { Hub } from '../hub.js';
import { checkSourceHost, INSTANCE_ID } from '../sources.js';
import { authEnabled, isAuthenticated, login, logout, requireAuth } from './auth.js';
import { formatConfigError } from '../config/store.js';
import { createTestEvent } from '../testEvents.js';
import { recentLogs } from '../logger.js';
import type { ArchiveContext, KnownUser } from '../state/directory.js';
import { synthesizeWithTikTok, TIKTOK_TTS_ENDPOINTS } from '../tts/tiktokProvider.js';
import type { ProviderId } from '../tts/providers/types.js';
import type { TunnelController } from '../tunnel.js';
import { env } from '../env.js';
import { openPanel, panelStatus } from '../panel.js';
import { parseSecretKey, secrets } from '../secrets.js';

const asError = (res: Response, status: number, message: string): Response =>
  res.status(status).json({ error: message });

/** `await`ing a handler that throws must not take the process down. */
const wrap =
  (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response): void => {
    Promise.resolve(handler(req, res)).catch((error: unknown) => {
      if (!res.headersSent) asError(res, 500, formatConfigError(error));
    });
  };

export function createApiRouter(hub: Hub, tunnel: TunnelController): Router {
  const router = Router();

  /* ---------------------------------------------------------------- *
   * Authentication
   *
   * The guard goes first so it covers every route below by default —
   * anything that should stay open is named in `auth.ts`, rather than each
   * new endpoint having to remember to opt in.
   * ---------------------------------------------------------------- */

  router.use(requireAuth);

  router.get('/auth/status', (req, res) => {
    res.json({ required: authEnabled(), authenticated: isAuthenticated(req) });
  });

  router.post('/auth/login', (req, res) => {
    const { password } = req.body as { password?: string };
    const result = login(req, res, String(password ?? ''));
    if (result.ok) {
      res.json({ ok: true });
      return;
    }
    if (result.retryAfter) {
      res
        .status(429)
        .json({ error: `Too many attempts. Try again in ${result.retryAfter} seconds.` });
      return;
    }
    res.status(401).json({ error: 'Wrong password' });
  });

  router.post('/auth/logout', (req, res) => {
    logout(req, res);
    res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- *
   * Status
   * ---------------------------------------------------------------- */

  router.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  router.get('/snapshot', (_req, res) => {
    res.json(hub.snapshot());
  });

  router.get('/logs', (_req, res) => {
    res.json(recentLogs());
  });

  router.get('/events', (_req, res) => {
    res.json(hub.getHistory());
  });

  router.get('/rejections', (_req, res) => {
    res.json(hub.getRejections());
  });

  /* ---------------------------------------------------------------- *
   * Near-miss review
   *
   * Phonetic look-alikes that were NOT blocked. Nothing here changes what
   * the filter does; promoting an entry writes it into the severe phrase
   * list, and from then on the ordinary matcher handles it.
   * ---------------------------------------------------------------- */

  router.get('/review', (_req, res) => {
    res.json({ entries: hub.review.list(), ignored: hub.review.ignoredPhrases() });
  });

  const phraseFrom = (req: Request): string =>
    String((req.body as { phrase?: string })?.phrase ?? '').trim().toLowerCase();

  /** Promotes a near miss into the severe phrase list, where it is enforced. */
  router.post(
    '/review/block',
    wrap((req, res) => {
      const phrase = phraseFrom(req);
      if (!phrase) {
        asError(res, 400, 'phrase is required');
        return;
      }

      const severe = hub.config.get().users.severe;
      if (!severe.phrases.some((p) => p.trim().toLowerCase() === phrase)) {
        hub.config.update({
          users: { severe: { ...severe, phrases: [...severe.phrases, phrase] } },
        });
      }
      // It is enforced now, so it no longer belongs in the review list.
      hub.review.dismiss(phrase);
      res.json({ entries: hub.review.list(), ignored: hub.review.ignoredPhrases() });
    }),
  );

  /** Marks a near miss as an innocent collision — never reported again. */
  router.post(
    '/review/ignore',
    wrap((req, res) => {
      const phrase = phraseFrom(req);
      if (!phrase) {
        asError(res, 400, 'phrase is required');
        return;
      }
      hub.review.ignore(phrase);
      res.json({ entries: hub.review.list(), ignored: hub.review.ignoredPhrases() });
    }),
  );

  router.post(
    '/review/unignore',
    wrap((req, res) => {
      hub.review.unignore(phraseFrom(req));
      res.json({ entries: hub.review.list(), ignored: hub.review.ignoredPhrases() });
    }),
  );

  router.post(
    '/review/clear',
    wrap((_req, res) => {
      hub.review.clear();
      res.json({ entries: hub.review.list(), ignored: hub.review.ignoredPhrases() });
    }),
  );

  router.get('/meta', (_req, res) => {
    res.json({
      voices: TTS_VOICES,
      eventTypes: STREAM_EVENT_TYPES,
      overlayTypes: OVERLAY_TYPES,
      ttsEndpoints: TIKTOK_TTS_ENDPOINTS,
      providers: hub.tts.providers.status(),
      // Never echo the values, just whether the server already has them.
      /*
       * How reachable this server is, so the dashboard can explain the
       * difference between a password and a network binding rather than
       * describing it in the abstract.
       */
      network: {
        host: env.host,
        port: env.port,
        // 0.0.0.0 means every interface: anything on the same network can
        // reach the dashboard. Loopback means only this machine can.
        loopbackOnly: env.host === '127.0.0.1' || env.host === 'localhost' || env.host === '::1',
        passwordSet: authEnabled(),
      },
      env: {
        hasSignApiKey: Boolean(env.signApiKey),
        hasTikTokSession: Boolean(env.ttSessionId),
        hasNgrokToken: Boolean(env.ngrokAuthToken),
        hasGoogleTtsKey: Boolean(env.googleTtsApiKey),
      },
    });
  });

  /**
   * Voices for a backend. Google enumerates its own catalogue live, so this is
   * always accurate for the key in use; TikTok returns the verified static list.
   */
  router.get(
    '/tts/voices',
    wrap(async (req, res) => {
      const requested = String(req.query.provider ?? hub.config.get().tts.provider);
      const adapter = hub.tts.providers.get(requested as ProviderId);

      if (!adapter) {
        // 'browser' voices live on the machine running the overlay, so the
        // server genuinely has nothing to offer here.
        res.json({ provider: requested, voices: [], note: 'Browser voices come from the overlay machine.' });
        return;
      }

      if (!adapter.isConfigured()) {
        asError(res, 400, adapter.configurationHint());
        return;
      }

      try {
        res.json({ provider: requested, voices: await adapter.listVoices() });
      } catch (error) {
        asError(res, 502, formatConfigError(error));
      }
    }),
  );

  /* ---------------------------------------------------------------- *
   * Config
   * ---------------------------------------------------------------- */

  router.get('/config', (_req, res) => {
    res.json(hub.config.get());
  });

  router.patch(
    '/config',
    wrap((req, res) => {
      try {
        res.json(hub.config.update(req.body));
      } catch (error) {
        asError(res, 400, formatConfigError(error));
      }
    }),
  );

  router.put(
    '/config',
    wrap((req, res) => {
      try {
        res.json(hub.config.replace(req.body));
      } catch (error) {
        asError(res, 400, formatConfigError(error));
      }
    }),
  );

  router.post('/config/reset', (_req, res) => {
    res.json(hub.config.reset());
  });

  /* ---------------------------------------------------------------- *
   * Overlay sources
   * ---------------------------------------------------------------- */

  /**
   * Identity probe. Deliberately tiny and unauthenticated — it exposes only a
   * random per-boot id, which is what makes it usable as proof that a hostname
   * resolves to this process rather than to something else on that port.
   */
  router.get('/ping', (_req, res) => {
    res.json({ instanceId: INSTANCE_ID });
  });

  router.get(
    '/sources/check',
    wrap(async (_req, res) => {
      res.json(await checkSourceHost(hub.config.get().sources.host, env.port));
    }),
  );

  router.get('/overlays', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    const tunnelUrl = hub.getTunnelState().url;
    const host = hub.config.get().sources.host;
    res.json(
      hub.config.get().overlays.map((overlay) => {
        const localUrl = `${origin}/overlay/${overlay.id}`;
        const publicUrl = tunnelUrl ? `${tunnelUrl}/overlay/${overlay.id}` : null;
        return {
          ...overlay,
          localUrl,
          publicUrl,
          /*
           * The one to actually paste into capture software.
           *
           * An explicit host wins over the tunnel: you set it because your
           * software rejected everything else, and silently handing back a
           * tunnel URL the moment one opens would undo that.
           */
          sourceUrl: host ? overlayUrl(origin, host, overlay.id) : (publicUrl ?? localUrl),
        };
      }),
    );
  });

  router.post(
    '/overlays',
    wrap((req, res) => {
      const { type, name, id } = req.body as { type?: string; name?: string; id?: string };
      if (!type || !OVERLAY_TYPES.includes(type as OverlayType)) {
        asError(res, 400, `type must be one of: ${OVERLAY_TYPES.join(', ')}`);
        return;
      }

      const existing = hub.config.get().overlays;
      const slug = slugify(id || name || type);
      const unique = uniqueId(slug, new Set(existing.map((o) => o.id)));
      const overlay = createOverlay(type as OverlayType, unique, name);

      try {
        hub.config.update({ overlays: [...existing, overlay] });
        res.status(201).json(overlay);
      } catch (error) {
        asError(res, 400, formatConfigError(error));
      }
    }),
  );

  router.delete(
    '/overlays/:id',
    wrap((req, res) => {
      const overlays = hub.config.get().overlays;
      const next = overlays.filter((o) => o.id !== req.params.id);
      if (next.length === overlays.length) {
        asError(res, 404, `No overlay with id "${req.params.id}"`);
        return;
      }
      hub.config.update({ overlays: next });
      res.json({ ok: true });
    }),
  );

  /** Reset just one source's settings back to the defaults for its type. */
  router.post(
    '/overlays/:id/reset',
    wrap((req, res) => {
      const overlays = hub.config.get().overlays;
      const target = overlays.find((o) => o.id === req.params.id);
      if (!target) {
        asError(res, 404, `No overlay with id "${req.params.id}"`);
        return;
      }
      const next = overlays.map((o) =>
        o.id === target.id ? { ...o, settings: defaultSettingsFor(o.type) } : o,
      );
      hub.config.update({ overlays: next });
      res.json(next.find((o) => o.id === target.id));
    }),
  );

  /* ---------------------------------------------------------------- *
   * Connection
   * ---------------------------------------------------------------- */

  router.post(
    '/connect',
    wrap(async (req, res) => {
      const username = String((req.body as { username?: string })?.username ?? '').trim();
      if (username) {
        hub.config.update({ connection: { ...hub.config.get().connection, username } });
      }
      try {
        await hub.tiktok.connect(username || undefined);
        res.json(hub.tiktok.getState());
      } catch (error) {
        // The manager already scheduled a retry; report the reason.
        asError(res, 502, formatConfigError(error));
      }
    }),
  );

  router.post(
    '/disconnect',
    wrap(async (_req, res) => {
      await hub.tiktok.disconnect();
      res.json(hub.tiktok.getState());
    }),
  );

  /* ---------------------------------------------------------------- *
   * Twitch
   *
   * Separate routes rather than a `platform` parameter on /connect: the two
   * managers have genuinely different lifecycles (TikTok resolves a room id
   * and can fail before connecting; Twitch joins a channel by name), and
   * collapsing them would mean one handler pretending they are the same.
   * ---------------------------------------------------------------- */

  router.post(
    '/twitch/connect',
    wrap((req, res) => {
      const channel = String((req.body as { channel?: string })?.channel ?? '').trim();
      const current = hub.config.get().twitch;
      // Enabling here rather than making the caller send it separately: asking
      // to connect *is* the intent to have it enabled.
      hub.config.update({
        twitch: { ...current, channel: channel || current.channel, enabled: true },
      });
      hub.twitch.connect(channel || undefined);
      res.json(hub.twitch.getState());
    }),
  );

  router.post(
    '/twitch/disconnect',
    wrap((_req, res) => {
      hub.twitch.disconnect();
      hub.config.update({ twitch: { ...hub.config.get().twitch, enabled: false } });
      res.json(hub.twitch.getState());
    }),
  );

  router.post(
    '/youtube/connect',
    wrap((req, res) => {
      // A video id or a full watch URL; the schema strips the URL down.
      const videoId = String((req.body as { videoId?: string })?.videoId ?? '').trim();
      const current = hub.config.get().youtube;
      hub.config.update({
        youtube: { ...current, videoId: videoId || current.videoId, enabled: true },
      });
      hub.youtube.connect();
      res.json(hub.youtube.getState());
    }),
  );

  router.post(
    '/youtube/disconnect',
    wrap((_req, res) => {
      hub.youtube.disconnect();
      hub.config.update({ youtube: { ...hub.config.get().youtube, enabled: false } });
      res.json(hub.youtube.getState());
    }),
  );

  /**
   * How much API quota this connection has actually spent.
   *
   * Exposed because the cost cannot be predicted: Google does not publish the
   * per-call price of the live-chat endpoints, and the poll rate is set by the
   * API according to how busy chat is. A real call count against a real stream
   * is the only honest answer.
   */
  router.get('/youtube/usage', (_req, res) => {
    res.json(hub.youtube.getUsage());
  });

  /* ---------------------------------------------------------------- *
   * Credentials
   *
   * Status is readable; values are not, and there is no route that returns
   * one. The dashboard can say "configured, 30 characters, from .env" and
   * nothing more — so nothing that can reach the API can read a secret back
   * out of it.
   * ---------------------------------------------------------------- */

  router.get('/credentials', (_req, res) => {
    res.json({ credentials: secrets.status() });
  });

  router.post(
    '/credentials',
    wrap((req, res) => {
      const body = (req.body ?? {}) as { key?: unknown; value?: unknown };
      const key = parseSecretKey(body.key);
      if (!key) {
        asError(res, 400, 'unknown credential');
        return;
      }
      if (typeof body.value !== 'string') {
        asError(res, 400, 'value must be a string');
        return;
      }
      const hadPassword = authEnabled();
      secrets.set(key, body.value);

      /*
       * Turning the password on would otherwise lock out the person who just
       * turned it on: `isAuthenticated` waves everything through while no
       * password is set, so nobody holds a session until one exists. The next
       * request after saving would bounce them to a login screen mid-click.
       *
       * Issuing a session here means enabling protection does not cost you
       * access to your own dashboard. Everyone else still has to log in.
       */
      if (key === 'DASHBOARD_PASSWORD' && !hadPassword && authEnabled()) {
        login(req, res, body.value);
      }

      res.json({ credentials: secrets.status() });
    }),
  );

  router.delete(
    '/credentials/:key',
    wrap((req, res) => {
      const key = parseSecretKey(req.params.key);
      if (!key) {
        asError(res, 400, 'unknown credential');
        return;
      }
      secrets.clear(key);
      res.json({ credentials: secrets.status() });
    }),
  );

  router.get('/connections', (_req, res) => {
    res.json({
      tiktok: hub.tiktok.getState(),
      twitch: hub.twitch.getState(),
      youtube: hub.youtube.getState(),
    });
  });

  /* ---------------------------------------------------------------- *
   * Platform sign-in
   *
   * The sign-in itself happens on the provider's own site. This server only
   * ever handles the short-lived code they redirect back with — no password
   * is ever typed into this application. Responses here describe what
   * credentials unlock; they never contain a token, secret or key.
   * ---------------------------------------------------------------- */

  router.get('/auth/platforms', (_req, res) => {
    res.json(hub.auth.overview());
  });

  const platformParam = (req: Request): Platform | null => {
    const value = req.params.platform ?? '';
    return PLATFORMS.includes(value as Platform) ? (value as Platform) : null;
  };

  /** Returns the provider URL for the dashboard to open in a new tab. */
  router.post(
    '/auth/:platform/start',
    wrap((req, res) => {
      const platform = platformParam(req);
      if (!platform) {
        asError(res, 400, 'Unknown platform');
        return;
      }
      const result = hub.auth.start(platform);
      if ('error' in result) {
        asError(res, 400, result.error);
        return;
      }
      res.json(result);
    }),
  );

  /**
   * Where the provider sends the browser back.
   *
   * Returns a plain HTML page rather than JSON: a person is looking at this,
   * not a script. It is deliberately self-closing so the sign-in tab does not
   * linger.
   */
  router.get(
    '/auth/:platform/callback',
    wrap(async (req, res) => {
      const platform = platformParam(req);
      const code = String(req.query.code ?? '');
      const state = String(req.query.state ?? '');
      const denied = String(req.query.error ?? '');

      if (!platform) {
        res.status(400).type('html').send(authPage('Unknown platform', false));
        return;
      }
      if (denied) {
        // The user pressed cancel on the provider's consent screen. Not an
        // error worth logging loudly — just report it back.
        res.type('html').send(authPage(`Sign-in cancelled (${denied})`, false));
        return;
      }
      if (!code || !state) {
        res.status(400).type('html').send(authPage('Missing code or state', false));
        return;
      }

      try {
        const account = await hub.auth.complete(platform, code, state);
        hub.broadcastAuth();
        res.type('html').send(authPage(`Signed in as ${account}. You can close this tab.`, true));
      } catch (error) {
        res.status(400).type('html').send(authPage(formatConfigError(error), false));
      }
    }),
  );

  router.post(
    '/auth/:platform/signout',
    wrap((req, res) => {
      const platform = platformParam(req);
      if (!platform) {
        asError(res, 400, 'Unknown platform');
        return;
      }
      hub.auth.signOut(platform);
      hub.broadcastAuth();
      res.json(hub.auth.overview());
    }),
  );

  /* ---------------------------------------------------------------- *
   * Desktop chat panel
   *
   * The only endpoint that starts a program. It takes no path and no
   * arguments — `openPanel` can run exactly one known binary — and it is
   * restricted to requests that actually came from this machine.
   * ---------------------------------------------------------------- */

  /**
   * Whether the request reached us directly rather than through the tunnel.
   *
   * `req.ip` is useless for this: ngrok forwards to loopback, so tunnelled
   * requests look local. What gives them away is the Host header naming the
   * public domain, and the forwarding headers a proxy adds.
   *
   * Both a security boundary and plain correctness — the panel window opens on
   * *this* desktop, so launching it for someone on another machine does
   * nothing they can see.
   */
  const isLocalRequest = (req: Request): boolean => {
    if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) return false;
    const host = (req.hostname ?? '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  };

  router.get('/panel/status', (req, res) => {
    res.json({ ...panelStatus(), local: isLocalRequest(req) });
  });

  router.post(
    '/panel/open',
    wrap((req, res) => {
      if (!isLocalRequest(req)) {
        asError(
          res,
          403,
          'The desktop panel can only be opened from the machine running the server — its window would appear there, not here.',
        );
        return;
      }

      const result = openPanel();
      if (!result.ok) {
        asError(res, 409, result.error);
        return;
      }
      res.json(panelStatus());
    }),
  );

  /* ---------------------------------------------------------------- *
   * Filters
   * ---------------------------------------------------------------- */

  router.post(
    '/filters/test',
    wrap((req, res) => {
      const text = String((req.body as { text?: string })?.text ?? '');
      res.json(hub.filters.explain(text));
    }),
  );

  /* ---------------------------------------------------------------- *
   * TTS
   * ---------------------------------------------------------------- */

  router.post(
    '/tts/test',
    wrap(async (req, res) => {
      const { text, voice } = req.body as { text?: string; voice?: string };
      const spoken = String(text ?? '').trim();
      if (!spoken) {
        asError(res, 400, 'text is required');
        return;
      }

      // Run it through the filter chain so the test reflects what viewers get.
      const filtered = hub.filters.apply(spoken);
      if (filtered.text === null) {
        res.json({ queued: false, reason: filtered.reason ?? 'blocked by the filter' });
        return;
      }

      /*
       * Deliberately not queued. A test exists to hear a voice right now, so
       * it jumps ahead of everything — including an earlier test still
       * playing. The audio is fetched before anything is cut off, so a slow
       * provider cannot leave the stream silent mid-sentence.
       */
      const { item, reason } = await hub.tts.speakNow({
        ruleId: 'manual',
        ruleName: 'Dashboard test',
        text: filtered.text,
        voice: voice || 'en_us_002',
        priority: 100,
        volume: hub.config.get().tts.masterVolume,
        rate: 1,
        pitch: 1,
        username: '',
      });

      res.json({ playing: Boolean(item), item, reason, filtered: filtered.filtered });
    }),
  );

  router.post('/tts/skip', (_req, res) => {
    hub.tts.skip();
    res.json({ ok: true });
  });

  router.post('/tts/clear', (_req, res) => {
    hub.tts.clear();
    res.json({ ok: true });
  });

  router.get('/tts/audio/:file', (req, res) => {
    const id = req.params.file.replace(/\.mp3$/, '');
    const clip = hub.tts.audio.get(id);
    if (!clip) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', clip.mimeType);
    res.setHeader('Content-Length', clip.buffer.length);
    // Clips are single-use and regenerated on demand.
    res.setHeader('Cache-Control', 'no-store');
    res.end(clip.buffer);
  });

  /* ---------------------------------------------------------------- *
   * People: autocomplete, trusted list, penalty box, voice profiles
   * ---------------------------------------------------------------- */

  /**
   * Autocomplete over everyone the server has seen.
   *
   * TikTok exposes no public user-search API, so this deliberately searches
   * your own chat history instead — which is who you actually want to trust
   * or mute, and it works offline.
   */
  /** Shared projection so search results and list lookups have one shape. */
  const asSearchResult = (user: KnownUser) => {
    const config = hub.config.get();
    return {
      platform: user.platform,
      // Canonical key for writes; `username` stays bare for display.
      key: userKey({ platform: user.platform, uniqueId: user.username }),
      username: user.username,
      displayName: user.displayName,
      // Prefer the local copy: TikTok's own avatar URLs expire in ~48h, so a
      // cached one is the only link an overlay can safely hold on to.
      avatarUrl: hub.avatars.publicPath(user.username) ?? user.avatarUrl,
      messages: user.messages,
      strikes: user.strikes,
      lastSeen: user.lastSeen,
      trusted: config.users.trusted.some((u) => listKey(u) === userKey({ platform: user.platform, uniqueId: user.username })),
      penalized: config.users.penaltyBox.some(
        (entry) => listKey(entry.username) === userKey({ platform: user.platform, uniqueId: user.username }),
      ),
    };
  };

  router.get('/users/search', (req, res) => {
    const query = String(req.query.q ?? '');
    const limit = Math.min(50, Number(req.query.limit) || 12);
    res.json(hub.directory.search(query, limit).map(asSearchResult));
  });

  /**
   * Directory entries for handles that are already on a list, so those lists
   * can show a display name and avatar instead of a bare handle. Must stay
   * above `/users/:username` or it would be captured as a username.
   */
  /* ---------------------------------------------------------------- *
   * Slideshow folders
   *
   * Uploads arrive one file at a time as a raw body, which avoids a
   * multipart dependency and lets the dashboard show real progress across a
   * folder. Every name is sanitised and every file is magic-number checked
   * before it lands.
   * ---------------------------------------------------------------- */

  router.get('/slideshows', (_req, res) => {
    res.json(hub.slideshows.list());
  });

  router.get('/slideshows/:folder', (req, res) => {
    const folder = hub.slideshows.folder(req.params.folder ?? '');
    if (!folder) {
      asError(res, 404, `No slideshow folder called "${req.params.folder}"`);
      return;
    }
    res.json(folder);
  });

  router.put(
    '/slideshows/:folder/:filename',
    express.raw({ type: '*/*', limit: '12mb' }),
    wrap((req, res) => {
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        asError(res, 400, 'Expected the image as the request body');
        return;
      }

      const stored = hub.slideshows.save(
        req.params.folder ?? '',
        req.params.filename ?? '',
        body,
      );
      if (!stored) {
        asError(res, 415, 'Not an accepted image, or the name could not be used');
        return;
      }
      res.json({ folder: hub.slideshows.safeSegment(req.params.folder ?? ''), filename: stored });
    }),
  );

  router.delete(
    '/slideshows/:folder/:filename',
    wrap((req, res) => {
      const ok = hub.slideshows.removeImage(req.params.folder ?? '', req.params.filename ?? '');
      if (!ok) {
        asError(res, 404, 'No such image');
        return;
      }
      res.json({ ok: true });
    }),
  );

  router.delete(
    '/slideshows/:folder',
    wrap((req, res) => {
      const ok = hub.slideshows.removeFolder(req.params.folder ?? '');
      if (!ok) {
        asError(res, 404, 'No such folder');
        return;
      }
      res.json({ ok: true });
    }),
  );

  /* ---------------------------------------------------------------- *
   * Profile pictures
   * ---------------------------------------------------------------- */

  router.get('/users/avatars', (_req, res) => {
    const all = hub.directory.all();
    res.json({
      cached: hub.avatars.count(),
      known: all.length,
      missing: all.filter((u) => !hub.avatars.publicPath(u.username)).length,
      running: hub.avatarPoller.isRunning(),
      lastRun: hub.avatarPoller.getLastRun() || null,
    });
  });

  /**
   * Runs a lookup pass now. `force` ignores the back-off, for when someone has
   * just changed their picture and you don't want to wait a day for it.
   */
  router.post(
    '/users/avatars/refresh',
    wrap(async (req, res) => {
      if (hub.avatarPoller.isRunning()) {
        asError(res, 409, 'A profile pass is already running');
        return;
      }
      const force = Boolean((req.body as { force?: boolean })?.force);
      const result = await hub.avatarPoller.run(hub.avatarPriority(), force);
      res.json({ ...result, cached: hub.avatars.count() });
    }),
  );

  /* ---------------------------------------------------------------- *
   * Archive: the long-lived record of everyone ever seen.
   *
   * Both routes must stay above `/users/:username` or that wildcard
   * swallows them and every request 404s as an unknown handle.
   * ---------------------------------------------------------------- */

  /** Config-derived status for one archive query, built once per request. */
  const archiveContext = (): ArchiveContext => {
    const config = hub.config.get();
    return {
      trusted: new Set(config.users.trusted.map(listKey)),
      penalized: new Set(config.users.penaltyBox.map((entry) => listKey(entry.username))),
      voiced: new Set(config.users.voiceProfiles.map((entry) => listKey(entry.username))),
      avatarPath: (username: string) => hub.avatars.publicPath(username),
      retention: (platform) => hub.retention.curve(platform),
    };
  };

  router.get('/users/archive', (req, res) => {
    const sort = ARCHIVE_SORTS.includes(req.query.sort as ArchiveSort)
      ? (req.query.sort as ArchiveSort)
      : 'lastSeen';
    const filter = ARCHIVE_FILTERS.includes(req.query.filter as ArchiveFilter)
      ? (req.query.filter as ArchiveFilter)
      : 'all';
    // Anything that is not a platform we know about means "all of them",
    // rather than an error — a stale bookmark should show data, not a 400.
    const platform = isPlatform(req.query.platform) ? req.query.platform : undefined;

    res.json(
      hub.directory.archive(
        {
          q: String(req.query.q ?? ''),
          sort,
          filter,
          ...(platform ? { platform } : {}),
          // Ascending only when explicitly asked for; every sort here reads
          // best largest-first apart from username.
          desc: req.query.desc !== 'false',
          offset: Number(req.query.offset) || 0,
          limit: Number(req.query.limit) || 50,
        },
        archiveContext(),
      ),
    );
  });

  router.get('/users/analytics', (_req, res) => {
    res.json(hub.directory.analytics(archiveContext()));
  });

  router.get('/users/known', (req, res) => {
    const names = String(req.query.usernames ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    res.json(hub.directory.lookup(names).map(asSearchResult));
  });

  /**
   * Removes one viewer from the archive.
   *
   * Must stay above `/users/:username` for the same reason the other archive
   * routes do. Does not touch the trusted, penalty or voice lists — those are
   * config and are managed by their own endpoints, and silently clearing
   * somebody's mute because their archive row was deleted would be a nasty
   * surprise.
   */
  router.delete(
    '/users/archive/:username',
    wrap((req, res) => {
      const reference = req.params.username ?? '';
      const removed = hub.directory.forget(reference);
      if (!removed) {
        asError(res, 404, `No archive record for ${reference}`);
        return;
      }

      // The cached profile picture goes too. The avatar poller fetches one for
      // every handle in the directory, so an invented name ends up holding a
      // real stranger's photo — whoever actually owns that handle on TikTok.
      // Dropping the record while keeping their picture on disk would be the
      // wrong half of the job.
      const { handle } = readViewerKey(reference);
      hub.avatars.remove(handle);

      res.json({ ok: true, removed: listKey(reference) });
    }),
  );

  router.get('/users/:username', (req, res) => {
    const user = hub.directory.get(req.params.username);
    if (!user) {
      asError(res, 404, `No record of @${req.params.username}`);
      return;
    }
    res.json(user);
  });

  router.post(
    '/users/trusted',
    wrap((req, res) => {
      const username = listKey(String((req.body as { username?: string })?.username ?? ''));
      if (!username) {
        asError(res, 400, 'username is required');
        return;
      }

      const config = hub.config.get();
      // Remember them either way: a handle typed in by hand is still someone
      // you listed, so it has to survive a restart and stay searchable.
      hub.directory.remember(
        username,
        String((req.body as { displayName?: string })?.displayName ?? ''),
      );

      if (config.users.trusted.some((u) => listKey(u) === username)) {
        res.json(hub.config.get().users);
        return;
      }

      // Being trusted and being muted are contradictory; trusting lifts the mute.
      const updated = hub.config.update({
        users: {
          trusted: [...config.users.trusted, username],
          penaltyBox: config.users.penaltyBox.filter(
            (entry) => listKey(entry.username) !== username,
          ),
        },
      });
      hub.directory.clearStrikes(username);
      // Trusting lifts the mute, so it has to lift the timeout too.
      void hub.liftPenalty(username);
      res.json(updated.users);
    }),
  );

  router.delete(
    '/users/trusted/:username',
    wrap((req, res) => {
      const username = listKey(req.params.username ?? '');
      const config = hub.config.get();
      const updated = hub.config.update({
        users: { trusted: config.users.trusted.filter((u) => listKey(u) !== username) },
      });
      res.json(updated.users);
    }),
  );

  router.post(
    '/users/penalty',
    wrap((req, res) => {
      const body = req.body as { username?: string; reason?: string; displayName?: string };
      const username = listKey(String(body?.username ?? ''));
      if (!username) {
        asError(res, 400, 'username is required');
        return;
      }

      const config = hub.config.get();
      hub.directory.remember(username, body.displayName ?? '');

      if (config.users.penaltyBox.some((entry) => listKey(entry.username) === username)) {
        res.json(config.users);
        return;
      }

      const known = hub.directory.get(username);
      const entry = {
        username,
        displayName: body.displayName ?? known?.displayName ?? username,
        reason: body.reason?.trim() || 'Added manually',
        addedAt: Date.now(),
        automatic: false,
        evidence: known?.evidence[0]?.text ?? null,
      };

      const updated = hub.config.update({
        users: {
          penaltyBox: [...config.users.penaltyBox, entry],
          trusted: config.users.trusted.filter((u) => listKey(u) !== username),
        },
      });
      // `automatic: false` — this came from a person clicking, which is the
      // case Twitch moderation is allowed to act on by default.
      void hub.enforcePenalty(username, entry.reason, false);
      res.json(updated.users);
    }),
  );

  router.delete(
    '/users/penalty/:username',
    wrap((req, res) => {
      const username = listKey(req.params.username ?? '');
      const config = hub.config.get();
      const updated = hub.config.update({
        users: {
          penaltyBox: config.users.penaltyBox.filter(
            (entry) => listKey(entry.username) !== username,
          ),
        },
      });
      // Forgiving someone should also clear the strikes that got them there,
      // otherwise the next slip re-triggers the auto-penalty immediately.
      hub.directory.clearStrikes(username);
      // And it should reach the platform, for the same reason penalising
      // does: a release that only unmutes TTS leaves them still timed out in
      // a channel you believe you have let them back into.
      void hub.liftPenalty(username);
      res.json(updated.users);
    }),
  );

  router.post(
    '/users/voice',
    wrap((req, res) => {
      const body = req.body as Partial<UserVoiceProfile> & {
        username?: string;
        settings?: Record<string, Partial<VoiceSettings>>;
      };
      const username = listKey(String(body?.username ?? ''));
      if (!username) {
        asError(res, 400, 'username is required');
        return;
      }

      const config = hub.config.get();
      hub.directory.remember(username, body.displayName ?? '');
      const known = hub.directory.get(username);
      const existing = config.users.voiceProfiles.find(
        (p) => listKey(p.username) === username,
      );

      // Settings arrive keyed by provider and merge per backend, so editing
      // this person's Google voice never disturbs their TikTok one.
      const settings: UserVoiceProfile['settings'] = { ...existing?.settings };
      for (const [providerId, patch] of Object.entries(body.settings ?? {})) {
        if (!patch) continue;
        settings[providerId] = {
          ...NEUTRAL_VOICE_SETTINGS,
          ...settingsFor({ settings }, providerId),
          ...patch,
        };
      }

      const profile: UserVoiceProfile = {
        ...NEUTRAL_VOICE_PROFILE,
        ...existing,
        username,
        displayName: body.displayName ?? existing?.displayName ?? known?.displayName ?? username,
        ...(body.provider !== undefined ? { provider: body.provider } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        settings,
      };

      const others = config.users.voiceProfiles.filter(
        (p) => listKey(p.username) !== username,
      );
      const updated = hub.config.update({ users: { voiceProfiles: [...others, profile] } });
      res.json(updated.users);
    }),
  );

  router.delete(
    '/users/voice/:username',
    wrap((req, res) => {
      const username = listKey(req.params.username ?? '');
      const config = hub.config.get();
      const updated = hub.config.update({
        users: {
          voiceProfiles: config.users.voiceProfiles.filter(
            (p) => listKey(p.username) !== username,
          ),
        },
      });
      res.json(updated.users);
    }),
  );

  /**
   * Probes voice codes against the live endpoint.
   *
   * There is no TikTok API that lists available voices — the catalogue is a
   * known set of `text_speaker` codes. What *is* checkable is which of them
   * your session is actually allowed to use, which this does by synthesizing
   * one short word per voice.
   */
  router.post(
    '/tts/voices/probe',
    wrap(async (req, res) => {
      const body = req.body as { voices?: string[]; provider?: string };
      const config = hub.config.get();
      const providerId = (body.provider ?? config.tts.provider) as ProviderId;
      const adapter = hub.tts.providers.get(providerId);

      if (!adapter) {
        asError(res, 400, 'Browser voices cannot be probed from the server');
        return;
      }
      if (!adapter.isConfigured()) {
        asError(res, 400, adapter.configurationHint());
        return;
      }

      // Google publishes an authoritative list, so probing it one voice at a
      // time would burn quota to re-learn what the API already states.
      if (providerId === 'google') {
        const voices = await adapter.listVoices();
        res.json({
          results: voices.map((v) => ({ code: v.code, ok: true })),
          available: voices.length,
          tested: voices.length,
          note: 'Google publishes its voice list, so these are reported rather than probed.',
        });
        return;
      }

      const codes = (body.voices?.length ? body.voices : TTS_VOICES.map((v) => v.code)).slice(0, 40);
      const results: Array<{ code: string; ok: boolean; error?: string }> = [];

      for (const code of codes) {
        try {
          await adapter.synthesize({ text: 'test', voice: code, rate: 1, pitch: 1 });
          results.push({ code, ok: true });
        } catch (error) {
          results.push({ code, ok: false, error: formatConfigError(error) });
        }
      }

      res.json({ results, available: results.filter((r) => r.ok).length, tested: results.length });
    }),
  );

  /* ---------------------------------------------------------------- *
   * Test events
   * ---------------------------------------------------------------- */

  router.post(
    '/test-event',
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as Partial<TestEventSpec>;

      const eventType = (body.type ?? 'chat') as StreamEventType;
      if (!STREAM_EVENT_TYPES.includes(eventType)) {
        asError(res, 400, `type must be one of: ${STREAM_EVENT_TYPES.join(', ')}`);
        return;
      }
      // Lets the chat log's per-platform styling be checked without being
      // live on three services at once.
      const platform = isPlatform(body.platform) ? body.platform : 'tiktok';

      // Capped rather than rejected: a typo asking for 10,000 messages should
      // produce a sensible burst, not an error and not a wedged queue.
      const count = Math.min(50, Math.max(1, Math.round(Number(body.count) || 1)));
      const intervalMs = Math.min(5000, Math.max(0, Math.round(Number(body.intervalMs) || 0)));

      const spec: TestEventSpec = { ...body, type: eventType, platform };
      const outcomes: TestEventOutcome[] = [];

      for (let index = 0; index < count; index += 1) {
        // Built fresh each time so every copy gets its own id — reusing one
        // would make React collapse the burst into a single row and hide the
        // very thing a burst is fired to look at.
        const event = createTestEvent(spec);

        // Opting in to the archive means dropping the flag that keeps it out.
        if (body.recordToArchive) event.synthetic = false;

        outcomes.push(hub.handleEvent(event));
        if (intervalMs > 0 && index < count - 1) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }

      // The last one is the honest answer for cooldown-shaped questions: the
      // first of a burst always speaks, and whether the *rest* did is the
      // interesting part.
      res.json({ fired: outcomes.length, outcome: outcomes[outcomes.length - 1], outcomes });
    }),
  );

  /* ---------------------------------------------------------------- *
   * Tunnel
   * ---------------------------------------------------------------- */

  router.get('/tunnel', (_req, res) => {
    res.json(hub.getTunnelState());
  });

  router.post(
    '/tunnel/start',
    wrap(async (_req, res) => {
      const state = await tunnel.start();
      res.json(state);
    }),
  );

  router.post(
    '/tunnel/stop',
    wrap(async (_req, res) => {
      const state = await tunnel.stop();
      res.json(state);
    }),
  );

  return router;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'source';
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * The little page the OAuth provider redirects back to.
 *
 * `message` can contain text the provider sent, so it is escaped rather than
 * interpolated raw — this is remote input rendered as HTML.
 */
function authPage(message: string, ok: boolean): string {
  const safe = message.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
  return [
    '<!doctype html><meta charset="utf-8"><title>Sign-in</title>',
    '<body style="font:16px system-ui;background:#07080d;color:#eaeef7;' +
      'display:grid;place-items:center;height:100vh;margin:0">',
    '<div style="text-align:center"><div style="font-size:40px">' +
      (ok ? '&#10003;' : '&#10007;') + '</div><p>' + safe + '</p></div>',
  ].join('');
}
