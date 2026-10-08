# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A solo streamer who goes live on TikTok, Twitch and YouTube at the same time and runs this on their own machine. They spend most dashboard time **before** going live: connecting platforms, pasting keys, adding browser sources to their streaming software, tuning TTS rules, filters and viewer trust. During a stream the dashboard is a secondary glance (kill TTS, check what got read), and chat is read in the desktop panel or pop-out instead.

## Product Purpose

Stream Control merges chat and events from TikTok, Twitch and YouTube into one stream, runs them through filters and TTS rules, speaks what survives, and serves overlays as browser sources for streaming software. Success is a streamer who can get from a fresh install to a correct, trustworthy live setup without hunting for settings, and who always knows what the system is doing with a viewer's message and why.

## Positioning

Everything runs locally: no hosted service, no account, no telemetry. Identity is `platform:handle` throughout, so one trusted list, penalty box and archive span all three services. The Keys screen states exactly which hosts each credential is sent to.

## Operating Context

- The dashboard is served by the local Node server (default port 4700, Vite on 5273 in dev) and is also reachable through an optional ngrok tunnel, so it can be opened from another machine.
- Overlays are browser sources inside OBS-style streaming software at fixed pixel sizes; they are transparent and styled per source by the user.
- The desktop chat panel is a transparent always-on-top Tauri window that loads `/panel/chat`.
- The TTS browser source is the audio sink; with none open, speech plays through the dashboard tab.
- The streamer is often on a second monitor next to a game, so the dashboard has to stay legible at a glance and work at ordinary laptop widths.

## Capabilities and Constraints

- Dashboard areas today: Go live (platform connections), Keys (credentials), Chat, Overlays (gallery and editor), Voice (engine and test), Speech rules, Filters, Viewers (one list with allow list, mute and own-voice settings per person; automatic protection; platform enforcement), Archive (viewer archive and stats), Log (why a message was or was not read).
- Speech rules combine event type, platforms, a spoken template, voice, priority, cooldown and one list of conditions (about the message, the gift or the viewer). Several rules can fire on one event. The streamer found the earlier cue-list editor with separate gates and conditions unconventional, so rules follow ordinary table and form patterns. A global Only the allow list switch limits speech to listed viewers.
- Some gates cannot be satisfied on some platforms (for example follower-only on Twitch); the UI already warns about this and must keep doing so.
- Config is deep-merged and broadcast over a socket; the UI holds no private copy, and two dashboards stay in sync.
- Terminology to keep: sources (not widgets), rules, conditions, penalty box, allow list, keys.

## Brand Commitments

None binding. The name is "Stream Control". The current neon-cyan and crimson glow look is not a commitment and is open to full replacement. The TikTok, YouTube and Twitch logos are third-party marks and stay as supplied.

## Evidence on Hand

The real app and its data model (`packages/shared`), the README, and the current dashboard in `packages/overlay/src/dashboard`. There are no user testimonials, analytics or usage numbers; none should be invented.

## Product Principles

1. Setup order should be visible: what is done, what is next, what is broken.
2. Every rule or filter outcome should be explainable in plain language, in the place the streamer is already looking.
3. Settings are grouped by the job they do, not by implementation, and long pages are split rather than scrolled.
4. Dangerous or urgent actions (kill TTS, penalty box) stay one click away and never look like decoration.
5. The interface should be calm to read for hours and should not compete with the stream or game beside it.

## Accessibility & Inclusion

Streamers work in dim rooms and on secondary monitors; text must hold at least WCAG AA contrast, keyboard focus must be visible everywhere, and nothing may rely on colour alone to show connection or error state. Honour `prefers-reduced-motion`.
