---
name: Stream Control
description: A stage manager's cue sheet for a three-platform stream: near-black surfaces, visible hairlines, one quiet tungsten accent.
colors:
  rail: "#08090c"
  ground: "#0d0e12"
  raised: "#1a1d24"
  inset: "#08090b"
  hover: "#232730"
  selected: "#2d323e"
  rule: "#343a47"
  rule-bright: "#666e80"
  ink: "#ececf1"
  ink-muted: "#b6bac6"
  ink-dim: "#8f95a5"
  tungsten: "#d9a441"
  tungsten-ink: "#17120a"
  state-ok: "#5bc99c"
  state-warn: "#d9bc4f"
  state-error: "#e8707d"
  gel-tiktok: "#4fd6d0"
  gel-youtube: "#e8685d"
  gel-twitch: "#a58be8"
typography:
  title:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.15
  heading:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "6px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "#e6e8ee"
    textColor: "{colors.ground}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
    height: "36px"
  button-default:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
    height: "38px"
  panel:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.md}"
    padding: "24px"
  nav-item-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "36px"
---

# Design System: Stream Control

## Overview

**Creative North Star: "The Cue Sheet"**

A stage manager's paperwork for a show with three audiences, printed in the dark. The dashboard is organised the way a message travels (platforms, filters, rules, voice, overlays), and a speech rule reads like a plain sentence: when it fires, the conditions that must be true, what it says. Everything is near-black and quiet so it can sit beside a game for hours; a single muted tungsten accent marks only the selected thing and the on switches.

The density is that of a tool used for hours: tight rows, visible hairlines, tabular figures. Depth comes from a lit top edge and a soft offset shadow, never from glow, blur or decorative motion. Colour is rationed: platform identity lives in small gel swatches, state lives in small marks, and the primary button is pale rather than coloured.

**Key Characteristics:**
- Near-black neutrals with a faint cool lean; panels are outlined by a visible hairline and a lit top edge.
- One quiet accent (tungsten), used small: tab underline, selected marks, focus, switches.
- The primary button is a pale neutral, so the interface never has a bright block competing with the stream.
- Every state has a shape and a word as well as a colour.
- Long areas are split into in-page tabs rather than scrolled.
- The signal path (five stations a message passes through) is the product's one signature element.

## Colors

A near-monochrome palette with one accent, three state colours and three platform gels.

