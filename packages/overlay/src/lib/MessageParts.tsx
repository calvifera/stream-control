import { hasEmotes, type ChatEvent, type EmoteEvent, type MessagePart } from '@streaming/shared';
import '../styles/gifts.css';

/**
 * A message with its emotes drawn as pictures.
 *
 * Shared by the chat overlay, the chat log and the pop-out so that a fan-club
 * emote looks the same everywhere. The images are sized in `em`, so they sit
 * on the line of text at whatever font size the surface uses.
 */
export function MessageParts({
  parts,
  className = 'msg-emote',
}: {
  parts: readonly MessagePart[];
  className?: string;
}): JSX.Element {
  return (
    <>
      {parts.map((part, index) =>
        part.type === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <img
            key={index}
            className={className}
            src={part.url}
            alt={part.name}
            title={part.name}
            // Emotes come from third-party CDNs; a dead one should vanish
            // rather than leave a broken-image icon mid-sentence.
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
            loading="lazy"
            decoding="async"
          />
        ),
      )}
    </>
  );
}

/**
 * The parts to draw for a chat line, or null to use its text instead.
 *
 * Only when the filter left the message alone. A censored message's text no
 * longer matches the positions its emotes were given, so it is shown as
 * filtered text without pictures rather than with pictures in the wrong
 * places — and a dropped one shows nothing at all.
 */
export function renderableParts(event: ChatEvent | EmoteEvent): readonly MessagePart[] | null {
  if (event.type === 'emote') {
    if (event.parts && event.parts.length > 0) return event.parts;
    const fromUrls = event.emoteUrls.map((url): MessagePart => ({ type: 'emote', name: '[emote]', url }));
    return fromUrls.length > 0 ? fromUrls : null;
  }
  if (event.filtered || event.displayText === null) return null;
  return hasEmotes(event.parts) ? (event.parts ?? null) : null;
}
