/**
 * Watch-page chat normalization.
 *   npm run check:innertube -w @streaming/server
 *
 * Fixtures rather than a live stream: this has to run when nobody is
 * broadcasting, and a check that depends on a stranger being live is a check
 * that fails for reasons having nothing to do with the code.
 *
 * Two things here are worth defending. Identity, because the whole promise of
 * having two YouTube sources is that switching between them mid-stream does
 * not split one viewer into two — which only holds while both key on the
 * channel id. And money, because the watch page never sends a machine amount,
 * only the string a viewer saw, and every currency writes it differently.
 */
import {
  centsFromText,
  innertubeEventFrom,
  runsToEmotes,
  runsToText,
} from '../youtube/innertubeNormalize.js';

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

const CHANNEL = 'UC0KQUEcYqORuIZzANJ70Oqw';

const action = (kind: string, renderer: Record<string, unknown>) => ({
  addChatItemAction: { item: { [kind]: renderer } },
});

const author = (extra: Record<string, unknown> = {}) => ({
  id: 'msg-1',
  timestampUsec: '1756800000000000',
  authorName: { simpleText: 'Someone' },
  authorPhoto: { thumbnails: [{ url: 'small.jpg' }, { url: 'large.jpg' }] },
  authorExternalChannelId: CHANNEL,
  ...extra,
});

console.log('\nmessage text\n');

check('plain runs are joined', runsToText([{ text: 'hello ' }, { text: 'chat' }]), 'hello chat');

check(
  'standard emoji keep their character',
  runsToText([{ text: 'hi ' }, { emoji: { emojiId: '🎉', isCustomEmoji: false } }]),
  'hi 🎉',
);

check(
  'custom emotes fall back to their shortcut',
  runsToText([{ emoji: { emojiId: 'abc', isCustomEmoji: true, shortcuts: [':_sagethink:'] } }]),
  ':_sagethink:',
);

check(
  'custom emote images are collected',
  runsToEmotes([
    { text: 'hi' },
    {
      emoji: {
        isCustomEmoji: true,
        shortcuts: [':_x:'],
        image: { thumbnails: [{ url: 'tiny.png' }, { url: 'big.png' }] },
      },
    },
  ]),
  ['big.png'],
);

console.log('\nmoney, as a viewer saw it written\n');

for (const [text, want] of [
  ['$5.00', 500],
  ['£3', 300],
  // No minor unit, so the digits are the whole amount.
  ['¥500', 50000],
  ['R$ 10,00', 1000],
  ['€2,50', 250],
  ['$1,234.56', 123456],
  ['', 0],
] as const) {
  check(`${text || '(empty)'} -> ${want} cents`, centsFromText(text), want);
}

console.log('\nevent mapping\n');

{
  const event = innertubeEventFrom(
    action('liveChatTextMessageRenderer', author({ message: { runs: [{ text: 'hey' }] } })),
  );
  check('a text message becomes a chat event', event?.type, 'chat');
  // The invariant the whole two-source design rests on.
  check('keyed on the channel id, lowercased', event?.user?.uniqueId, CHANNEL.toLowerCase());
  check('the largest avatar thumbnail wins', event?.user?.avatarUrl, 'large.jpg');
  check('the renderer id is reused as the event id', event?.id, 'msg-1');
}

{
  const event = innertubeEventFrom(
    action(
      'liveChatPaidMessageRenderer',
      author({ message: { runs: [{ text: 'nice' }] }, purchaseAmountText: { simpleText: '$5.00' } }),
    ),
  );
  check('a super chat becomes a gift', event?.type, 'gift');
  check('worth its amount in cents', event?.type === 'gift' && event.totalDiamonds, 500);
}

{
  const event = innertubeEventFrom(action('liveChatMembershipItemRenderer', author()));
  check('a membership becomes a subscribe', event?.type, 'subscribe');
  check('not marked as gifted', event?.type === 'subscribe' && event.isGifted, false);
}

{
  const event = innertubeEventFrom(
    action('liveChatSponsorshipsGiftPurchaseAnnouncementRenderer', author()),
  );
  check('a gifted membership is marked gifted', event?.type === 'subscribe' && event.isGifted, true);
}

console.log('\nbadges\n');

{
  const mod = innertubeEventFrom(
    action(
      'liveChatTextMessageRenderer',
      author({
        message: { runs: [{ text: 'x' }] },
        authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' } } }],
      }),
    ),
  );
  check('a named icon marks a moderator', mod?.user?.isModerator, true);

  const member = innertubeEventFrom(
    action(
      'liveChatTextMessageRenderer',
      author({
        message: { runs: [{ text: 'x' }] },
        // A paying member has a custom image and no named icon at all, which
        // is the only thing distinguishing them.
        authorBadges: [
          { liveChatAuthorBadgeRenderer: { customThumbnail: { thumbnails: [{ url: 'b.png' }] } } },
        ],
      }),
    ),
  );
  check('a custom badge image marks a member', member?.user?.isSubscriber, true);
  check('and not a moderator', member?.user?.isModerator, false);
}

console.log('\nthings with no equivalent\n');

check(
  'the viewer engagement notice is skipped',
  innertubeEventFrom(action('liveChatViewerEngagementMessageRenderer', author())),
  null,
);
check('an action with no chat item is skipped', innertubeEventFrom({ markChatItemAsDeletedAction: {} }), null);
check('nonsense is skipped rather than thrown at', innertubeEventFrom(null), null);

/* ------------------------------------------------------------------ *
 * Choosing what to read
 *
 * Every case here comes from one live failure. The Setup field learned to
 * accept a @handle, the Connect route kept writing whatever it was given
 * into `videoId`, and the reader went looking for a video called
 * "@calvifera" on a stream that was up and running.
 * ------------------------------------------------------------------ */

{
  const { findLiveChat } = await import('../youtube/innertube.js');

  const urlsTried = async (target: Parameters<typeof findLiveChat>[0]) => {
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: URL | string) => {
      seen.push(String(u));
      return new Response('', { status: 404 });
    }) as typeof fetch;
    await findLiveChat(target).catch(() => null);
    globalThis.fetch = real;
    return seen;
  };

  console.log('');
  console.log('which pages get tried');

  const blank = await urlsTried({ handle: '', channelId: 'UCchannel' });
  // '' .replace(/^@?/, '@') is '@', not '' — a blank handle became a real
  // looking one and shadowed the channel id that would have worked.
  check('a blank handle never becomes /@/', blank.some((u) => u.includes('/@/')), false);
  check('and the channel id is used instead', blank[0]?.includes('/channel/UCchannel/live'), true);

  const spaces = await urlsTried({ handle: '   ', channelId: 'UCchannel' });
  check('whitespace counts as blank too', spaces.some((u) => u.includes('/@/')), false);

  const both = await urlsTried({ handle: '@someone', channelId: 'UCchannel' });
  check('a real handle is tried first', both[0]?.includes('/@someone/live'), true);
  // A 404 on the handle used to throw, which meant the channel id behind it
  // was never reached — the fallback existed and could not be got to.
  check('and a 404 there falls through to the channel', both[1]?.includes('/channel/UCchannel/live'), true);

  const bare = await urlsTried({ handle: 'someone', channelId: '' });
  check('a handle without its @ still works', bare[0]?.includes('/@someone/live'), true);

  const video = await urlsTried({ videoId: 'abcdefghijk', handle: '@someone' });
  check('a video id wins outright', video[0]?.includes('watch?v=abcdefghijk'), true);
  check('and nothing else is tried', video.length, 1);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
