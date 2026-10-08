# Speech backends and TikTok voices

Reference for the **Voice** page and the **Speech rules** that use it. Back to the [README](../README.md).

## Speech backends

TTS runs through swappable providers, chosen on the **Voice** page (Engine tab). Per-user voice
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
5. Put it in `.env` as `GOOGLE_TTS_API_KEY`, or paste it on the Engine tab of **Voice**.

Then verify it:

```bash
npm run check:google -w @streaming/server
```

### The unofficial Google Translate engine

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

## When TikTok TTS stops working

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
working one in the endpoint field on the Engine tab of **Voice**. To check synthesis end to end
through the real code path:

```bash
npm run check:synth -w @streaming/server
```

Neither command prints your session id.

## Voices

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

There's also a **Test voices** button on the Viewers page for a quick in-app check.
