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
 * This is the viewer-facing form, matched to `displayText`: a message the
 * filter dropped shows nothing, and one it merely changed shows its pictures
 * re-fitted to the cleaned text. Treating any change as a reason to hide them
 * is what made stickers vanish from messages whose only fault was a curly
 * quote. The host's own flagged lines show the text as sent, and use
 * `originalParts` for the pictures that go with it.
 */
export function renderableParts(event: ChatEvent | EmoteEvent): readonly MessagePart[] | null {
  if (event.type === 'emote') {
    if (event.parts && event.parts.length > 0) return event.parts;
    const fromUrls = event.emoteUrls.map((url): MessagePart => ({ type: 'emote', name: '[emote]', url }));
    return fromUrls.length > 0 ? fromUrls : null;
  }
  if (event.displayText === null) return null;
  const parts = event.displayParts ?? event.parts;
  return hasEmotes(parts) ? (parts ?? null) : null;
}

/** The pictures that go with `event.text` — for a line that shows the message as sent. */
export function originalParts(event: ChatEvent): readonly MessagePart[] | null {
  return hasEmotes(event.parts) ? (event.parts ?? null) : null;
}
