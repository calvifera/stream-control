/**
 * YouTube live chat normalization checks.
 *
 * Two things here can be wrong in a way nobody notices for weeks.
 *
 * The first is identity. YouTube display names are neither unique nor stable,
 * so keying a viewer on one merges strangers into a single archive entry and
 * lets a rename escape a penalty. Every check below that touches `uniqueId`
 * is defending the channel id.
 *
 * The second is money. Super Chats arrive as currency and everything
 * downstream counts integers, so a conversion happens — and a conversion that
 * is off by a factor of ten makes every gift threshold and every leaderboard
 * position wrong while still looking entirely plausible.
 */
import {
  centsFrom,
  youtubeEventFrom,
  youtubeUser,
  type YouTubeChatMessage,
} from '../youtube/normalize.js';

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

const author = (over: Record<string, unknown> = {}) => ({
  channelId: 'UCabcdef123456',
  displayName: 'Some Viewer',
  profileImageUrl: 'https://yt3.example/photo.jpg',
  ...over,
});

const message = (snippet: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  ({
    id: 'msg-1',
    snippet: { publishedAt: '2026-08-26T12:00:00Z', ...snippet },
    authorDetails: author(over),
  }) as YouTubeChatMessage;

console.log('\nYouTube\n');

console.log('a viewer is their channel, not their name');
{
  const user = youtubeUser(author());
  // The whole point: two people can share a display name in one chat, and
  // anyone can change theirs mid-stream. Keying on it would merge strangers
  // in the archive and let a rename walk out of the penalty box.
  check('the handle is the channel id', user.uniqueId, 'ucabcdef123456');
  check('the id is too', user.userId, 'UCabcdef123456');
  check('the display name is kept for reading', user.nickname, 'Some Viewer');
  check('the avatar comes straight from the API', user.avatarUrl, 'https://yt3.example/photo.jpg');

  const renamed = youtubeUser(author({ displayName: 'Totally Different Now' }));
  check('a rename is the same person', renamed.uniqueId, user.uniqueId);

  const impostor = youtubeUser(author({ channelId: 'UCzzzzzz999999', displayName: 'Some Viewer' }));
  check('a shared display name is not', impostor.uniqueId === user.uniqueId, false);
}

console.log('\nroles mean what YouTube means by them');
{
  // The vocabulary trap this codebase has hit before: a YouTube "subscriber"
  // is free and corresponds to a follower elsewhere, while the paid tier is a
  // member. Only the paid one is reported, and it is what maps to
  // isSubscriber.
  const member = youtubeUser(author({ isChatSponsor: true }));
  check('a sponsor is a subscriber', member.isSubscriber, true);
  check('and carries the member badge', member.badges, ['member']);
  // Free subscription is not in the payload at all, so claiming to know it
  // would be inventing a fact.
  check('following is never claimed', member.isFollower, false);
  check('nor is a follow role', member.followRole, 0);

  const mod = youtubeUser(author({ isChatModerator: true }));
  check('a moderator is one', mod.isModerator, true);

  const owner = youtubeUser(author({ isChatOwner: true }));
  check('the owner is the host', owner.isHost, true);
  check('and badges say owner', owner.badges, ['owner']);

  const nobody = youtubeUser(author());
  check('a stranger claims nothing', [nobody.isSubscriber, nobody.isModerator, nobody.isHost], [false, false, false]);
  check('and has no badges', nobody.badges, []);
}

console.log('\nmoney becomes cents');
{
  // amountMicros is millionths, so $5.00 is 5,000,000. The factor here is
  // 10,000 — one order of magnitude out in either direction would silently
  // rescale every threshold and leaderboard position.
  check('$5.00 is 500', centsFrom({ amountMicros: '5000000' }), 500);
  check('$1.00 is 100', centsFrom({ amountMicros: '1000000' }), 100);
  check('$0.99 is 99', centsFrom({ amountMicros: '990000' }), 99);
  check('$100.00 is 10000', centsFrom({ amountMicros: '100000000' }), 10000);

  // Defensive: the field is documented as a string, arrives as one, and a
  // number would be just as valid JSON.
  check('a numeric amount works too', centsFrom({ amountMicros: 2500000 }), 250);
  check('nothing is zero', centsFrom(undefined), 0);
  check('garbage is zero, not NaN', centsFrom({ amountMicros: 'not a number' }), 0);
  check('negative is zero', centsFrom({ amountMicros: '-5000000' }), 0);
}

console.log('\nsuper chats are gifts');
{
  const event = youtubeEventFrom(
    message({
      type: 'superChatEvent',
      superChatDetails: {
        amountMicros: '5000000',
        currency: 'USD',
        amountDisplayString: '$5.00',
        userComment: 'love the stream',
        tier: 4,
      },
    }),
  );

  check('it is a gift', event?.type, 'gift');
  check('worth the right amount', event?.type === 'gift' && event.totalDiamonds, 500);
  // The displayed string, not a converted number: an alert should say what
  // the viewer actually paid, in the currency they paid it in.
  check('named with what they paid', event?.type === 'gift' && event.giftName, 'Super Chat $5.00');
  check('and counts once', event?.type === 'gift' && event.repeatCount, 1);
  // Not streakable: unlike a TikTok combo there is no partial state to wait
  // for, so banking it immediately is correct.
  check('it is complete on arrival', event?.type === 'gift' && event.repeatEnd, true);

  const sticker = youtubeEventFrom(
    message({
      type: 'superStickerEvent',
      superStickerDetails: {
        amountMicros: '2000000',
        amountDisplayString: '$2.00',
        superStickerMetadata: { stickerId: 'abc', altText: 'waving cat' },
      },
    }),
  );
  check('a sticker is a gift too', sticker?.type, 'gift');
  check('worth its own amount', sticker?.type === 'gift' && sticker.totalDiamonds, 200);
  check('named for the sticker', sticker?.type === 'gift' && sticker.giftName, 'Super Sticker: waving cat');
}

console.log('\nmemberships are subscriptions');
{
  const joined = youtubeEventFrom(message({ type: 'newSponsorEvent', newSponsorDetails: { memberLevelName: 'Fan' } }));
  check('a new member subscribes', joined?.type, 'subscribe');
  check('not gifted', joined?.type === 'subscribe' && joined.isGifted, false);

  const milestone = youtubeEventFrom(
    message({ type: 'memberMilestoneChatEvent', memberMilestoneChatDetails: { memberMonth: 14 } }),
  );
  check('a milestone carries its months', milestone?.type === 'subscribe' && milestone.subMonths, 14);

  const received = youtubeEventFrom(message({ type: 'giftMembershipReceivedEvent' }));
  check('a received gift is gifted', received?.type === 'subscribe' && received.isGifted, true);
}

console.log('\nchat about the chat is not chat');
{
  // These describe moderation or chat state. Rendering them would put
  // "userBannedEvent" on stream, and counting them would inflate the session.
  for (const type of [
    'messageDeletedEvent',
    'userBannedEvent',
    'tombstone',
    'sponsorOnlyModeStartedEvent',
    'sponsorOnlyModeEndedEvent',
    'pollEvent',
  ]) {
    check(`${type} produces nothing`, youtubeEventFrom(message({ type })), null);
  }

  // The exception: the chat ending is worth saying out loud, because it is
  // the reason messages stop arriving.
  const ended = youtubeEventFrom(message({ type: 'chatEndedEvent' }));
  check('but the chat ending is announced', ended?.type, 'system');

  check('an unknown future type is ignored', youtubeEventFrom(message({ type: 'somethingNew' })), null);
  check('a message with no snippet is ignored', youtubeEventFrom({ id: 'x' }), null);
  check('an empty text message is ignored', youtubeEventFrom(message({ type: 'textMessageEvent' })), null);
}

console.log('\ntimestamps come from YouTube, not from arrival');
{
  // Polling means a batch can land seconds after it was sent. Ordering a chat
  // log by arrival rather than by when people spoke reads visibly wrong.
  const event = youtubeEventFrom(
    message({ type: 'textMessageEvent', textMessageDetails: { messageText: 'hi' }, publishedAt: '2026-08-26T12:00:00Z' }),
  );
  check('the publish time is used', event?.ts, Date.parse('2026-08-26T12:00:00Z'));

  const noTs = youtubeEventFrom(message({ type: 'textMessageEvent', textMessageDetails: { messageText: 'hi' }, publishedAt: undefined }));
  const drift = Math.abs((noTs?.ts ?? 0) - Date.now());
  check('a missing one falls back to now', drift < 5000, true);

  const bad = youtubeEventFrom(message({ type: 'textMessageEvent', textMessageDetails: { messageText: 'hi' }, publishedAt: 'not a date' }));
  check('and so does an unparseable one', Math.abs((bad?.ts ?? 0) - Date.now()) < 5000, true);
}

console.log('\nplain messages');
{
  const event = youtubeEventFrom(
    message({ type: 'textMessageEvent', textMessageDetails: { messageText: 'hello there' } }),
  );
  check('are chat', event?.type, 'chat');
  check('with the text intact', event?.type === 'chat' && event.text, 'hello there');
  check('unfiltered at this stage', event?.type === 'chat' && event.filtered, false);
  check('and attributed to youtube', event?.platform, 'youtube');

  // displayMessage is the fallback when textMessageDetails is absent, which
  // the API does for some localized responses.
  const fallback = youtubeEventFrom(message({ type: 'textMessageEvent', displayMessage: 'from display' }));
  check('displayMessage is the fallback', fallback?.type === 'chat' && fallback.text, 'from display');
}

/* ------------------------------------------------------------------ *
 * Quota exhaustion
 *
 * The one API failure that retrying cannot fix. Everything else — a 500, a
 * dropped socket, a token mid-refresh — deserves another attempt. This one is
 * a budget that does not refill until midnight Pacific, so a reconnect loop
 * spends a call every couple of minutes to be refused again, and leaves less
 * headroom for the next day than doing nothing at all.
 * ------------------------------------------------------------------ */

{
  const { YouTubeManager } = await import('../youtube/manager.js');
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

  const run = async (reply: () => Response) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => reply()) as typeof fetch;

    const manager = new YouTubeManager(
      {
        enabled: true,
        source: 'api' as const,
        moderation: { enabled: false, timeoutSeconds: 300, includeAutomatic: false },
        handle: '',
        videoId: '',
        autoReconnect: true,
        reconnectDelaySeconds: 15,
        connectOnStartup: false,
        pollIntervalMs: 3000,
      },
      { userToken: async () => 'token' } as never,
    );

    const states: string[] = [];
    manager.on('state', (st: { status: string }) => states.push(st.status));
    manager.connect();
    await settle();

    const pending = Boolean((manager as unknown as { reconnectTimer: unknown }).reconnectTimer);
    manager.disconnect();
    globalThis.fetch = real;
    return { states, pending };
  };

  console.log('');
  console.log('quota exhaustion');
  const quota = await run(
    () =>
      new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), {
        status: 403,
      }),
  );
  check('does not schedule a reconnect', quota.pending, false);
  check('never enters the reconnecting state', quota.states.includes('reconnecting'), false);

  console.log('');
  console.log('an ordinary failure, for contrast');
  // Without this, the checks above would still pass if retries were simply
  // broken — a different bug wearing the same result.
  const transient = await run(() => new Response('upstream blew up', { status: 500 }));
  check('still schedules a reconnect', transient.pending, true);
}

