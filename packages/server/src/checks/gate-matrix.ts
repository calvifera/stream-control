/**
 * Who actually clears a gate, per platform.
 *   npm run probe:gates -w @streaming/server
 *
 * Exists because a gate can be silently unsatisfiable on one platform while
 * working perfectly on another. "Followers only" is the case that prompted
 * this: Twitch's IRC tags carry no follow relationship, so `isFollower` is
 * always false there and the gate rejects every ordinary viewer — for ever,
 * with no error and no log line. The rule looks enabled and does nothing.
 *
 * Printing the matrix is the cheapest way to see that before a stream rather
 * than during one.
 */
import { checkGate } from '../pipeline/gates.js';
import { SessionState } from '../state/session.js';
import { PLATFORM_INFO, type GateConfig, type Platform, type StreamUser } from '@streaming/shared';

const OPEN_GATE: GateConfig = {
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

const person = (platform: Platform, over: Partial<StreamUser>): StreamUser => ({
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

/**
 * What each platform can actually tell us about a viewer.
 *
 * TikTok reports a follow relationship on every event; Twitch reports none
 * over IRC; YouTube reports channel membership but not following. A role a
 * platform cannot report is not a role that is false — it is one nobody knows,
 * and a gate keyed on it can never pass there.
 */
const CAST: Record<Platform, Array<{ label: string; user: StreamUser }>> = {
  tiktok: [
    { label: 'you, the host', user: person('tiktok', { isHost: true }) },
    { label: 'a moderator', user: person('tiktok', { isModerator: true }) },
    { label: 'a mutual ("friend")', user: person('tiktok', { isFriend: true, isFollower: true }) },
    { label: 'a follower', user: person('tiktok', { isFollower: true, followRole: 1 }) },
    { label: 'a subscriber', user: person('tiktok', { isSubscriber: true }) },
    { label: 'a stranger', user: person('tiktok', {}) },
  ],
  twitch: [
    { label: 'you, the broadcaster', user: person('twitch', { isHost: true, badges: ['broadcaster'] }) },
    { label: 'a moderator', user: person('twitch', { isModerator: true, badges: ['moderator'] }) },
    { label: 'a VIP', user: person('twitch', { badges: ['vip'] }) },
    { label: 'a subscriber', user: person('twitch', { isSubscriber: true, badges: ['subscriber'] }) },
    { label: 'a follower (unknowable over IRC)', user: person('twitch', {}) },
    { label: 'a stranger', user: person('twitch', {}) },
  ],
  youtube: [
    { label: 'you, the owner', user: person('youtube', { isHost: true }) },
    { label: 'a moderator', user: person('youtube', { isModerator: true }) },
    { label: 'a member', user: person('youtube', { isSubscriber: true }) },
    { label: 'a stranger', user: person('youtube', {}) },
  ],
};

const GATES: Array<{ label: string; gate: GateConfig }> = [
  { label: 'no gate', gate: OPEN_GATE },
  { label: 'followers only', gate: { ...OPEN_GATE, followersOnly: true } },
  { label: 'mutuals only', gate: { ...OPEN_GATE, friendsOnly: true } },
  { label: 'subscribers only', gate: { ...OPEN_GATE, subscribersOnly: true } },
  { label: 'moderators only', gate: { ...OPEN_GATE, moderatorsOnly: true } },
];

const session = new SessionState();

for (const [platform, cast] of Object.entries(CAST) as Array<[Platform, typeof CAST.tiktok]>) {
  console.log(`\n${PLATFORM_INFO[platform].label}`);
  for (const { label, gate } of GATES) {
    const passes = cast.filter(({ user }) => checkGate(gate, user, session).allowed);
    const summary =
      passes.length === 0
        ? 'NOBODY — this gate can never pass here'
        : passes.map((p) => p.label).join(', ');
    console.log(`  ${label.padEnd(18)} ${summary}`);
  }
}
console.log('');
