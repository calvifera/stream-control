import { randomUUID } from 'node:crypto';
import {
  CHEER_TIER_COLORS,
  cheerTier,
  findCheers,
  formatUnit,
  globalCheermoteUrl,
  replaceRanges,
  stripCheers,
  twitchEmoteUrl,
  twitchSubTier,
  type ChatEvent,
  type EmoteRange,
  type GiftEvent,
  type MessagePart,
  type ShareEvent,
  type StreamEvent,
  type StreamUser,
  type SubscribeEvent,
} from '@streaming/shared';

/**
 * Twitch IRC → the normalized event model.
 *
 * Twitch speaks IRCv3 with a `twitch.tv/tags` capability, so every message
 * arrives as `@key=value;key=value :prefix COMMAND #channel :text`. This module
 * is the Twitch counterpart to `tiktok/normalize.ts`: nothing downstream should
 * ever learn that IRC was involved.
 */

export interface IrcMessage {
  tags: Record<string, string>;
  /** The part between `:` and the first space, e.g. `nick!user@host`. */
  prefix: string;
  command: string;
  params: string[];
  /** The trailing parameter — the message body for PRIVMSG. */
  text: string;
}

/**
 * Parses one IRC line.
 *
 * Hand-rolled rather than pulled from a library because the grammar is small
 * and fixed, and a chat parser is the one place where an opaque dependency
 * processing untrusted remote input is least welcome.
 */
export function parseIrc(line: string): IrcMessage | null {
  let rest = line.trim();
  if (!rest) return null;

  const tags: Record<string, string> = {};
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    if (end === -1) return null;
    for (const pair of rest.slice(1, end).split(';')) {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? '' : pair.slice(eq + 1);
      if (key) tags[key] = unescapeTag(value);
    }
    rest = rest.slice(end + 1);
  }

  let prefix = '';
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    if (end === -1) return null;
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }

  // The trailing parameter is everything after " :" and may itself contain
  // spaces and colons, so it has to be split off before the rest.
  let text = '';
  const trailing = rest.indexOf(' :');
  if (trailing !== -1) {
    text = rest.slice(trailing + 2);
    rest = rest.slice(0, trailing);
  }

  const parts = rest.split(' ').filter(Boolean);
  const command = parts.shift() ?? '';
  if (!command) return null;

  return { tags, prefix, command, params: parts, text };
}

/** IRCv3 tag values escape the characters that would break the framing. */
function unescapeTag(value: string): string {
  return value
    .replace(/\\s/g, ' ')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\:/g, ';')
    .replace(/\\\\/g, '\\');
}

const toInt = (value: string | undefined, fallback = 0): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** `nick!nick@nick.tmi.twitch.tv` → `nick`. */
function nickOf(prefix: string): string {
  const bang = prefix.indexOf('!');
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

/**
 * Builds the viewer from IRC tags.
 *
 * `avatarUrl` is always null: IRC simply does not carry it. Fetching avatars
 * would mean the Helix API and a registered client id, so the chat UI falls
 * back to an initial instead of showing a broken image.
 */
export function twitchUser(message: IrcMessage, broadcaster: string): StreamUser {
  const login = (message.tags['login'] || nickOf(message.prefix) || '').toLowerCase();
  const badges = (message.tags['badges'] ?? '')
    .split(',')
    .map((entry) => entry.split('/')[0] ?? '')
    .filter(Boolean);

  const moderator = message.tags['mod'] === '1' || badges.includes('moderator');
  const subscriber = message.tags['subscriber'] === '1' || badges.includes('subscriber');
  const isHost = badges.includes('broadcaster') || login === broadcaster.toLowerCase();

  return {
    platform: 'twitch',
    userId: message.tags['user-id'] || login || '0',
    uniqueId: login,
    nickname: message.tags['display-name'] || login || 'Unknown',
    avatarUrl: null,
    // Twitch exposes no follow relationship over IRC, so this stays 0 rather
    // than guessing. Any gate keyed on "followers only" simply won't match
    // Twitch users, which is the safe direction to be wrong in.
    followRole: 0,
    isFollower: false,
    isFriend: false,
    isSubscriber: subscriber,
    isModerator: moderator,
    isHost,
    isVerified: badges.includes('partner'),
    followerCount: 0,
    fansClubLevel: 0,
    badges,
  };
}

const base = (): { id: string; ts: number; platform: 'twitch' } => ({
  id: randomUUID(),
  ts: Date.now(),
  platform: 'twitch',
});

export function normalizeTwitchChat(message: IrcMessage, broadcaster: string): ChatEvent {
  return {
    ...base(),
    type: 'chat',
    user: twitchUser(message, broadcaster),
    text: message.text,
    displayText: message.text,
    filtered: false,
    filterReason: null,
    redacted: false,
    filterSeverity: 'none',
    emotes: Object.keys(parseEmotes(message.tags['emotes'])),
    parts: twitchParts(message.text, message.tags['emotes']),
  };
}

/**
 * The message with its emotes as images.
 *
 * Twitch leaves emote names in the text and says in the `emotes` tag which
 * code points each covers, so this is a straight replacement. Undefined for a
 * message with no emotes, which is most of them.
 */
export function twitchParts(text: string, tag: string | undefined): MessagePart[] | undefined {
  const ranges: EmoteRange[] = [];
  for (const [id, spans] of Object.entries(parseEmotes(tag))) {
    for (const span of spans) {
      const [start, end] = span.split('-').map((n) => Number.parseInt(n, 10));
      if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end)) {
        continue;
      }
      ranges.push({ start, end, url: twitchEmoteUrl(id), id });
    }
  }
  return ranges.length > 0 ? replaceRanges(text, ranges) : undefined;
}

