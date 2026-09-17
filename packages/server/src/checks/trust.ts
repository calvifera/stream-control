/**
 * Verifies viewer trust scoring.
 *   npm run check:trust -w @streaming/server
 *
 * Needs no running server. Two failures matter most: a regular pushed into
 * strict mode by ordinary chat, which quietly stops their messages being read
 * aloud, and a disguised retry that scores as harmless.
 */
import { DEFAULT_TRUST, type TrustConfig } from '@streaming/shared';
import type { KnownUser } from '../state/directory.js';
import { soundsSimilar, textSignals, TrustTracker, type TrustSubject } from '../state/trust.js';

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

const config: TrustConfig = { ...DEFAULT_TRUST };

const known = (over: Partial<KnownUser>): KnownUser => ({
  platform: 'tiktok',
  username: 'someone',
  displayName: 'Someone',
  avatarUrl: null,
  userId: '1',
  firstSeen: Date.now() - 60 * 24 * 3600 * 1000,
  lastSeen: Date.now(),
  messages: 0,
  strikes: 0,
  evidence: [],
  ...over,
});

const subject = (key: string, over: Partial<TrustSubject> = {}): TrustSubject => ({
  key,
  known: undefined,
  onTrustedList: false,
  isHost: false,
  isModerator: false,
  isSubscriber: false,
  isFollower: false,
  isVerified: false,
  fansClubLevel: 0,
  ...over,
});

const clean = { filtered: false, severity: 'none' as const, evasion: false, nearMiss: false };

/* ------------------------------------------------------------------ *
 * 1. Ordinary chat carries no spelling signals
 * ------------------------------------------------------------------ */

console.log('ordinary chat has no signals');
for (const text of [
  'gg well played',
  'what time is the stream tomorrow',
  'i sent it already lol',
  'mp3 and mp4 files',
  'the co-op mode is fun',
  'x-ray vision',
  'I am so tired',
  'a b testing is real',
  'it costs $5 now',
  '2nd place again',
  'my rank is gold 4',
  'e.g. this one',
  'hello from brazil 🇧🇷',
  'lets goooo',
]) {
  const signals = textSignals(text);
  check(`"${text}"`, signals.length === 0, signals.join(', '));
}

/* ------------------------------------------------------------------ *
 * 2. Disguised spellings are flagged
 * ------------------------------------------------------------------ */

console.log('\ndisguised spellings');
for (const text of [
  'n i g g a',
  'f.u.c.k you',
  'n-i-g-g',
  'you f4ggot',
  'n1gger',
  'ｎｉｇｇｅｒ',
  'ni​gger',
  'nіgger', // Cyrillic і
]) {
  const signals = textSignals(text);
  check(`"${text}"`, signals.length > 0, signals.join(', '));
}

/* ------------------------------------------------------------------ *
 * 3. Scores land in the right band
 * ------------------------------------------------------------------ */

console.log('\nbands');
{
  const tracker = new TrustTracker();

  const stranger = tracker.score(subject('tiktok:new'), config);
  check('a brand-new viewer is in strict mode', stranger.strict && stranger.band === 'new', `${stranger.score}`);

  const regular = tracker.score(
    subject('tiktok:regular', { known: known({ daysSeen: 12, messages: 340 }) }),
    config,
  );
  check('a long-time regular is not strict', !regular.strict && regular.band === 'regular', `${regular.score}`);

  const follower = tracker.score(
    subject('tiktok:follower', { known: known({ daysSeen: 2, messages: 8 }), isFollower: true }),
    config,
  );
  check('a returning follower is not strict', !follower.strict, `${follower.score}`);

  const trusted = tracker.score(subject('tiktok:trusted', { onTrustedList: true }), config);
  check('the trusted list scores 100', trusted.score === 100 && trusted.band === 'trusted');

  const mod = tracker.score(subject('twitch:mod', { isModerator: true }), config);
  check('a moderator is trusted', mod.band === 'trusted');

  const off = tracker.score(subject('tiktok:new'), { ...config, enabled: false });
  check('turning trust off turns strict mode off', !off.strict);
}

