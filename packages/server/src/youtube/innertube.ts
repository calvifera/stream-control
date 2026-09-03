import { createLogger } from '../logger.js';

const log = createLogger('youtube-innertube');

/**
 * Reads YouTube live chat the way the watch page does.
 *
 * The Data API is not the only door into a public live chat, and for reading
 * it is the worse one. It requires a Google Cloud project, an OAuth consent
 * screen and a signed-in account before it will return a single message, and
 * then it spends from a daily quota that a two-hour stream can exhaust. None
 * of that buys anything a viewer with a browser does not already have.
 *
 * So this does what the browser does. The watch page carries an InnerTube API
 * key, a client version and a continuation token; posting the token back to
 * `live_chat/get_live_chat` returns a batch of messages and the next token.
 * No credentials, no quota, and it works on any public stream rather than
 * only your own.
 *
 * The trade is that none of it is documented or promised. Field names move,
 * and when they do this breaks with no deprecation notice — which is why the
 * Data API reader stays in the codebase as a fallback rather than being
 * deleted. A break should cost a settings change, not the platform.
 *
 * The same trade the TikTok connection already makes, for the same reason:
 * the official path either does not exist or does not answer the question.
 */

const ORIGIN = 'https://www.youtube.com';

/**
 * A desktop browser's user agent.
 *
 * Not disguise — the endpoint is the desktop site's own, and the response
 * shape depends on which client is asking. Sent a Node default it either
 * answers in a different schema or not at all.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Fallback pacing when the server does not state a preference. */
const DEFAULT_POLL_MS = 2000;
/** Never faster than this, whatever the page suggests. */
const MIN_POLL_MS = 1000;
/** Never slower than this, so the end of a stream is noticed promptly. */
const MAX_POLL_MS = 10_000;

export interface ChatSession {
  videoId: string;
  title: string;
  apiKey: string;
  clientVersion: string;
  /** Cursor for the next batch. Replaced on every poll. */
  continuation: string;
}

export interface ChatBatch {
  /** Raw `addChatItemAction` items, for the normalizer to interpret. */
  items: unknown[];
  /** Cursor for the following batch, or null when the chat has ended. */
  continuation: string | null;
  /** How long the server would like us to wait, already clamped. */
  waitMs: number;
}

/** What to point the reader at. The first one that resolves wins. */
export interface ChatTarget {
  /** An explicit video id, for a stream you do not own. */
  videoId?: string;
  /** `@handle`, for finding whichever stream that channel has live. */
  handle?: string;
  /** `UC...` channel id — what the OAuth account id already is. */
  channelId?: string;
}

const first = <T>(...values: (T | undefined | null)[]): T | undefined =>
  values.find((v) => v !== undefined && v !== null) as T | undefined;

/**
 * Fetches a candidate page, or null when there is nothing there.
 *
 * Null rather than throwing, because these are candidates: a handle that does
 * not exist should let the next candidate be tried, not abort the search. It
 * threw before, which meant a wrong handle hid a perfectly good channel id
 * sitting behind it in the list.
 */
async function getPage(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' },
  });
  if (!response.ok) {
    log.debug(`${response.status} for ${url}`);
    return null;
  }
  return response.text();
}

/**
 * The URLs that land on a channel's current broadcast.
 *
 * `/live` is the one that matters: YouTube resolves it to whichever stream is
 * live right now, so nothing has to be typed in when the stream starts. A
 * channel that is not live returns an ordinary page with no chat in it, which
 * is how "not live" is detected rather than guessed.
 */
function candidateUrls(target: ChatTarget): string[] {
  if (target.videoId) return [`${ORIGIN}/watch?v=${target.videoId}`];

  const urls: string[] = [];

  /*
   * Emptiness has to be checked before the `@` is added, not after.
   *
   * `''.replace(/^@?/, '@')` is `'@'`, not `''` — the optional group matches
   * nothing at position zero and the replacement lands anyway. A blank handle
   * therefore became a real-looking one and sent the reader to `/@/live`,
   * which 404s. Worse, it did so *before* the channel-id candidate, which
   * would have worked.
   */
  const handle = target.handle?.trim();
  if (handle) urls.push(`${ORIGIN}/${handle.startsWith('@') ? handle : `@${handle}`}/live`);
  if (target.channelId?.trim()) urls.push(`${ORIGIN}/channel/${target.channelId.trim()}/live`);
  return urls;
}

/**
 * Finds a live chat to read, or null when the target is not live.
 *
 * Null rather than throwing: not being live is the ordinary state of a
 * channel, not a failure, and the caller says so differently.
 */
export async function findLiveChat(target: ChatTarget): Promise<ChatSession | null> {
  const urls = candidateUrls(target);
  if (urls.length === 0) {
    throw new Error('Set a YouTube video id or channel handle before connecting.');
  }

  for (const url of urls) {
    const html = await getPage(url);
    if (!html) continue;

    // No chat renderer at all means this is not a live watch page — a channel
    // home page, a members-only stream, or a stream with chat disabled.
    if (!html.includes('liveChatRenderer')) continue;

    const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
    const clientVersion = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1];
    const videoId = first(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html)?.[1],
      /"videoId":"([\w-]{11})"/.exec(html)?.[1],
      target.videoId,
    );

    // Long tokens only: the page is full of short continuations belonging to
    // comments, related videos and the rest of the shelf furniture.
    const continuation = [...html.matchAll(/"continuation":"([^"]{40,})"/g)]
      .map((m) => m[1] as string)
      .find(Boolean);

    if (!apiKey || !continuation || !videoId) {
      log.debug(`No usable chat context at ${url}`);
      continue;
    }

    const title = first(
      /<meta name="title" content="([^"]*)"/.exec(html)?.[1],
      /"title":"([^"]{1,120})"/.exec(html)?.[1],
    );

    return {
      videoId,
      title: decodeEntities(title ?? videoId),
      apiKey,
      clientVersion: clientVersion ?? '2.20240101.00.00',
      continuation,
    };
  }

  return null;
}

/**
 * Fetches the next batch of chat.
 *
 * A null continuation in the reply means the chat is over; the caller treats
 * that the same way the Data API's `offlineAt` is treated.
 */
export async function pollChat(session: ChatSession): Promise<ChatBatch> {
  const response = await fetch(
    `${ORIGIN}/youtubei/v1/live_chat/get_live_chat?key=${session.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: session.clientVersion } },
        continuation: session.continuation,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `YouTube live chat returned ${response.status}: ${body.slice(0, 160) || '(empty body)'}`,
    );
  }

  const data = (await response.json()) as {
    continuationContents?: {
      liveChatContinuation?: {
        actions?: unknown[];
        continuations?: Record<string, { continuation?: string; timeoutMs?: number }>[];
      };
    };
  };

  const chat = data.continuationContents?.liveChatContinuation;
  // The chat ending is the documented-by-observation way this stops: the
  // response arrives fine and simply carries no way to ask again.
  if (!chat) return { items: [], continuation: null, waitMs: DEFAULT_POLL_MS };

  const next = chat.continuations?.[0];
  const nextData = next ? Object.values(next)[0] : undefined;
  const suggested = nextData?.timeoutMs ?? DEFAULT_POLL_MS;

  return {
    items: chat.actions ?? [],
    continuation: nextData?.continuation ?? null,
    // Clamped both ways: the page has been seen asking for intervals short
    // enough to look like hammering, and long enough to miss a stream ending.
    waitMs: Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, suggested)),
  };
}

/** The handful of entities that show up in a scraped title. */
function decodeEntities(text: string): string {
  return text
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
