/**
 * Verifies the rule model: old saved rules migrate to the same behaviour, the
 * engine reads the new condition list, and allow-list mode speaks for nobody
 * else.
 *   npm run check:rules-model -w @streaming/server
 */
import { createDefaultConfig } from '@streaming/shared';
import type { StreamEvent, StreamUser, TtsConfig, UsersConfig } from '@streaming/shared';
import { migrateLegacyRule, ttsRuleSchema } from '../config/schema.js';
import { createTestEvent } from '../testEvents.js';
import { RuleEngine } from '../pipeline/rules.js';
import { SessionState } from '../state/session.js';

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

const BASE = createDefaultConfig();

const user = (uniqueId: string, over: Partial<StreamUser> = {}): StreamUser =>
  ({
    platform: 'tiktok',
    userId: `id-${uniqueId}`,
    uniqueId,
    nickname: uniqueId,
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
  }) as StreamUser;

const chat = (who: StreamUser, text: string): StreamEvent =>
  ({
    id: `${who.uniqueId}-${Math.random()}`,
    type: 'chat',
    platform: who.platform,
    ts: Date.now(),
    text,
    displayText: text,
    filtered: false,
    filterReason: null,
    user: who,
  }) as unknown as StreamEvent;

const gift = (who: StreamUser, name: string, diamonds: number): StreamEvent => {
  const base = createTestEvent({ type: 'gift', platform: 'tiktok' }) as unknown as Record<string, unknown>;
  return { ...base, user: who, giftName: name, totalDiamonds: diamonds, streakable: false, repeatEnd: true } as unknown as StreamEvent;
};

const legacyGate = {
  followersOnly: true,
  friendsOnly: false,
  subscribersOnly: false,
  moderatorsOnly: false,
  giftersOnly: false,
  minSessionDiamonds: 5,
  minFollowerCount: 0,
  minFansClubLevel: 0,
  allowUsers: ['@vip'],
};
const legacyConditions = {
  requirePrefix: '!say',
  stripPrefix: true,
  matchRegex: '',
  minLength: 1,
  minDiamonds: 0,
  giftNames: [] as string[],
  minLikeCount: 0,
};
const legacy = {
  id: 'old',
  name: 'Old rule',
  enabled: true,
  eventTypes: ['chat'],
  template: '{{message}}',
  voice: 'en_us_002',
  voicePool: [],
  priority: 0,
  cooldownSeconds: 0,
  maxChars: 100,
  volume: 1,
  rate: 1,
  gate: legacyGate,
  conditions: legacyConditions,
};

const config = (rules: unknown[], extra: Partial<TtsConfig> = {}): TtsConfig => ({
  ...BASE.tts,
  rules: rules.map((rule) => ttsRuleSchema.parse(rule)) as TtsConfig['rules'],
  ...extra,
});
const users = (trusted: string[] = []): UsersConfig => ({ ...BASE.users, trusted });

console.log('migrating a rule saved in the old shape');
{
  const migrated = ttsRuleSchema.parse(legacy);
  const types = migrated.conditions.map((c) => c.type).join(',');
  check('every switch that was on becomes a condition', types === 'startsWith,viewerIs,viewerGifted', types);
  check('a minimum length of 1 is not carried over', !types.includes('minLength'));
  check('the allow list moves to the rule', migrated.alwaysAllow.length === 1);
  check('the old objects are gone', !('gate' in migrated));
  check('a rule already in the new shape passes through untouched', migrateLegacyRule(migrated) === migrated);
}

