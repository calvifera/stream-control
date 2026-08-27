/**
 * Role and gate-reach checks.
 *
 * The bug behind these: a rule gated on "followers only" works on TikTok and
 * silently never fires on Twitch, because Twitch's chat connection carries no
 * follow relationship. Nothing errors and nothing is logged — and testing from
 * your own account hides it completely, because the host bypasses every gate.
 *
 * So there are two things to pin down. What each platform can actually report,
 * and who still gets through when it can't.
 */
import { checkGate } from '../pipeline/gates.js';
import { SessionState } from '../state/session.js';
import {
  gateWarning,
  platformsMissing,
  roleLabel,
  ROLE_SIGNALS,
  PLATFORM_ROLES,
  PLATFORMS,
  type GateConfig,
  type Platform,
  type StreamUser,
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

const person = (platform: Platform, over: Partial<StreamUser> = {}): StreamUser => ({
  platform,
  userId: '1',
  uniqueId: 'someone',
  nickname: 'Someone',
  avatarUrl: null,
  followRole: 0,
  isFollower: false,
  isFriend: false,
  isSubscriber: false,
  isModerator: false,
  isHost: false,
  isVerified: false,
  followerCount: 0,
  fansClubLevel: 0,
  badges: [],
  ...over,
});

const session = new SessionState();
const allows = (gate: GateConfig, user: StreamUser): boolean =>
  checkGate(gate, user, session).allowed;

console.log('\nRoles and gate reach\n');

console.log('every platform declares every signal');
{
  for (const platform of PLATFORMS) {
    const declared = ROLE_SIGNALS.every((signal) => typeof PLATFORM_ROLES[platform][signal] === 'boolean');
    check(`${platform} covers all signals`, declared, true);
  }
}

console.log('\nwhat the declarations say');
{
  check('tiktok reports following', PLATFORM_ROLES.tiktok.follower, true);
  // The one that started all this.
  check('twitch does not', PLATFORM_ROLES.twitch.follower, false);
  check('twitch has no concept of mutuals at all', PLATFORM_ROLES.twitch.friend, false);
  check('but twitch does report subscribers', PLATFORM_ROLES.twitch.subscriber, true);
  check('and moderators', PLATFORM_ROLES.twitch.moderator, true);
  check('youtube reports membership', PLATFORM_ROLES.youtube.subscriber, true);
  check('youtube does not report following', PLATFORM_ROLES.youtube.follower, false);
}

console.log('\nthe declarations match what the gate actually does');
{
  // This is the check that matters: if the table ever drifts from the gate's
  // real behaviour, the warnings become lies and are worse than nothing.
  for (const platform of PLATFORMS) {
    const viewer = person(platform, { isFollower: false });
    const gated = allows({ ...OPEN, followersOnly: true }, viewer);
    const reported = PLATFORM_ROLES[platform].follower;
    // A platform that cannot report following must reject an ordinary viewer.
    check(
      `${platform}: an ordinary viewer is ${reported ? 'checkable' : 'always rejected'}`,
      gated,
      false,
    );
  }
}

console.log('\nwho still gets through an unsatisfiable gate');
{
  const followersOnly: GateConfig = { ...OPEN, followersOnly: true };

  check('you always do', allows(followersOnly, person('twitch', { isHost: true })), true);
  check('your moderators do', allows(followersOnly, person('twitch', { isModerator: true })), true);
  check('an ordinary viewer does not', allows(followersOnly, person('twitch')), false);
  // Subscribing does not make you a follower as far as the gate is concerned,
  // even though on Twitch you must follow to subscribe.
  check('nor does a subscriber', allows(followersOnly, person('twitch', { isSubscriber: true })), false);

  // Which is why testing from your own account proves nothing.
  check(
    'the host passing is exactly what hid this',
    allows(followersOnly, person('twitch', { isHost: true, uniqueId: 'thehost' })),
    true,
  );
}

console.log('\nsubscriber gates do work on twitch');
{
  const subsOnly: GateConfig = { ...OPEN, subscribersOnly: true };
  check('a subscriber gets through', allows(subsOnly, person('twitch', { isSubscriber: true })), true);
  check('a non-subscriber does not', allows(subsOnly, person('twitch')), false);
  check('nothing is flagged as unreachable', platformsMissing('subscriber', ['twitch']), []);
}

console.log('\nwarnings name the right platforms');
{
  check('twitch is flagged for followers', platformsMissing('follower', ['twitch']), ['twitch']);
  check('tiktok is not', platformsMissing('follower', ['tiktok']), []);
  check(
    'an empty platform list means all of them',
    platformsMissing('follower', []),
    ['youtube', 'twitch'],
  );
  // Stable regardless of the order the caller listed them, so the sentence
  // built from this never rearranges itself between renders.
  check(
    'order follows PLATFORMS, not the caller',
    platformsMissing('follower', ['twitch', 'youtube']),
    platformsMissing('follower', ['youtube', 'twitch']),
  );
  check('a satisfiable gate produces no warning', gateWarning('subscriber', ['twitch']), null);

  const warning = gateWarning('follower', ['twitch']) ?? '';
  check('the warning names the platform', warning.includes('Twitch'), true);
  // It must not claim nothing will match — the host and mods still pass, and
  // an overstated warning gets disproved and then ignored.
  check('and does not overstate it', warning.includes('only you and your moderators get through'), true);

  const both = gateWarning('follower', ['twitch', 'youtube']) ?? '';
  check('two platforms read naturally', both.includes('YouTube and Twitch'), true);
  check(
    'and read the same whichever order they were given',
    gateWarning('follower', ['youtube', 'twitch']),
    both,
  );
}

console.log('\nplatform-specific naming');
{
  // A YouTube "subscriber" is free and means what TikTok calls a follower;
  // the paid tier is a member. One word for both is how a gate ends up
  // meaning the opposite of what was intended.
  check('youtube subscribers are called members', roleLabel('subscriber', 'youtube'), 'Member (paid)');
  check('twitch hosts are broadcasters', roleLabel('host', 'twitch'), 'Broadcaster');
  check('the generic label still works', roleLabel('host'), 'Host');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
