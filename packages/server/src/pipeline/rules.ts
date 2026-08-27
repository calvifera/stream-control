import { listKey, userKey } from '@streaming/shared';
import {
  buildTemplateVars,
  renderTemplate,
  type StreamEvent,
  settingsFor,
  type TtsConfig,
  type TtsProvider,
  type TtsRule,
  type UsersConfig,
  type UserVoiceProfile,
} from '@streaming/shared';
import type { SessionState } from '../state/session.js';
import { checkGate } from './gates.js';
import { createLogger } from '../logger.js';

const log = createLogger('rules');

export interface RuleMatch {
  rule: TtsRule;
  /** Final text to speak, after templating, prefix stripping and clamping. */
  text: string;
  voice: string;
  /** Rule values with the speaker's personal voice profile applied. */
  rate: number;
  pitch: number;
  volume: number;
  /** Set when the speaker has their own backend; null follows the global one. */
  provider: TtsProvider | null;
}

export interface RuleRejection {
  ruleId: string;
  ruleName: string;
  reason: string;
}

export interface RuleEvaluation {
  matches: RuleMatch[];
  rejections: RuleRejection[];
}

/** Cheap LRU-ish cooldown table keyed by `ruleId:userId`. */
class CooldownTable {
  private entries = new Map<string, number>();

  isCooling(key: string, seconds: number, now: number): boolean {
    if (seconds <= 0) return false;
    const last = this.entries.get(key);
    return last !== undefined && now - last < seconds * 1000;
  }

  touch(key: string, now: number): void {
    this.entries.set(key, now);
    if (this.entries.size > 5000) this.prune(now);
  }