/* ------------------------------------------------------------------ *
 * 4. Ordinary chat never pushes a regular into strict mode
 * ------------------------------------------------------------------ */

console.log('\nbehaviour');
{
  const tracker = new TrustTracker();
  const regular = subject('tiktok:chatty', { known: known({ daysSeen: 5, messages: 60 }) });
  let last = tracker.score(regular, config);
  for (let i = 0; i < 40; i += 1) {
    last = tracker.observe(regular, { ...clean, text: `message number ${i}` }, config).score;
  }
  check('40 clean messages keep a regular out of strict mode', !last.strict, `${last.score}`);

  // One swear word, dropped by the ordinary list, then an apology.
  tracker.observe(regular, { ...clean, text: 'damn it', filtered: true, severity: 'normal' }, config);
  const apology = tracker.observe(regular, { ...clean, text: 'sorry chat' }, config);
  check('an apology after a block is not a retry', !apology.retry);
  check('one ordinary block leaves a regular out of strict mode', !apology.score.strict, `${apology.score.score}`);
}

{
  const tracker = new TrustTracker();
  const troll = subject('tiktok:troll');

  tracker.observe(troll, { ...clean, text: 'nigger', filtered: true, severity: 'severe' }, config);
  const retry = tracker.observe(troll, { ...clean, text: 'knee grow' }, config);
  check('a sound-alike right after a severe block is a retry', retry.retry && retry.severeRetry);
  check('the retry leaves them in strict mode', retry.score.strict && retry.score.band === 'low', `${retry.score.score}`);

  const spaced = tracker.observe(troll, { ...clean, text: 'n i g g a' }, config);
  check('a spaced-out retry is flagged', spaced.retry && spaced.signals.length > 0, spaced.signals.join(', '));
}

{
  const tracker = new TrustTracker();
  const late = subject('tiktok:late');
  const old = { ...config, retryWindowSeconds: 10 };
  tracker.observe(late, { ...clean, text: 'nigger', filtered: true, severity: 'severe' }, old);
  // Nothing to wait on: shift the block into the past instead.
  const memory = (tracker as unknown as { memory: Map<string, { lastBlock: { ts: number } }> }).memory;
  memory.get('tiktok:late')!.lastBlock.ts -= 60_000;
  const after = tracker.observe(late, { ...clean, text: 'knee grow' }, old);
  check('a message outside the retry window is not a retry', !after.retry);
}

{
  const tracker = new TrustTracker();
  const tester = subject('tiktok:test');
  tracker.observe(tester, { ...clean, text: 'nigger', filtered: true, severity: 'severe' }, config, false);
  const after = tracker.score(tester, config);
  check('an unrecorded test message leaves no memory', !after.factors.some((f) => f.delta < 0 && f.label !== 'New here'));
}

{
  const tracker = new TrustTracker();
  const person = subject('tiktok:reset');
  tracker.observe(person, { ...clean, text: 'nigger', filtered: true, severity: 'severe' }, config);
  tracker.reset();
  const fresh = tracker.score(person, config);
  check('a new session forgets the last stream', fresh.band === 'new', `${fresh.score}`);
}

/* ------------------------------------------------------------------ *
 * 5. Retry similarity
 * ------------------------------------------------------------------ */

console.log('\nsimilarity');
check('"knee grow" sounds like the blocked slur', soundsSimilar('nigger', 'knee grow'));
check('"deal dough" sounds like "dildo"', soundsSimilar('dildo', 'deal dough'));
check('"sorry chat" does not sound like a slur', !soundsSimilar('nigger', 'sorry chat'));
check('"good game" does not sound like a slur', !soundsSimilar('faggot', 'good game'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
