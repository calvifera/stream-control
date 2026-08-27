/**
 * Making notable viewers look notable.
 *
 * The hashed palette in `palette.ts` answers "who is this, and where are they
 * from". It deliberately cannot answer "does this person matter to me right
 * now" — every viewer gets an equally pretty colour, which is exactly right
 * for telling four hundred strangers apart and exactly wrong for spotting the
 * one who just dropped a five-thousand-diamond gift.
 *
 * A highlight is the second channel. Where the palette is a flat colour, a
 * highlight is an animated gradient, and motion in peripheral vision is the
 * one thing that reliably pulls attention off a game. That is a budget, not a
 * decoration: if a third of chat is animated then nothing is, so the defaults
 * are set where they catch a handful of people per stream rather than a third
 * of the room.
 */

import type { Platform } from './platforms.js';

/**
 * What makes someone notable.
 *
 * `given` is the only one with a number attached, and it is the interesting
 * one: subscriber and moderator are binary facts the platform hands over,
 * whereas "has given enough to stand out" is a judgement that differs per
 * stream and per platform. TikTok diamonds, Twitch bits and YouTube Super
 * Chats are all different units, which is why the threshold lives on the tier
 * and not in one global setting.
 */
export const HIGHLIGHT_CONDITIONS = ['given', 'subscriber', 'moderator', 'host'] as const;
export type HighlightCondition = (typeof HIGHLIGHT_CONDITIONS)[number];

/**
 * Whether a `given` threshold counts this stream or all time.
 *
 * Both are worth having and they say different things. `session` is "notable
 * right now", and resets when the stream does. `lifetime` is "notable to me",
 * and keeps a long-standing supporter marked on a night they happen to be
 * quiet — without it, the person who has given you the most all year looks
 * exactly like a stranger the moment they stop paying.
 */
export const HIGHLIGHT_SCOPES = ['session', 'lifetime'] as const;
export type HighlightScope = (typeof HIGHLIGHT_SCOPES)[number];

export interface HighlightTier {
  id: string;
  /** Shown in the dashboard, and as the tooltip on a highlighted name. */
  label: string;
  enabled: boolean;
  /** Which platforms it applies to. Empty means all of them. */
  platforms: Platform[];
  condition: HighlightCondition;
  /** For `given`: how much, in that platform's own units. Ignored otherwise. */
  threshold: number;
  scope: HighlightScope;
  /**
   * Gradient stops. Two or more; the first is repeated at the end when
   * animating so the loop has no visible seam.
   */
  colors: string[];
  /**
   * Seconds for one full sweep. 0 holds the gradient still.
   *
   * Under about 2s it reads as flickering rather than moving, and stops being
   * something you can look away from — which for a name that sits on screen
   * for a minute is closer to a hazard than a highlight.
   */
  speed: number;
  /** Higher wins when more than one tier matches. */
  priority: number;
}

/**
 * What a highlight needs to know about a viewer.
 *
 * Deliberately not `StreamUser`: the giving totals are not properties of a
 * person, they are running totals the server keeps, and folding them into the
 * user record would mean every stored copy of a viewer carried a number that
 * was only true at the instant it was written.
 */
export interface HighlightSubject {
  platform: Platform;
  isSubscriber: boolean;
  isModerator: boolean;
  isHost: boolean;
  /** Given during this stream, in the platform's own units. */
  sessionGiven: number;
  /** Given across every stream. */
  lifetimeGiven: number;
}

/** Does this viewer satisfy this tier? */
export function matchesTier(tier: HighlightTier, subject: HighlightSubject): boolean {
  if (!tier.enabled) return false;
  if (tier.platforms.length > 0 && !tier.platforms.includes(subject.platform)) return false;

  switch (tier.condition) {
    case 'subscriber':
      return subject.isSubscriber;
    case 'moderator':
      return subject.isModerator;
    case 'host':
      return subject.isHost;
    case 'given': {
      const given = tier.scope === 'lifetime' ? subject.lifetimeGiven : subject.sessionGiven;
      // A zero threshold would mark every viewer who has never given anything,
      // which is the whole room. Treated as "at least one" so a tier that has
      // not been configured yet fails safe towards marking too few people
      // rather than all of them.
      return given >= Math.max(1, tier.threshold);
    }
    default:
      return false;
  }
}

/**
 * The tier a viewer gets, or null.
 *
 * Ties break on priority, then on threshold, then on list order — so a
 * hundred-diamond tier and a five-thousand-diamond tier at the same priority
 * resolve to the five-thousand one without the streamer having to know that
 * ordering mattered.
 */
export function tierFor(
  tiers: readonly HighlightTier[],
  subject: HighlightSubject,
): HighlightTier | null {
  let best: HighlightTier | null = null;
  for (const tier of tiers) {
    if (!matchesTier(tier, subject)) continue;
    if (
      best === null ||
      tier.priority > best.priority ||
      (tier.priority === best.priority && tier.threshold > best.threshold)
    ) {
      best = tier;
    }
  }
  return best;
}

/**
 * The CSS for a tier's gradient text.
 *
 * `background-clip: text` with a transparent fill is the only way to get a
 * gradient into glyphs; the animation then slides the background rather than
 * recolouring anything, so it costs a compositor property and not a repaint.
 *
 * The stops are repeated so the sweep wraps seamlessly: a gradient that runs
 * red-to-blue and then jumps back to red flashes once per cycle, which is far
 * more distracting than the motion it is supposed to be carrying.
 */
export function tierStyle(tier: HighlightTier): Record<string, string> {
  const stops = tier.colors.length >= 2 ? tier.colors : [...tier.colors, ...tier.colors];
  const loop = [...stops, stops[0] as string];

  const style: Record<string, string> = {
    backgroundImage: `linear-gradient(90deg, ${loop.join(', ')})`,
    backgroundSize: '300% 100%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    // Without this the gradient is clipped to the glyphs of *this* element
    // only, and any descendant re-establishes its own background box.
    WebkitTextFillColor: 'transparent',
  };

  if (tier.speed > 0) {
    style.animation = `highlight-sweep ${tier.speed}s linear infinite`;
  }
  return style;
}

/** Fallback when a tier has been deleted but an old event still names it. */
export function findTier(
  tiers: readonly HighlightTier[],
  id: string | null | undefined,
): HighlightTier | null {
  if (!id) return null;
  return tiers.find((tier) => tier.id === id) ?? null;
}
