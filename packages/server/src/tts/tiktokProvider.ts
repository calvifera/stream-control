import { createLogger, describeError } from '../logger.js';

const log = createLogger('tts:tiktok');

/**
 * TikTok's internal TTS endpoint — the same one the app uses to voice
 * captions. It is not a documented public API: it needs a logged-in
 * `sessionid` cookie, it is region-sharded, and it caps each request at a few
 * hundred characters. Long text is split and the resulting MP3 frames are
 * concatenated, which works because MP3 is a stream of independent frames.
 */

/**
 * Endpoint hosts, in the order we try them. Regions get retired regularly, and
 * which ones actually serve audio varies by where you are — as of the last
 * check only `useast5` answered, while the rest returned
 * `status_code 1: "Couldn't load speech"` for the same request.
 *
 * The trailing slash is REQUIRED. Without it the route returns a plain 404,
 * which is what every older guide's URL now hits.
 *
 * When synthesis breaks, re-probe with:
 *   npx tsx packages/server/src/checks/probe-endpoints.ts
 */
export const TIKTOK_TTS_ENDPOINTS = [
  'https://api16-normal-useast5.us.tiktokv.com/media/api/text/speech/invoke/',
  'https://api16-normal-c-useast1a.tiktokv.com/media/api/text/speech/invoke/',
  'https://api16-normal-c-useast2a.tiktokv.com/media/api/text/speech/invoke/',
  'https://api19-normal-c-useast1a.tiktokv.com/media/api/text/speech/invoke/',
  'https://api22-normal-c-useast2a.tiktokv.com/media/api/text/speech/invoke/',
  'https://api-va.tiktokv.com/media/api/text/speech/invoke/',
];

/**
 * The route 404s without a trailing slash, and configs saved before that was
 * understood still hold the old URL — so repair it rather than fail.
 */
export function normalizeEndpoint(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return TIKTOK_TTS_ENDPOINTS[0] as string;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * The endpoint that last produced audio. Which host works is stable for a
 * given location but varies between them, so remembering the winner avoids
 * re-walking the dead ones on every single clip.
 */
let lastWorkingEndpoint: string | null = null;

const USER_AGENT =
  'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; es_ES; SM-G988N; Build/NRD90M; tt-ok/3.12.13.1)';

/** Empirically the endpoint rejects anything much past ~300 characters. */
const CHUNK_SIZE = 200;

export class TtsError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** False for auth/quota problems that retrying won't fix. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

interface TikTokTtsResponse {
  data?: { v_str?: string; duration?: string; speaker?: string };
  message?: string;
  status_code?: number;
  status_msg?: string;
}

/**
 * Splits on word boundaries so a chunk break never lands mid-word (which
 * makes the seam audible). Words longer than the limit are hard-split.
 */
export function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let current = '';

  for (const word of clean.split(' ')) {
    if (word.length > size) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += size) chunks.push(word.slice(i, i + size));
      continue;
    }
    if (current.length + word.length + 1 > size) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function describeStatus(code: number, message: string): TtsError {
  switch (code) {
    case 1:
      // Seen from hosts that resolve and answer but don't serve TTS for your
      // region — the same request succeeds on another host, so keep going.
      return new TtsError(
        `Endpoint would not synthesize (${message || 'no reason given'})`,
        'rejected',
        true,
      );
    case 2:
      return new TtsError('Text was too long for one request', 'too_long', false);
    case 3:
      // Observed when firing many requests at once — backing off and retrying
      // the same voice succeeds.
      return new TtsError(
        `Rate limited by TikTok${message ? `: ${message}` : ''}`,
        'rate_limited',
        true,
      );
    case 4:
      return new TtsError('That voice code is not available on this account', 'bad_voice', false);
    case 5:
      return new TtsError(
        'TikTok session id is missing, expired or invalid — paste a fresh sessionid cookie',
        'bad_session',
        false,
      );
    default:
      return new TtsError(
        `TikTok TTS returned status ${code}${message ? `: ${message}` : ''}`,
        'unknown',
        true,
      );
  }
}

export interface SynthesisResult {
  audio: Buffer;
  mimeType: 'audio/mpeg';
  durationMs: number | null;
  voice: string;
}

