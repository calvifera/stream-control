/**
 * Verifies the account-wide per-user cooldown.
 *   npm run check:cooldown -w @streaming/server
 *
 * This exists because the setting was already wired through types, schema,
 * defaults and the rule engine's *check* — but nothing ever recorded that a
 * user had spoken, so `isCooling` looked at a key no one ever wrote and the
 * cooldown silently never fired. A config field that reads back correctly and
 * does nothing is worse than a missing one, so the behaviour is asserted here.
 */
import { createDefaultConfig, DEFAULT_GATE } from '@streaming/shared';
import type { StreamEvent, StreamUser, TtsConfig, UsersConfig } from '@streaming/shared';
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

function userNamed(uniqueId: string): StreamUser {
  return {
    platform: 'tiktok',
    userId: `id-${uniqueId}`,
    uniqueId,
    nickname: uniqueId,
    avatarUrl: null,
    followRole: 1,
    isFollower: true,
    isFriend: false,
    isSubscriber: false,
    isModerator: false,
    isHost: false,
    isVerified: false,
    followerCount: 10,
    fansClubLevel: 0,
    badges: [],
  } as StreamUser;
}

function chatFrom(uniqueId: string, text: string): StreamEvent {
  return {
    id: `${uniqueId}-${Math.random()}`,
    type: 'chat',
    ts: Date.now(),
    text,
    displayText: text,
    filtered: false,
    filterReason: null,
    user: userNamed(uniqueId),
  } as unknown as StreamEvent;
}

/** Two permissive rules, so only the cooldown can reject. */
function ttsConfig(userCooldownSeconds: number): TtsConfig {
  const rule = (id: string) => ({
    ...BASE.tts.rules[0]!,
    id,
    enabled: true,
    eventTypes: ['chat' as const],
    template: '{{message}}',
    cooldownSeconds: 0,
    gate: { ...DEFAULT_GATE },
    conditions: { ...BASE.tts.rules[0]!.conditions, minLength: 0 },
  });

  return { ...BASE.tts, userCooldownSeconds, rules: [rule('r1'), rule('r2')] };
}

const users = (trusted: string[] = []): UsersConfig => ({ ...BASE.users, trusted });

function main(): void {
  console.log('per-user cooldown');

  {
    const engine = new RuleEngine();
    const session = new SessionState();
    const config = ttsConfig(0);
    const first = engine.evaluate(chatFrom('alice', 'one'), config, session, users());
    const second = engine.evaluate(chatFrom('alice', 'two'), config, session, users());
    check(
      '0 disables it — back-to-back messages both speak',
      first.matches.length > 0 && second.matches.length > 0,
      `${first.matches.length} then ${second.matches.length} matches`,
    );
  }

  {
    const engine = new RuleEngine();
    const session = new SessionState();
    const config = ttsConfig(30);

    const first = engine.evaluate(chatFrom('alice', 'one'), config, session, users());
    check('the first message speaks', first.matches.length > 0, `${first.matches.length} matches`);
    check(
      'one event still fires every rule it matches',
      first.matches.length === 2,
      `${first.matches.length} rules fired`,
    );

    const second = engine.evaluate(chatFrom('alice', 'two'), config, session, users());
    check('the next message is blocked', second.matches.length === 0, `${second.matches.length} matches`);
    check(
      'and the log says why',
      second.rejections.some((r) => r.ruleId === 'user-cooldown'),
      JSON.stringify(second.rejections.map((r) => r.reason)),
    );

    const other = engine.evaluate(chatFrom('bob', 'hello'), config, session, users());
    check('a different user is unaffected', other.matches.length > 0, `${other.matches.length} matches`);
  }

  {
    const engine = new RuleEngine();
    const session = new SessionState();
    const config = ttsConfig(30);
    engine.evaluate(chatFrom('alice', 'one'), config, session, users(['alice']));
    const second = engine.evaluate(chatFrom('alice', 'two'), config, session, users(['alice']));
    check('trusted users are exempt', second.matches.length > 0, `${second.matches.length} matches`);
  }

  {
    const engine = new RuleEngine();
    const session = new SessionState();
    const config = ttsConfig(1);
    engine.evaluate(chatFrom('alice', 'one'), config, session, users());
    const blocked = engine.evaluate(chatFrom('alice', 'two'), config, session, users());
    check('still cooling immediately after', blocked.matches.length === 0);

    // The engine reads Date.now() itself, so the window has to really elapse.
    const start = Date.now();
    while (Date.now() - start < 1100) {
      /* busy-wait */
    }
    const after = engine.evaluate(chatFrom('alice', 'three'), config, session, users());
    check('speaks again once the window passes', after.matches.length > 0, `${after.matches.length} matches`);
  }

  {
    // A blocked event must not start the clock again, or a chatty viewer would
    // never get out of the cooldown.
    const engine = new RuleEngine();
    const session = new SessionState();
    const config = ttsConfig(1);
    engine.evaluate(chatFrom('alice', 'one'), config, session, users());
    const start = Date.now();
    while (Date.now() - start < 600) {
      /* half the window */
    }
    engine.evaluate(chatFrom('alice', 'blocked'), config, session, users());
    const start2 = Date.now();
    while (Date.now() - start2 < 600) {
      /* past the original window */
    }
    const after = engine.evaluate(chatFrom('alice', 'free'), config, session, users());
    check('a blocked message does not extend the cooldown', after.matches.length > 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
