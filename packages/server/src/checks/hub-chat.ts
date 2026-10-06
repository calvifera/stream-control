/**
 * The Hub's chat path, end to end, with no network and no server.
 *
 * Everything between "a chat event arrives" and "speech is queued or turned
 * away" runs here for real: the word filter, strikes, the penalty box, trust
 * scoring and what trust holds back. Until now only `check:api` and
 * `check:penalty` reached it, and both need a running server, so a change to
 * this path could pass every offline check and still change who gets spoken
 * over. This is the net under that path.
 *
 * Speech itself is stubbed — the engine would call out to a voice service —
 * so what is asserted is what the rules *decided*, which is the outcome and
 * the queue, not the sound.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTemplateVars, type ChatEvent, type GiftEvent, type TestEventSpec } from '@streaming/shared';

// Before anything is imported: the hub and the directory write under DATA_DIR,
// which is resolved once when `env.ts` loads.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-chat-check-'));
process.env.DATA_DIR = SANDBOX;
process.env.LOG_LEVEL = 'error';

const { Hub } = await import('../hub.js');
const { createTestEvent } = await import('../testEvents.js');

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
    console.log(`         expected ${JSON.stringify(expected)}`);
    console.log(`         actual   ${JSON.stringify(actual)}`);
  }
}

const hub = new Hub();
const queued: string[] = [];
// The engine would synthesise and play; what matters here is whether the rules
// asked it to.
hub.tts.enqueue = (item) => {
  queued.push(item.text);
  return null as never;
};

const READ_CHAT = 'Read chat (followers only)';

/** A known, quiet starting point for every scenario. */
function reset(over: Record<string, unknown> = {}): void {
  hub.config.reset();
  hub.config.update({
    users: {
      severe: { words: ['gebeta'], phrases: [], regex: [] },
      autoPenalty: {
        enabled: true,
        strikesBeforePenalty: 3,
        onlyCountEvasion: true,
        exemptTrusted: true,
      },
      penaltyBox: [],
      trusted: [],
    },
    tts: { enabled: true, userCooldownSeconds: 0 },
    trust: { enabled: true, holdNewViewers: false },
    ...over,
  });
  hub.trust.reset();
  hub.rules.resetCooldowns();
  queued.length = 0;
}

/**
 * One chat line from a named viewer. Followers by default, because the stock
 * rule reads followers only and a message that never reaches speech for that
 * reason would hide what these checks are about.
 */
function say(text: string, username: string, who: Partial<TestEventSpec> = {}) {
  const event = createTestEvent({
    type: 'chat',
    platform: 'tiktok',
    text,
    username,
    isFollower: true,
    ...who,
  }) as ChatEvent;
  const outcome = hub.handleEvent(event);
  return { event, outcome };
}

const strikesOf = (username: string): number => hub.directory.get(`tiktok:${username}`)?.strikes ?? 0;
const inPenaltyBox = (username: string): boolean =>
  hub.config.get().users.penaltyBox.some((entry) => entry.username.endsWith(username));

console.log('\nHub chat path\n');

console.log('an ordinary message');
reset();
{
  const { event, outcome } = say('hello everyone', 'plain');
  check('is spoken by the stock rule', outcome.spoke, [READ_CHAT]);
  check('is queued for speech', queued.length, 1);
  check('carries a trust verdict, not held', event.trust, { score: 35, band: 'new', held: null, signals: [] });
  check('is not marked filtered', outcome.filtered, false);
}

console.log('\na severe term, typed plainly');
reset();
{
  const { event, outcome } = say('gebeta', 'blunt');
  check('is dropped by the filter', [outcome.filtered, event.displayText], [true, null]);
  check('is not spoken', outcome.spoke, []);
  check('earns no strike while only evasion counts', strikesOf('blunt'), 0);
  check('is not "held" -- the filter already stopped it', event.trust?.held, null);
}

console.log('\na severe term, disguised');
reset();
{
  const { event, outcome } = say('ገበታ', 'evader');
  check('is dropped by the filter', outcome.filtered, true);
  check('earns a strike', strikesOf('evader'), 1);
  check('is reported as a disguised spelling', event.trust?.signals, ['disguised spelling']);
}

console.log('\nretrying a blocked term');
reset();
{
  say('gebeta', 'retrier');
  check('the first block is not itself a strike', strikesOf('retrier'), 0);
  say('knee grow gebeta', 'retrier');
  check('a second try right after strikes', strikesOf('retrier'), 1);
  say('g e b e t a', 'retrier');
  check('and a third', strikesOf('retrier'), 2);
  check('below the threshold nobody is boxed', inPenaltyBox('retrier'), false);
  say('gebeta', 'retrier');
  check('the strike that reaches the threshold boxes them', [strikesOf('retrier'), inPenaltyBox('retrier')], [3, true]);

  const profile = hub.viewerProfile('tiktok:retrier');
  check('and the card shows them muted', profile?.muted, true);
  check('with this stream\'s filtered count', profile?.session.filtered, 4);
  check('and the strikes', profile?.lifetime?.strikes, 3);
}

