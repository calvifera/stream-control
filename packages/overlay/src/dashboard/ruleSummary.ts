import {
  PLATFORM_INFO,
  STREAM_EVENT_LABELS,
  type RoleSignal,
  type RuleCondition,
  type RuleConditionType,
  type StreamEventType,
  type TtsRule,
  type ViewerRole,
} from '@streaming/shared';

/**
 * How a rule reads, in the words the dashboard uses everywhere.
 *
 * A rule is a trigger (which events, on which platforms), a list of
 * conditions that all have to be true, and what it says. These helpers turn
 * the conditions into labels, one-line summaries for the rules table, and the
 * sentence at the top of the editor.
 */

/** Plural wording, since "treasure boxs" is what appending an s would say. */
const PLURAL: Partial<Record<StreamEventType, string>> = {
  chat: 'chat messages',
  gift: 'gifts',
  follow: 'new followers',
  share: 'shares',
  like: 'likes',
  join: 'viewers joining',
  subscribe: 'subscriptions',
  envelope: 'treasure boxes',
  question: 'questions',
};

export function joinWords(words: string[], conjunction = 'and'): string {
  if (words.length <= 1) return words.join('');
  if (words.length === 2) return `${words[0]} ${conjunction} ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} ${conjunction} ${words[words.length - 1]}`;
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

export type ConditionGroup = 'Message' | 'Gift' | 'Likes' | 'Viewer';

export const VIEWER_ROLE_LABELS: Record<ViewerRole, string> = {
  follower: 'a follower',
  mutual: 'a mutual follow',
  subscriber: 'a subscriber',
  moderator: 'a moderator',
  gifter: 'someone who has gifted this session',
};

interface ConditionMeta {
  group: ConditionGroup;
  /** The label in the "Add condition" menu. */
  label: string;
  /** Which events the condition says anything about. Viewer conditions apply to all. */
  events: readonly StreamEventType[] | 'any';
}

export const CONDITION_META: Record<RuleConditionType, ConditionMeta> = {
  startsWith: { group: 'Message', label: 'Message starts with…', events: ['chat', 'question'] },
  matches: { group: 'Message', label: 'Message matches a pattern…', events: ['chat', 'question'] },
  minLength: { group: 'Message', label: 'Message is at least… characters', events: ['chat', 'question'] },
  giftValue: { group: 'Gift', label: 'Gift is worth at least… diamonds', events: ['gift'] },
  giftIs: { group: 'Gift', label: 'Gift is one of…', events: ['gift'] },
  likeCount: { group: 'Likes', label: 'Like count is at least…', events: ['like'] },
  viewerIs: { group: 'Viewer', label: 'Viewer is…', events: 'any' },
  viewerGifted: { group: 'Viewer', label: 'Viewer has gifted at least… diamonds', events: 'any' },
  followerCount: { group: 'Viewer', label: 'Viewer has at least… followers', events: 'any' },
  fansClub: { group: 'Viewer', label: 'Viewer is fans club level…', events: 'any' },
};

/** The label on a condition row, where its input sits to the right. */
export const CONDITION_ROW_LABEL: Record<RuleConditionType, string> = {
  startsWith: 'Message starts with',
  matches: 'Message matches',
  minLength: 'Message length at least (characters)',
  giftValue: 'Gift value at least (diamonds)',
  giftIs: 'Gift is one of (one per line)',
  likeCount: 'Like count at least',
  viewerIs: 'Viewer is',
  viewerGifted: 'Viewer has gifted at least (diamonds)',
  followerCount: 'Viewer has at least (followers)',
  fansClub: 'Viewer is fans club level (or higher)',
};

export const CONDITION_ORDER: RuleConditionType[] = [
  'startsWith',
  'matches',
  'minLength',
  'giftValue',
  'giftIs',
  'likeCount',
  'viewerIs',
  'viewerGifted',
  'followerCount',
  'fansClub',
];

/** Does this kind of condition mean anything for the events the rule listens to? */
export function conditionApplies(type: RuleConditionType, rule: Pick<TtsRule, 'eventTypes'>): boolean {
  const { events } = CONDITION_META[type];
  return events === 'any' || rule.eventTypes.some((event) => events.includes(event));
}

let counter = 0;
const conditionId = (): string => `c-${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newCondition(type: RuleConditionType): RuleCondition {
  const id = conditionId();
  switch (type) {
    case 'startsWith':
      return { id, type, text: '!say', strip: true };
    case 'matches':
      return { id, type, pattern: '' };
    case 'minLength':
      return { id, type, chars: 3 };
    case 'giftValue':
      return { id, type, diamonds: 10 };
    case 'giftIs':
      return { id, type, names: [] };
    case 'likeCount':
      return { id, type, count: 50 };
    case 'viewerIs':
      return { id, type, role: 'follower' };
    case 'viewerGifted':
      return { id, type, diamonds: 10 };
    case 'followerCount':
      return { id, type, count: 100 };
    case 'fansClub':
      return { id, type, level: 1 };
  }
}

/** The condition as a short phrase, for the table and the summary sentence. */
export function describeCondition(condition: RuleCondition): string {
  switch (condition.type) {
    case 'startsWith':
      return condition.text.trim() ? `message starts with “${condition.text.trim()}”` : 'message starts with (nothing yet)';
    case 'matches':
      return condition.pattern.trim() ? `message matches /${condition.pattern.trim()}/` : 'message matches (no pattern yet)';
    case 'minLength':
      return `message is at least ${condition.chars} characters`;
    case 'giftValue':
      return `gift is worth ${condition.diamonds}+ diamonds`;
    case 'giftIs':
      return condition.names.length === 0
        ? 'gift is one of (none listed)'
        : condition.names.length <= 2
          ? `gift is ${joinWords(condition.names, 'or')}`
          : `gift is one of ${condition.names.length} named gifts`;
    case 'likeCount':
      return `${condition.count}+ likes`;
    case 'viewerIs':
      return `viewer is ${VIEWER_ROLE_LABELS[condition.role]}`;
    case 'viewerGifted':
      return `viewer has gifted ${condition.diamonds}+ diamonds`;
    case 'followerCount':
      return `viewer has ${condition.count}+ followers`;
    case 'fansClub':
      return `viewer is fans club level ${condition.level}+`;
  }
}

/** Which platform-reach signal a condition depends on, if it has one. */
export function signalOf(condition: RuleCondition): RoleSignal | null {
  switch (condition.type) {
    case 'viewerIs':
      return (
        { follower: 'follower', mutual: 'friend', subscriber: 'subscriber', moderator: 'moderator', gifter: 'gifter' } as const
      )[condition.role];
    case 'followerCount':
      return 'followerCount';
    case 'fansClub':
      return 'fansClubLevel';
    default:
      return null;
  }
}

/** The conditions that apply to what this rule listens to, in order. */
export function activeConditions(rule: TtsRule): RuleCondition[] {
  return rule.conditions.filter((condition) => conditionApplies(condition.type, rule));
}

/* ------------------------------------------------------------------ *
 * Rule summaries
 * ------------------------------------------------------------------ */

export function describeEvents(rule: TtsRule): string {
  if (rule.eventTypes.length === 0) return 'nothing yet';
  return joinWords(rule.eventTypes.map((type) => PLURAL[type] ?? STREAM_EVENT_LABELS[type].toLowerCase()));
}

export function eventsLabel(rule: TtsRule): string {
  return rule.eventTypes.length === 0
    ? 'No events'
    : rule.eventTypes.map((type) => STREAM_EVENT_LABELS[type]).join(', ');
}

export function platformsLabel(rule: TtsRule): string {
  return rule.platforms.length === 0
    ? 'All platforms'
    : rule.platforms.map((platform) => PLATFORM_INFO[platform].label).join(', ');
}

export function describePlatforms(rule: TtsRule): string {
  return rule.platforms.length === 0
    ? 'every connected platform'
    : joinWords(rule.platforms.map((platform) => PLATFORM_INFO[platform].label));
}

/** One sentence: the whole rule, said back. */
export function describeRule(rule: TtsRule, voiceLabel: string): string {
  const conditions = activeConditions(rule).map(describeCondition);
  const when = `When ${describeEvents(rule)} arrive on ${describePlatforms(rule)}`;
  const only = conditions.length > 0 ? `, and ${joinWords(conditions)}` : '';
  const voice = rule.voice === 'random' ? 'a random voice from its pool' : `the voice “${voiceLabel}”`;
  return `${when}${only}, speak the text in ${voice}.`;
}

/** The table's Conditions cell: the first one, and how many more. */
export function conditionsBrief(rule: TtsRule): { first: string; more: number } | null {
  const conditions = activeConditions(rule);
  if (conditions.length === 0) return null;
  const first = describeCondition(conditions[0] as RuleCondition);
  return { first: first.charAt(0).toUpperCase() + first.slice(1), more: conditions.length - 1 };
}
