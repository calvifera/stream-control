/**
 * Verifies that the dashboard test button jumps the queue.
 *   npm run check:preview -w @streaming/server
 *
 * Runs the engine in-process against a stub provider, so the timing-sensitive
 * parts are controllable and nothing here needs network or credentials.
 *
 * The behaviour under test, in the order it matters:
 *   1. A test plays immediately, even with a backlog and something speaking.
 *   2. The audio is fetched BEFORE anything is interrupted — pressing test
 *      must never punch a silent hole in the stream while a provider thinks.
 *   3. A test interrupts an earlier test.
 *   4. A failed synthesis leaves whatever was playing alone.
 *   5. Overlapping presses supersede each other rather than racing.
 *   6. The queue is not consumed, and resumes afterwards.
 */
import { createDefaultConfig, type TtsConfig, type TtsQueueItem } from '@streaming/shared';
import { TtsEngine } from '../tts/engine.js';

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

interface Harness {
  engine: TtsEngine;
  /** Ordered log of everything the engine told listeners to do. */
  events: string[];
  setProvider: (options: { delayMs?: number; fail?: boolean }) => void;
}

function makeEngine(overrides: Partial<TtsConfig> = {}): Harness {
  const config: TtsConfig = {
    ...createDefaultConfig().tts,
    provider: 'tiktok', // anything with a server-side adapter, so the stub is used
    gapMs: 0,
    fallbackToBrowser: false,
    ...overrides,
  };

  const engine = new TtsEngine(config);
  const events: string[] = [];

  engine.on('play', (item: TtsQueueItem) => events.push(`play:${item.text}`));
  engine.on('stop', () => events.push('stop'));

  const setProvider = ({ delayMs = 0, fail = false }): void => {
    // Deliberately replacing the lookup rather than the registry internals:
    // the engine only ever reaches a provider through `get`.
    (engine.providers as unknown as { get: () => unknown }).get = () => ({
      name: 'stub',
      synthesize: async () => {
        await wait(delayMs);
        if (fail) throw new Error('stub provider is down');
        return {
          audio: Buffer.from('not really audio'),
          mimeType: 'audio/mpeg',
          durationMs: 60_000, // long, so nothing finishes on its own mid-test
        };
      },
    });
  };

  setProvider({});
  // One listener, so the queue is allowed to pump. Nothing acks, which is the
  // point: whatever starts stays "speaking" until something interrupts it.
  engine.setListenerCount(1);
  return { engine, events, setProvider };
}

const speaking = (engine: TtsEngine): string | null => engine.getState().speaking?.text ?? null;
const queued = (engine: TtsEngine): string[] => engine.getState().queue.map((q) => q.text);

const request = (text: string) => ({
  ruleId: 'test',
  ruleName: 'test',
  text,
  voice: 'v',
  priority: 100,
  volume: 1,
  rate: 1,
  pitch: 1,
  username: '',
});

