# Working on Emergenthealth

A handoff for whoever picks this up next — the things that cost a session an
hour to rediscover, and the reasons behind the decisions that look odd.

Read `docs/local-dev.md` too if you need the app actually running; it covers
the Postgres-over-WebSocket bridge that makes local development possible at
all.

## What this is

A personal health companion. A Next.js app on Vercel, a Postgres database on
Neon, and an Android app that is a Capacitor WebView wrapper around the same
web app — plus a growing amount of native Java that is *not* a wrapper.

The single most useful fact about this architecture:

> **Web and server changes reach the phone with no new APK.** The Android app
> loads the deployed web app. Merge, wait for Vercel, reopen the app — it's
> there.
>
> **Native Java changes need a new APK.** Anything under `android-widget/`.

Getting this backwards wastes a build cycle and, worse, has you debugging a
phone that is running last week's code.

## The Android half

Native Java lives in `android-widget/*.java`. There is **no Android project in
the repo** — CI generates it with Capacitor, then `.ci/customize-android.py`
copies those Java files in, patches `AndroidManifest.xml` with the permissions,
services and receivers they need, and wires up Gradle. If you add a Java file,
add it to the copy list in that script or it silently won't ship.

What runs natively, and why each one exists:

| File | What it does |
|---|---|
| `EmergyHeadService` | The floating chat head that survives closing the app |
| `EmergyLocationService` | Background GPS: foreground service, on-disk queue, posts with the widget key. Needs no WebView and no session. |
| `EmergyWakeService` | Always-listening mic for the wake word |
| `SherpaWakeDetector` | sherpa-onnx keyword spotting behind the service's `WakeDetector` seam |
| `HeadAlarmReceiver` | Reminder pop-outs, restart alarms, **and the 15-minute watchdog** |
| `HeadBootReceiver` | Re-arms everything after a reboot (which clears all alarms) |
| `*Widget.java` | Home-screen widgets |

### The watchdog, and why it exists

Every restart path in this app used to be event-driven: `START_STICKY`, the
alarm set in `onTaskRemoved`, and the boot receiver. **None of them fires for
what actually happens on a Samsung** — the system decides the app is sleeping,
ends a service, and tells nobody. No `onTaskRemoved`, no reboot, and
`START_STICKY` not honoured. Tracking would stop at lunchtime and stay stopped
until the app was next opened.

`HeadAlarmReceiver.ACTION_WATCHDOG` is an inexact `setAndAllowWhileIdle` alarm
every 15 minutes that re-arms itself and calls `ensureRunning` on whatever
asked to be kept running. Inexact deliberately: the exact variety needs
`SCHEDULE_EXACT_ALARM`, which the user can revoke, and Doze throttles
`setAndAllowWhileIdle` to ~9 minutes anyway, so asking for less would only lie
about the interval.

It re-arms **before** doing anything else, and cancels itself when nothing
wants keeping.

### The microphone is singular

`EmergyWakeService` holds `AudioRecord` open continuously — that's its job. But
when it hears the wake word and opens the app, the chat page starts the
phone's speech recogniser **on the same microphone**. Two captures fighting
over one mic means dictation gets silence, which reads as a broken recogniser.

So `fire()` releases the mic *before* launching the app, and the chat hands it
back via `resumeWake()` the moment dictation ends. There's a 90-second backstop
for an app that crashes mid-handoff — a wake word left permanently deaf would
be worse than the bug it fixes.

## The correlation engine

`src/lib/correlations.ts` (~2600 lines) is the heart of the app. It builds a
`DayData` record per local day from ~28 sources, then runs ~31 families of
comparisons over them.

Structure worth knowing:

- **`compareGroups()`** is the workhorse: two groups of numbers in, one
  `InsightResult` out, with a permutation p-value.
- **`assignTiers()`** applies Benjamini-Hochberg FDR across the whole run.
  With ~70 candidates several will always look interesting by luck; this is
  what separates them. Runs **once**, after every family, so the p-value budget
  is shared fairly.
- **`deriveInsights(days)`** holds families 1–26 and is called **twice** — once
  on all days, once on weekdays only. The second pass is the weekend guard: an
  effect that collapses or flips without weekends is probably the weekend.
