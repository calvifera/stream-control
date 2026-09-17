/**
 * Per-platform gift and emote checks.
 *
 * Covers what each platform's normalizer builds for paid support and for
 * emotes, the shared helpers they lean on, and the rules that decide what the
 * gift sources show. All offline: fixtures only, no server.
 */
import {
  approxCents,
  argbToCss,
  bracketFor,
  createOverlay,
  defaultSoundSettings,
  bandForCents,
  cheerTier,
  clearsMinimum,
  describeGift,
  describeSubscribe,
  findCheers,
  globalCheermoteUrl,
  insertEmotes,
  matchMediaRule,
  replaceRanges,
  stripCheers,
  subscriptionWeight,
  type GiftEvent,
  type GiftMediaRule,
  type SubscribeEvent,
} from '@streaming/shared';
import { normalizeChat, normalizeEmote } from '../tiktok/normalize.js';
import { parseIrc, twitchEventFrom } from '../twitch/normalize.js';
import { innertubeEventFrom } from '../youtube/innertubeNormalize.js';
import { youtubeEventFrom } from '../youtube/normalize.js';
import { SessionState } from '../state/session.js';
import { overlaySchema } from '../config/schema.js';

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

const twitch = (line: string) => twitchEventFrom(parseIrc(line)!, 'streamer');

console.log('\nGifts and emotes\n');

console.log('message parts');
{
  check(
    'TikTok emote spliced at its index',
    insertEmotes('hi there', [{ index: 3, name: '[emote]', url: 'u' }]),
    [
      { type: 'text', text: 'hi ' },
      { type: 'emote', name: '[emote]', url: 'u' },
      { type: 'text', text: 'there' },
    ],
  );
  check(
    'emote-only message (empty content) keeps the emote',
    insertEmotes('', [{ index: 0, name: '[emote]', url: 'u' }]),
    [{ type: 'emote', name: '[emote]', url: 'u' }],
  );
  check(
    'index past the end appends rather than dropping',
    insertEmotes('ab', [{ index: 99, name: 'x', url: 'u' }]).at(-1),
    { type: 'emote', name: 'x', url: 'u' },
  );
  check(
    'indices count code points, so an emoji before the emote does not shift it',
    insertEmotes('😀ab', [{ index: 1, name: 'x', url: 'u' }])[0],
    { type: 'text', text: '😀' },
  );
  check(
    'Twitch ranges replace the emote name',
    replaceRanges('hi LUL bye', [{ start: 3, end: 5, url: 'u', id: '1' }]),
    [
      { type: 'text', text: 'hi ' },
      { type: 'emote', name: 'LUL', url: 'u', id: '1' },
      { type: 'text', text: ' bye' },
    ],
  );
  check(
    'overlapping and out-of-range spans are ignored',
    replaceRanges('abc', [
      { start: 0, end: 1, url: 'a' },
      { start: 1, end: 2, url: 'b' },
      { start: 2, end: 9, url: 'c' },
    ]).filter((p) => p.type === 'emote').length,
    1,
  );
}

console.log('\nTikTok');
{
  const chat = normalizeChat(
    {
      content: 'love this ',
      user: { nickname: 'A', displayId: 'a' },
      emotes: [{ index: 10, emote: { emoteId: '77', image: { urlList: ['https://e/77.png'] } } }],
    } as never,
    '',
  );
  check('chat keeps the fan-club emote as a part', chat.parts?.[1], {
    type: 'emote',
    name: '[emote]',
    url: 'https://e/77.png',
    id: '77',
  });

  const emoteOnly = normalizeEmote(
    { user: { nickname: 'A' }, emoteList: [{ emoteId: '9', image: { urlList: ['https://e/9.png'] } }] } as never,
    '',
  );
  check('emote-only message has parts to draw', emoteOnly.parts?.length, 1);
}

