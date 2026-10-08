import { listKey, userKey } from '@streaming/shared';
import type { RuleCondition, StreamUser } from '@streaming/shared';
import type { SessionState } from '../state/session.js';

export interface GateResult {
  allowed: boolean;
  /** Which requirement failed, for the dashboard's "why didn't it speak" view. */
  reason: string | null;
}

const ALLOWED: GateResult = { allowed: true, reason: null };

type ViewerCondition = Extract<RuleCondition, { type: 'viewerIs' | 'viewerGifted' | 'followerCount' | 'fansClub' }>;

export function isViewerCondition(condition: RuleCondition): condition is ViewerCondition {
  return (
    condition.type === 'viewerIs' ||
    condition.type === 'viewerGifted' ||
    condition.type === 'followerCount' ||
    condition.type === 'fansClub'
  );
}

/**
 * Decides whether a user clears a rule's viewer conditions.
 *
 * The host always passes, since locking yourself out of your own TTS is never
 * the intent, and anyone on `alwaysAllow` skips the rest. Moderators clear the
 * softer social conditions (follower, mutual, subscriber, follower count, fans
 * club) without extra setup, but not "Viewer is a moderator" or the ones about
 * gifting, which are about what the person has done this session.
 */
export function checkViewer(
  conditions: readonly RuleCondition[],
  alwaysAllow: readonly string[],
  user: StreamUser,
  session: SessionState,
): GateResult {
  if (user.isHost) return ALLOWED;

  const handle = userKey(user);
  if (handle && alwaysAllow.some((entry) => listKey(entry) === handle)) {
    return ALLOWED;
  }

  for (const condition of conditions) {
    if (!isViewerCondition(condition)) continue;
    const failure = failureOf(condition, user, session);
    if (failure) return { allowed: false, reason: failure };
  }
  return ALLOWED;
}

function failureOf(condition: ViewerCondition, user: StreamUser, session: SessionState): string | null {
  switch (condition.type) {
    case 'viewerIs':
      switch (condition.role) {
        case 'moderator':
          return user.isModerator ? null : 'moderators only';
        case 'mutual':
          return user.isModerator || user.isFriend ? null : 'mutual follows only';
        case 'follower':
          return user.isModerator || user.isFollower || user.isFriend ? null : 'followers only';
        case 'subscriber':
          return user.isModerator || user.isSubscriber ? null : 'subscribers only';
        case 'gifter':
          return session.hasGifted(user) ? null : 'gifters only';
      }
      return null;
    case 'fansClub':
      if (condition.level <= 0 || user.isModerator) return null;
      return user.fansClubLevel >= condition.level ? null : `fans club level ${condition.level}+ required`;
    case 'followerCount':
      if (condition.count <= 0 || user.isModerator) return null;
      return user.followerCount >= condition.count ? null : `${condition.count}+ followers required`;
    case 'viewerGifted': {
      if (condition.diamonds <= 0) return null;
      const diamonds = session.sessionDiamonds(user);
      return diamonds >= condition.diamonds
        ? null
        : `${condition.diamonds} diamonds required (has ${diamonds})`;
    }
  }
}
