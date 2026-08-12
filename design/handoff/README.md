# Handoff: Emergenthealth design system + six-page redesign

## Overview

A full visual and IA redesign of Emergenthealth, covering all six destinations in
mobile (390px) and web (1280px), plus the mascot Emergy rebuilt as a real-time 3D
avatar. The redesign's premise: the app's inconsistency is not a set of bugs but a
missing rule — colour was decorative. Everything below follows from giving colour a
job.

Source repo: `Stano-Salvatore/Emergenthealth`, branch `main`, read at commit-time
2026-08-11. Audited 381 hard-coded colour literals across the 26 dashboard routes.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes
showing intended look and behaviour, not production code to copy. The task is to
**recreate them inside the existing Next.js + Tailwind + shadcn/ui codebase**, using
its established patterns: `src/components/ui/*` primitives, the theme variables in
`src/app/globals.css`, and the existing route structure under `src/app/dashboard/`.

Two exceptions that ARE production-ready and should be copied in as-is:

- `emergy-model.js` — the three.js scene graph for the mascot (named meshes and
  materials, mood colours, gesture poses). Framework-agnostic ES module.
- `emergy-avatar.js` — a custom element `<emergy-avatar>` wrapping it. One shared
  WebGL renderer blits to per-instance canvases, so N avatars cost one context.
  Works in React as-is (`<emergy-avatar mood="okay" fit="icon">`); if you prefer a
  React wrapper, wrap it rather than reimplementing.

Both need `three` (already an npm-installable peer; the prototypes load it from a
CDN import map — swap that for the bundled import).

## Fidelity

**High-fidelity.** Final colours, typography, spacing and interaction states. Recreate
pixel-perfectly with existing libraries. Every hex below is literal and intentional;
where a value differs from today's code it is a deliberate change, not drift.

---

## The two palettes — the core rule

Colour does exactly two jobs, and a screen may tint a number by one or the other,
never both.

### Identity — locked per domain, theme-independent

| Domain | Hex | Covers |
| --- | --- | --- |
| Sleep | `#818cf8` | hours, score, stages, debt, sleep bars |
| Heart | `#fb7185` | RHR, HRV, SpO₂, breathing rate |
| Move | `#a3e635` | steps, active minutes, activity score |
| Fuel | `#22d3ee` | water, intake, medications |
| Mind | `#c084fc` | mood, focus, journal, screen time |
| Life | `#8d8da8` | calendar, habits, reminders, money — neutral by design |

A figure, its bar, its icon and its sparkline all take the hue of what they measure,
on every screen. **This is the single most important rule in the redesign**: today
sleep is indigo on Today, green/amber/red on Health, and its score uses a different
scale again.

Sub-hues inside Fuel (drinks only — quantity is still carried by the bar):

| Drink | Hex |
| --- | --- |
| Water | `#22d3ee` (the domain hue) |
| Coffee | `#c08552` |
| Tea / matcha | `#8fbf6a` |
| Beer / spirits | `#e0a83c` |
| Wine | `#c15f7a` |

### Status — three steps, nothing else

| State | Hex | Means |
| --- | --- | --- |
| On target | `#34d399` | at or above goal, in range, done |
| Watch | `#fbbf24` | drifting, due today, near a limit |
| Off target | `#f87171` | missed, overdue, out of range, error |

Status appears **only** on rings, chips, deltas and dots — never on a metric's own
glyph or figure, so it can't be confused with identity. Consequences:

- Money stops being green/red. The amount is neutral; direction is the sign and the
  arrow. (Income-green currently collides with habit-done-green.)
- Red must stop being a metric colour, because delete/error/overdue keep it. Heart
  becomes rose `#fb7185`, never `#ef4444`.
- The nine `.card-*` gradients in `globals.css` should derive from the domain hue so
  they survive a theme switch instead of staying emerald in Forest and rose in Ocean.

---

## Surface tokens (dark theme, as drawn)

| Token | Hex | Use |
| --- | --- | --- |
| Ground | `#09090f` | app background |
| Card | `#100f1a` | every card fill |
| Sidebar top | `#0e0d1a` | web sidebar gradient start (to `#09090f`) |
| Border | `#201f32` | every card and divider border, 1px |
| Inner rule | `#17162a` | rules between rows inside a card |
| Track | `#1a192a` | progress-bar and ring tracks |
| Text | `#f2f2fa` | primary |
| Text secondary | `#a9a9c0` | supporting prose |
| Text tertiary | `#7a7a96` | labels, units, meta |
| Text quaternary | `#4e4d68` | disabled, faint meta |
| Accent tint bg | `rgba(99,102,241,0.06)` | Emergy briefing card |
| Accent tint border | `rgba(99,102,241,0.22)` | same |
| Active nav bg | `rgba(99,102,241,0.14–0.15)` | selected tab / sidebar row |