/**
 * Cheer bits, modelled as a gift.
 *
 * Bits are the closest Twitch analogue to a TikTok gift: a viewer spending
 * currency mid-chat. Mapping them onto `GiftEvent` means existing gift alerts,
 * gates and TTS rules work on Twitch without special-casing — `diamondCount`
 * carries the bit count, so a "minimum diamonds" threshold reads as a minimum
 * bit threshold.
 *
 * The picture is the global cheermote for the tier, which needs no
 * credentials. A channel's own cheermotes need Helix, so `cheermotes.ts` swaps
 * the picture later when app credentials exist — the prefix is recorded here
 * so that it can.
 */
export function normalizeTwitchBits(
  message: IrcMessage,
  broadcaster: string,
  knownPrefixes?: ReadonlySet<string>,
): GiftEvent {
  const bits = toInt(message.tags['bits']);
  const cheers = findCheers(message.text, bits, knownPrefixes);
  // The biggest single cheer decides the look, as it does in Twitch's own chat.
  const main = [...cheers].sort((a, b) => b.bits - a.bits)[0];
  const tier = cheerTier(bits);
  const text = stripCheers(message.text, cheers);
  const still = globalCheermoteUrl(bits, { animated: false });

  return {
    ...base(),
    type: 'gift',
    user: twitchUser(message, broadcaster),
    giftId: `cheer-${tier}`,
    giftName: bits === 1 ? 'Bit' : 'Bits',
    giftImageUrl: still,
    diamondCount: bits,
    repeatCount: 1,
    repeatEnd: true,
    streakable: false,
    totalDiamonds: bits,
    detail: {
      kind: 'twitch-cheer',
      platform: 'twitch',
      prefix: main?.prefix ?? 'cheer',
      tier,
      value: { amount: bits, unit: 'bits', known: true, label: formatUnit(bits, 'bits') },
      media: { imageUrl: still, animationUrl: globalCheermoteUrl(bits) },
      // The cheer words themselves are the payment, not the message.
      message: text || null,
      displayMessage: text || null,
      colors: {
        primary: CHEER_TIER_COLORS[tier],
        secondary: CHEER_TIER_COLORS[tier],
        text: '#ffffff',
      },
    },
  };
}

/** `msg-id` values Twitch puts on a chat line that bits turned into a Power-up. */
const POWER_UPS: Record<string, 'gigantify' | 'message-effect'> = {
  'gigantified-emote-message': 'gigantify',
  'animated-message': 'message-effect',
};

/**
 * A Power-up: bits spent to gigantify an emote or put an effect on a message.
 *
 * Twitch does not put the price in the tags — the streamer sets it — so the
 * value is marked unknown rather than recorded as free. The gigantified emote
 * is, by Twitch's convention, the last one in the message.
 */
export function normalizeTwitchPowerUp(message: IrcMessage, broadcaster: string): GiftEvent | null {
  const effect = POWER_UPS[message.tags['msg-id'] ?? ''];
  if (!effect) return null;

  const bits = toInt(message.tags['bits']);
  const lastEmote = lastEmoteId(message.tags['emotes']);
  const emoteUrl = effect === 'gigantify' && lastEmote ? twitchEmoteUrl(lastEmote, '3.0') : null;

  return {
    ...base(),
    type: 'gift',
    user: twitchUser(message, broadcaster),
    giftId: effect,
    giftName: effect === 'gigantify' ? 'Gigantified emote' : 'Message effect',
    giftImageUrl: emoteUrl,
    diamondCount: bits,
    repeatCount: 1,
    repeatEnd: true,
    streakable: false,
    totalDiamonds: bits,
    detail: {
      kind: 'twitch-power-up',
      platform: 'twitch',
      effect,
      animationId: message.tags['animation-id'] || null,
      value: {
        amount: bits,
        unit: 'bits',
        known: bits > 0,
        label: bits > 0 ? formatUnit(bits, 'bits') : 'Power-up',
      },
      media: { imageUrl: emoteUrl, animationUrl: emoteUrl },
      message: message.text || null,
      displayMessage: message.text || null,
      colors: null,
    },
  };
}