/* ------------------------------------------------------------------ *
 * The backlog on connect
 *
 * Asked for a chat with no pageToken, the API answers with what has already
 * been said. TikTok and Twitch deliver live messages and nothing else, so
 * that difference is invisible until you join a busy chat an hour in and the
 * whole hour arrives at once — spoken aloud, drawn in overlays, archived, and
 * weighed for penalties, all long after the fact.
 * ------------------------------------------------------------------ */

{
  const { YouTubeManager } = await import('../youtube/manager.js');
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

  const message = (id: string, text: string) => ({
    id,
    snippet: { type: 'textMessageEvent', displayMessage: text, publishedAt: new Date().toISOString() },
    authorDetails: { channelId: 'UC' + id, displayName: 'Someone' },
  });

  let page = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = String(input);
    if (url.includes('liveBroadcasts')) {
      return new Response(
        JSON.stringify({ items: [{ id: 'vid', snippet: { title: 'Stream', liveChatId: 'chat1' } }] }),
        { status: 200 },
      );
    }
    page += 1;
    // First answer: history. Second: one genuinely new message.
    const items =
      page === 1
        ? [message('old1', 'said before you joined'), message('old2', 'also before')]
        : [message('new1', 'said while listening')];
    return new Response(
      JSON.stringify({ items, nextPageToken: `t${page}`, pollingIntervalMillis: 20 }),
      { status: 200 },
    );
  }) as typeof fetch;

  const manager = new YouTubeManager(
    {
      enabled: true,
      source: 'api' as const,
      moderation: { enabled: false, timeoutSeconds: 300, includeAutomatic: false },
      handle: '',
      videoId: '',
      autoReconnect: false,
      reconnectDelaySeconds: 15,
      connectOnStartup: false,
      pollIntervalMs: 1,
    },
    { userToken: async () => 'token' } as never,
  );

  const spoken: string[] = [];
  manager.on('event', (e: { type: string; text?: string }) => {
    if (e.type === 'chat' && e.text) spoken.push(e.text);
  });

  manager.connect();
  await settle();
  // Drive the second poll rather than waiting out the interval floor: the
  // question is what priming does to the messages, not how long until it does.
  await (manager as unknown as { poll: () => Promise<void> }).poll();
  manager.disconnect();
  globalThis.fetch = real;

  console.log('');
  console.log('joining a chat that already has messages in it');
  check('the backlog is not replayed', spoken.includes('said before you joined'), false);
  check('nor the rest of it', spoken.includes('also before'), false);
  // The other half: priming must not swallow the live stream that follows.
  check('messages after the cursor still arrive', spoken.includes('said while listening'), true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