console.log('\nTwitch cheers');
{
  check('tiers', [1, 99, 100, 999, 1000, 4999, 5000, 10000, 50000].map(cheerTier), [
    1, 1, 100, 100, 1000, 1000, 5000, 10000, 10000,
  ]);
  check(
    'global cheermote URL',
    globalCheermoteUrl(1500),
    'https://d3aqoihi2n8ty8.cloudfront.net/actions/cheer/dark/animated/1000/4.gif',
  );
  check('explicit Cheer tokens found', findCheers('Cheer100 Cheer50 gg', 150), [
    { prefix: 'cheer', bits: 150 - 50 },
    { prefix: 'cheer', bits: 50 },
  ]);
  check('ordinary words ending in numbers are not cheers', findCheers('level5 Cheer100', 100), [
    { prefix: 'cheer', bits: 100 },
  ]);
  check('custom prefix accepted when the total adds up', findCheers('corgo500 nice', 500), [
    { prefix: 'corgo', bits: 500 },
  ]);
  check('known prefixes decide when supplied', findCheers('corgo500 level5', 505, new Set(['corgo'])), [
    { prefix: 'corgo', bits: 500 },
  ]);
  check('cheer words stripped from the message', stripCheers('Cheer100 great  stream', [{ prefix: 'cheer', bits: 100 }]), 'great stream');

  const cheer = twitch(
    '@bits=250;display-name=Bob;user-id=1;badges= :bob!bob@bob.tmi.twitch.tv PRIVMSG #streamer :Cheer250 hype!',
  ) as GiftEvent;
  check('cheer is a gift', cheer.type, 'gift');
  check('cheer kind', cheer.detail.kind, 'twitch-cheer');
  check('cheer keeps its message, minus the cheer', cheer.detail.message, 'hype!');
  check('cheer animation is the tier GIF', cheer.detail.media.animationUrl, globalCheermoteUrl(250));
  check('cheer describes in bits', describeGift(cheer), 'cheered 250 bits');
}

console.log('\nTwitch Power-ups');
{
  const giant = twitch(
    '@msg-id=gigantified-emote-message;emotes=25:0-4,6-10/88:12-15;display-name=Bob;user-id=1 :bob!bob@bob.tmi.twitch.tv PRIVMSG #streamer :first ffff last',
  ) as GiftEvent;
  check('gigantify is a gift', giant.detail.kind, 'twitch-power-up');
  check('the last emote is the giant one', giant.detail.media.animationUrl?.includes('/88/'), true);
  check('unreported price is unknown, not free', giant.detail.value.known, false);
  check('unknown price clears any minimum', clearsMinimum(giant.detail, 0, { twitch: 1000 }), true);

  const effect = twitch(
    '@msg-id=animated-message;animation-id=rainbow-eclipse;display-name=Bob;user-id=1 :bob!bob@bob.tmi.twitch.tv PRIVMSG #streamer :look at me',
  ) as GiftEvent;
  check('message effect records its animation', effect.detail.kind === 'twitch-power-up' && effect.detail.animationId, 'rainbow-eclipse');

  const plain = twitch('@emotes=25:0-4;display-name=Bob;user-id=1 :bob!bob@bob.tmi.twitch.tv PRIVMSG #streamer :LUL x');
  check('ordinary chat gets emote parts', plain?.type === 'chat' && plain.parts?.[0]?.type, 'emote');
}

console.log('\nTwitch subs and gift bombs');
{
  const bomb = twitch(
    '@msg-id=submysterygift;msg-param-mass-gift-count=5;msg-param-sub-plan=1000;login=bob;display-name=Bob;user-id=1 :tmi.twitch.tv USERNOTICE #streamer',
  ) as SubscribeEvent;
  check('bomb carries its count', bomb.giftCount, 5);
  check('bomb weighs its count', subscriptionWeight(bomb), 5);
  check('bomb tier', bomb.tier, '1');
  check('bomb described', describeSubscribe(bomb), 'gifted 5 Tier 1 subs');

  const member = twitch(
    '@msg-id=subgift;msg-param-community-gift-id=123;msg-param-recipient-display-name=Amy;msg-param-sub-plan=1000;login=bob;user-id=1 :tmi.twitch.tv USERNOTICE #streamer',
  ) as SubscribeEvent;
  check('bomb recipient flagged', member.giftBombMember, true);
  check('bomb recipient weighs nothing', subscriptionWeight(member), 0);

  const single = twitch(
    '@msg-id=subgift;msg-param-recipient-display-name=Amy;msg-param-sub-plan=2000;login=bob;user-id=1 :tmi.twitch.tv USERNOTICE #streamer',
  ) as SubscribeEvent;
  check('single gift counts once', subscriptionWeight(single), 1);
  check('single gift names the recipient', describeSubscribe(single), 'gifted a Tier 2 sub to Amy');

  const prime = twitch('@msg-id=sub;msg-param-sub-plan=Prime;login=bob;user-id=1 :tmi.twitch.tv USERNOTICE #streamer') as SubscribeEvent;
  check('prime tier', prime.tier, 'prime');

  const session = new SessionState();
  for (const event of [bomb, member, member, member, member, member]) session.ingest(event);
  check('session counts a 5-bomb as 5, not 10', session.getStats().subscribers, 5);
}

