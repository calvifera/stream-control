# Development

Tests, project layout and the notes on the TikTok integration. Back to the [README](../README.md).

## Tests

```bash
npm test
```

Typechecks all three packages, then runs every check that needs no server and no
network: the filter engine (transliteration, homoglyph folding, mixed-script
detection, severity, censoring), the rule gates, trust scoring, the YouTube and
Twitch parsers, gifts, the credentials store and more. Each one lives in
`packages/server/src/checks/`, and can be run alone with
`npm run check:<name> -w @streaming/server`.

`check:network` is the one to know about: it fails if the source can reach a host
the Keys screen does not declare, so a new integration cannot quietly break the
promise made there.

A new `check:*` script has to be listed in `scripts/check.mjs` — as offline, or as
live if it needs a server or a platform — or the run fails, so one can't be added
and then never run.

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
  desktop/   Tauri shell for the always-on-top chat panel (`npm run panel`)
scripts/     update.mjs (`npm run update`), check.mjs (`npm test`)
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
