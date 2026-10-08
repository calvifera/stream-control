---
version: 1
slug: "packages-overlay-src-dashboard-dashboard-tsx"
primary_target: "packages/overlay/src/dashboard/Dashboard.tsx"
related_targets: []
---

# Surface brief: dashboard (Operate)

Scope: the whole dashboard shell and every tab, the pop-out and desktop chat panel, then the built-in overlay defaults. Mode: Operate. A solo streamer, mostly setting up before going live, on a laptop or second monitor in a dim room.

Task: get from fresh install to a correct live setup without hunting; understand exactly why a message was or was not spoken; tune rules, filters and viewer trust without a wall of fields.

Unresolved: overlay default restyle must not change anything a user has already configured.

## Direction contract

THESIS: A stage manager's paperwork for a three-platform show. The dashboard is organised as the signal path a message travels (platforms, filter, rules, voice, overlays) and a TTS rule is read as a cue: trigger, who may fire it, what it says. It refuses the category default of one scrolling stack of identical glowing panels under nine flat tabs.

OWN-WORLD: Blackout-blue ground (deep gel blue, not near-black) with a darker rail, hairline rules at one pixel, no glow, no gradients, no blur. Tungsten amber is the single action colour; a small gel set (steel, rose, lavender, green, straw) carries platform identity, categories and state, always paired with a mark and a word. Barlow in three widths: Barlow for text, Barlow Semi Condensed for controls and tables, Barlow Condensed numerals and cue numbers; system mono only for code and keys. Swatch chips with gel-style numbers are the recurring ornament.

STORY: Opening the dashboard shows what is done, what is next and what is broken along the signal path, each station a link to the place that fixes it. Rules read as a cue sheet; selecting one opens its editor in grouped sections (When, Who, Says) beside a plain-English summary of what it will do.

FIRST VIEWPORT: Left rail 232px grouped Go live, Speech, Moderate, Watch, Settings, with a compact audio and Kill TTS block pinned at its foot. Main area opens on "Go live": a page title and one-line status, the signal path as a horizontal strip of five stations with state marks, then platform cards in a three-column row, each with connect field and primary action. Secondary settings sit behind in-page tabs, not below the fold.

FORM: Reference-setting source's discipline of one moving part and printed state marks, applied as a stage cue sheet. Position 3 on the ordered list; seed key 5a0c58e4. Challenger verdicts: developer-console competitive (kept: destructive actions isolated by space and outline until focus, now applied to Kill TTS and Delete); timetable slide rack competitive (kept: state as a mark in a fixed cell, never colour alone); Ikeda, Crouwel and vertical-feed declined.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