Radii: **16px** cards, **12px** chips and inner tiles, **10px** buttons and icon
buttons, **99px** pills/dots. Card padding: 16px (mobile), 16–18px (web), 12–14px for
dense tiles.

## Typography

**Geist Sans** for all prose, labels and buttons. **Geist Mono** for figures, times,
tabular columns and the score — with `font-feature-settings:'tnum'` wherever numbers
line up.

This is a change: `globals.css` currently maps `--font-sans` to `--font-geist-mono`,
so Geist Sans is loaded in the root layout and never used. Everything sets
fixed-width today, which reads as a developer tool and costs ~8% of line length at
390px. **One line in the theme block fixes it.**

Scale as drawn:

| Role | Size / weight |
| --- | --- |
| Page title (web) | 26px / 600, `letter-spacing:-.015em` |
| Page title (mobile) | 19px / 600, `-.012em` |
| Live clock | 27px web, 23px mobile / 700 mono |
| Big metric | 26px web, 21px mobile / 900 mono |
| Score numeral | 38px web, 30px mobile / 900 mono |
| Ring label | 6.5px / 700, `letter-spacing:.1em` |
| Card kicker | 10px / 700 uppercase, `letter-spacing:.15em`, `#7a7a96` |
| Body | 13–14.5px / 400 |
| Meta | 10.5–12px / 400, `#7a7a96` |
| Briefing prose | 14.5px web / 13px mobile, **italic serif** — deliberately the one non-Geist voice, because it is Emergy speaking |

## Icons

**Lucide throughout** (already a dependency). Emoji survive in exactly two places:

1. Emergy himself, who is illustration, not iconography.
2. The five mood faces — 😴 😕 😐 🙂 😄 — where the face *is* the answer.

Everywhere else (drawer, timeline, intake types, finance categories) emoji become
Lucide glyphs tinted with the domain hue. Today the drawer labels 26 destinations
with emoji while the bottom bar labels five of the same destinations with Lucide, so
Habits is ✅ in one place and a check-square outline in the other.

---

## Information architecture

26 destinations (11 hidden behind Customize) collapse to **four rooms plus Emergy and
Settings**:

| Room | Absorbs |
| --- | --- |
| **Today** | Overview, Brief, Check-in, This Week |
| **Body** | Health & Body, Trackers, Weight, Labs, Intake's medication tab |
| **Log** | Intake, mood, weight, meds, notes — the job done most, which today has no front door |
| **Patterns** | Trends, Streaks, Timeline, Insights, Garden as its reward layer |
| **Emergy** | the chat |
| **Settings & sources** | account, themes, notifications, and every integration as a *source*, not a destination |

Integrations (Oura, Health Connect, Strava, Gmail, Last.fm, RescueTime, YNAB,
subscriptions) stop being pages. They become connected sources with their own
last-sync state, listed in Settings, feeding the four rooms.

Bottom nav (mobile): Today · Body · **Emergy (centre, raised)** · Log · Patterns.
Emergy keeps the centre button, per the brief.

---

## Screens

Each is drawn twice in `Emergenthealth.dc.html` — mobile at 390px (`Na`) and web at
1280px (`Nb`). Anchors `#t1`…`#t6`.

### 1. Today

Purpose: the glance. Header (greeting + live clock + weather with three-day strip),
Emergy's briefing in his own italic serif voice with the today-strip folded into its
footer, mood row, score ring with four pillars, **Log card promoted to the top
third**, four metric cards, day timeline, calendar + Up next as one block.

- Score ring: 84px viewBox, r=34, stroke 7, `stroke-linecap:round`, rotated 135°,
  dasharray `160.2 213.6` track / progress to value. Ring colour is **status**, and
  the label reads "ON TARGET" rather than the ring picking a colour from a band.
- Pillars: 3px hue tab, label, 6px track, mono value — all in the domain hue.
- Timeline: dots are **squares (2px radius) for domain, circles (99px) for status**.
- Calendar + Up next are one card parted by a hairline. Every event carries a hue,
  and the mini-month's dots are *derived from the same list* — the dot on the 13th
  and "Mum's birthday" below it are the same colour by construction.