console.log('\nYouTube colours');
{
  check('ARGB integer to CSS', argbToCss(4278239141), '#00bfa5');
  check('$5 band is green', bandForCents(500).name, 'green');
  check('$100 band is red', bandForCents(10000).tier, 7);
}

console.log('\nYouTube watch page');
{
  const author = { authorExternalChannelId: 'UCx', authorName: { simpleText: 'Viv' } };
  const paid = innertubeEventFrom({
    addChatItemAction: {
      item: {
        liveChatPaidMessageRenderer: {
          ...author,
          id: 'p1',
          purchaseAmountText: { simpleText: '¥500' },
          bodyBackgroundColor: 4280150454, // #1de9b6, green
          headerBackgroundColor: 4278239141,
          message: { runs: [{ text: 'thanks for the stream' }] },
        },
      },
    },
  }) as GiftEvent;
  check('Super Chat message kept', paid.detail.message, 'thanks for the stream');
  check('band read from the colour, not the yen amount', paid.detail.kind === 'youtube-super-chat' && paid.detail.tier, 3);
  check('amount label is what the viewer saw', paid.detail.value.label, '¥500');

  const sticker = innertubeEventFrom({
    addChatItemAction: {
      item: {
        liveChatPaidStickerRenderer: {
          ...author,
          purchaseAmountText: { simpleText: '$2.00' },
          sticker: {
            thumbnails: [{ url: '//lh3.googleusercontent.com/s.webp' }],
            accessibility: { accessibilityData: { label: 'dancing cat' } },
          },
        },
      },
    },
  }) as GiftEvent;
  check('sticker image made absolute', sticker.detail.media.animationUrl, 'https://lh3.googleusercontent.com/s.webp');
  check('sticker label', sticker.detail.kind === 'youtube-super-sticker' && sticker.detail.stickerLabel, 'dancing cat');

  const purchase = innertubeEventFrom({
    addChatItemAction: {
      item: {
        liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {
          authorExternalChannelId: 'UCbuyer',
          header: {
            liveChatSponsorshipsHeaderRenderer: {
              authorName: { simpleText: 'Buyer' },
              primaryText: { runs: [{ text: 'Gifted ' }, { text: '10' }, { text: ' memberships' }] },
            },
          },
        },
      },
    },
  }) as SubscribeEvent;
  check('gift purchase buyer read from the header', purchase.user.nickname, 'Buyer');
  check('gift purchase count', purchase.giftCount, 10);

  const redemption = innertubeEventFrom({
    addChatItemAction: { item: { liveChatSponsorshipsGiftRedemptionAnnouncementRenderer: author } },
  }) as SubscribeEvent;
  check('redemption is part of the purchase', subscriptionWeight(redemption), 0);

  const jewels = innertubeEventFrom({
    addChatItemAction: {
      item: {
        giftMessageViewModel: {
          id: 'j1',
          text: { content: 'sent Heart for 50 Jewels' },
          authorName: { content: '@fan' },
          giftImage: { sources: [{ url: 'https://g/heart.webp' }] },
        },
      },
    },
  }) as GiftEvent;
  check('Jewels gift parsed', [jewels.giftName, jewels.totalDiamonds, jewels.detail.kind], ['Heart', 50, 'youtube-jewels']);
  check('Jewels gifter keyed on handle, not merged into "unknown"', jewels.user.uniqueId, 'fan');

  const emoji = innertubeEventFrom({
    addChatItemAction: {
      item: {
        liveChatTextMessageRenderer: {
          ...author,
          message: {
            runs: [
              { text: 'hmm ' },
              { emoji: { emojiId: 'x', shortcuts: [':_sagethink:'], isCustomEmoji: true, image: { thumbnails: [{ url: 'https://e/s.png' }] } } },
            ],
          },
        },
      },
    },
  });
  check('member emoji becomes a picture', emoji?.type === 'chat' && emoji.parts?.[1], {
    type: 'emote',
    name: ':_sagethink:',
    url: 'https://e/s.png',
    id: 'x',
  });
}

