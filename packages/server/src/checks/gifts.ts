/**
 * Per-platform gift and emote checks.
 *
 * Covers what each platform's normalizer builds for paid support and for
 * emotes, the shared helpers they lean on, and the rules that decide what the
 * gift sources show. All offline: fixtures only, no server.
 */
import {
  describeShare,
  expandBeanCodes,
  BEAN_EMOJI_CODES,
  mapTextParts,
  approxCents,
  argbToCss,
  bracketFor,
  bracketSound,
  createOverlay,
  DEFAULT_OVERLAYS,
  defaultSettingsFor,
  defaultSoundSettings,
  PLATFORMS,
  bandForCents,
  cheerTier,
  clearsMinimum,
  describeEvent,
  describeGift,
  describeSubscribe,
  findCheers,
  globalCheermoteUrl,
  insertEmotes,
  matchMediaRule,
  replaceRanges,
  resolveGiftSound,
  stripCheers,
  subscriptionWeight,
  type GiftEvent,
  type GiftMediaRule,
  type OverlaySettings,
  type SubscribeEvent,
} from '@streaming/shared';

type AlertsSettings = Extract<OverlaySettings, { type: 'alerts' }>;
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
  check('and offers nothing to show until the filter has seen it', cheer.detail.displayMessage, null);
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
  check('a Power-up message is not shown until filtered', [effect.detail.message, effect.detail.displayMessage], ['look at me', null]);

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
  check('and not shown until filtered', paid.detail.displayMessage, null);
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
  check('and not shown until filtered', sc.detail.displayMessage, null);
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
function settingsDefaults(type: 'giftSpotlight' | 'giftRain' | 'alerts'):Record<string, any> | undefined {
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

  // Which sound a source plays, in the order rule, price bracket, single sound.
  const on = { ...defaultSoundSettings(true), volume: 0.5 };
  const off = defaultSoundSettings(false);
  const hundred = bits(100);
  check('price sounds on: the bracket plays at bracket volume x master', resolveGiftSound(hundred, null, { sounds: on }), { sound: 'builtin:coin', volume: 0.5 * 0.8 });
  check('a rule sound beats the bracket', resolveGiftSound(hundred, '/media/galaxy.mp3', { sounds: on })?.sound, '/media/galaxy.mp3');
  check('and plays at the price volume while those are on', resolveGiftSound(hundred, '/media/galaxy.mp3', { sounds: on, soundVolume: 0.2 })?.volume, 0.5);
  check('price sounds off, none set: silence', resolveGiftSound(hundred, null, { sounds: off }), null);
  check('price sounds off: the single sound at its own volume', resolveGiftSound(hundred, null, { sounds: off, soundUrl: '/media/ding.mp3', soundVolume: 0.3 }), { sound: '/media/ding.mp3', volume: 0.3 });
  check('price sounds off: a rule sound still plays', resolveGiftSound(hundred, '/media/galaxy.mp3', { sounds: off, soundVolume: 0.3 }), { sound: '/media/galaxy.mp3', volume: 0.3 });
  check('with no volume of its own it uses the sounds volume', resolveGiftSound(hundred, '/media/galaxy.mp3', { sounds: { ...off, volume: 0.9 } })?.volume, 0.9);
  check('bracketSound is silent with settings missing', bracketSound(hundred, undefined), null);
}

console.log('\nconfig defaults');
{
  const spotlight = settingsDefaults('giftSpotlight');
  check('old spotlight config gains name effect', spotlight?.nameEffect?.motion, 'wave');
  check('old spotlight config gains sounds, on', spotlight?.sounds?.enabled, true);
  const alerts = settingsDefaults('alerts');
  check('existing alerts keep their look', alerts?.nameEffect?.motion, 'none');
  check('existing alerts keep their single sound', alerts?.giftSounds?.enabled, false);

  // Both gift sources read their feed fields back from the schema the same way.
  const rain = settingsDefaults('giftRain');
  check('old rain config gains a minimum for every platform', Object.keys(rain?.minValue ?? {}).sort(), [...PLATFORMS].sort());
  check('rain keeps its sounds off', rain?.sounds?.enabled, false);
  check('spotlight and rain share the minimums', rain?.minValue, spotlight?.minValue);

  // A default that is one shared object would let editing one parsed config
  // change what the next one starts from.
  spotlight?.nameEffect?.colors?.push('#000000');
  if (spotlight?.minValue) spotlight.minValue.tiktok = 999;
  const again = settingsDefaults('giftSpotlight');
  check('parsed defaults do not share their colours', again?.nameEffect?.colors?.length, 3);
  check('or their minimums', again?.minValue?.tiktok, 1);

  const seeded = DEFAULT_OVERLAYS.find((o) => o.type === 'alerts')?.settings as AlertsSettings | undefined;
  const created = defaultSettingsFor('alerts') as AlertsSettings;
  check('a seeded alerts source starts like a new one: name', seeded?.alerts.nameEffect, created.alerts.nameEffect);
  check('and its gift sounds', seeded?.alerts.giftSounds, created.alerts.giftSounds);
}

