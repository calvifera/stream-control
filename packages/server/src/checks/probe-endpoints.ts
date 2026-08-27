/**
 * Probes candidate TikTok TTS endpoints to find which are still alive.
 *   npx tsx packages/server/src/checks/probe-endpoints.ts
 *
 * TikTok retires these hosts regularly, so when synthesis starts failing this
 * tells you which host/path pairs still answer. Never prints the session id.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH } from '../env.js';

const HOSTS = [
  'api16-normal-c-useast1a.tiktokv.com',
  'api16-normal-c-useast2a.tiktokv.com',
  'api19-normal-c-useast1a.tiktokv.com',
  'api16-normal-useast5.us.tiktokv.com',
  'api22-normal-c-useast2a.tiktokv.com',
  'api16-normal-c-alisg.tiktokv.com',
  'api-normal.tiktokv.com',
  'api16-core-c-useast1a.tiktokv.com',
];

const PATHS = ['/media/api/text/speech/invoke'];

const USER_AGENT =
  'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; es_ES; SM-G988N; Build/NRD90M; tt-ok/3.12.13.1)';

function readSessionId(): string {
  const fromEnv = process.env.TIKTOK_SESSION_ID?.trim();
  if (fromEnv) return fromEnv;
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as {
      tts?: { sessionId?: string };
    };
    return config.tts?.sessionId?.trim() ?? '';
  } catch {
    return '';
  }
}

async function probe(host: string, route: string, sessionId: string): Promise<string> {
  const url = new URL(`https://${host}${route}`);
  url.searchParams.set('text_speaker', 'en_us_002');
  url.searchParams.set('req_text', 'test');
  url.searchParams.set('speaker_map_type', '0');
  url.searchParams.set('aid', '1233');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: `sessionid=${sessionId}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    const body = await response.text();
    if (!response.ok) return `HTTP ${response.status}`;

    try {
      const parsed = JSON.parse(body) as {
        status_code?: number;
        status_msg?: string;
        message?: string;
        data?: { v_str?: string; duration?: string };
      };
      const code = parsed.status_code ?? 0;
      if (code !== 0) {
        return `status_code ${code} — ${parsed.status_msg ?? parsed.message ?? 'no message'}`;
      }
      const bytes = parsed.data?.v_str ? Buffer.from(parsed.data.v_str, 'base64').length : 0;
      return `WORKS — ${bytes} bytes of audio, ${parsed.data?.duration ?? '?'}s`;
    } catch {
      return `HTTP 200 but non-JSON (${body.slice(0, 60).replace(/\s+/g, ' ')}…)`;
    }
  } catch (error) {
    if (controller.signal.aborted) return 'timeout';
    return `network: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const sessionId = readSessionId();
  console.log(
    sessionId
      ? `Using a session id of ${sessionId.length} characters (from ${
          process.env.TIKTOK_SESSION_ID ? 'the environment' : path.basename(CONFIG_PATH)
        })\n`
      : 'WARNING: no session id found — every endpoint will reject the request\n',
  );

  const working: string[] = [];

  for (const route of PATHS) {
    for (const host of HOSTS) {
      const result = await probe(host, route, sessionId);
      const marker = result.startsWith('WORKS') ? ' *' : '  ';
      console.log(`${marker} ${host.padEnd(38)} ${result}`);
      if (result.startsWith('WORKS')) working.push(`https://${host}${route}`);
    }
  }

  console.log(
    working.length > 0
      ? `\n${working.length} working endpoint(s):\n${working.map((u) => `  ${u}`).join('\n')}`
      : '\nNo endpoint returned audio.',
  );
}

main().catch((error: unknown) => {
  console.error('probe failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
