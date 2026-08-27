import type { CSSProperties } from 'react';
import type { OverlayAnimation, OverlaySource, OverlayStyle } from '@streaming/shared';

/**
 * Overlay styling is driven entirely by CSS custom properties so a widget's
 * own stylesheet never has to know about the config shape — and so the user's
 * `customCss` can override anything by targeting the same variables.
 */
export function styleVars(style: OverlayStyle): CSSProperties {
  return {
    '--font-family': style.fontFamily,
    '--font-size': `${style.fontSize}px`,
    '--font-weight': String(style.fontWeight),
    '--text-color': style.textColor,
    '--accent-color': style.accentColor,
    '--bg-color': style.backgroundColor,
    '--item-bg': style.itemBackground,
    '--radius': `${style.borderRadius}px`,
    '--padding': `${style.padding}px`,
    '--gap': `${style.gap}px`,
    '--stroke-width': `${style.textStroke}px`,
    '--stroke-color': style.textStrokeColor,
    '--opacity': String(style.opacity),
    '--shadow': style.shadow ? '0 6px 24px rgba(0, 0, 0, 0.45)' : 'none',
    '--text-shadow': style.shadow ? '0 2px 6px rgba(0, 0, 0, 0.75)' : 'none',
    '--text-stroke': style.textStroke > 0 ? `${style.textStroke}px ${style.textStrokeColor}` : 'unset',
  } as CSSProperties;
}

const FLEX_ALIGN: Record<OverlaySource['align'], string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

/** Positions the widget inside the browser source's viewport. */
export function containerStyle(overlay: OverlaySource): CSSProperties {
  return {
    ...styleVars(overlay.style),
    display: 'flex',
    flexDirection: 'column',
    alignItems: FLEX_ALIGN[overlay.align],
    justifyContent: FLEX_ALIGN[overlay.justify],
    width: '100%',
    height: '100%',
    padding: `${overlay.style.padding}px`,
    boxSizing: 'border-box',
    background: overlay.style.backgroundColor,
    color: overlay.style.textColor,
    fontFamily: overlay.style.fontFamily,
    fontSize: `${overlay.style.fontSize}px`,
    fontWeight: overlay.style.fontWeight,
    opacity: overlay.style.opacity,
    overflow: 'hidden',
  };
}

export const ANIMATION_CLASS: Record<OverlayAnimation, string> = {
  fade: 'anim-fade',
  'slide-left': 'anim-slide-left',
  'slide-right': 'anim-slide-right',
  'slide-up': 'anim-slide-up',
  pop: 'anim-pop',
  none: '',
};

/**
 * Deterministic per-user colour so the same viewer keeps the same name colour
 * across a stream. HSL keeps saturation and lightness in a readable band.
 */
export function nameColor(uniqueId: string): string {
  let hash = 0;
  for (let i = 0; i < uniqueId.length; i += 1) {
    hash = (hash * 31 + uniqueId.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 85%, 68%)`;
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(value));
}