- Dropped deliberately: the separate score chip (the ring already says 78; two
  scores that disagree is the inconsistency in miniature) and the standalone Morning
  check-in banner (it becomes the timeline's first row once checked in).

### 2. Body

Five tabs (Metrics, Weight, Body, Links, Labs). Four hue-led cards — Sleep, Heart,
Move, Body — over the full Oura field set, sleep debt, and the eight charts collapsed
into one Trends block with a range selector. Mobile tab labels are shortened so the
row can't clip.

### 3. Log

All 23 quick-adds, grouped (Water / Coffee & tea / Alcohol / Other), each in its
drink sub-hue; custom amount; today's totals with the 7-day water trend; mood faces;
weight, meds and the daily note. This screen is the reason Log is a room: it is the
daily job.

### 4. Patterns

Trends, streaks, correlations, week review, and the Garden as the reward layer.

### 5. Emergy

The chat. **Every message from Emergy carries the 3D mascot as its avatar** — not a
sprout glyph. Suggested-question chips take the hue of the domain they ask about
(the coffee question is coffee-brown).

### 6. Settings & sources

Account, themes, notifications, and the integration list with per-source sync state.

---

## The mascot

`<emergy-avatar mood="…" fit="…" gesture="…">`

- **Moods**: `great` `good` `okay` `tired` `poor` — drive body colour and expression.
- **Fits**: `full` (whole figure, portrait slots), `icon` (whole figure incl. pot,
  square slots), `bust` (head close-up — do NOT use in small square slots; he'll be
  cropped with no pot).
- **Gestures**: idle sway, wave, sigh. Arms pivot at the shoulder; reach is clamped
  so no arm or body corner clips the pot wall at any point in the wave.
- Three-quarter camera and asymmetric key/fill are what make him read as 3D at 24px —
  a head-on camera made the same geometry look flat. Don't re-centre the camera.
- He sits *in* the pot: soil disc slightly proud of the rim, overlapping his lower
  edge, in a light terracotta-adjacent brown. A darker soil ring reads as a black
  crevice — avoid.
- Sizes in use: 46px (tab bar), 34px (briefing, chat), 30px, 26px (chat messages),
  24px (sidebar mark), 88×112px (mobile portrait). Always give the mount a fixed-size
  box; as a bare flex child it shrinks.

---

## Interactions & behaviour

- Nav: active room = `rgba(99,102,241,0.14)` pill + `#818cf8` icon + `#c7c9ff` label.
- Quick-add chips: preset amounts filled at 12% of their hue with a 45% border;
  everything else outlined at 22%. Tap logs immediately, no confirm.
- Ring, bars and sparklines animate on data change only, not on mount.
- Focus: 2px accent outline, 2px offset — never the browser default.
- Web content column: **remove the 3px solid primary border and its shadow** around
  the content panel. It reads as debug chrome on a store-facing product. Replace with
  a max-width column on the recessed ground. Fix the two or three real overflow
  offenders with `min-width:0` on the flex children so the global
  `overflow-x:hidden; max-width:100vw` clamp on `html, body` can come off.
- Card density: adopt three densities as component props — comfortable (24px),
  compact (16px), tile (12px) — one radius per density, and return every hand-rolled
  card panel to the shared `Card` component (which also gets you hover and focus
  states for free). Today `Card` pads at 24px while mobile Today's hand-rolled cards
  use 16px and its chart cards 14/12px, so gutters visibly step as you scroll.

## Suggested implementation order

1. Land the two palettes as theme variables in `globals.css` (domain + status), so
   the six themes and eight accents inherit them instead of each screen inventing
   hues. Map every one of the 381 literals to one.
2. Flip `--font-sans` to Geist Sans; keep mono for figures.
3. Copy in `emergy-model.js` + `emergy-avatar.js`, replace every mascot emoji.
4. Restructure the nav to four rooms; move integrations under Settings as sources.
5. Sweep the routes in traffic order: Today, Log, Body, Patterns, Emergy, Settings.

## Before the Play Store — not yet designed

1. **Empty and first-run states.** Every mockup shows a full day of data. A new
   install has none; the ring, the four metric cards and Patterns all need a designed
   empty state or day one looks broken.
2. **The permissions moment.** Health Connect, calendar, location and notifications
   are four separate asks — one screen each, in Emergy's voice, explaining what it
   buys the user. This is also what Play's data-safety review reads against.
3. **A finished light theme.** The store screenshots will be dark, but the theme
   exists and the palette needs its light-ground values pinned or the eight accents
   will fight it.

## Files in this bundle

| File | What it is |
| --- | --- |
| `Emergenthealth.dc.html` | **The design.** Index + all six pages, mobile and web. Open in a browser. |
| `Design Review.dc.html` | The audit that motivates it: the colour-job table, the worst cases, the IA comparison, and a before/after of mobile Today rebuilt from `MobileToday.tsx`. |
| `Emergy in app.html` | The mascot in situ at every size, with mood and gesture states. |
| `Emergy 3D.html` | The mascot viewer — orbit, and export him as OBJ or GLB. |
| `emergy-model.js` | **Production-ready.** three.js scene graph, moods, gestures. |
| `emergy-avatar.js` | **Production-ready.** `<emergy-avatar>` custom element, shared renderer. |
| `three-d-stage.js` | Viewer shell used by `Emergy 3D.html` only — not needed in the app. |
| `support.js` | Runtime for the `.dc.html` prototypes — not needed in the app. |
| `github.md` | Repo provenance and the screen-to-source map. |

Assets: no images. Every graphic is SVG, CSS or three.js geometry. Icons are Lucide
(CDN in the prototypes; use the npm package in the app).
