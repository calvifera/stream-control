import type { GiftShowcaseEvent } from './media.js';

/**
 * Sounds by how much a gift was worth.
 *
 * The point is escalation: a Rose should get a small, pleasant pop and a
 * $100 Super Chat should get a moment. A single alert sound can only ever
 * be right for one of those.
 *
 * Brackets are compared against `approxCents`, a rough common scale, so one
 * list of brackets works for all three platforms at once.
 */

/**
 * Sounds that ship with the app.
 *
 * Synthesized in the browser rather than shipped as audio files: no licences
 * to track, nothing to download, identical in OBS and a browser, and each is
 * tuned to sit with the others as a set — each bracket up is brighter,
 * longer and fuller than the one below.
 */
export const BUILTIN_SOUNDS = [
  { id: 'pop', label: 'Pop', blurb: 'A tiny bubbly pop. For the smallest gifts.' },
  { id: 'bubbles', label: 'Bubbles', blurb: 'Three soft rising blips.' },
  { id: 'coin', label: 'Coin', blurb: 'The classic two-note coin pickup.' },
  { id: 'chime', label: 'Chime', blurb: 'A warm three-bell chord.' },
  { id: 'sparkle', label: 'Sparkle', blurb: 'A glittering run up to a bell.' },
  { id: 'levelup', label: 'Level up', blurb: 'A rising arpeggio that lands on a chord.' },
  { id: 'fanfare', label: 'Fanfare', blurb: 'A short brass flourish with a shimmer tail.' },
  { id: 'jackpot', label: 'Jackpot', blurb: 'Fanfare, a cascade of coins and a big bell.' },
] as const;

export type BuiltinSoundId = (typeof BUILTIN_SOUNDS)[number]['id'];

export const BUILTIN_PREFIX = 'builtin:';

export const builtinSound = (id: BuiltinSoundId): string => `${BUILTIN_PREFIX}${id}`;

export function builtinSoundId(sound: string): BuiltinSoundId | null {
  if (!sound.startsWith(BUILTIN_PREFIX)) return null;
  const id = sound.slice(BUILTIN_PREFIX.length);
  return BUILTIN_SOUNDS.some((s) => s.id === id) ? (id as BuiltinSoundId) : null;
}

export interface GiftSoundBracket {
  id: string;
  /** Gifts worth at least this, in approximate cents, use this bracket. */
  minCents: number;
  /** `builtin:<id>`, a /media or https URL, or empty for silence. */
  sound: string;
  /** Relative to the source's volume, 0 to 1. */
  volume: number;
}

export interface GiftSoundSettings {
  enabled: boolean;
  /** Master volume for every bracket, 0 to 1. */
  volume: number;
  brackets: GiftSoundBracket[];
}

export const DEFAULT_SOUND_BRACKETS: GiftSoundBracket[] = [
  { id: 'tiny', minCents: 0, sound: builtinSound('pop'), volume: 0.8 },
  { id: 'small', minCents: 100, sound: builtinSound('coin'), volume: 0.8 },
  { id: 'medium', minCents: 500, sound: builtinSound('sparkle'), volume: 0.9 },
  { id: 'large', minCents: 2000, sound: builtinSound('levelup'), volume: 0.9 },
  { id: 'huge', minCents: 5000, sound: builtinSound('fanfare'), volume: 1 },
  { id: 'massive', minCents: 10000, sound: builtinSound('jackpot'), volume: 1 },
];

export const defaultSoundSettings = (enabled = true): GiftSoundSettings => ({
  enabled,
  volume: 0.7,
  brackets: DEFAULT_SOUND_BRACKETS.map((bracket) => ({ ...bracket })),
});

/** A sub's rough price in cents, by tier. Prime is paid for by Amazon, at Tier 1 value. */
const SUB_CENTS: Record<string, number> = { prime: 499, '1': 499, '2': 999, '3': 2499 };

/** What a Power-up usually costs, since Twitch does not say. */
const UNKNOWN_POWER_UP_CENTS = 150;

/**
 * Roughly what a gift cost, in US cents, on one scale for every platform.
 *
 * It happens that every platform's unit is close to a cent: a TikTok coin and
 * a Twitch bit each cost a viewer about 1.3¢, and YouTube amounts are already
 * cents. So the native total is used as-is. It is an approximation — good
 * for "is this a big gift?", never for accounting — and YouTube amounts in
 * other currencies are read as if they were dollars, like everywhere else in
 * this app.
 */
export function approxCents(event: GiftShowcaseEvent): number {
  if (event.type === 'subscribe') {
    if (event.giftBombMember) return 0;
    const each = SUB_CENTS[event.tier ?? '1'] ?? 499;
    return each * Math.max(1, event.giftCount ?? 1);
  }
  if (!event.detail.value.known) return UNKNOWN_POWER_UP_CENTS;
  return Math.max(0, event.totalDiamonds);
}

/** The highest bracket the amount reaches, or null if it reaches none. */
export function bracketFor(
  cents: number,
  brackets: readonly GiftSoundBracket[],
): GiftSoundBracket | null {
  let best: GiftSoundBracket | null = null;
  for (const bracket of brackets) {
    if (cents >= bracket.minCents && (!best || bracket.minCents >= best.minCents)) best = bracket;
  }
  return best;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
