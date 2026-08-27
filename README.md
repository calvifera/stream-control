# Stream Control

A self-hosted control room for live streaming to more than one platform at
once. It connects to TikTok, Twitch and YouTube chat together, normalizes every
event into one model, runs messages through a filter and rules pipeline, speaks
what survives, and serves the results as browser sources for whatever software
you stream with — plus a
transparent always-on-top chat panel for reading chat over a game.

Everything runs on your machine. There is no hosted service, no account to
make, and no telemetry: it talks to the platforms themselves and to nothing
else. See [Credentials](#credentials) for exactly which hosts each key reaches.

Node + TypeScript on the server, React + TypeScript for the overlays and
dashboard, Tauri for the desktop panel.

```
TikTok  ─┐
Twitch  ─┼─▶ normalize ──▶ filters ──▶ rules/gates ──▶ TTS queue
YouTube ─┘                     │                          │
                               └──────▶ Socket.IO ◀───────┘
                                            │
                overlays (browser sources) + dashboard + chat panel
```

Identity is keyed on `platform:handle` throughout, so one trusted list, one
penalty box and one viewer archive span all three services without a Twitch
mute silencing a TikTok stranger who happens to share a name.

## Credentials

Each platform needs its own API keys, created on that platform's site. The
**Keys** tab in the dashboard walks through every one of them, states which
hosts the value is sent to and when, and stores them in `data/secrets.json` —
never in `config.json`, which is broadcast to every overlay.

`npm run check:network` enforces that list: it walks every hostname the source
can reach and fails on anything not declared on that screen.

Keys can also live in `.env` if you prefer; see `.env.example`.

## Quick start

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

The dashboard opens at <http://localhost:5273> in dev (Vite), proxying the API
to the server on port 4700. For a single-process setup:

```bash
npm run build && npm start
```

Then everything — dashboard and overlays — is served from
<http://localhost:4700>.

Enter your TikTok @handle on the **Connect** tab and hit Connect. You do not
need credentials to read a room, and you do not have to be the host.

## Adding overlays to your streaming software

Every source in the **Sources** tab has its own URL:

```
http://localhost:4700/overlay/<id>
```

Add it as a **browser source** at the width and height shown next to it. Every
major streaming application has one, though the name varies — some call it a
webpage or web source.
Copy buttons for each URL are on the Connect tab.

Built-in source types:

| Type | What it does |
| --- | --- |
| `chat` | Live comments, with avatars, badges and optional gift/follow lines |
| `alerts` | One-at-a-time alert cards for follows, gifts, subs and shares |
| `tts` | **The audio sink** — add this once and leave it running |
| `goal` | Progress bar toward a like/diamond/follower target |
| `leaderboard` | Top gifters, likers or chatters this session |
| `counter` | Compact stat readouts (viewers, likes, diamonds, …) |
| `ticker` | Scrolling strip of recent events |
| `custom` | Your own HTML + CSS, rendered per event |

Add as many as you want — several chat overlays with different styling is a
normal setup. Each has its own fonts, colours, animation and custom CSS.

> The **TTS source is where sound goes into your stream.** The server sends each
> clip to exactly one page, so having it open in a second tab won't double the
> audio.
>
> If no TTS source is open, clips play through the **dashboard** instead, so you
> can hear TTS while setting things up. A real TTS source always takes priority,
> so opening the dashboard next to a live overlay never steals audio out of the
stream. The
> dashboard says which of the two is currently happening, and warns you when
> sound is only reaching your desktop.

## Text filtering

The **Filters** tab holds the ordinary blocklist: words (whole-word matched),
phrases (matched anywhere), regexes, and blocked users. Matches are either
censored in place or drop the whole message.

Matching is deliberately hard to dodge:

- **Leetspeak and separators** — `f4ke`, `f@ke`, `f-a-k-e`, `faaaake` all hit
  the same entry.
- **Homoglyphs** — Cyrillic `сorn`, fullwidth `ｃｏｒｎ` and mathematical
  `𝐜𝐨𝐫𝐧` fold to plain ASCII before matching.
- **Cross-script romanization** — TTS reads other writing systems phonetically,
  so a term typed as `ገበታ` (Ethiopic), `바보` (Hangul), `バカ` (katakana) or
  `дурак` (Cyrillic) is spoken aloud while sailing past a latin word list. Every
  message is romanized and re-checked against your list. A hit found only in a
  romanized copy always drops the message rather than censoring it — the offsets
  can't be mapped back to the original safely.
- **Mixed-script words** — `ᏣΟᏒΝ` spells "corn" from Cherokee and Greek letters.
  No glyph table is ever complete, so words that switch writing system mid-token
  are detected structurally. Latin mixed with Japanese is excluded, since real
  viewers write that way.
- **Script allowlist** — the backstop for writing systems that can't be
  romanized at all. Off by default; turn it on if you get targeted.

The **Test a message** box runs the exact chain a real comment goes through and
shows every romanized view that was checked.

## People

The **People** tab is where individual viewers are managed.

**Trusted** — regulars who bypass every rule gate and per-user cooldown.
Trusting someone also lifts a mute and clears their strikes.

**Penalty box** — muted from TTS only. Their messages still appear in chat
overlays and still count toward stats; they just never get read aloud.

**Automatic penalties** — this is what the severe list is for. Ordinary
swearing gets filtered and forgotten. But a viewer who reaches for a phonetic
or cross-script bypass to get a slur read aloud is doing it deliberately, and
that lands them in the penalty box automatically, with the offending message
kept as evidence so you can review or undo it.

By default only *disguised* attempts count — plainly typing a severe term is
filtered like anything else without a strike. Both that and the strike threshold
are configurable, and trusted users are exempt.

The severe list ships empty. It's yours to fill in for your room.

**Per-user voices** — give specific people their own voice, speed and pitch.
Anything left neutral inherits from whichever rule fired, so you only set what
you want changed. Speed preserves pitch; pitch preserves length (done with
overlap-add resampling in the browser, since TikTok's endpoint has no pitch
parameter).

### Username autocomplete

The user pickers search **everyone the server has seen in your chat**, with
avatars, message counts and strike history, persisted in `data/users.json`
across restarts.

To be straight about the limitation: TikTok has no public user-search API, so
this can't autocomplete arbitrary TikTok accounts the way a search engine would.
In practice that's fine — the people you want to trust or mute are the ones who
have actually been in your room. Handles that aren't in the directory can still
be typed in by hand.

## TTS rules

A rule decides what gets spoken, by whom, and how. Several rules can fire on the
same event.

- **Fires on** — chat, gifts, follows, subs, shares, likes, joins, questions.
- **Template** — `{{nickname}} says {{message}}`, with placeholders for
  `{{gift}}`, `{{count}}`, `{{diamonds}}`, `{{likes}}`, `{{months}}` and more.
- **Gates** — followers only, mutuals only, subscribers only, moderators only,
  must have gifted this session, minimum diamonds gifted, minimum follower
  count, minimum fans-club level, plus a per-rule always-allowed list.
- **Conditions** — required prefix (`!say`), regex match, minimum length,
  minimum gift value, specific gift names.
- **Voice** — a fixed voice, or `random` from a pool.
- **Priority and cooldown** — higher priority jumps the queue; cooldowns are
  per user per rule.

The **Log** tab has a "Why didn't that get read?" panel listing rules that
declined an event and the reason, which is the fastest way to debug a gate.

### Speech backends

TTS runs through swappable providers, chosen on the TTS tab. Per-user voice
profiles and rule voices always follow whichever one is active.

| Provider | Voices | Pitch & speed | Notes |
| --- | --- | --- | --- |
| **Google Cloud TTS** | 2000+, enumerated live by its own API | Applied server-side | Official and stable. Free tier is 4M chars/month Standard, 1M Neural2. Needs your own API key. |
| **TikTok TTS** | 83, verified by probing | Applied in the browser | The app's own voices. Internal API — no guarantees, see below. |
| **Google Translate (unofficial)** | 2 per language, 10 languages | Applied server-side | No key needed, but not on your quota — see below. |
| **Browser speech** | Whatever the overlay machine has | Applied in the browser | No credentials, no network. The automatic fallback. |

Google is the recommended default: it's a supported API, it publishes its own
voice catalogue so the list is never stale, and it applies pitch and speed
during synthesis — which sounds cleaner than the overlap-add resampling the
browser has to do for the other backends.

Setting it up takes about five minutes:

1. In [Google Cloud Console](https://console.cloud.google.com), create or pick a project.
2. Enable the **Cloud Text-to-Speech API**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. **Restrict the key to the Text-to-Speech API** — an unrestricted key works
   for anything on the project if it ever leaks.
5. Put it in `.env` as `GOOGLE_TTS_API_KEY`, or paste it on the TTS tab.

Then verify it:

```bash
npm run check:google -w @streaming/server
```

#### The unofficial Google Translate engine

This is the engine behind the "default male / female" voices in some other
stream tools, available here as `google-legacy`. It calls the undocumented
`google.com/speech-api/v2/synthesize` endpoint using **Chromium's public API
key** — the one that has sat in Chromium's source for over a decade.

It's included because it's instant, needs no signup, and has real `speed` and
`pitch` parameters. Know what you're choosing:

- The quota **isn't yours**. Requests ride Google's own key, so it can be
  throttled or revoked at any time — the speech-to-*text* half of that same key
  already was. A revocation surfaces as a clear `key_revoked` error rather than
  silence.
- Using a key that wasn't issued to you sits **outside Google's terms**.
- **Two voices per language**, ten languages. That's the entire catalogue.

Measured behaviour, since none of it is documented: `speed` runs 0.1–1.0 and
400s above that (0.5 is neutral); `pitch` runs 0–1 and moves the fundamental
exponentially (0.0 → 99 Hz, 0.45 → 121 Hz, 1.0 → 364 Hz on a male voice);
`gender` is really male-vs-everything-else, since `neutral` and even a nonsense
value return the female voice. There's no practical length limit.

Keep Google Cloud TTS configured alongside it so `fallbackToBrowser` isn't your
only safety net.

### When TikTok TTS stops working

TikTok's TTS endpoint is internal and unstable in two specific ways, both of
which the code now handles but which are worth knowing about.

**The route needs a trailing slash.** `/media/api/text/speech/invoke` returns a
plain `404`; `/media/api/text/speech/invoke/` works. Every older guide and
library uses the slashless form, which is why they've broken. The config schema
appends the slash automatically, so a hand-typed URL can't get this wrong.

**Only some regional hosts serve it.** The rest resolve, answer, and return
`status_code 1: "Couldn't load speech. Try again."` for a request that succeeds
elsewhere. The provider walks the host list until one produces audio, then
remembers the winner so later clips go straight to it.

If synthesis starts failing, re-probe which hosts are alive:

```bash
npm run probe:endpoints -w @streaming/server
```

It prints a status line per host and lists any that returned audio — put a
working one in the endpoint field on the TTS tab. To check synthesis end to end
through the real code path:

```bash
npm run check:synth -w @streaming/server
```

Neither command prints your session id.

### Voices

There is no TikTok endpoint that enumerates voices, and the community lists
floating around GitHub disagree with each other and with reality. So the
catalogue in `packages/shared/src/voices.ts` was built empirically instead:
96 candidate codes were synthesized against the live endpoint, and only the
**83 that returned audio** are shipped.

Thirteen codes that appear in popular lists were probed and **rejected** —
`en_male_ad_spokesman`, `br_001`, `en_male_petergriffin`, `en_male_werewolf`,
`en_male_dracula`, `en_male_hero`, `en_female_lady`, `en_male_ukguy`,
`en_male_readingnice`, `en_male_narration_v2`, `en_female_f08_birthday`,
`jp_female_fujicochan`, `pt_male_bueno` — so don't re-add them without
re-probing.

Availability varies by account and region. To re-verify against your own:

```bash
npm run probe:voices -w @streaming/server
```

That probes the full candidate set and prints a paste-ready list of what
worked. To check just the shipped catalogue is still accurate (exits non-zero
if any entry has gone stale):

```bash
npm run probe:voices -w @streaming/server -- --shipped
```

There's also a **Test voices** button on the People tab for a quick in-app check.

## Public URLs (ngrok)

Put an `NGROK_AUTHTOKEN` in `.env`, then start the tunnel from the Connect tab.
Overlay URLs become reachable from another machine — useful when your encoder
runs
somewhere other than this server.

**Set `tunnel.basicAuth` to `user:password` when you do.** The tunnel exposes
the dashboard, and the dashboard can hold your TikTok session id.

## Configuration and data

Everything lives in `data/`, which is gitignored:

| File | Contents |
| --- | --- |
| `data/config.json` | All settings. Written on every change, validated on load. |
| `data/users.json` | The user directory: who's been seen, and strike history. |
| `data/media/` | Drop alert sounds/images here; reference them as `/media/<file>`. |

If `config.json` is ever invalid the server keeps a `.broken-<timestamp>.json`
copy next to it and boots from defaults rather than refusing to start.

Config changes are broadcast over the socket, so two open dashboards stay in
sync and overlays restyle live without a refresh.

## Updating

```bash
npm run update
```

Pulls, installs only if the lockfile moved, and rebuilds — in that order,
stopping at the first failure rather than leaving you half-updated.

Nothing it does can reach your settings. `data/` and `.env` are gitignored, and
no tracked file is written at runtime, so a pull never conflicts with anything
you have configured.

**Settings survive version changes without a migration step.** A stored config
is deep-merged over the current defaults, so fields added in a later version
simply appear with their default value while everything you set is left alone.
Arrays are replaced wholesale rather than merged, so deleting every overlay
leaves you with none rather than quietly restoring the defaults.

**The one thing to know:** the server runs from source and needs no build of
its own, but the dashboard is served from `packages/overlay/dist`, which is
gitignored and therefore untouched by a pull. `git pull && npm start` runs new
server code behind the previous build of the UI. Startup warns when the build
is older than the source it came from, and `npm run update` cannot leave you in
that state to begin with.

Doing it by hand is the same three steps:

```bash
git pull && npm install && npm run build
```

If you downloaded the ZIP rather than cloning, download it again over the same
folder and run `npm install && npm run build`; your `data/` folder is not part
of the download and will be left where it is.

## Tests

```bash
npm test
```

Covers the filter engine: transliteration, homoglyph folding, mixed-script
detection, severity, evasion classification and censoring behaviour.

With the server running:

```bash
npm run test:live
```

> These talk to a **live server** and reset config to get a known starting
> state. They snapshot the config first and restore it afterwards — even on
> failure or Ctrl-C — and `/config/reset` always writes a timestamped
> `data/config.json.reset-*.bak.json` first. Both protections exist because an
> earlier version of this suite wiped a real TikTok session id and Google API
> key off a working install. For complete isolation, point them at a throwaway
> instance with `CHECK_BASE`.

Exercises the REST API, the trusted/penalty flows, per-user voice profiles, the
auto-penalty path, and TTS clip routing end to end.

The routing check needs a server with no other dashboards or overlay tabs
connected, since those would intercept the clips it watches for. Easiest way is
an isolated instance:

```bash
PORT=4799 npm start
```

then point the check at it:

```bash
CHECK_BASE=http://localhost:4799 npm run check:listeners -w @streaming/server
```

## Layout

```
packages/
  shared/    types, config schema, defaults, template rendering, voice catalogue
  server/    connection, normalization, filters, rules, TTS queue, REST + socket
  overlay/   React overlays and the dashboard (one Vite app, two route trees)
```

The server's `hub.ts` is the single place events flow through:
filter → aggregate → rules → TTS queue → fan out.

## A note on the TikTok integration

`tiktok-live-connector` and the TTS endpoint both talk to TikTok's internal
Webcast APIs, which are reverse-engineered rather than supported. They change
without notice. The code treats failure as routine — reconnects with backoff,
tries several TTS endpoints, falls back to browser speech — but expect to update
dependencies occasionally when TikTok shifts something.

Proto field names in particular are version-specific: this targets the v3 protos
(`user.displayId`, `message.content`), which differ from older guides. All of
that is confined to `server/src/tiktok/normalize.ts`, so a proto change is a
one-file fix.

## Not affiliated

This project is not affiliated with, endorsed by, or connected to TikTok,
Twitch, Google or YouTube. All trademarks belong to their respective owners.

The TikTok connection uses reverse-engineered internal APIs rather than a
public one — see [A note on the TikTok integration](#a-note-on-the-tiktok-integration).
That is worth understanding before you rely on it, and worth checking against
the platform's terms for your own situation.

## License

MIT. See [LICENSE](LICENSE).