console.log('\na message that is both disguised and a retry');
reset();
{
  say('ገበታ', 'both');
  say('ገበታ', 'both');
  check('earns one strike each, not two', strikesOf('both'), 2);
}

console.log('\nan exempt viewer');
reset();
{
  hub.config.update({ users: { trusted: ['tiktok:regular'] } });
  say('ገበታ', 'regular');
  check('is never struck', strikesOf('regular'), 0);
}

console.log('\nwhat trust holds back from speech');
reset();
{
  const { event, outcome } = say('gaybeta', 'soundalike');
  check('a sound-alike from a stranger is held', event.trust?.held, 'low trust: sounds like a severe term');
  check('so nothing is spoken', [outcome.spoke, queued.length], [[], 0]);
  check('and the test panel is told why', outcome.declined, [
    { rule: 'Trust score', reason: 'low trust: sounds like a severe term' },
  ]);
  check('while the line still reaches chat as itself', event.displayText, 'gaybeta');

  const odd = say('h e l l o t h e r e', 'oddspell');
  check('oddly spelled text from a stranger is held', odd.event.trust?.held, 'low trust: spaced-out letters');
  check('and says which signal', odd.outcome.declined, [
    { rule: 'Trust score', reason: 'low trust: spaced-out letters' },
  ]);
  const card = hub.viewerProfile('tiktok:oddspell');
  check('the card counts it as not read', card?.session.held, 1);
  check('and says why on the message', card?.recent[0]?.held, 'low trust: spaced-out letters');
}

console.log('\nwho is not held');
reset();
{
  hub.config.update({ users: { trusted: ['tiktok:vip'] } });
  const vip = say('h e l l o t h e r e', 'vip');
  check('someone on the trusted list', [vip.event.trust?.band, vip.event.trust?.held, vip.outcome.spoke], ['trusted', null, [READ_CHAT]]);
  const mod = say('h e l l o t h e r e', 'themod', { isModerator: true });
  check('a moderator', [mod.event.trust?.band, mod.event.trust?.held, mod.outcome.spoke], ['trusted', null, [READ_CHAT]]);
  const sub = say('h e l l o t h e r e', 'subscriber', { isSubscriber: true });
  check('a subscriber, who is not in strict mode', [sub.event.trust?.held, sub.outcome.spoke], [null, [READ_CHAT]]);
}

console.log('\nthe new-viewer hold');
reset({ trust: { enabled: true, holdNewViewers: true, holdMessages: 3, holdMinutes: 5 } });
{
  const first = say('hi', 'newcomer');
  check('holds a first-time viewer', first.event.trust?.held, 'new viewer: speech starts after 3 messages or 5 minutes');
  check('and says so to the test panel', first.outcome.declined, [
    { rule: 'Trust score', reason: 'new viewer: speech starts after 3 messages or 5 minutes' },
  ]);
  const sub = say('hi', 'newsub', { isSubscriber: true });
  check('does not hold a subscriber', [sub.event.trust?.held, sub.outcome.spoke], [null, [READ_CHAT]]);
}

console.log('\nswitches');
reset({ tts: { enabled: false } });
{
  const { event, outcome } = say('h e l l o t h e r e', 'quiet');
  check('with speech off nothing is spoken or declined', [outcome.spoke, outcome.declined], [[], []]);
  check('but the verdict is still stamped on the line', event.trust?.held, 'low trust: spaced-out letters');
}
reset({ trust: { enabled: false } });
{
  const { event, outcome } = say('h e l l o t h e r e', 'untracked');
  check('with trust off, nothing is held', [event.trust?.held, outcome.spoke], [null, [READ_CHAT]]);
}

console.log('\na muted viewer who would also be held');
reset();
{
  hub.config.update({
    users: { penaltyBox: [{ username: 'tiktok:boxed', displayName: 'boxed', reason: 'test', addedAt: 1, automatic: false, evidence: null }] },
  });
  const { outcome } = say('h e l l o t h e r e', 'boxed');
  check('is turned away by the penalty box, which is the stronger reason', outcome.declined, [
    { rule: 'Penalty box', reason: 'muted from TTS' },
  ]);
}

console.log('\npictures in a cleaned message');
reset({ filters: { action: 'censor', blockedWords: ['fiddlesticks'], censorReplacement: '***' } });
{
  const event = createTestEvent({ type: 'chat', platform: 'tiktok', text: 'oh :x: fiddlesticks nice', username: 'sticker', isFollower: true }) as ChatEvent;
  event.parts = [
    { type: 'text', text: 'oh ' },
    { type: 'emote', name: ':x:', url: 'https://example.test/x.png' },
    { type: 'text', text: ' fiddlesticks nice' },
  ];
  hub.handleEvent(event);
  check('the line is censored, not dropped', [event.filtered, event.displayText], [true, 'oh :x: *** nice']);
  check('its pictures are refitted to the cleaned text', event.displayParts, [
    { type: 'text', text: 'oh ' },
    { type: 'emote', name: ':x:', url: 'https://example.test/x.png' },
    { type: 'text', text: ' *** nice' },
  ]);
  check('while the original parts are left as sent', event.parts?.[2], { type: 'text', text: ' fiddlesticks nice' });
}

