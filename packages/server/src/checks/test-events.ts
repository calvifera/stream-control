/**
 * Spoofed-event checks.
 *
 * Two things to hold down. The roles a spec asks for must reach the gate
 * unchanged — a test tool that quietly randomises what it is testing is worse
 * than no test tool, because it answers confidently and wrongly. And a
 * synthetic event must leave no trace in the permanent archive, which is the
 * whole reason the flag exists.
 */
import { checkGate } from '../pipeline/gates.js';
import { SessionState } from '../state/session.js';
import { createTestEvent } from '../testEvents.js';
import {
  TEST_PERSONAS,
  type GateConfig,
  type StreamEvent,
  type TestEventSpec,
} from '@streaming/shared';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
    console.log(`         expected ${JSON.stringify(expected)}`);
    console.log(`         actual   ${JSON.stringify(actual)}`);
  }
}

const OPEN: GateConfig = {
  followersOnly: false,
  friendsOnly: false,
  subscribersOnly: false,
  moderatorsOnly: false,
  giftersOnly: false,
  minSessionDiamonds: 0,
  minFollowerCount: 0,
  minFansClubLevel: 0,
  allowUsers: [],
};

const spec = (over: Partial<TestEventSpec> = {}): TestEventSpec => ({
  type: 'chat',
  platform: 'tiktok',
  ...over,
});

const userOf = (event: StreamEvent) => {
  if (!event.user) throw new Error('expected an event with a user');
  return event.user;
};

console.log('\nTest events\n');

console.log('nothing is written to the archive');
{
  for (let i = 0; i < 5; i += 1) {
    check(`fire ${i + 1} is marked synthetic`, createTestEvent(spec()).synthetic, true);
  }
  // Every type, because the flag is set in one shared place and a type that
  // built its own object would silently opt itself back in.
  for (const type of ['gift', 'follow', 'like', 'join', 'subscribe'] as const) {
    check(`${type} is synthetic too`, createTestEvent(spec({ type })).synthetic, true);
  }
}

console.log('\nroles arrive at the gate exactly as asked for');
{
  const session = new SessionState();
  const allows = (gate: GateConfig, event: StreamEvent): boolean =>
    checkGate(gate, userOf(event), session).allowed;

  // The old generator set isFollower unconditionally and rolled isSubscriber
  // on a 30% chance, so a gated rule appeared to work or not work depending
  // on the dice.
  const stranger = createTestEvent(spec());
  check('a stranger follows nobody', userOf(stranger).isFollower, false);
  check('and subscribes to nothing', userOf(stranger).isSubscriber, false);
  check('and is refused by a followers gate', allows({ ...OPEN, followersOnly: true }, stranger), false);

  const follower = createTestEvent(spec({ isFollower: true }));
  check('a follower gets through', allows({ ...OPEN, followersOnly: true }, follower), true);
  check('but not a subscribers gate', allows({ ...OPEN, subscribersOnly: true }, follower), false);

  const sub = createTestEvent(spec({ isSubscriber: true }));
  check('a subscriber gets through', allows({ ...OPEN, subscribersOnly: true }, sub), true);

  const mod = createTestEvent(spec({ isModerator: true }));
  check('a moderator clears the social gates', allows({ ...OPEN, followersOnly: true }, mod), true);

  const host = createTestEvent(spec({ isHost: true }));
  check('the host clears everything', allows({ ...OPEN, moderatorsOnly: true }, host), true);
}

console.log('\nthe personas mean what they say');
{
  const session = new SessionState();
  for (const persona of TEST_PERSONAS) {
    const event = createTestEvent(spec({ ...persona.roles }));
    const user = userOf(event);
    const asked = persona.roles as Record<string, boolean | undefined>;
    const matches = Object.entries(asked).every(
      ([key, value]) => (user as unknown as Record<string, unknown>)[key] === value,
    );
    check(`${persona.label} arrives as described`, matches, true);
  }

  // A mutual must also read as a follower: no platform reports someone who is
  // mutual but not following, so spoofing one would test an impossible state.
  const mutual = createTestEvent(spec({ isFriend: true, isFollower: true }));
  check('a mutual is also a follower', userOf(mutual).isFollower, true);
  check('and clears a followers gate', checkGate({ ...OPEN, followersOnly: true }, userOf(mutual), session).allowed, true);
}

console.log('\nidentity is stable across a burst');
{
  const a = createTestEvent(spec({ username: 'Repeat_Tester' }));
  const b = createTestEvent(spec({ username: 'repeat_tester' }));

  check('the handle is normalized', userOf(a).uniqueId, 'repeat_tester');
  check('case does not create a second person', userOf(a).userId, userOf(b).userId);
  // Per-user cooldowns and session totals key on the id, so a burst that
  // changed identity each time would never trip the thing being tested.
  check('ids are derived from the handle', userOf(a).userId, 'test-repeat_tester');
  check('but each event is its own event', a.id === b.id, false);
}

console.log('\nthe details that get spoofed');
{
  const gift = createTestEvent(spec({ type: 'gift', diamonds: 500, repeatCount: 3 }));
  check('diamond value is honoured', gift.type === 'gift' && gift.diamondCount, 500);
  check('repeat count is honoured', gift.type === 'gift' && gift.repeatCount, 3);
  check('and the total is the product', gift.type === 'gift' && gift.totalDiamonds, 1500);

  const chat = createTestEvent(spec({ text: 'a very specific line' }));
  check('the message is used verbatim', chat.type === 'chat' && chat.text, 'a very specific line');

  const named = createTestEvent(spec({ username: 'someone', displayName: 'Someone Nice' }));
  check('the display name is used', userOf(named).nickname, 'Someone Nice');

  const platform = createTestEvent(spec({ platform: 'twitch', isSubscriber: true }));
  check('the platform is carried', platform.platform, 'twitch');
  check('and badges match the platform', userOf(platform).badges, ['subscriber']);

  const broadcaster = createTestEvent(spec({ platform: 'twitch', isHost: true }));
  check('twitch hosts get the broadcaster badge', userOf(broadcaster).badges, ['broadcaster']);
  const tiktokHost = createTestEvent(spec({ platform: 'tiktok', isHost: true }));
  check('tiktok hosts do not', userOf(tiktokHost).badges, ['host']);
}

console.log('\nrandom fallback still works');
{
  const bare = createTestEvent(spec());
  check('a handle is invented', bare.user !== null && userOf(bare).uniqueId.length > 0, true);
  check('and a message', bare.type === 'chat' && bare.text.length > 0, true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