- Families 27+ (consistency, streaks, absence, onset, interactions) live
  **outside** `deriveInsights`, deliberately. Every one of them would be
  destroyed by the weekday-only filter — streaks aren't consecutive across
  weekend cuts, absence loses its "recent" window, onset can't spot a first
  appearance. Their unique ids mean the guard's lookup no-ops on them.

Adding a family: match the existing shape, give it a unique id, add its
category to the union in `correlations.ts` **and** to `CATEGORY_META` +
`CATEGORY_ORDER` in `src/app/dashboard/insights/page.tsx`. Missing the second
one type-errors, which is the intent.

## Standing guards

`src/lib/__tests__/no-utc-day-bucketing.test.ts` is not a unit test — it greps
the codebase and fails the build when new UTC-day-bucketing appears. Slicing an
ISO string to get a day gives the *UTC* day; for anyone not on UTC, everything
between local midnight and their offset lands on the wrong date. That was found
in fourteen places in one sweep, twice in code that *writes* a journal entry.

If you hit it, **fix the code**. A legitimate exception goes in the allow-list
with the reason written down — never silenced.

## Conventions

- **Comments explain why, not what.** The codebase is written so that the
  reasoning behind an odd decision survives. Match that; a comment that
  restates the line below it is noise, one that explains the bug it prevents
  is the point.
- **Honest UI over reassuring UI.** A recurring bug class here is a screen
  that says something is fine because it hasn't complained. Several rounds of
  work have gone into status text that says what's actually true — "went
  quiet on 2026-07-28" rather than a cheerful green tick.
- **Never point at a remedy that isn't rendered.** Same family of bug: a
  warning saying "the two settings below are usually why" when neither
  setting is showing.

## Workflow

Branch `claude/emergi-overhaul-77lk2s`. Develop there, push there, open a
**draft** PR. After a merge, reset the branch onto main rather than stacking:

```bash
git fetch origin main && git checkout -B claude/emergi-overhaul-77lk2s origin/main
```

One open PR at a time. Validate before pushing: `npx tsc --noEmit`, `npx
eslint`, `npx vitest run`. CI runs the same plus the Android build, which is
the only thing that compiles the Java.

`versionCode` is CI-derived from the run number — never bump it by hand.

## Commands

```bash
npm test              # vitest, ~740 tests across 87 files
npm run lint          # eslint
npx tsc --noEmit      # typecheck
npm run dev           # needs the local-dev.md setup first
npm run dev:proxy     # the ws→tcp bridge Neon's driver needs locally
npm run dev:seed      # demo data
npm run smoke         # screenshots every dashboard page to .ci/smoke-shots/
```

## A note on measuring the UI

Pages scroll in an inner `<main class="flex-1 overflow-y-auto">`, **not the
window**. `window.scrollTo` does nothing and `document.documentElement.scrollHeight`
equals the viewport height. Measuring scroll position the obvious way produces
confident, wrong conclusions — this cost one session a false bug report about
content being stranded below the fold on seven pages.

## Recently landed

Roughly in order, most recent first:

- Correlation families: consistency, streaks, absence, onset, two-way
  interactions
- Settings regrouped by purpose ("Emergy on this phone" / "Data connections" /
  "Location & weather"); stale sources now say "went quiet"
- Wake word end to end: sherpa-onnx model, mic handoff, error reporting
- The 15-minute watchdog
- Native background location that survives the app closing
- Evening check-in; Emergy setting real alarms; dictation auto-send after 6s

## Open threads

- **Onset/withdrawal** in the correlation engine is half-done — onset ships,
  withdrawal needs pre-window history the engine doesn't load.
- **Interaction p-values** are hardcoded to 1. The family earns its cards
  through an effect-change threshold instead; a permutation design for
  four-cell shifts would be better.
- **Body measurements and lab results** are stored but never correlated.
  Both were flagged as worth doing.
- **Toggl** stores a token but no daily log table, so nothing correlates.
- `EMAIL_FROM` is unset — the sender is Resend's sandbox, which only reaches
  the account owner. Needs a domain.
