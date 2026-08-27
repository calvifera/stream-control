import { BRAND_MARKS, PLATFORM_INFO, type Platform } from '@streaming/shared';

/**
 * A platform's brand mark.
 *
 * Renders the vendored path data into an inline SVG rather than loading a PNG:
 * one asset covers every size, it takes the platform's brand colour without a
 * second file for dark mode, it adds no network request, and it stays sharp on
 * a high-DPI display where a small raster logo goes soft.
 *
 * `title` is omitted when the logo sits next to the platform's name, which is
 * usually — repeating it makes a screen reader say "Twitch Twitch".
 */
export function PlatformLogo({
  platform,
  size = 16,
  color,
  labelled = false,
}: {
  platform: Platform;
  /** Any CSS length. Pass `1em` to make the logo track the surrounding text. */
  size?: number | string;
  /** Defaults to the brand colour; pass `currentColor` to inherit. */
  color?: string;
  /** Set when the logo appears without the platform name beside it. */
  labelled?: boolean;
}): JSX.Element | null {
  const mark = BRAND_MARKS[platform];
  const info = PLATFORM_INFO[platform];
  if (!mark) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={color ?? info.color}
      role={labelled ? 'img' : 'presentation'}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      {labelled ? <title>{mark.title}</title> : null}
      <path d={mark.path} />
    </svg>
  );
}