export interface TikTokTtsOptions {
  sessionId: string;
  /** Preferred endpoint; the built-in list is tried afterwards as a fallback. */
  baseUrl?: string;
  timeoutMs?: number;
}

async function requestChunk(
  endpoint: string,
  text: string,
  voice: string,
  sessionId: string,
  timeoutMs: number,
): Promise<{ audio: Buffer; durationMs: number | null }> {
  const url = new URL(endpoint);
  url.searchParams.set('text_speaker', voice);
  // `+` is interpreted as a space by the endpoint, so spell it out.
  url.searchParams.set('req_text', text.replace(/\+/g, 'plus'));
  url.searchParams.set('speaker_map_type', '0');
  url.searchParams.set('aid', '1233');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: `sessionid=${sessionId}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    throw new TtsError(
      aborted ? `TTS request timed out after ${timeoutMs}ms` : describeError(error),
      aborted ? 'timeout' : 'network',
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Retryable on purpose, 404 included: a dead or moved route on one host
    // says nothing about the others, and hosts get retired all the time.
    throw new TtsError(`TTS endpoint returned HTTP ${response.status}`, 'http', true);
  }

  let body: TikTokTtsResponse;
  try {
    body = (await response.json()) as TikTokTtsResponse;
  } catch {
    // A login wall or region block returns HTML rather than JSON.
    throw new TtsError('TTS endpoint returned a non-JSON response', 'bad_response', true);
  }

  const status = body.status_code ?? 0;
  if (status !== 0) {
    throw describeStatus(status, body.status_msg ?? body.message ?? '');
  }

  const encoded = body.data?.v_str;
  if (!encoded) {
    throw new TtsError('TTS response contained no audio', 'empty', true);
  }

  const audio = Buffer.from(encoded, 'base64');

  // `duration` is not reliably seconds — a two-word clip has been observed
  // reporting 81 — and it only feeds the playback watchdog, so treat an
  // implausible value as absent rather than stalling the queue on it.
  const reported = Number.parseFloat(body.data?.duration ?? '');
  const plausible = Number.isFinite(reported) && reported > 0 && reported <= 60;

  return { audio, durationMs: plausible ? Math.round(reported * 1000) : null };
}

/** Synthesizes `text` with `voice`, splitting and re-joining as needed. */
export async function synthesizeWithTikTok(
  text: string,
  voice: string,
  options: TikTokTtsOptions,
): Promise<SynthesisResult> {
  const sessionId = options.sessionId.trim();
  if (!sessionId) {
    throw new TtsError(
      'No TikTok session id configured — set TIKTOK_SESSION_ID or paste one in the dashboard',
      'no_session',
      false,
    );
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new TtsError('Nothing to speak', 'empty_text', false);
  }

  // Last known-good first, then the configured one, then the rest. Dedupe so a
  // dead host isn't retried twice per clip.
  const preferred = options.baseUrl ? normalizeEndpoint(options.baseUrl) : null;
  const endpoints = [
    ...new Set(
      [lastWorkingEndpoint, preferred, ...TIKTOK_TTS_ENDPOINTS]
        .filter((url): url is string => Boolean(url))
        .map(normalizeEndpoint),
    ),
  ];

  const timeoutMs = options.timeoutMs ?? 10_000;
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    try {
      const parts: Buffer[] = [];
      let totalMs = 0;

      for (const chunk of chunks) {
        const part = await requestChunk(endpoint, chunk, voice, sessionId, timeoutMs);
        parts.push(part.audio);
        totalMs += part.durationMs ?? 0;
      }

      if (lastWorkingEndpoint !== endpoint) {
        log.info(`Using TTS endpoint ${endpoint}`);
        lastWorkingEndpoint = endpoint;
      }

      return {
        audio: Buffer.concat(parts),
        mimeType: 'audio/mpeg',
        durationMs: totalMs > 0 ? totalMs : null,
        voice,
      };
    } catch (error) {
      lastError = error;
      // Auth and voice problems are the same on every host — stop early.
      if (error instanceof TtsError && !error.retryable) throw error;
      // This host is out; don't keep preferring it on the next clip.
      if (lastWorkingEndpoint === endpoint) lastWorkingEndpoint = null;
      log.warn(`Endpoint ${endpoint} failed (${describeError(error)}), trying the next one`);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new TtsError('All TikTok TTS endpoints failed', 'exhausted', true);
}