console.log('\nthe message that comes with a gift');
{
  const gift = (platform: 'twitch' | 'youtube', text: string, username: string): GiftEvent => {
    const event = createTestEvent({ type: 'gift', platform, text, username, diamonds: platform === 'twitch' ? 100 : 500 });
    hub.handleEvent(event);
    return event as GiftEvent;
  };

  reset();
  const blocked = gift('youtube', 'gebeta', 'sc-blocked');
  check('a Super Chat carrying a blocked word shows nothing', [blocked.detail.message, blocked.detail.displayMessage], ['gebeta', null]);
  check('and says nothing to the speech template either', buildTemplateVars(blocked).message, '');

  const cheer = gift('twitch', 'gebeta', 'cheer-blocked');
  check('a cheer is held to the same filter', cheer.detail.displayMessage, null);

  const clean = gift('twitch', 'nice one', 'cheer-clean');
  check('a clean message is shown as sent', clean.detail.displayMessage, 'nice one');

  reset({ filters: { action: 'censor', blockedWords: ['fiddlesticks'], censorReplacement: '***' } });
  const censored = gift('youtube', 'oh fiddlesticks', 'sc-censored');
  check('a censored one is shown censored', censored.detail.displayMessage, 'oh ***');

  const tiktok = createTestEvent({ type: 'gift', platform: 'tiktok', username: 'rose', diamonds: 1 }) as GiftEvent;
  hub.handleEvent(tiktok);
  check('a gift with no message has none to show', [tiktok.detail.message, tiktok.detail.displayMessage], [null, null]);
}

console.log('\nconnecting Twitch and YouTube');
reset();
{
  // The managers would open a real connection; what is checked is what the hub
  // records about it.
  const asked: string[] = [];
  hub.twitch.connect = ((channel?: string) => void asked.push(`twitch:${channel ?? ''}`)) as never;
  hub.youtube.connect = (() => void asked.push('youtube')) as never;

  hub.connectTwitch('somechannel');
  check('connecting Twitch turns it on and keeps the channel', [hub.config.get().twitch.enabled, hub.config.get().twitch.channel], [true, 'somechannel']);
  hub.disconnectTwitch();
  check('disconnecting turns it off', hub.config.get().twitch.enabled, false);
  hub.connectTwitch();
  check('connecting with no channel uses the saved one, and turns it back on', [hub.config.get().twitch.enabled, hub.config.get().twitch.channel, asked.at(-1)], [true, 'somechannel', 'twitch:']);

  hub.connectYouTube('@somehandle');
  check('a YouTube handle is routed to the handle field', [hub.config.get().youtube.handle, hub.config.get().youtube.videoId, hub.config.get().youtube.enabled], ['@somehandle', '', true]);
  hub.connectYouTube('dQw4w9WgXcQ');
  check('and a video id to the other, clearing the first', [hub.config.get().youtube.handle, hub.config.get().youtube.videoId], ['', 'dQw4w9WgXcQ']);
  hub.connectYouTube();
  check('connecting with nothing typed keeps what was saved', [hub.config.get().youtube.videoId, asked.at(-1)], ['dQw4w9WgXcQ', 'youtube']);
  hub.disconnectYouTube();
  check('and disconnecting turns it off', hub.config.get().youtube.enabled, false);
}

console.log('\na viewer\'s profile link');
reset();
{
  say('hello', 'linkperson');
  check('is built from the record for a TikTok viewer', hub.viewerProfileUrl('tiktok:linkperson'), 'https://www.tiktok.com/@linkperson');
  check('is null for someone never seen', hub.viewerProfileUrl('tiktok:nobody-at-all'), null);
  const ytChannel = 'UC' + 'a'.repeat(22);
  const yt = createTestEvent({ type: 'chat', platform: 'youtube', text: 'hi', username: 'ytperson' }) as ChatEvent;
  hub.handleEvent(yt);
  check('is null for a YouTube viewer whose channel id was never seen', hub.viewerProfileUrl('youtube:ytperson'), null);
  yt.user.userId = ytChannel;
  check('and uses the channel id when there is one', hub.viewerProfileUrl('youtube:ytperson'), `https://www.youtube.com/channel/${ytChannel}`);
}

console.log('\nthe profile card');
reset();
{
  check('is null for someone never seen', hub.viewerProfile('tiktok:nobody'), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
await hub.dispose();
process.exit(failed > 0 ? 1 : 0);
