import type { MessagePart } from './messageParts.js';

/**
 * TikTok's "Bean" mascot stickers — `[wow]`, `[sagethink]`, `[rockycool]`.
 *
 * Unlike a fan-club emote, these are not sent as pictures. A chat message
 * carries the bare text `[sagethink]` and the sender's app draws the image
 * from a set it already knows about, so over the webcast connection they
 * arrive as words in brackets and nothing else.
 *
 * The set and the rule for finding an image come from TikTok LIVE Studio's own
 * configuration (`beans_emoji_config`): a base address, a list of codes, and
 * the image for a code is `<base>/<code without brackets>.webp`. They are
 * public files on TikTok's asset CDN, fetched by the viewer's browser the way
 * Studio fetches them — nothing is copied or stored here.
 *
 * The list is fixed at build time but TikTok serves it as a live setting, so a
 * new character can appear that this does not know. Those still show as their
 * text, which is the behaviour they had before.
 */
export const BEAN_EMOJI_BASE = 'https://p16-tiktok-livestudio-asset-sg.ibyteimg.com/tos-alisg-i-x0wz2yqgvw-sg';

export const BEAN_EMOJI_CODES: readonly string[] = [
  '[wow]',
  '[laugh]',
  '[thanks]',
  '[laughcry]',
  '[thumb]',
  '[hi]',
  '[heart]',
  '[congrat]',
  '[rockyserious]',
  '[rockyloveit]',
  '[rockyproud]',
  '[rockycool]',
  '[rosiedislike]',
  '[rosieawkward]',
  '[rosiekisskiss]',
  '[rosiecute]',
  '[jolliekissingface]',
  '[jolliewow]',
  '[jolliespeechless]',
  '[jolliesatisfied]',
  '[sagethink]',
  '[sagefulfilled]',
  '[sageclever]',
  '[sagemoney]',
];

const KNOWN = new Set(BEAN_EMOJI_CODES);

/** The image for a code such as `[sagethink]`, or null when it is not one. */
export function beanEmojiUrl(code: string): string | null {
  return KNOWN.has(code) ? `${BEAN_EMOJI_BASE}/${code.slice(1, -1)}.webp` : null;
}

const CODE = /\[[a-zA-Z0-9_]+\]/g;

/**
 * Turns known bean codes in a message into pictures.
 *
 * Takes the parts built so far — fan-club emotes already placed — and splits
 * the text between them. Only text is touched, so the positions the emotes
 * were given are never disturbed. Returns the input unchanged (possibly
 * undefined) when there is no code to replace, so plain messages stay plain.
 */
export function expandBeanCodes(
  parts: MessagePart[] | undefined,
  text: string,
): MessagePart[] | undefined {
  const base: MessagePart[] = parts ?? (text ? [{ type: 'text', text }] : []);
  let found = false;
  const out: MessagePart[] = [];

  const pushText = (value: string): void => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + value };
    else out.push({ type: 'text', text: value });
  };

  for (const part of base) {
    if (part.type !== 'text') {
      out.push(part);
      continue;
    }
    let cursor = 0;
    for (const match of part.text.matchAll(CODE)) {
      const url = beanEmojiUrl(match[0]);
      if (!url) continue;
      found = true;
      pushText(part.text.slice(cursor, match.index));
      out.push({ type: 'emote', name: match[0], url });
      cursor = match.index + match[0].length;
    }
    pushText(part.text.slice(cursor));
  }

  return found ? out : parts;
}