  private prune(now: number): void {
    for (const [key, ts] of this.entries) {
      if (now - ts > 60 * 60 * 1000) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

function compileRegex(source: string): RegExp | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  try {
    return new RegExp(trimmed, 'i');
  } catch (error) {
    log.warn(`Rule regex "${trimmed}" is invalid and was ignored: ${String(error)}`);
    return null;
  }
}

/** Returns the text a text-shaped event contributes, or null if it has none. */
function textOf(event: StreamEvent): string | null {
  if (event.type === 'chat') return event.displayText;
  if (event.type === 'question') return event.text;
  return null;
}

function pickVoice(rule: TtsRule): string {
  if (rule.voice !== 'random') return rule.voice;
  const pool = rule.voicePool.filter(Boolean);
  if (pool.length === 0) return 'en_us_002';
  return pool[Math.floor(Math.random() * pool.length)] as string;
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  // Prefer cutting at a word boundary so TTS doesn't end mid-syllable.
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd();
}

const normalizeHandle = (value: string): string => value.trim().toLowerCase().replace(/^@/, '');

export class RuleEngine {
  private cooldowns = new CooldownTable();

  resetCooldowns(): void {
    this.cooldowns.clear();
  }

  /**
   * Evaluates every rule against one event. Multiple rules can match a single
   * event (e.g. "read all chat" plus "!say command"); the queue orders them by
   * rule priority.
   */
  evaluate(
    event: StreamEvent,
    tts: TtsConfig,
    session: SessionState,
    users: UsersConfig,
  ): RuleEvaluation {
    const matches: RuleMatch[] = [];
    const rejections: RuleRejection[] = [];
    const now = Date.now();

    if (!tts.enabled) return { matches, rejections };

    // Platform-qualified: comparing bare handles would let a Twitch mute
    // silence an unrelated TikTok viewer of the same name.
    const handle = event.user ? userKey(event.user) : '';

    // The penalty box is absolute: no rule can speak for someone in it.
    if (handle && users.penaltyBox.some((entry) => listKey(entry.username) === handle)) {
      return {
        matches,
        rejections: [{ ruleId: 'penalty-box', ruleName: 'Penalty box', reason: 'muted from TTS' }],
      };
    }

    const trusted = Boolean(handle) && users.trusted.some((u) => listKey(u) === handle);
    const profile = handle
      ? users.voiceProfiles.find((p) => listKey(p.username) === handle)
      : undefined;

    /*
     * The account-wide cooldown, checked once per event rather than per rule.
     *
     * Each rule's own cooldown only limits that rule, so someone can talk
     * without pause by alternating between whichever rules match. This gates
     * the person instead of the rule. Trusted users are exempt, consistent
     * with the per-rule cooldown.
     */
    const userCooldown = tts.userCooldownSeconds;
    if (event.user && !trusted && userCooldown > 0) {
      const key = `user:${event.user.userId}`;
      if (this.cooldowns.isCooling(key, userCooldown, now)) {
        return {
          matches,
          rejections: [
            {
              ruleId: 'user-cooldown',
              ruleName: 'Per-user cooldown',
              reason: `@${event.user.uniqueId} spoke less than ${userCooldown}s ago`,
            },
          ],
        };
      }
    }

    for (const rule of tts.rules) {
      if (!rule.enabled) continue;
      if (!rule.eventTypes.includes(event.type)) continue;
      // Empty means every platform, so a rule written before this existed is
      // unaffected. This is what scopes TTS per service — e.g. read chat on
      // TikTok but only announce gifts on Twitch.
      if (rule.platforms.length > 0 && !rule.platforms.includes(event.platform)) continue;

      const reject = (reason: string): void => {
        rejections.push({ ruleId: rule.id, ruleName: rule.name, reason });
      };

      // --- gift-specific short circuit ------------------------------------
      if (event.type === 'gift') {
        // Wait for the combo to settle so one 50x rose is one thank-you.
        if (event.streakable && !event.repeatEnd) continue;
        if (event.totalDiamonds < rule.conditions.minDiamonds) {
          reject(`gift worth ${event.totalDiamonds} < ${rule.conditions.minDiamonds} diamonds`);
          continue;
        }
        const wanted = rule.conditions.giftNames.map((g) => g.trim().toLowerCase()).filter(Boolean);
        if (wanted.length > 0 && !wanted.includes(event.giftName.toLowerCase())) {
          reject(`gift "${event.giftName}" not in the rule's gift list`);
          continue;
        }
      }

      if (event.type === 'like' && event.likeCount < rule.conditions.minLikeCount) {
        continue;
      }

      // --- text-shaped events ---------------------------------------------
      let messageText: string | null = null;
      if (event.type === 'chat' || event.type === 'question') {
        messageText = textOf(event);
        if (messageText === null) {
          reject('message was removed by the text filter');
          continue;
        }

        const prefix = rule.conditions.requirePrefix.trim();
        if (prefix) {
          const lower = messageText.trimStart().toLowerCase();
          const needle = prefix.toLowerCase();
          const startsWith =
            lower.startsWith(needle) &&
            (lower.length === needle.length || /[\s:,]/.test(lower.charAt(needle.length)));
          if (!startsWith) continue;
          if (rule.conditions.stripPrefix) {
            messageText = messageText.trimStart().slice(prefix.length).replace(/^[\s:,]+/, '');
          }
        }

        const regex = compileRegex(rule.conditions.matchRegex);
        if (regex && !regex.test(messageText)) continue;

        if (messageText.trim().length < rule.conditions.minLength) {
          reject(`message shorter than ${rule.conditions.minLength} characters`);
          continue;
        }
      }

      // --- gating ----------------------------------------------------------
      // Trusted users skip every gate and cooldown — that is the whole point
      // of the list, so you never have to special-case a regular again.
      if (event.user && !trusted) {
        const gate = checkGate(rule.gate, event.user, session);
        if (!gate.allowed) {
          reject(gate.reason ?? 'gated');
          continue;
        }

        const cooldownKey = `${rule.id}:${event.user.userId}`;
        if (this.cooldowns.isCooling(cooldownKey, rule.cooldownSeconds, now)) {
          reject(`on cooldown (${rule.cooldownSeconds}s per user)`);
          continue;
        }
      }

      // --- render -----------------------------------------------------------
      const vars = buildTemplateVars(event, messageText !== null ? { message: messageText } : {});
      const rendered = renderTemplate(rule.template, vars).replace(/\s+/g, ' ').trim();
      if (!rendered) {
        reject('template rendered empty');
        continue;
      }

      if (event.user) this.cooldowns.touch(`${rule.id}:${event.user.userId}`, now);

      matches.push({
        rule,
        text: clamp(rendered, rule.maxChars),
        ...applyVoiceProfile(rule, profile, tts.provider),
      });
    }

    /*
     * Start the account-wide cooldown, but only if this event actually spoke.
     * Touched once here rather than inside the loop so that one event matching
     * several rules still counts as a single turn — the cooldown gates the
     * *next* thing this person says, which is what the per-rule cooldown does
     * for its own rule.
     */
    if (event.user && !trusted && userCooldown > 0 && matches.length > 0) {
      this.cooldowns.touch(`user:${event.user.userId}`, now);
    }

    return { matches, rejections };
  }
}

/**
 * Layers a speaker's personal voice settings over the rule's.
 *
 * A blank `voice` inherits the rule's choice, and the numeric fields multiply
 * rather than replace, so a profile set to 1.2x rate stays 1.2x faster than
 * whatever rule happens to fire.
 *
 * The settings picked are the ones belonging to the backend this person will
 * actually be spoken with — their own if they have one, otherwise the global
 * one. That is what keeps a TikTok voice code from leaking into a Google
 * request when the two are configured independently.
 */
function applyVoiceProfile(
  rule: TtsRule,
  profile: UserVoiceProfile | undefined,
  activeProvider: TtsProvider,
): { voice: string; rate: number; pitch: number; volume: number; provider: TtsProvider | null } {
  const base = {
    voice: pickVoice(rule),
    rate: rule.rate,
    pitch: 1,
    volume: rule.volume,
    provider: null,
  };
  if (!profile) return base;

  const provider = profile.provider || activeProvider;
  const settings = settingsFor(profile, provider);

  return {
    voice: settings.voice.trim() || base.voice,
    rate: clampRange(base.rate * settings.rate, 0.5, 2),
    pitch: clampRange(settings.pitch, 0.5, 2),
    volume: clampRange(base.volume * settings.volume, 0, 1),
    // null means "no override" — the engine then uses the global provider.
    provider: profile.provider || null,
  };
}

const clampRange = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