### Primary
- **Tungsten** (#d9a441): tab underline, selected list border, selected-chip border and square, switch track when on, focus rings, the "next thing to fix" station. Text on it is **Tungsten Ink** (#17120a).

### Neutral
- **Rail Black** (#08090c): the sidebar.
- **Ground** (#0d0e12): the page.
- **Raised** (#1a1d24): panels and cards, outlined by a hairline and a lit top edge.
- **Inset** (#08090b): inputs and list items, sunk into the panel so a field reads as a hole.
- **Hover** (#232730) and **Selected** (#2d323e): row hover, and the current nav item, list selection or selected chip.
- **Rule** (#343a47) and **Bright Rule** (#666e80): hairline dividers, and control borders that clear 3:1 on a panel.
- **Ink** (#ececf1), **Muted Ink** (#b6bac6), **Dim Ink** (#8f95a5): 14.7:1, 8.9:1 and 5.8:1 on a panel.

### State and identity
- **OK Green** (#5bc99c), **Straw** (#d9bc4f), **Alarm Rose** (#e8707d): connected or ready, needs attention, problem. Always paired with a drawn shape (disc, ring, diamond) and a word.
- **TikTok Cyan** (#4fd6d0), **YouTube Red** (#e8685d), **Twitch Lavender** (#a58be8): platform gels, used as a tint behind a logo, a ring around a chat avatar, and the name colour bands.

### Named Rules
**The Small Accent Rule.** Tungsten never fills a large area and is never a translucent tint (over a dark ground it goes olive). Selection is a neutral step with an amber edge or mark.
**The Never-Colour-Alone Rule.** State is a shape plus a word: filled disc, open ring, diamond, hollow or filled square. A colour-blind streamer must lose nothing.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI Variable Text, Segoe UI, system-ui)
**Body and UI Font:** Segoe UI Variable Text (with Segoe UI, system-ui, -apple-system)
**Mono:** Cascadia Mono, only for code, keys and URLs

**Character:** The platform's own UI face, so the dashboard feels native and renders crisply on the machine it runs on. Weight and size carry hierarchy; numbers use tabular figures. Nothing is fetched or bundled.

### Hierarchy
- **Title** (600, 26px, 1.15): one per page.
- **Heading** (600, 17px, 1.25): panel and modal titles.
- **Body** (400, 14px, 1.5): descriptions, hints; capped near 66-78ch.
- **Label** (600, 13px): field labels, buttons, tabs, table cells.
- **Small caps label** (600, 12px, +0.06em, uppercase): table headers, nav group names, stat captions only.
- **Figure** (600, 17-26px, tabular-nums): readouts and counts.

### Named Rules
**The Fixed Scale Rule.** Sizes are 12 / 13 / 14 / 17 / 21 / 26. There is no fluid type in the product UI.

## Layout

A 252px left rail (brand, connections, grouped navigation, then a pinned foot with audio state, chat window and Kill TTS) beside a page capped at 1120px. Every page opens with a title and a one-line purpose, then in-page tabs, then one or two panels. Master-detail pages (rules, keys, overlays) use a list column of 260-340px beside a workspace.

Spacing is 4 / 8 / 12 / 16 / 24 / 32 / 48. Related fields sit 16px apart; groups are separated by a hairline and 16px above the group title. Below 1100px split layouts stack; below 900px the rail becomes a block above the page with a horizontally scrolling nav.

## Elevation & Depth

Layered, not glowing. The page is the darkest field; panels rise out of it with a visible hairline, a lit top edge and a soft offset shadow; inputs and readouts sink into panels with an inner shadow. Every shadow has an offset and a blur. There is no glow, no gradient and no backdrop blur anywhere in the dashboard.

### Shadow Vocabulary
- **Lift** (`inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 1px 2px rgba(0, 0, 0, 0.5), 0 10px 22px -10px rgba(0, 0, 0, 0.7)`): panels, the signal path.
- **Sink** (`inset 0 1px 3px rgba(0, 0, 0, 0.7)`): inputs, readouts, banners.
- **Pop** (`0 16px 40px rgba(0, 0, 0, 0.7)`): modals only.

### Named Rules
**The Lit-Edge Rule.** Raised things get a one-pixel light top edge and an offset shadow; sunken things get an inner shadow. Nothing changes depth on hover: hover changes tone or border, and press scales to 0.97.

## Shapes

Small, even radii: 6px on controls and list rows, 8px on panels. Switches are squarer (2-4px) like printed labels. Chips carry a drawn 8px square at the left as their state mark. There are no pill buttons and no circles except avatars and status discs.

## Components

### Buttons
- **Shape:** 6px radius, 36px high, 600 weight.
- **Primary:** pale neutral fill (#e6e8ee) with dark text and a lit top edge. One per area. Disabled primary goes flat and grey.
- **Default:** faint white fill with a bright-rule border; hover fills Hover.
- **Danger:** Alarm Rose outline at rest, filled only on hover or keyboard focus. Destructive actions sit apart from other buttons, in a footer, and ask twice.

### Chips
Rectangular swatches with a drawn square: hollow when off, filled when on; on selection the chip takes Selected with an amber border. Action chips (Connect, pop-out) carry no square.

### Inputs / Fields
Inset fill, bright-rule border, 6px radius, 38px high, inner shadow. Focus is a 2px tungsten outline. Numbers are text fields with arrow-key and wheel stepping, never browser spinners.

### Navigation
The rail groups areas by job (Set up, Speech, Moderation, Activity). The current item is Selected with a tungsten icon. In-page tabs are underlined by a 3px tungsten bar that scales in over 160ms; a small straw diamond marks a tab that needs attention.

### Signal path (signature component)
Five stations in one ruled strip: Platforms, Filters, Rules, Voice, Overlays. Each shows a numbered plate, a state mark and word, one line of truth, and a link to where it is fixed. The first station that is not ready is highlighted as the next step.

### Rules table and form
Speech rules are a plain table (On switch printed as a word, name, when, conditions, voice, priority); a row opens one top-to-bottom form with When, Conditions, Then speak and Limits, topped by the rule read back as one sentence. Conditions are a single If / And list with an Add condition menu, so who may trigger a rule and what must match are the same kind of thing. The blocklist (one table of words, phrases, patterns and users with an add form) and the viewers list (one table of people, one open row at a time holding access and voice settings) follow the same pattern. On narrow screens each row stacks.

## Do's and Don'ts

### Do:
- **Do** pair every state colour with a shape and a word.
- **Do** put long settings behind in-page tabs or a disclosure instead of a longer scroll.
- **Do** say a rule, filter or key back in plain language where the streamer is already looking.
- **Do** keep destructive controls outline-only and isolated.
- **Do** keep text at 4.5:1 or better and control borders at 3:1 or better.
- **Do** keep transitions between 120ms and 200ms, `cubic-bezier(0.23, 1, 0.32, 1)`, and honour `prefers-reduced-motion`.

### Don't:
- **Don't** add `html` backgrounds, `color-scheme`, or global element styles to the shared stylesheet: the same bundle serves transparent browser sources and the transparent chat panel.
- **Don't** use gradients, glows, blur, gradient text or coloured side stripes, or put amber at low opacity over a dark surface.
- **Don't** nest cards, or use a modal where an inline area works.
- **Don't** use Unicode glyphs as icons; draw them in the 20px, 1.6px-stroke set.
- **Don't** introduce a second accent colour or a saturated field.
