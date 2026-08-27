import { listKey, userKey } from '@streaming/shared';
import type { GateConfig, StreamUser } from '@streaming/shared';
import type { SessionState } from '../state/session.js';

export interface GateResult {
  allowed: boolean;
  /** Which requirement failed, for the dashboard's "why didn't it speak" view. */
  reason: string | null;
}

const ALLOWED: GateResult = { allowed: true, reason: null };

const normalizeHandle = (value: string): string => value.trim().toLowerCase().replace(/^@/, '');

/**
 * Decides whether a user clears a rule's requirements.
 *
 * The host and moderators always pass — locking yourself out of your own
 * TTS is never the intent — and anyone on `allowUsers` bypasses the rest.
 */
export function checkGate(gate: GateConfig, user: StreamUser, session: SessionState): GateResult {
  if (user.isHost) return ALLOWED;

  const handle = userKey(user);
  if (handle && gate.allowUsers.some((entry) => listKey(entry) === handle)) {
    return ALLOWED;
  }

  if (gate.moderatorsOnly && !user.isModerator) {
    return { allowed: false, reason: 'moderators only' };
  }

  // Moderators clear the softer social gates below without extra config.
  if (!user.isModerator) {
    if (gate.friendsOnly && !user.isFriend) {
      return { allowed: false, reason: 'mutual follows only' };
    }
    if (gate.followersOnly && !user.isFollower && !user.isFriend) {
      return { allowed: false, reason: 'followers only' };
    }
    if (gate.subscribersOnly && !user.isSubscriber) {
      return { allowed: false, reason: 'subscribers only' };
    }
    if (gate.minFansClubLevel > 0 && user.fansClubLevel < gate.minFansClubLevel) {
      return { allowed: false, reason: `fans club level ${gate.minFansClubLevel}+ required` };
    }
    if (gate.minFollowerCount > 0 && user.followerCount < gate.minFollowerCount) {
      return { allowed: false, reason: `${gate.minFollowerCount}+ followers required` };
    }
  }

  if (gate.giftersOnly && !session.hasGifted(user)) {
    return { allowed: false, reason: 'gifters only' };
  }

  if (gate.minSessionDiamonds > 0) {
    const diamonds = session.sessionDiamonds(user);
    if (diamonds < gate.minSessionDiamonds) {
      return {
        allowed: false,
        reason: `${gate.minSessionDiamonds} diamonds required (has ${diamonds})`,
      };
    }
  }

  return ALLOWED;
}