console.log('\nYouTube Data API');
{
  const sc = youtubeEventFrom({
    snippet: {
      type: 'superChatEvent',
      superChatDetails: { amountMicros: '20000000', amountDisplayString: '$20.00', tier: 5, userComment: 'gg' },
    },
    authorDetails: { channelId: 'UCx', displayName: 'V' },
  }) as GiftEvent;
  check('Data API Super Chat comment kept', sc.detail.message, 'gg');
  check('Data API tier used', sc.detail.kind === 'youtube-super-chat' && sc.detail.tier, 5);

  const gifting = youtubeEventFrom({
    snippet: { type: 'membershipGiftingEvent', membershipGiftingDetails: { giftMembershipsCount: 3 } },
    authorDetails: { channelId: 'UCx' },
  }) as SubscribeEvent;
  check('Data API gift count', gifting.giftCount, 3);
}

console.log('\nmedia rules');
{
  const rule = (over: Partial<GiftMediaRule>): GiftMediaRule => ({
    id: 'r',
    enabled: true,
    platform: 'any',
    kinds: [],
    giftName: '',
    minValue: 0,
    mediaUrl: '/media/x.gif',
    soundUrl: '',
    ...over,
  });
  const cheer = twitch('@bits=1000;user-id=1 :bob!bob@x PRIVMSG #streamer :Cheer1000') as GiftEvent;

  check('first matching rule wins', matchMediaRule(cheer, [rule({ id: 'a' }), rule({ id: 'b' })])?.id, 'a');
  check('disabled rules skipped', matchMediaRule(cheer, [rule({ id: 'a', enabled: false }), rule({ id: 'b' })])?.id, 'b');
  check('platform filter', matchMediaRule(cheer, [rule({ platform: 'tiktok' })]), null);
  check('kind filter', matchMediaRule(cheer, [rule({ kinds: ['youtube-super-chat'] })]), null);
  check('minimum in native unit', matchMediaRule(cheer, [rule({ minValue: 5000 })]), null);
  check('minimum met', matchMediaRule(cheer, [rule({ id: 'big', minValue: 1000 })])?.id, 'big');
}

/**
 * A source saved before effects and sounds existed, read back through the
 * schema — which is exactly what happens to a real config file on upgrade.
 */
function settingsDefaults(type: 'giftSpotlight' | 'alerts'): Record<string, any> | undefined {
  const overlay = createOverlay(type, `old-${type.toLowerCase()}`) as unknown as { settings: Record<string, Record<string, unknown>> };
  const inner = overlay.settings[type] as Record<string, unknown>;
  for (const key of ['nameEffect', 'valueEffect', 'sounds', 'giftSounds']) delete inner[key];
  const parsed = overlaySchema.safeParse(overlay);
  if (!parsed.success) {
    console.log(parsed.error.issues);
    return undefined;
  }
  return (parsed.data.settings as Record<string, any>)[type];
}

console.log('\nprice brackets');
{
  const brackets = defaultSoundSettings().brackets;
  const at = (cents: number): string | undefined => bracketFor(cents, brackets)?.sound;
  const bits = (n: number) => twitch(`@bits=${n};user-id=1 :bob!bob@x PRIVMSG #streamer :Cheer${n}`) as GiftEvent;

  check('a single bit is a pop', at(approxCents(bits(1))), 'builtin:pop');
  check('100 bits is a coin', at(approxCents(bits(100))), 'builtin:coin');
  check('$5 sparkles', at(500), 'builtin:sparkle');
  check('$100 hits the jackpot', at(10000), 'builtin:jackpot');
  check('brackets need not be in order', bracketFor(600, [...brackets].reverse())?.id, 'medium');
  check('below every bracket is silence', bracketFor(5, [{ id: 'x', minCents: 100, sound: 'a', volume: 1 }]), null);

  const bomb = twitch(
    '@msg-id=submysterygift;msg-param-mass-gift-count=10;msg-param-sub-plan=1000;login=bob;user-id=1 :tmi.twitch.tv USERNOTICE #streamer',
  ) as SubscribeEvent;
  check('a 10-sub bomb is about $50', approxCents(bomb), 4990);
  const giant = twitch(
    '@msg-id=gigantified-emote-message;emotes=25:0-4;user-id=1 :bob!bob@x PRIVMSG #streamer :hello',
  ) as GiftEvent;
  check('an unpriced Power-up still earns a sound', at(approxCents(giant)), 'builtin:coin');
}

console.log('\nconfig defaults');
{
  const spotlight = settingsDefaults('giftSpotlight');
  check('old spotlight config gains name effect', spotlight?.nameEffect?.motion, 'wave');
  check('old spotlight config gains sounds, on', spotlight?.sounds?.enabled, true);
  const alerts = settingsDefaults('alerts');
  check('existing alerts keep their look', alerts?.nameEffect?.motion, 'none');
  check('existing alerts keep their single sound', alerts?.giftSounds?.enabled, false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
