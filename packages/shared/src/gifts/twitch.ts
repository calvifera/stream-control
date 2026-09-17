/**
 * Twitch's gift vocabulary: cheers, cheermotes and emote images.
 *
 * Pure functions only, so the server's normalizer, the overlay's renderer and
 * the check scripts all agree on what a tier is and where its image lives.
 */

/** The amounts at which a cheermote changes look. */
export const CHEER_TIERS = [1, 100, 1000, 5000, 10000] as const;
export type CheerTier = (typeof CHEER_TIERS)[number];

/** Twitch's own colour for each tier: grey, purple, teal, blue, red. */
export const CHEER_TIER_COLORS: Record<CheerTier, string> = {
  1: '#979797',
  100: '#9c3ee8',
  1000: '#1db2a5',
  5000: '#0099fe',
  10000: '#f43021',
};

export function cheerTier(bits: number): CheerTier {
  let tier: CheerTier = 1;
  for (const candidate of CHEER_TIERS) {
    if (bits >= candidate) tier = candidate;
  }
  return tier;
}

export type CheermoteScale = '1' | '1.5' | '2' | '3' | '4';

/**
 * The global "Cheer" cheermote, animated, from Twitch's public CDN.
 *
 * Needs no credentials, which is why it is the default: most cheers use the
 * global prefix, and a channel's own cheermotes are resolved separately
 * through Helix when app credentials exist (`server/src/twitch/cheermotes.ts`).
 */
export function globalCheermoteUrl(
  bits: number,
  options: { animated?: boolean; theme?: 'dark' | 'light'; scale?: CheermoteScale } = {},
): string {
  const { animated = true, theme = 'dark', scale = '4' } = options;
  const format = animated ? 'animated' : 'static';
  const ext = animated ? 'gif' : 'png';
  return `https://d3aqoihi2n8ty8.cloudfront.net/actions/cheer/${theme}/${format}/${cheerTier(bits)}/${scale}.${ext}`;
}

/**
 * An emote image by id.
 *
 * `default` rather than `static` or `animated`: Twitch serves the animated
 * version when the emote has one and the still otherwise, so one URL covers
 * both without knowing which this emote is.
 */
export function twitchEmoteUrl(id: string, scale: '1.0' | '2.0' | '3.0' = '2.0'): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/${scale}`;
}

export interface CheerToken {
  prefix: string;
  bits: number;
}

/** `Cheer100`, `corgo500` — a word that is letters followed by an amount. */
const CHEER_TOKEN = /^([a-z][a-z0-9_]*?[a-z])(\d+)$/i;

/**
 * Finds the cheermote words in a cheer message.
 *
 * Twitch sends the total in the `bits` tag but not which words spent it, and
 * "level5" is an ordinary word as much as a cheer. So a token only counts
 * when it is a known prefix, or — lacking a catalogue — when the tokens that
 * look like cheers add up to exactly the reported total.
 */
export function findCheers(
  text: string,
  totalBits: number,
  knownPrefixes?: ReadonlySet<string>,
): CheerToken[] {
  const candidates: CheerToken[] = [];
  for (const word of text.split(/\s+/)) {
    const match = CHEER_TOKEN.exec(word);
    if (!match) continue;
    const prefix = (match[1] ?? '').toLowerCase();
    const bits = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isFinite(bits) || bits <= 0) continue;
    candidates.push({ prefix, bits });
  }

  if (knownPrefixes && knownPrefixes.size > 0) {
    return candidates.filter((token) => knownPrefixes.has(token.prefix));
  }
  const explicit = candidates.filter((token) => token.prefix === 'cheer');
  const sum = (tokens: CheerToken[]): number => tokens.reduce((n, t) => n + t.bits, 0);
  if (explicit.length > 0 && sum(explicit) === totalBits) return explicit;
  if (sum(candidates) === totalBits) return candidates;
  return explicit;
}

/** The message with the cheer words taken out, for showing on stream. */
export function stripCheers(text: string, cheers: readonly CheerToken[]): string {
  if (cheers.length === 0) return text.trim();
  const remaining = [...cheers];
  return text
    .split(/(\s+)/)
    .filter((word) => {
      const match = CHEER_TOKEN.exec(word);
      if (!match) return true;
      const prefix = (match[1] ?? '').toLowerCase();
      const bits = Number.parseInt(match[2] ?? '', 10);
      const at = remaining.findIndex((t) => t.prefix === prefix && t.bits === bits);
      if (at === -1) return true;
      remaining.splice(at, 1);
      return false;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Prime`, `1000`, `2000`, `3000` → the shared tier name. */
export function twitchSubTier(plan: string | undefined): 'prime' | '1' | '2' | '3' | null {
  switch ((plan ?? '').toLowerCase()) {
    case 'prime':
      return 'prime';
    case '1000':
      return '1';
    case '2000':
      return '2';
    case '3000':
      return '3';
    default:
      return null;
  }
}
