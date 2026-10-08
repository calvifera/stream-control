import type { RuleCondition, StreamUser } from '@streaming/shared';
import { checkViewer, type GateResult } from '../pipeline/gates.js';
import type { SessionState } from '../state/session.js';

/**
 * The switch-per-requirement shape rules used to be saved in, kept for the
 * checks that read most clearly as "followers only on Twitch". Each switch is
 * turned into the condition the rule engine now uses, so these still exercise
 * the real viewer check.
 */
export interface GateConfig {
  followersOnly: boolean;
  friendsOnly: boolean;
  subscribersOnly: boolean;
  moderatorsOnly: boolean;
  giftersOnly: boolean;
  minSessionDiamonds: number;
  minFollowerCount: number;
  minFansClubLevel: number;
  allowUsers: string[];
}

export const OPEN_GATE: GateConfig = {
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

export function conditionsFor(gate: GateConfig): RuleCondition[] {
  const out: RuleCondition[] = [];
  const role = (r: 'moderator' | 'mutual' | 'follower' | 'subscriber' | 'gifter'): void => {
    out.push({ id: `c-${r}`, type: 'viewerIs', role: r });
  };
  if (gate.moderatorsOnly) role('moderator');
  if (gate.friendsOnly) role('mutual');
  if (gate.followersOnly) role('follower');
  if (gate.subscribersOnly) role('subscriber');
  if (gate.giftersOnly) role('gifter');
  if (gate.minSessionDiamonds > 0) out.push({ id: 'c-diamonds', type: 'viewerGifted', diamonds: gate.minSessionDiamonds });
  if (gate.minFollowerCount > 0) out.push({ id: 'c-count', type: 'followerCount', count: gate.minFollowerCount });
  if (gate.minFansClubLevel > 0) out.push({ id: 'c-club', type: 'fansClub', level: gate.minFansClubLevel });
  return out;
}

export function checkGate(gate: GateConfig, user: StreamUser, session: SessionState): GateResult {
  return checkViewer(conditionsFor(gate), gate.allowUsers, user, session);
}
