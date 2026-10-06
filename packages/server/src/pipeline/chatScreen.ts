import { mapTextParts, userKey, type ChatEvent } from '@streaming/shared';
import type { ConfigStore } from '../config/store.js';
import { createLogger } from '../logger.js';
import type { UserDirectory } from '../state/directory.js';
import type { ReviewFeed } from '../state/review.js';
import { trustSubject, type TrustTracker } from '../state/trust.js';
import type { FilterEngine } from './filters.js';

const log = createLogger('hub');

export interface ChatScreenDeps {
  config: ConfigStore;
  filters: FilterEngine;
  review: ReviewFeed;
  trust: TrustTracker;
  directory: UserDirectory;
  /**
   * Records a strike against the speaker, and boxes them once they reach the
   * threshold. Returns true when a strike was recorded. It acts on the whole
   * app — config, platform moderation, the event log — so the hub owns it.
   */
  strike: (event: ChatEvent, reason: string) => boolean;
}

export interface ChatScreening {
  /** The filter changed or dropped the message. */
  filtered: boolean;
  filterReason: string | null;
}

/**
 * What happens to a chat message before the rules see it.
 *
 * Runs the word filter, stamps the verdicts onto the event, decides whether
 * the speaker earns a strike, and has trust score them. In that order, which
 * matters: a strike lowers the trust score computed straight after it, and a
 * message that already earned a strike for its disguise does not earn another
 * for being a retry.
 *
 * Nothing here decides whether the message is *spoken*. It leaves the verdict
 * on the event (`displayText`, `trust.held`) and the rules read it from there.
 */
export class ChatScreen {
  constructor(private readonly deps: ChatScreenDeps) {}

  screen(event: ChatEvent): ChatScreening {
    const { filters, review, trust, directory, strike } = this.deps;
    const config = this.deps.config.get();

    const result = filters.apply(event.text, event.user);
    event.displayText = result.text;
    event.filtered = result.filtered;
    event.filterReason = result.reason;
    event.redacted = result.redact;
    event.filterSeverity = result.severity;
    // The pictures were positioned against the text as sent, so they fit
    // `text` and not `displayText`. Fit a second set to the cleaned text, or
    // a message loses every sticker over something as small as a curly quote.
    if (result.filtered && result.text !== null && event.parts) {
      event.displayParts = mapTextParts(event.parts, (text) => filters.apply(text).text);
    }

    const auto = config.users.autoPenalty;
    const struck =
      result.severity === 'severe' &&
      (!auto.onlyCountEvasion || result.evasion) &&
      strike(event, result.reason ?? 'severe term');

    // Only for what got through — a message the filter already stopped needs
    // no review. The review feed never changes the outcome; trust uses the
    // same check to decide whether speech skips the message.
    const terms = [...config.users.severe.words, ...config.users.severe.phrases];
    const nearMiss =
      config.filters.enabled &&
      result.text !== null &&
      terms.length > 0 &&
      (config.filters.reviewNearMatches || config.trust.enabled) &&
      review.sounds(event.text, terms);

    if (nearMiss && config.filters.reviewNearMatches) {
      for (const entry of review.observe(event.text, event.user.uniqueId, terms)) {
        log.info(
          `Near miss: "${entry.phrase}" sounds like "${entry.term}" ` +
            `(@${event.user.uniqueId}) — review it in the Filters tab`,
        );
      }
    }

    // Runs before the directory counts this message, so "new viewer" means the
    // messages they had sent before it. Test events are scored too: this
    // memory only lasts the session, and counting them is what lets the test
    // panel show a retry being caught.
    const key = userKey(event.user);
    const assessment = trust.observe(
      trustSubject(key, event.user, directory.get(key), config.users),
      {
        text: event.text,
        filtered: result.text === null,
        severity: result.severity,
        evasion: result.evasion,
        nearMiss,
      },
      config.trust,
    );
    event.trust = {
      score: assessment.score.score,
      band: assessment.score.band,
      held: assessment.held,
      signals: assessment.signals,
    };

    const retried =
      config.trust.enabled &&
      config.trust.strikeOnRetry &&
      assessment.severeRetry &&
      assessment.score.strict;
    if (retried && !struck) strike(event, 'retried a severe term after it was blocked');

    return { filtered: result.filtered, filterReason: result.reason };
  }
}
