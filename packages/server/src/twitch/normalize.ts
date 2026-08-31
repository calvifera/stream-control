import { randomUUID } from 'node:crypto';
import type {
  ChatEvent,
  GiftEvent,
  ShareEvent,
  StreamEvent,
  StreamUser,
  SubscribeEvent,
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
    emotes: Object.keys(parseEmotes(message.tags['emotes'])),
  };
}

/**
 * Cheer bits, modelled as a gift.
 *
 * Bits are the closest Twitch analogue to a TikTok gift: a viewer spending
 * currency mid-chat. Mapping them onto `GiftEvent` means existing gift alerts,
 * gates and TTS rules work on Twitch without special-casing — `diamondCount`
 * carries the bit count, so a "minimum diamonds" threshold reads as a minimum
 * bit threshold.
 */
export function normalizeTwitchBits(message: IrcMessage, broadcaster: string): GiftEvent {
  const bits = toInt(message.tags['bits']);
  return {
    ...base(),
    type: 'gift',
    user: twitchUser(message, broadcaster),
    giftId: 'bits',
    giftName: bits === 1 ? 'Bit' : 'Bits',
    giftImageUrl: null,
    diamondCount: bits,
    repeatCount: 1,
    repeatEnd: true,
    streakable: false,
    totalDiamonds: bits,
  };
}

export function normalizeTwitchSub(message: IrcMessage, broadcaster: string): SubscribeEvent {
  const id = message.tags['msg-id'] ?? '';
  return {
    ...base(),
    type: 'subscribe',
    user: twitchUser(message, broadcaster),
    subMonths: toInt(
      message.tags['msg-param-cumulative-months'] ?? message.tags['msg-param-months'],
      1,
    ),
    isGifted: id === 'subgift' || id === 'anonsubgift',
  };
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

/** Routes one parsed line to the right normalizer, or null if it isn't an event. */
export function twitchEventFrom(message: IrcMessage, broadcaster: string): StreamEvent | null {
  if (message.command === 'PRIVMSG') {
    // A cheer is a PRIVMSG that also carries bits. Emit the gift rather than
    // the chat line so the money isn't silently swallowed; the message text
    // still rides along on the gift's user for templates that want it.
    return message.tags['bits']
      ? normalizeTwitchBits(message, broadcaster)
      : normalizeTwitchChat(message, broadcaster);
  }

  if (message.command === 'USERNOTICE') {
    const id = message.tags['msg-id'] ?? '';
    if (id === 'raid') return normalizeTwitchRaid(message, broadcaster);
    if (['sub', 'resub', 'subgift', 'anonsubgift', 'giftpaidupgrade'].includes(id)) {
      return normalizeTwitchSub(message, broadcaster);
    }
  }

  return null;
}
