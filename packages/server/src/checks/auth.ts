/**
 * Verifies the dashboard password gate.
 *   npm run check:auth -w @streaming/server
 *
 * Spawns its own server on a spare port with a known password, so nothing here
 * touches your real config or signs you out of an open dashboard.
 *
 * The properties that matter, in order:
 *   1. Without a session, nothing that reads or changes state is reachable.
 *   2. Browser sources still work — they cannot log in, so the handful of
 *      routes an overlay needs must stay open.
 *   3. A wrong password is refused, and repeated guesses get locked out.
 *   4. With no password configured, the server behaves exactly as before.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4788;
const OPEN_PORT = 4789;
const PASSWORD = 'correct-horse-battery-staple';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** A throwaway data directory, so nothing here can reach the real config. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-auth-check-'));

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function start(port: number, password: string): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DASHBOARD_PASSWORD: password,
      DATA_DIR: SANDBOX,
    },
    stdio: 'ignore',
  });
}

async function waitForBoot(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ping`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  return false;
}

const children: ChildProcess[] = [];

async function main(): Promise<void> {
  console.log('starting a protected instance…');
  children.push(start(PORT, PASSWORD));
  if (!(await waitForBoot(PORT))) {
    console.error('FAIL  server did not start');
    process.exit(1);
  }

  const base = `http://127.0.0.1:${PORT}/api`;
  const status = async (path: string, init?: RequestInit): Promise<number> =>
    (await fetch(`${base}${path}`, init)).status;

  /* --- 1. locked down without a session --------------------------- */

  console.log('\nwithout signing in');
  for (const [path, init] of [
    ['/config', undefined],
    ['/snapshot', undefined],
    ['/overlays', undefined],
    ['/meta', undefined],
    ['/users', undefined],
    ['/sources/check', undefined],
    ['/health', undefined],
    ['/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/tts/clear', { method: 'POST' }],
  ] as Array<[string, RequestInit | undefined]>) {
    const code = await status(path, init);
    check(`${init?.method ?? 'GET'} ${path} is refused`, code === 401, `got ${code}`);
  }

  /* --- 2. what a browser source needs stays open ------------------- */

  console.log('\nbrowser sources still work');
  check('GET /ping is open', (await status('/ping')) === 200);
  check('GET /auth/status is open', (await status('/auth/status')) === 200);
  check(
    'GET /slideshows/:folder is open',
    [200, 404].includes(await status('/slideshows/none-such')),
    'the one API call an overlay makes',
  );
  const page = await fetch(`http://127.0.0.1:${PORT}/overlay/chat`);
  check('the overlay page itself loads', page.status === 200, `got ${page.status}`);

  const auth = (await (await fetch(`${base}/auth/status`)).json()) as {
    required: boolean;
    authenticated: boolean;
  };
  check('auth/status reports a password is required', auth.required && !auth.authenticated);

  /* --- 3. logging in ---------------------------------------------- */

  console.log('\nsigning in');
  const bad = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'not-the-password' }),
  });
  check('a wrong password is refused', bad.status === 401, `got ${bad.status}`);
  check('and sets no cookie', !bad.headers.get('set-cookie'));

  const good = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = good.headers.get('set-cookie')?.split(';')[0] ?? '';
  check('the right password is accepted', good.status === 200, `got ${good.status}`);
  check('and sets an HttpOnly session cookie', /HttpOnly/i.test(good.headers.get('set-cookie') ?? ''));

  const withCookie = { headers: { cookie } };
  check('GET /config now works', (await status('/config', withCookie)) === 200);
  check('GET /snapshot now works', (await status('/snapshot', withCookie)) === 200);
  check(
    'PATCH /config now works',
    (await status('/config', {
      method: 'PATCH',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: '{}',
    })) === 200,
  );

  /* --- 4. a forged cookie is not enough ---------------------------- */

  console.log('\nsession integrity');
  check(
    'a made-up token is rejected',
    (await status('/config', { headers: { cookie: 'stream_session=totally-made-up' } })) === 401,
  );

  const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } });
  check('logout succeeds', out.status === 200);
  check(
    'and the old cookie stops working',
    (await status('/config', withCookie)) === 401,
    'session is revoked server-side, not just cleared in the browser',
  );

  /* --- 5. brute force gets throttled ------------------------------- */

  console.log('\nrepeated guesses');
  let lockedAt = 0;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: `guess-${attempt}` }),
    });
    if (response.status === 429 && !lockedAt) lockedAt = attempt;
  }
  check('guessing gets locked out', lockedAt > 0, `after ${lockedAt} attempts`);
  const duringLockout = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  check(
    'even the correct password waits out the lockout',
    duringLockout.status === 429,
    `got ${duringLockout.status}`,
  );

  /* --- 6. no password set = unchanged behaviour -------------------- */

  console.log('\nwith no password configured');
  children.push(start(OPEN_PORT, ''));
  if (!(await waitForBoot(OPEN_PORT))) {
    check('an unprotected instance starts', false);
  } else {
    const openBase = `http://127.0.0.1:${OPEN_PORT}/api`;
    check(
      'GET /config is open',
      (await fetch(`${openBase}/config`)).status === 200,
      'no lockout when DASHBOARD_PASSWORD is unset',
    );
    const openAuth = (await (await fetch(`${openBase}/auth/status`)).json()) as {
      required: boolean;
    };
    check('auth/status reports no password required', openAuth.required === false);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    failed += 1;
  })
  .finally(() => {
    for (const child of children) child.kill();
    fs.rmSync(SANDBOX, { recursive: true, force: true });
    process.exit(failed === 0 ? 0 : 1);
  });
