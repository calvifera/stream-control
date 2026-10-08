import type { ReactNode } from 'react';

/**
 * The dashboard's icon set: one 20px grid, 1.6px stroke, round caps.
 *
 * Authored here rather than pulled from a library so the whole set shares one
 * stroke and adds no dependency. Each icon is decorative; the label next to it
 * carries the meaning, so they are hidden from assistive technology.
 */

export type IconName =
  | 'live'
  | 'key'
  | 'layers'
  | 'speech'
  | 'filter'
  | 'people'
  | 'chat'
  | 'archive'
  | 'log'
  | 'stop'
  | 'audio'
  | 'window'
  | 'signout'
  | 'check'
  | 'arrow'
  | 'close';

const PATHS: Record<IconName, ReactNode> = {
  // A broadcast mark: a point with two arcs either side.
  live: (
    <>
      <circle cx="10" cy="10" r="1.8" />
      <path d="M6.2 6.2a5.4 5.4 0 0 0 0 7.6M13.8 6.2a5.4 5.4 0 0 1 0 7.6" />
      <path d="M3.6 3.6a9 9 0 0 0 0 12.8M16.4 3.6a9 9 0 0 1 0 12.8" />
    </>
  ),
  key: (
    <>
      <circle cx="6.6" cy="10" r="3.2" />
      <path d="M9.8 10H17.5M15 10v2.6M12.6 10v1.8" />
    </>
  ),
  layers: (
    <>
      <path d="M10 3.2 17.2 7 10 10.8 2.8 7z" />
      <path d="m2.8 10.2 7.2 3.8 7.2-3.8M2.8 13.4 10 17.2l7.2-3.8" />
    </>
  ),
  speech: (
    <>
      <path d="M3 8.2v3.6M6.5 5.6v8.8M10 3.2v13.6M13.5 6.4v7.2M17 8.6v2.8" />
    </>
  ),
  filter: <path d="M3 4.6h14L11.6 11v4.6l-3.2 1.4V11z" />,
  people: (
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4 16.6c.6-3 2.8-4.6 6-4.6s5.4 1.6 6 4.6" />
    </>
  ),
  chat: <path d="M3.4 4.6h13.2v8.4H9l-3.8 3v-3H3.4z" />,
  archive: (
    <>
      <path d="M3.4 4.2h13.2v3.4H3.4zM4.4 7.6v8.2h11.2V7.6M8 10.8h4" />
    </>
  ),
  log: <path d="M4 5.2h12M4 8.4h12M4 11.6h8M4 14.8h5" />,
  stop: <rect x="5" y="5" width="10" height="10" rx="1.5" />,
  audio: (
    <>
      <path d="M3.6 8.2h2.8L10.4 5v10l-4-3.2H3.6z" />
      <path d="M13 7.4a3.6 3.6 0 0 1 0 5.2M15.2 5.4a6.4 6.4 0 0 1 0 9.2" />
    </>
  ),
  window: (
    <>
      <rect x="3.2" y="4.4" width="13.6" height="11.2" rx="1.6" />
      <path d="M3.2 8h13.6" />
    </>
  ),
  signout: <path d="M8 4H4.6v12H8M12 6.6 15.4 10 12 13.4M15.2 10H7.6" />,
  check: <path d="m4.6 10.4 3.4 3.4 7.4-7.6" />,
  arrow: <path d="M4.4 10h11M11.4 5.8 15.6 10l-4.2 4.2" />,
  close: <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
    >
      {PATHS[name]}
    </svg>
  );
}
