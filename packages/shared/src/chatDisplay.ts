import type { ChatEvent } from './events.js';

/**
 * How the host's own surfaces should present a filtered message.
 *
 * Lives here, away from the JSX, because it is a policy decision rather than a
 * rendering one and it governs the single most sensitive thing this app does:
 * which words reach whose eyes. It is shared by the dashboard, the chat panel
 * and the pop-out, and it is the only part of the display path that can be
 * tested without a browser.
 *
 * The rule the tiers encode: a filter hit is worth reading. A false positive
 * can only be spotted by seeing what was actually said, and a real hit is the
 * one a host most wants to read before acting on it. Hiding the message hid
 * the evidence for both.
 *
 *   plain   nothing was caught.
 *   amber   caught, and readable. Ordinary blocklist hits, and *anything*
 *           from a trusted viewer — someone already vouched for is far more
 *           likely to have tripped a bad wordlist entry than to have meant it.
 *   red     a severe hit from someone not trusted. Still readable; the point
 *           is emphasis, not concealment.
 *   folded  a refused or mixed script. The only tier with nothing to show,
 *           because unreadable-to-the-host is what made it refused.
 *
 * None of this reaches viewers. Overlays render `displayText` and never
 * consult these tiers.
 */
export type MessageTier = 'plain' | 'amber' | 'red' | 'folded';

export interface MessageDisplay {
  tier: MessageTier;
  /** The text to render; null when the tier is `folded`. */
  text: string | null;
  /**
   * Whether TTS was denied the message entirely.
   *
   * True only when the filter took the whole thing. A censored message was
   * still spoken with the word masked, so marking it "not read" would be a
   * lie — and this exists precisely to answer "did that go out loud?".
   */
  notRead: boolean;
}

export function messageDisplay(
  event: Pick<ChatEvent, 'text' | 'displayText' | 'filtered' | 'redacted' | 'filterSeverity'>,
  options: { trusted?: boolean } = {},
): MessageDisplay {
  if (!event.filtered) {
    return { tier: 'plain', text: event.displayText ?? event.text, notRead: false };
  }

  // Folded ahead of the trust check on purpose: being vouched for does not
  // make a refused script readable, so there is nothing for trust to unlock.
  if (event.redacted) {
    return { tier: 'folded', text: null, notRead: event.displayText === null };
  }

  const severe = event.filterSeverity === 'severe' && !options.trusted;
  return {
    tier: severe ? 'red' : 'amber',
    text: event.text,
    notRead: severe && event.displayText === null,
  };
}
