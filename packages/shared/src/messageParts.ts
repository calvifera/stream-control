/**
 * A chat message as the platform meant it to look: text with images in it.
 *
 * Every platform has emotes that are not Unicode — TikTok fan-club and
 * subscriber emotes, Twitch channel emotes, YouTube member emoji — and none
 * of them survive being flattened to a string. TikTok is the worst case: it
 * cuts the emote *out* of the text entirely and sends its image and position
 * alongside, so a message that was nothing but a fan-club emote arrives as an
 * empty string.
 *
 * `ChatEvent.text` stays the plain form, because filters, TTS and trust all
 * work on words. `parts` is the rendering form, built by each normalizer from
 * whatever its platform provides.
 */

export type MessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'emote';
      /** Shortcode or name, for alt text and for reading it aloud. */
      name: string;
      url: string;
      /** Platform emote id, when there is one. */
      id?: string;
    };

export interface PositionedEmote {
  /**
   * Where the emote sits, counted in code points of the text it is being
   * placed into — not UTF-16 units, so an emoji earlier in the line does not
   * shift every emote after it by one.
   */
  index: number;
  name: string;
  url: string;
  id?: string;
}

/** Joins adjacent text parts and drops empty ones. */
function compact(parts: MessagePart[]): MessagePart[] {
  const out: MessagePart[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      if (!part.text) continue;
      const last = out[out.length - 1];
      if (last?.type === 'text') {
        out[out.length - 1] = { type: 'text', text: last.text + part.text };
        continue;
      }
    }
    out.push(part);
  }
  return out;
}

/**
 * Puts emotes back into text they were removed from.
 *
 * TikTok's shape: `content` has no trace of the emote, and each emote says at
 * which character it belongs. Emotes sharing an index keep their order.
 * An index past the end appends rather than being lost, because a picture in
 * slightly the wrong place is better than a message that silently lost it.
 */
export function insertEmotes(text: string, emotes: PositionedEmote[]): MessagePart[] {
  if (emotes.length === 0) return text ? [{ type: 'text', text }] : [];

  const chars = Array.from(text);
  const sorted = emotes
    .map((emote, order) => ({ emote, order }))
    .sort((a, b) => a.emote.index - b.emote.index || a.order - b.order);

  const parts: MessagePart[] = [];
  let cursor = 0;
  for (const { emote } of sorted) {
    const at = Math.min(Math.max(0, Math.trunc(emote.index)), chars.length);
    if (at > cursor) {
      parts.push({ type: 'text', text: chars.slice(cursor, at).join('') });
      cursor = at;
    }
    parts.push({ type: 'emote', name: emote.name, url: emote.url, id: emote.id });
  }
  parts.push({ type: 'text', text: chars.slice(cursor).join('') });
  return compact(parts);
}

export interface EmoteRange {
  /** First code point of the emote's text, inclusive. */
  start: number;
  /** Last code point, inclusive — Twitch's convention. */
  end: number;
  name?: string;
  url: string;
  id?: string;
}

/**
 * Replaces spans of text with emotes.
 *
 * Twitch's shape: the emote's name stays in the text and the tags say which
 * code points it covers. Overlapping or out-of-range spans are skipped rather
 * than trusted, since this runs on input from the public internet.
 */
export function replaceRanges(text: string, ranges: EmoteRange[]): MessagePart[] {
  const chars = Array.from(text);
  const sorted = [...ranges].sort((a, b) => a.start - b.start);

  const parts: MessagePart[] = [];
  let cursor = 0;
  for (const range of sorted) {
    if (range.start < cursor || range.end < range.start || range.end >= chars.length) continue;
    parts.push({ type: 'text', text: chars.slice(cursor, range.start).join('') });
    const covered = chars.slice(range.start, range.end + 1).join('');
    parts.push({ type: 'emote', name: range.name ?? covered, url: range.url, id: range.id });
    cursor = range.end + 1;
  }
  parts.push({ type: 'text', text: chars.slice(cursor).join('') });
  return compact(parts);
}

/** True when the parts contain at least one picture — otherwise text is enough. */
export const hasEmotes = (parts: readonly MessagePart[] | undefined): boolean =>
  Boolean(parts?.some((part) => part.type === 'emote'));

/** The parts as plain text, with emotes as their names. */
export const partsToText = (parts: readonly MessagePart[]): string =>
  parts.map((part) => (part.type === 'text' ? part.text : part.name)).join('');