/** The emote whose last use comes latest in the message. */
function lastEmoteId(tag: string | undefined): string | null {
  let best: [string, number] | null = null;
  for (const [id, spans] of Object.entries(parseEmotes(tag))) {
    for (const span of spans) {
      const start = Number.parseInt(span.split('-')[0] ?? '', 10);
      if (Number.isFinite(start) && (!best || start > best[1])) best = [id, start];
    }
  }
  return best?.[0] ?? null;
}

const GIFT_IDS = new Set(['subgift', 'anonsubgift', 'submysterygift', 'anonsubmysterygift']);
const BOMB_IDS = new Set(['submysterygift', 'anonsubmysterygift']);

/**
 * Subscriptions, including gifted ones and gift bombs.
 *
 * A bomb of N arrives as one `submysterygift` from the buyer with the count,
 * then N `subgift`s sharing its `msg-param-community-gift-id`. The
 * announcement carries the count and each recipient is marked as part of it,
 * so totals count the bomb once and alerts do not fire N+1 times.
 */
export function normalizeTwitchSub(message: IrcMessage, broadcaster: string): SubscribeEvent {
  const id = message.tags['msg-id'] ?? '';
  const event: SubscribeEvent = {
    ...base(),
    type: 'subscribe',
    user: twitchUser(message, broadcaster),
    subMonths: toInt(
      message.tags['msg-param-cumulative-months'] ?? message.tags['msg-param-months'],
      1,
    ),
    isGifted: GIFT_IDS.has(id),
    tier: twitchSubTier(message.tags['msg-param-sub-plan']),
  };

  if (BOMB_IDS.has(id)) {
    event.giftCount = Math.max(1, toInt(message.tags['msg-param-mass-gift-count'], 1));
  } else if (GIFT_IDS.has(id)) {
    event.recipient =
      message.tags['msg-param-recipient-display-name'] ||
      message.tags['msg-param-recipient-user-name'] ||
      null;
    if (message.tags['msg-param-community-gift-id']) event.giftBombMember = true;
  }
  return event;
}

/**
 * A raid, mapped onto `ShareEvent`.
 *
 * There is no raid concept in the event model and inventing one would mean
 * touching every consumer. A share is the nearest existing idea — someone
 * sending their audience your way — and `shareCount` carries the raider count,
 * so the number is preserved rather than lost.
 */
export function normalizeTwitchRaid(message: IrcMessage, broadcaster: string): ShareEvent {
  return {
    ...base(),
    type: 'share',
    user: twitchUser(message, broadcaster),
    shareCount: toInt(message.tags['msg-param-viewerCount'], 1),
  };
}

/** `emotes` tag: `id:start-end,start-end/id:start-end`. */
function parseEmotes(tag: string | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!tag) return out;
  for (const group of tag.split('/')) {
    const [id, ranges] = group.split(':');
    if (id && ranges) out[id] = ranges.split(',');
  }
  return out;
}

const SUB_NOTICES = new Set([
  'sub',
  'resub',
  'subgift',
  'anonsubgift',
  'submysterygift',
  'anonsubmysterygift',
  'giftpaidupgrade',
  'anongiftpaidupgrade',
  'primepaidupgrade',
]);

/** Routes one parsed line to the right normalizer, or null if it isn't an event. */
export function twitchEventFrom(
  message: IrcMessage,
  broadcaster: string,
  knownPrefixes?: ReadonlySet<string>,
): StreamEvent | null {
  if (message.command === 'PRIVMSG') {
    // A Power-up or a cheer is a chat line that cost bits. Emit the gift, with
    // the message riding on it, rather than the chat line: the money is not
    // swallowed, and the line does not show twice.
    const powerUp = normalizeTwitchPowerUp(message, broadcaster);
    if (powerUp) return powerUp;
    return toInt(message.tags['bits']) > 0
      ? normalizeTwitchBits(message, broadcaster, knownPrefixes)
      : normalizeTwitchChat(message, broadcaster);
  }

  if (message.command === 'USERNOTICE') {
    const id = message.tags['msg-id'] ?? '';
    if (id === 'raid') return normalizeTwitchRaid(message, broadcaster);
    if (SUB_NOTICES.has(id)) return normalizeTwitchSub(message, broadcaster);
  }

  return null;
}