console.log('\nthe engine reads the condition list');
{
  const engine = new RuleEngine();
  const follower = user('fan', { isFollower: true });
  const plain = { ...legacy, gate: { ...legacyGate, minSessionDiamonds: 0 } };
  const cfg = config([plain]);

  const noPrefix = engine.evaluate(chat(follower, 'hello'), cfg, new SessionState(), users());
  check('without the prefix nothing speaks', noPrefix.matches.length === 0);

  const said = engine.evaluate(chat(follower, '!say hi there'), cfg, new SessionState(), users());
  check('with the prefix it speaks, prefix stripped', said.matches[0]?.text === 'hi there', said.matches[0]?.text);

  const stranger = engine.evaluate(chat(user('rando'), '!say hi there'), cfg, new SessionState(), users());
  check('a viewer who is not a follower is refused', stranger.matches.length === 0);
  check('and the log says why', stranger.rejections[0]?.reason === 'followers only', stranger.rejections[0]?.reason);

  const vip = engine.evaluate(chat(user('vip'), '!say hi there'), cfg, new SessionState(), users());
  check('the rule always-allow list skips the viewer conditions', vip.matches.length === 1);

  const diamondRule = config([legacy]);
  const broke = engine.evaluate(chat(follower, '!say hi there'), diamondRule, new SessionState(), users());
  check('a viewer short of the session diamonds is refused', broke.matches.length === 0, broke.rejections[0]?.reason);

  const giftRule = {
    ...legacy,
    id: 'gift',
    eventTypes: ['gift'],
    template: '{{nickname}} sent {{gift}}',
    gate: { ...legacyGate, followersOnly: false, minSessionDiamonds: 0, allowUsers: [] },
    conditions: { ...legacyConditions, requirePrefix: '', minDiamonds: 50, giftNames: ['Rose'] },
  };
  const gcfg = config([giftRule]);
  const small = engine.evaluate(gift(follower, 'Rose', 1), gcfg, new SessionState(), users());
  check('a gift worth less than the condition is refused', small.matches.length === 0);
  const wrong = engine.evaluate(gift(follower, 'Galaxy', 500), gcfg, new SessionState(), users());
  check('a gift not on the list is refused', wrong.matches.length === 0);
  const right = engine.evaluate(gift(follower, 'Rose', 60), gcfg, new SessionState(), users());
  check('the right gift speaks', right.matches.length === 1);
}

console.log('\nallow-list mode');
{
  const open = {
    ...legacy,
    gate: { ...legacyGate, followersOnly: false, minSessionDiamonds: 0, allowUsers: [] },
    conditions: { ...legacyConditions, requirePrefix: '' },
  };
  const cfg = config([open], { onlyAllowList: true });
  const engine = new RuleEngine();

  const stranger = engine.evaluate(chat(user('rando'), 'hello'), cfg, new SessionState(), users(['friend']));
  check('someone not on the list is dropped', stranger.matches.length === 0);
  check('with one clear reason', stranger.rejections.length === 1 && stranger.rejections[0]?.ruleId === 'allow-list');

  const friend = engine.evaluate(chat(user('friend'), 'hello'), cfg, new SessionState(), users(['friend']));
  check('someone on the list speaks', friend.matches.length === 1);

  const host = engine.evaluate(chat(user('me', { isHost: true }), 'hello'), cfg, new SessionState(), users(['friend']));
  check('the host always does', host.matches.length === 1);

  const off = engine.evaluate(
    chat(user('rando'), 'hello'),
    { ...cfg, onlyAllowList: false },
    new SessionState(),
    users(['friend']),
  );
  check('and with the switch off everyone does again', off.matches.length === 1);

  const withProfile = {
    ...users(['friend']),
    voiceProfiles: [
      {
        username: 'tiktok:friend',
        displayName: 'friend',
        note: '',
        provider: '',
        settings: { '*': { voice: 'en_us_rocket', rate: 1, pitch: 1, volume: 1 } },
      },
    ],
  } as UsersConfig;
  const profiled = engine.evaluate(chat(user('friend'), 'hello'), cfg, new SessionState(), withProfile);
  check('a listed viewer still gets their own voice settings', profiled.matches[0]?.voice === 'en_us_rocket', profiled.matches[0]?.voice);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
