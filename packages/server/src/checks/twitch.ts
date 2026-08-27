/**
 * Twitch IRC parsing checks.
 *
 * This parser is fed unauthenticated input from the public internet, so it is
 * tested with hostile lines as well as well-formed ones: a crash here takes the
 * whole server down, and a mis-parse mis-attributes a message to the wrong
 * viewer.
 */
import { parseIrc, twitchEventFrom, twitchUser } from '../twitch/normalize.js';

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

console.log('\nTwitch IRC\n');

console.log('parsing');
{
  // A real line, captured from the live service during development.
  const line =
    '@badge-info=subscriber/60;badges=subscriber/60,premium/1;color=#D2691E;' +
    'display-name=HannesTheLord;emotes=;mod=0;room-id=71092938;subscriber=1;' +
    'user-id=217641708 :hannesthelord!hannesthelord@hannesthelord.tmi.twitch.tv ' +
    'PRIVMSG #xqc :hello there';

  const message = parseIrc(line);
  check('command', message?.command, 'PRIVMSG');
  check('channel param', message?.params[0], '#xqc');
  check('body', message?.text, 'hello there');
  check('display name tag', message?.tags['display-name'], 'HannesTheLord');
  check('user id tag', message?.tags['user-id'], '217641708');

  const user = twitchUser(message!, 'xqc');
  check('platform stamped', user.platform, 'twitch');
  check('handle is the login, lowercased', user.uniqueId, 'hannesthelord');
  check('display name preserved', user.nickname, 'HannesTheLord');
  check('subscriber flag', user.isSubscriber, true);
  check('moderator flag', user.isModerator, false);
  check('badges parsed to names', user.badges, ['subscriber', 'premium']);
  check('no avatar over IRC', user.avatarUrl, null);
}

console.log('\nmessage bodies that could break framing');
{
  const withColons = parseIrc(
    '@x=1 :bob!bob@bob.tmi.twitch.tv PRIVMSG #c :https://example.com/a:b :: done',
  );
  check('colons in the body survive', withColons?.text, 'https://example.com/a:b :: done');

  const empty = parseIrc('@x=1 :bob!bob@bob.tmi.twitch.tv PRIVMSG #c :');
  check('empty body', empty?.text, '');

  // IRCv3 escaping: \s is a space, \: is a semicolon.
  const escaped = parseIrc('@system-msg=Bob\\ssubscribed\\:\\syay :tmi.twitch.tv USERNOTICE #c');
  check('tag escapes decoded', escaped?.tags['system-msg'], 'Bob subscribed; yay');
}

console.log('\nhostile and malformed input');
{
  const cases: Array<[string, string]> = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['tags with no message', '@only=tags'],
    ['prefix with no command', ':bob!bob@bob.tmi.twitch.tv'],
    ['bare colon', ':'],
    ['bare at-sign', '@'],
    ['no trailing separator', '@a=1 :bob PRIVMSG #c'],
    ['tag with no value', '@novalue :bob PRIVMSG #c :hi'],
    ['tag with only equals', '@= :bob PRIVMSG #c :hi'],
  ];

  for (const [label, line] of cases) {
    let threw = false;
    try {
      parseIrc(line);
    } catch {
      threw = true;
    }
    check(`does not throw on ${label}`, threw, false);
  }

  // A very long line must not hang or blow up.
  const huge = `@a=1 :bob!bob@bob.tmi.twitch.tv PRIVMSG #c :${'x'.repeat(200_000)}`;
  const started = Date.now();
  const parsedHuge = parseIrc(huge);
  check('200k-char body parses', parsedHuge?.text.length, 200_000);
  check('and does so quickly', Date.now() - started < 500, true);
}

console.log('\nevent routing');
{
  const chat = twitchEventFrom(
    parseIrc('@display-name=Ann;user-id=1 :ann!ann@ann.tmi.twitch.tv PRIVMSG #c :hi')!,
    'c',
  );
  check('plain message becomes chat', chat?.type, 'chat');
  check('chat carries the platform', chat?.platform, 'twitch');

  const cheer = twitchEventFrom(
    parseIrc('@bits=500;display-name=Ann;user-id=1 :ann!ann@ann.tmi.twitch.tv PRIVMSG #c :cheer500')!,
    'c',
  );
  check('a cheer becomes a gift, not chat', cheer?.type, 'gift');
  check(
    'bits land in diamondCount so minDiamonds gates work',
    cheer?.type === 'gift' ? cheer.diamondCount : null,
    500,
  );
  check(
    'totalDiamonds matches for a single cheer',
    cheer?.type === 'gift' ? cheer.totalDiamonds : null,
    500,
  );

  const sub = twitchEventFrom(
    parseIrc('@msg-id=resub;msg-param-cumulative-months=7;login=ann;user-id=1 :tmi.twitch.tv USERNOTICE #c')!,
    'c',
  );
  check('resub becomes subscribe', sub?.type, 'subscribe');
  check('months read from the tag', sub?.type === 'subscribe' ? sub.subMonths : null, 7);
  check('resub is not marked gifted', sub?.type === 'subscribe' ? sub.isGifted : null, false);

  const gifted = twitchEventFrom(
    parseIrc('@msg-id=subgift;login=ann;user-id=1 :tmi.twitch.tv USERNOTICE #c')!,
    'c',
  );
  check('subgift is marked gifted', gifted?.type === 'subscribe' ? gifted.isGifted : null, true);

  const raid = twitchEventFrom(
    parseIrc('@msg-id=raid;msg-param-viewerCount=42;login=ann;user-id=1 :tmi.twitch.tv USERNOTICE #c')!,
    'c',
  );
  check('raid maps to share', raid?.type, 'share');
  check('raider count preserved', raid?.type === 'share' ? raid.shareCount : null, 42);

  // Things that are not events must be ignored rather than mis-typed.
  for (const line of [
    ':tmi.twitch.tv 001 justinfan1 :Welcome, GLHF!',
    ':tmi.twitch.tv ROOMSTATE #c',
    '@msg-id=unknownthing :tmi.twitch.tv USERNOTICE #c',
    ':bob!bob@bob.tmi.twitch.tv JOIN #c',
  ]) {
    check(`ignores ${line.slice(0, 34)}…`, twitchEventFrom(parseIrc(line)!, 'c'), null);
  }
}

console.log('\nhost detection');
{
  const broadcaster = twitchUser(
    parseIrc('@badges=broadcaster/1;display-name=Cal;user-id=9 :cal!cal@cal.tmi.twitch.tv PRIVMSG #cal :hi')!,
    'cal',
  );
  check('broadcaster badge marks the host', broadcaster.isHost, true);

  const viewer = twitchUser(
    parseIrc('@display-name=Ann;user-id=1 :ann!ann@ann.tmi.twitch.tv PRIVMSG #cal :hi')!,
    'cal',
  );
  check('a viewer is not the host', viewer.isHost, false);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
