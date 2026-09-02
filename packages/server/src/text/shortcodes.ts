/**
 * Bracketed emote codes, as they arrive in chat text.
 *
 * TikTok renders a set of shortcodes as pictures in its own app — `[smile]`,
 * `[thinking]`, and whatever a creator has in their subscription set. What
 * reaches this app over the webcast connection is the literal text, so a
 * message that looked like three little faces to the sender arrives as
 * `[sagethink][sagethink][sagethink]`, and speech synthesis reads exactly
 * that: "sagethink sagethink sagethink".
 *
 * Removing them for speech only. The panel and the overlay keep showing the
 * codes, because the host can at least tell an emote from a word — and
 * silently deleting part of someone's message from the display would be a
 * worse trade than a slightly ugly one.
 */

/**
 * A shortcode: one lowercase token in brackets.
 *
 * Deliberately narrow. `[laughs]` typed by a person matches this too, which is
 * fine — nobody wants that read out either. What must not match is ordinary
 * bracketed writing: `[1]`, `[see below]`, `[A]`. So: lowercase only, no
 * spaces, at least two characters, and a length bound well past the longest
 * real code.
 */
const SHORTCODE = /\[[a-z][a-z0-9_]{1,19}\]/g;

/**
 * Strips emote codes from text bound for speech.
 *
 * Returns an empty string when the message was nothing but codes, which the
 * caller treats as "no speech to make" rather than as an error — an emote-only
 * message is a real thing to send, it just has nothing to say out loud.
 */
export function stripEmoteCodes(text: string): string {
  if (!text.includes('[')) return text;
  return text
    .replace(SHORTCODE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Whether the text carries at least one shortcode. */
export function hasEmoteCodes(text: string): boolean {
  if (!text.includes('[')) return false;
  SHORTCODE.lastIndex = 0;
  return SHORTCODE.test(text);
}
