import type { CSSProperties } from 'react';
import { isVideoUrl } from '@streaming/shared';

/**
 * A gift's picture: an image, an animated GIF/WebP, or a video.
 *
 * Videos play muted and inline because browser sources refuse unmuted
 * autoplay the same way browsers do, and a clip that silently fails to start
 * looks exactly like a broken overlay. Sound comes from the source's own
 * audio element instead.
 */
export function GiftMedia({
  url,
  className,
  style,
  alt = '',
}: {
  url: string;
  className?: string;
  style?: CSSProperties;
  alt?: string;
}): JSX.Element {
  if (isVideoUrl(url)) {
    return <video className={className} style={style} src={url} autoPlay muted playsInline loop />;
  }
  return (
    <img
      className={className}
      style={style}
      src={url}
      alt={alt}
      onError={(event) => {
        event.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}