async function main(): Promise<void> {
  /* --- 1. jumps the queue ----------------------------------------- */

  console.log('a test jumps the queue');
  {
    const { engine, events } = makeEngine();
    engine.enqueue(request('chat-A'));
    engine.enqueue(request('chat-B'));
    engine.enqueue(request('chat-C'));
    await wait(60);

    check('a real message is playing first', speaking(engine) === 'chat-A', `${speaking(engine)}`);
    check('with the rest queued behind it', queued(engine).join() === 'chat-B,chat-C');

    const result = await engine.speakNow(request('TEST'));
    check('the test reports playing', result.item !== null && result.reason === null);
    check('and is what is now speaking', speaking(engine) === 'TEST', `${speaking(engine)}`);
    check(
      'the interrupted clip was stopped, then the test started',
      events.join(' ') === 'play:chat-A stop play:TEST',
      events.join(' '),
    );
    check(
      'the queue is untouched',
      queued(engine).join() === 'chat-B,chat-C',
      `[${queued(engine).join(', ')}]`,
    );

    // 6. and normal playback resumes once the test finishes
    engine.reportDone(engine.getState().speaking!.id);
    await wait(60);
    check('the queue resumes afterwards', speaking(engine) === 'chat-B', `${speaking(engine)}`);
    engine.dispose();
  }

  /* --- 2. audio first, interruption second ------------------------ */

  console.log('\nnothing is cut off until the audio is in hand');
  {
    const { engine, events, setProvider } = makeEngine();
    engine.enqueue(request('chat-A'));
    await wait(60);

    setProvider({ delayMs: 300 });
    const pending = engine.speakNow(request('TEST'));

    await wait(150); // mid-synthesis
    check(
      'the previous clip is still playing while the test synthesizes',
      speaking(engine) === 'chat-A',
      `${speaking(engine)}`,
    );
    check('and no stop has been sent yet', !events.includes('stop'), events.join(' '));

    await pending;
    check('once ready, it takes over', speaking(engine) === 'TEST');
    check(
      'stop lands immediately before the test, not before the fetch',
      events.join(' ') === 'play:chat-A stop play:TEST',
      events.join(' '),
    );
    engine.dispose();
  }

  /* --- 3. a test interrupts a test -------------------------------- */

  console.log('\na test interrupts an earlier test');
  {
    const { engine, events } = makeEngine();
    await engine.speakNow(request('TEST-1'));
    check('the first test plays', speaking(engine) === 'TEST-1');

    await engine.speakNow(request('TEST-2'));
    check('the second replaces it', speaking(engine) === 'TEST-2', `${speaking(engine)}`);
    check(
      'with a stop in between',
      events.join(' ') === 'play:TEST-1 stop play:TEST-2',
      events.join(' '),
    );
    engine.dispose();
  }

  /* --- 4. a failure disturbs nothing ------------------------------ */

  console.log('\na failed test leaves playback alone');
  {
    const { engine, events, setProvider } = makeEngine();
    engine.enqueue(request('chat-A'));
    await wait(60);

    setProvider({ fail: true });
    const result = await engine.speakNow(request('TEST'));

    check('it reports why nothing played', result.item === null && Boolean(result.reason), `${result.reason}`);
    check('the original clip is still playing', speaking(engine) === 'chat-A', `${speaking(engine)}`);
    check('and was never stopped', !events.includes('stop'), events.join(' '));
    engine.dispose();
  }

  /* --- 5. overlapping presses supersede --------------------------- */

  console.log('\noverlapping presses');
  {
    const { engine, events, setProvider } = makeEngine();

    setProvider({ delayMs: 300 });
    const slow = engine.speakNow(request('SLOW'));
    // The second press is issued later but its provider answers first.
    await wait(20);
    setProvider({ delayMs: 10 });
    const fast = engine.speakNow(request('FAST'));

    const [slowResult, fastResult] = await Promise.all([slow, fast]);
    await wait(350); // let the slow one finish synthesizing and be discarded

    check('the later press plays', fastResult.item !== null && speaking(engine) === 'FAST');
    check(
      'the overtaken press is discarded, not played late',
      slowResult.item === null && !events.includes('play:SLOW'),
      `${slowResult.reason} · ${events.join(' ')}`,
    );
    check('nothing played twice', events.filter((e) => e === 'play:FAST').length === 1);
    engine.dispose();
  }

  /* --- 7. refusals ------------------------------------------------- */

  console.log('\nrefusals are explained');
  {
    const { engine } = makeEngine({ enabled: false });
    const result = await engine.speakNow(request('TEST'));
    check('says so when TTS is off', result.item === null && /switched off/i.test(result.reason ?? ''));
    engine.dispose();
  }
  {
    const { engine } = makeEngine();
    engine.setListenerCount(0);
    const result = await engine.speakNow(request('TEST'));
    check(
      'says so when nothing can play it',
      result.item === null && /listening/i.test(result.reason ?? ''),
      `${result.reason}`,
    );
    engine.dispose();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    failed += 1;
  })
  .finally(() => process.exit(failed === 0 ? 0 : 1));