console.log('\nTikTok mascot stickers sent as text');
{
  const url = (name: string): string =>
    `https://p16-tiktok-livestudio-asset-sg.ibyteimg.com/tos-alisg-i-x0wz2yqgvw-sg/${name}.webp`;

  check('a bare code becomes a picture', expandBeanCodes(undefined, '[sagethink]'), [
    { type: 'emote', name: '[sagethink]', url: url('sagethink') },
  ]);
  check('text around it is kept', expandBeanCodes(undefined, 'hmm [sagethink] ok'), [
    { type: 'text', text: 'hmm ' },
    { type: 'emote', name: '[sagethink]', url: url('sagethink') },
    { type: 'text', text: ' ok' },
  ]);
  check(
    'every code in a run is replaced',
    expandBeanCodes(undefined, '[wow][wow]')?.filter((p) => p.type === 'emote').length,
    2,
  );
  check('a code we do not know stays text', expandBeanCodes(undefined, 'see [note] below'), undefined);
  check('the match is exact, not case-insensitive', expandBeanCodes(undefined, '[Wow]'), undefined);
  check('a plain message stays plain', expandBeanCodes(undefined, 'hello there'), undefined);
  check('and an empty one', expandBeanCodes(undefined, ''), undefined);

  // A fan-club emote is already placed; the code beside it must not move it.
  const placed = insertEmotes('look [wow]', [{ index: 5, name: '[emote]', url: 'fan' }]);
  check('fan-club emotes keep their place', expandBeanCodes(placed, 'look [wow]'), [
    { type: 'text', text: 'look ' },
    { type: 'emote', name: '[emote]', url: 'fan' },
    { type: 'emote', name: '[wow]', url: url('wow') },
  ]);
  check('the list matches what TikTok LIVE Studio ships', BEAN_EMOJI_CODES.length, 24);

  // Through the real normalizer, the way a webcast message arrives.
  const viaNormalizer = normalizeChat({ user: { nickname: 'A' }, content: 'ha [sagethink]' } as never, 'host');
  check('a TikTok chat message gets the picture', viaNormalizer.parts, [
    { type: 'text', text: 'ha ' },
    { type: 'emote', name: '[sagethink]', url: url('sagethink') },
  ]);
  check('while its text stays as sent, for the filter and speech', viaNormalizer.text, 'ha [sagethink]');
}

console.log('\nstickers survive the filter changing the text');
{
  // Positions were measured against the text as sent. A cleaner that changes
  // its length — "…" becomes "..." — must not cost the message its pictures.
  const sticker = { type: 'emote', name: '[emote]', url: 'u' } as const;
  const dots = (text: string): string | null => text.replace('…', '...');

  check(
    'a changed stretch keeps the sticker beside it',
    mapTextParts([{ type: 'text', text: 'wait… ' }, sticker, { type: 'text', text: ' ok' }], dots),
    [{ type: 'text', text: 'wait... ' }, sticker, { type: 'text', text: ' ok' }],
  );
  check(
    'a stretch the filter drops leaves the sticker standing',
    mapTextParts([{ type: 'text', text: 'badword' }, sticker], () => null),
    [sticker],
  );
  check('an emote-only message is untouched', mapTextParts([sticker], dots), [sticker]);
  check(
    'the space beside a sticker is kept, so words do not run into it',
    mapTextParts([{ type: 'text', text: 'hi ' }, sticker, { type: 'text', text: ' there' }], (t) => t),
    [{ type: 'text', text: 'hi ' }, sticker, { type: 'text', text: ' there' }],
  );
  check(
    'but no stray space appears where there was none',
    mapTextParts([{ type: 'text', text: 'hi' }, sticker], (t) => t),
    [{ type: 'text', text: 'hi' }, sticker],
  );
}

console.log('\nwhat a share says');
{
  // The same field is a raid's size on Twitch and a share tally on TikTok.
  // Only the first is a count of people who arrived.
  const share = (platform: string, shareCount: number) => ({ platform, shareCount }) as never;
  check('a TikTok share does not claim viewers', describeShare(share('tiktok', 12)), 'shared the stream');
  check('and neither does a single one', describeShare(share('tiktok', 1)), 'shared the stream');
  check('a Twitch raid does', describeShare(share('twitch', 40)), 'raided with 40 viewers');
  check('a one-person raid does not pluralise', describeShare(share('twitch', 1)), 'raided the channel');
}

console.log('\nwhat an event says');
{
  // One wording for the chat log, the event log and the chat overlay.
  const ev = (fields: Record<string, unknown>) => fields as never;
  check('a follow', describeEvent(ev({ type: 'follow' })), 'followed');
  check('a join', describeEvent(ev({ type: 'join' })), 'joined');
  check('likes say how many', describeEvent(ev({ type: 'like', likeCount: 7 })), 'sent 7 likes');
  check('a treasure box says its size', describeEvent(ev({ type: 'envelope', coins: 500 })), 'dropped a 500-coin treasure box');
  check('a question carries its text', describeEvent(ev({ type: 'question', text: 'why?' })), 'asked: why?');
  check('an emote', describeEvent(ev({ type: 'emote' })), 'sent an emote');
  check('the viewer count', describeEvent(ev({ type: 'roomStats', viewerCount: 120 })), '120 viewers');
  check('a system line is its own text', describeEvent(ev({ type: 'system', text: 'Connected' })), 'Connected');
  check('a share goes through the platform wording', describeEvent(ev({ type: 'share', platform: 'twitch', shareCount: 40 })), 'raided with 40 viewers');
  check('chat is left to each surface', describeEvent(ev({ type: 'chat', text: 'hi' })), null);
  const cheered = twitch(
    '@bits=250;display-name=Bob;user-id=1 :bob!bob@bob.tmi.twitch.tv PRIVMSG #streamer :Cheer250 hype!',
  ) as GiftEvent;
  check('a gift says nothing of its message until the filter has seen it', describeEvent(cheered), 'cheered 250 bits');
  cheered.detail.displayMessage = cheered.detail.message;
  check('and carries it after', describeEvent(cheered), 'cheered 250 bits: hype!');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
