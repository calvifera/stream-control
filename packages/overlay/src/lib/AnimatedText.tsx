import { useMemo, type CSSProperties } from 'react';
import { isTextEffectActive, type TextEffect } from '@streaming/shared';
import '../styles/textEffects.css';

/**
 * Text that waves, hops or flows through colours, one letter at a time.
 *
 * Every letter runs the same animation, offset in time by its position, so a
 * single sine motion becomes a wave travelling through the word. The colour
 * works the same way: each letter cycles the palette a little behind the one
 * before it, which reads as a gradient sliding along the name.
 */

/**
 * Scripts whose letters join up or reorder: Arabic, Hebrew, the Indic
 * scripts, Thai and friends. Splitting them into separately positioned
 * letters breaks the shaping and makes the name unreadable, so these move
 * as one piece instead.
 */
const JOINING = /[֐-ࣿऀ-෿฀-໿က-႟ក-៿]/;

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** User-perceived characters, so an emoji with a skin tone stays one letter. */
function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/** Past this, a long name would be hundreds of animated nodes for no visible gain. */
const MAX_LETTERS = 64;

const NBSP = String.fromCharCode(0xa0);

const RAINBOW = ['#ff5f6d', '#ffc371', '#fff36b', '#6bff95', '#5ecbff', '#a57bff', '#ff5f6d'];

export function AnimatedText({
  text,
  effect,
  className,
  /** Overrides the effect's colours, e.g. with a highlight tier's. */
  colors,
}: {
  text: string;
  effect: TextEffect | undefined;
  className?: string;
  colors?: readonly string[];
}): JSX.Element {
  const letters = useMemo(() => graphemes(text), [text]);

  if (!effect || !isTextEffectActive(effect) || !text) {
    return <span className={className}>{text}</span>;
  }

  const palette = effect.fill === 'rainbow' ? RAINBOW : (colors ?? effect.colors);
  const loop = palette.length > 1 ? [...palette, palette[0] as string] : [palette[0] ?? '#fff', palette[0] ?? '#fff'];
  const style = {
    '--tx-amp': `${effect.amplitude}em`,
    '--tx-speed': `${effect.speed}s`,
    // Up to eight stops, each as its own variable the keyframes step through.
    ...Object.fromEntries(loop.slice(0, 9).map((color, i) => [`--tx-c${i}`, color])),
  } as CSSProperties;

  const classes = [
    'tx',
    `tx-motion-${effect.motion}`,
    effect.fill !== 'solid' ? `tx-fill tx-stops-${Math.min(loop.length, 9)}` : '',
    className ?? '',
  ].join(' ');

  // Whole-word animation for joined scripts and very long text.
  if (JOINING.test(text) || letters.length > MAX_LETTERS) {
    return (
      <span className={`${classes} tx-whole`} style={style}>
        <span className="tx-l" style={{ '--tx-i': 0, '--tx-f': 0 } as CSSProperties}>
          <span className="tx-c">{text}</span>
        </span>
      </span>
    );
  }

  const last = Math.max(1, letters.length - 1);
  return (
    <span className={classes} style={style} aria-label={text}>
      {letters.map((letter, i) => (
        <span
          key={i}
          className="tx-l"
          aria-hidden="true"
          // --tx-i staggers the motion by a fixed step per letter, so the wave
          // travels at the same speed through short and long names. --tx-f
          // spreads the colour over half a cycle, so every name shows the
          // whole gradient however long it is.
          style={{ '--tx-i': i, '--tx-f': i / last } as CSSProperties}
        >
          <span className="tx-c">{letter === ' ' ? NBSP : letter}</span>
        </span>
      ))}
    </span>
  );
}
