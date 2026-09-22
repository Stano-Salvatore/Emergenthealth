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

`src/lib/correlations.ts` (~4100 lines) is the heart of the app. It builds a
`DayData` record per local day from ~28 sources, then runs ~31 families of
comparisons over them.

Structure worth knowing:

- **`compareGroups()`** is the workhorse: one day-ordered `Split` of
  observations in, one `InsightResult` out, with a **block permutation**
  p-value — week-scale runs of days are shuffled, not days, because days
  carry yesterday inside them. Measured on AR(1) nulls at the
  autocorrelation daily weather and physiology show, the old day-shuffle
  rejected 9–22% of true nulls at p<0.05; blocks bring it back to ~5–7%,
  at ~no power cost on strong effects. The observations must be pushed in
  day order — that ordering is the entire point of `Split`.
- **`assignTiers()`** applies Benjamini-Hochberg FDR across the whole run.
  With ~70 candidates several will always look interesting by luck; this is
  what separates them. Runs **once**, after every family, so the p-value budget
  is shared fairly.
- **`deriveInsights(days)`** holds families 1–26 and is called **twice** — once
  on all days, once on weekdays only. The second pass is the weekend guard: an
  effect that collapses or flips without weekends is probably the weekend.
- Families 27+ (consistency, streaks, absence, onset, interactions,
  combinations) live
  **outside** `deriveInsights`, deliberately. Every one of them would be
  destroyed by the weekday-only filter — streaks aren't consecutive across
  weekend cuts, absence loses its "recent" window, onset can't spot a first
  appearance. Their unique ids mean the guard's lookup no-ops on them.

Adding a family: match the existing shape, give it a unique id, add its
category to the union in `correlations.ts` **and** to `CATEGORY_META` +
`CATEGORY_ORDER` in `src/app/dashboard/insights/page.tsx`. Missing the second
one type-errors, which is the intent.

**Where a family cuts high from low** is the single biggest lever on whether
anything ever reads "Solid". Most families cut at the user's own median
(screen time, walking, productivity, distance, listening, custom
trackers). Three were still cut at a borrowed number — 200mg of caffeine,
25°C, an hour of high stress — and `balancedCut()` now decides between the
two: it keeps the borrowed number while the days fall on both sides of it,
and falls back to the personal median when they don't. In a Central European
year "25°C+" picked out 7 days against 57, and no effect however real clears
a permutation test from a group of seven. The label always prints the number
actually applied, so a card never advertises a threshold it didn't use. The
cut is computed on the full window, never per-pass — otherwise the weekend
guard would compare two structurally different splits.

Bump `ENGINE_VERSION` when a group definition moves, not just when a family
is added: cached cards carry the label they were computed with.

**`higherIsBetter` is about the outcome, never the exposure.** The engine
negates a card's delta when it is false, so it means "a lower value of the
thing measured is good" (resting HR, blood pressure, symptom severity,
minutes to fall asleep). Three cards had set it because the *exposure* was
bad — alcohol on HRV, alcohol on REM, rain on mood — and each showed a
harmful effect as a green improvement. Check the outcome column, not the
title.

**A question is asked once.** The sleep panel's gates on caffeine and alcohol
are the caffeine → sleep-score and alcohol → sleep-score cards; there are no
main-battery twins. Caffeine → deep sleep and alcohol → REM are the other
way round: pre-registered in the main battery so they run whether or not
the gate clears (a cause can move one component while the score holds
still), and `PREREGISTERED_ASPECTS` makes the panel skip them. `drankDay`
is the one definition of a drinking day for the sleep, HRV and resting-HR
cards: any logged drink, silent days set aside, the same as the panel.

**No location means no weather, not somebody else's.** `getWeatherCoords`
used to fall back to Bratislava for any user with no stored preference. For
the one account that lives there the guess was invisible and correct; for
everyone else — a Play reviewer, anyone the app is shown to — the Brief
opened on a confident hourly forecast for a city they had never been to, with
an outfit line underneath telling them it was t-shirt weather. It is the rule
the nightly weather cron states about itself, broken on the first screen:
**no row rather than a guessed city**. It returns null now, both callers
already had a no-weather path, and the Brief says where to set it. Found by
signing in as an empty account rather than by reading the code — the guess is
invisible from Bratislava.

**A connected source speaks only for the days it existed.** `SOURCE_FROM` in
`correlations.ts` holds the first day each one produced a row, and
`sourceCovers(src, date)` is the question every family has to ask before
reading a zero. The rule was already written here — `calendarFrom` carries a
comment stating it exactly — and used by one family out of all of them, while
eight other places read `(d.workoutMin ?? 0) >= 20` and filed every day before
Strava was linked as a rest day. Those days are all OLDER than the covered
ones, so "training vs rest" quietly became "since I connected it vs before",
with the label still saying "rest days". On a 60-day fixture with the same
workouts either way, a Strava linked 20 days ago compared 10 workout days
against **9** rest days; linked throughout, 10 against **51**. Before the fix
both said 51.

`ComboCondition.test` now returns `boolean | null` like `SleepCause.test`,
which is the tri-state the combinations were noted as lacking — `dense` fills
the calendar with bare `{ date }` objects and every one of them used to answer
"no alcohol, no workout, not busy" in the same voice as a real control.
Watch the two call sites: `null` is falsy, so `dense.filter(c.test)` and
`conds.every(c.test)` both compiled perfectly and counted unknowns as no.
`source-coverage-guarded.test.ts` greps for the coercion and allows it only
with a coverage call within two lines, because the failure is an omission and
an omission has no runtime symptom.

Still open, and a different shape: a source that **stops**. `SOURCE_FROM` is a
first-seen date, so it cannot tell a disconnected Strava from a fortnight off
the bike — which is precisely what the absence family would report as
"Missing: a workout". It needs a last-seen date and a rule about how long a
silence has to run before it counts as gone.

**Sleep debt has one definition, in `sleep-rhythm.ts`.** It had three: the
Health screen and Emergy's scripted answer compared the goal against what was
slept and let a long night pay some back, while the Week screen summed
`max(0, goal - night)` per night — which can never show a surplus and never
lets a lie-in count. On the demo week those two read −36 minutes (36 ahead of
goal) and +24 minutes (a debt warning) from the same five nights. The signed
one won, because it is the arithmetic the words describe and "debt" is a word
that implies repayment. A night with no duration is not a zero-hour night; it
drops out, and `nights` comes back with the figure so the caller can say what
it is based on.

**Sleep regularity is the Sleep Regularity Index**, not the spread of
bedtimes — same hours to bed with a four-hour-earlier alarm on weekdays is not
a regular sleeper. For every minute of the clock it asks how often you were in
the same state on two days running: 100 is the same day every day, 0 is today
telling you nothing about tomorrow. Two limits it states on the card rather
than hiding: it reads the IN-BED window, the only one the API returns, so
lying awake at 04:00 counts as asleep; and a night with no recording is
unknown, not awake — without that rule two missing nights in a row would agree
perfectly with each other and read as a person who keeps immaculate hours.
Note that a steadily drifting sleeper still scores high (an hour a night
round the clock comes out at 84), because the index is about consecutive
days, not about stability over a month. It is read against the account's own
previous month, never a population average.

**Bedtime is a cause, and its caveat is a different column.** It is the one
`SleepCause` that reads the NIGHT rather than the day (`test(d, night)`), for
the obvious reason: a bedtime is the night's own first fact, and `byDate` is
not in scope where the causes are declared. The panel is the right home for
it rather than a combination condition — a night with no ring has no bedtime
AND no score, so the same rows drop out of both sides, where a combo would
have read that night as "went to bed early" and grown triples from it. Every
other cause is checked against bedtime (`BEDTIME_CONFOUND_MIN`, 45 min); this
one is checked against **length** (`DURATION_CONFOUND_MIN`, 30 min), because
a cause cannot confound itself and the question underneath a late night is
whether it was a short one — the alarm rarely moves, and a sleep score is
mostly length. The cut is 23:30 borrowed, personal median once that fails to
split the nights, and the chip carries whichever it used so the "Test this"
experiment can say "Lights out before 00:15" without naming an hour of its
own.

**A day's music genre** comes from `dominantGenre()`: the genre holding a
majority of the day's tagged plays (`artistPlays`, min 3 tagged). Rows
written before `artistPlays` existed fall back to the old top-artist lookup;
a row WITH counts but no majority stays unlabelled on purpose. Old rows gain
counts from a Takeout re-upload (fills only where null) or a Last.fm re-sync
(overwrites). The genre tagger reads every artist on a day, not just the
day-winners — the acts that swing a majority are precisely the ones that
never top a day.

Two families do not work on single days, and the reasons generalise:

- **Interactions** compare two differences, so they get
  `interactionPermutationP` rather than `permutationP`.
- **Combinations** (`combo_*`, shown under Combinations with the
  interactions) are conjunctions — A + B, A + B + C on day D against the
  next morning's sleep score, HRV, readiness, energy or mood. One predictor,
  so the ordinary `compareGroups` path: block permutation, weekend guard,
  FDR. The search is apriori-shaped: ten day-conditions, pairs must beat
  their best ingredient by a third in the same direction, triples are grown
  only from passing pairs and must beat their best pair by a third; at most
  three cards per outcome, and a pair steps aside for a triple that contains
  it. `correlations-combo.test.ts` plants a triple no pair explains and a
  single-ingredient effect that must yield no combo card.
 It shuffles the
  moderator label *within each predictor level*, which leaves main effects
  cancelling in the difference-of-differences. Shuffling across the whole
  table instead would hand a significant p-value to every moderator that
  merely has an effect of its own.
- **Body measurements** compare the stretches *between* weigh-ins, never the
  weights themselves. Today's weight is mostly yesterday's weight, and that
  autocorrelation is exactly what a permutation test assumes away — grouping
  weight levels by behaviour produces confident nonsense. Spans are walked
  anchor-to-anchor so they never overlap.

Lab results stay out of this engine on purpose; the reasoning is at the top
of `src/lib/lab-trends.ts`. A marker with three readings a year would get a
p-value computed from three points. That module compares consecutive draws
descriptively, and now carries the everyday numbers (alcohol, exercise,
sleep, steps, weight) over the interval alongside the supplements — each
measured against the same length of time before the earlier draw, because
"2 drinks a day" is trivia and "up from half of one" is context.

Every source marked `driver: "server"` in `sync-status.ts` must have a
`/api/cron/<id>` on a schedule. That is what lets the status screen call its
silence overdue; without a cron the claim is false, because the source syncs
only when the app is opened. Last.fm and RescueTime lived that way for months —
inside a `Promise.allSettled` that discarded the rejection, so a revoked key
was indistinguishable from a quiet week.

## Standing guards

`src/lib/__tests__/no-utc-day-bucketing.test.ts` is not a unit test — it greps
the codebase and fails the build when new UTC-day-bucketing appears. Slicing an
ISO string to get a day gives the *UTC* day; for anyone not on UTC, everything
between local midnight and their offset lands on the wrong date. That was found
in fourteen places in one sweep, twice in code that *writes* a journal entry.

If you hit it, **fix the code**. A legitimate exception goes in the allow-list
with the reason written down — never silenced.

`src/lib/__tests__/quick-answer.test.ts` does the same for the scripted
answers, and adds one more guard worth knowing about: it greps
`quick-answer-run.ts` for verdict language ("that's good", "you should", "too
much") and fails on a match. A script that starts judging is claiming a
judgement nobody made, in a voice that sounds certain.

`src/lib/__tests__/quick-log.test.ts` guards the fast path in both directions.
The messages it must parse are real ones; so are the messages it must refuse,
and those matter more. If a change makes the parser accept something in the
"his, not ours" list, it has started guessing, and a guessed row is worse than
a slow one. It also asserts the parser still runs *before* the model in
`/api/chat`, and `intake-backdating.test.ts` asserts the tools still write
through `recordDrink` rather than reaching for `intakeLog.create` again.

`src/lib/__tests__/insight-language.test.ts` holds the engine's *sentences* to
the standard `quick-answer.test.ts` holds the scripted answers to. The rule
lives in `insight-lint.ts`: no preposition stacked inside one clause, no phrase
used as a plural subject, no verdict, no statistics vocabulary on the card, and
nothing over 25 words. It exists because the insight cards are the only strings
in the app nobody wrote — they are assembled from a template plus a group
label, and "After some caffeine after 16:00 the night scores 62.9" is what that
produces when no one reads the two together.

The half of that file that matters is the list of sentences it must *not* flag.
A lint that fires on "After 7h+ sleep, mood averages 3.8 vs 3.1 after shorter
nights" gets switched off within a week and deserves to. Repetition across a
comparison is fine; a preposition stacked inside one clause is the bug.

When you need a group label to read differently in the chip and in the
sentence, `compareGroups` takes `{ chip, phrase }` instead of a string — see
the sleep panel's causes. Plain strings still mean both. **`experiment-suggest.ts`
greps the chip** (`/still on board/i`, `/ days$/i`), so a label rename can
silently re-enable an experiment suggestion on a prescription.

It also reads **insight ids**, and that is a second thing a rename breaks
quietly. Almost every id ends in what it measured, so the outcome is taken off
the suffix — but the interaction cards are `combo_<outcome>_<cond>_<cond>`, with
the outcome at the front, and for as long as that went unnoticed not one
combination card offered an experiment. The combination tables in
`experiment-suggest.ts` are copies of two arrays that live *inside a function* in
`correlations.ts`, where nothing can import them; a guard test reads the copies
back against that file, because a condition added there and missed here costs a
button on every card that uses it.

`src/lib/__tests__/mood-one-place.test.ts` exists because **mood lives in two
tables**. The check-in writes `MorningCheckIn."mood"`; Emergy's `log_mood`
writes `MoodLog`. Neither is a superset of the other, and a reader that queries
one of them has silently opted out of the other — no error, no empty state,
just a metric that stops appearing weeks later. `lib/mood-series.ts` holds the
only merge, and the only rule: **the check-in wins**, being the answer someone
stopped to give. `correlations.ts` and `daily-score-load.ts` predate the helper
and merge by hand; the guard allows that, and requires only that no file ever
reads one mood table alone.

`src/lib/__tests__/bottom-nav.test.ts` pins `BottomNav.tsx` against Sidebar's
`IN_BOTTOM_NAV`, which are two hand-maintained lists that must agree. Below
`lg` the bottom nav *is* navigation and the sidebar is a drawer that hides
anything pinned there as a duplicate. So a tab moved out of `BottomNav` and
left in `IN_BOTTOM_NAV` is not demoted — it is **gone on a phone**, hidden in
favour of a tab that no longer exists. Overview is the one deliberate
exception, and it is asserted as such.

**The generated manifest is checked against itself now, and here is why.**
`customize-android.py` decides whether to add a component by asking whether
the manifest already mentions it. It used to ask for the bare class name — and
the manifest also carries the comments that same script writes into it. One of
those comments explains `ACCESS_BACKGROUND_LOCATION` by naming
`EmergyLocationService`. So the check matched its own prose, the `<service>`
element was never added, and the class shipped compiled-in and undeclared.
Android will not start an undeclared service, so `startForegroundService`
threw, the plugin rejected the call, and the Settings card told people to
check their location permission or Samsung's battery settings. Every phone,
from 2026-09-02.

Two things came out of that and both are worth keeping:

- **Check the element, not the string.** `android:name=".Foo"`, never `"Foo"`.
  The same mistake in the other direction hid the missing Health Connect
  rationale screen: `ACTION_SHOW_PERMISSIONS_RATIONALE` was in the manifest,
  under `<queries>` — which is how this app *finds* Health Connect and does
  nothing to let Health Connect find a screen. A `<queries>` entry and an
  `<intent-filter>` grep identically and mean opposite things.
- **The script verifies its own output.** Its last step reads the finished
  manifest and fails the build if any component class compiled into the app is
  not declared — deriving "is a component" from what the class extends, rather
  than from a list somebody has to remember to update. Break it and watch it
  fail: revert one check to the bare name, regenerate, and the build stops.

The three Play guards are a family, and they all exist for one reason: the
files that describe this app to Google are not code, so nothing notices when
they stop being true. `screen-time-declared.test.ts` ties the readable flag to
the manifest. `health-permissions-declared.test.ts` ties the record types the
app reads to the `android.permission.health.*` lines and the Play form's list.
`play-permissions-documented.test.ts` requires every declared permission to
have a row in `COMPLIANCE.md` — and reads the Capacitor plugins' manifests too,
because the manifest merger folds those into the APK, which is how `WAKE_LOCK`
turned out to be shipping with nothing written down about it.
`privacy-policy-covers-permissions.test.ts` is the same idea pointed at the
public policy: the manifest decides what the page has to address, so declaring
background location makes "we do not collect data in the background" a failing
test rather than a sentence nobody re-read.

Each of them fails in **both** directions. A permission declared and unused is
not a tidiness problem — it is a Play Console form asking what a sensitive
permission is for, and "nothing" is not an answer that gets an app published.

`.ci/smoke.mjs` fails a run in which more than two routes land on `/signin`.
It used to report **"All 39 screens clean (39 redirected)"** for a sweep that
was never signed in — the sign-in page renders perfectly thirty-nine times.
A check that passes while checking nothing is worse than no check. If it
fires, the demo session expired: `npm run dev:seed`.

A note on writing either kind of guard: both of these passed on their first
draft against code I had deliberately broken — one matched a leftover
`import` rather than a call, the other a comment rather than the rendered
string. **Break the code first and watch the guard fail**, or it is decoration.

## Conventions

- **The trackers are meant to replace other apps, not summarise them.** The
  owner's stated goal for habits, reminders, the calendar, training and weight
  is that they are complete enough to be someone's *only* app for that job.
  So a feature in one of those areas is judged against the standalone app it
  displaces (Loop, Google Tasks, Strong, MyFitnessPal…), not against "better
  than nothing": recurrence rules, editing, deleting, history, an empty state
  that teaches — the boring completeness is the feature. Half a habit tracker
  sends the user back to the app they were trying to leave, and takes the
  data with them.
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

Then render it. In one day, six faults were found by running the app and
looking at the page, and all six were invisible to 1,400 passing tests — a
card pointing at a setting that was not there, copy that read wrong only once
two labels met. When something "passes" and you are unsure, ask for a render
(`npm run smoke` screenshots every dashboard page) before calling it done.

`versionCode` is CI-derived from the run number — never bump it by hand.

## Commands

```bash
npm test              # vitest, ~1454 tests across 128 files
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

- **Collected and never read (3.3.4).** Hunting the 3.3.3 bug's whole class
  turned up its twin, one release old and self-inflicted: `PhoneSleepSegment`
  was written by `/api/phone/sensors` and read by nothing. The feature exists
  for the nights the ring is on its charger — and on exactly those nights the
  brief said "NO SLEEP DATA ... never invent or imply sleep figures" and
  `quick-answer-run` said "No sleep data for last night", while the estimate
  sat in the table. Both now fall back to it, labelled as the phone's guess
  (no stages, no score), with a 3-hour floor so a nap is not sold as a night;
  a week's answer reports the count rather than averaging phone guesses in
  with ring measurements.

  `collected-data-is-read.test.ts` is the general guard: for tables that exist
  to answer a question the app asks out loud, it fails when nothing reads
  them, and it also pins that the brief consults the phone BEFORE asserting
  ignorance and that it carries a step count at all. Deliberate deferrals stay
  legal — they just have to come off the list with a reason, so the decision is
  visible instead of silent. `AmbientSample` and `PhoneEvent` are deliberately
  NOT on the list: nothing anywhere claims "you had no light yesterday", so an
  unread row there is a gap and not a contradiction.

- **The brief had no steps in it (3.3.3).** `trainingLoad()` reads
  `StravaActivity` and nothing else — `loadSessionsForUser` is the only feeder
  — and its resting summary said "No sessions in the last four weeks" without
  naming the source. `/api/briefing` pastes that line into the prompt, and the
  prompt contained **no step count whatsoever**, so nothing in it could
  contradict the reading. Emergy told a person who had walked 12k steps the
  previous day that they had not trained in a month. Two fixes, because it was
  two faults: the summary now names Strava and says walks and steps are
  outside it, and the brief now carries steps (today or yesterday, by period)
  plus recognised walking minutes with an explicit "do not call a day like
  this inactive". Guarded in `training-load.test.ts`, broken first. The
  general lesson is the one this codebase keeps relearning: a sentence
  measuring one table must name that table, because the reader assumes it
  measured everything.

- **Three things a screenshot caught at midnight (3.3.2).** The pattern-watch
  message said "tap to see" inside a chat bubble — the string was written for
  the push, whose tap works, and reused on a surface with nothing to tap.
  `watchBodies()` in `lib/watch-message.ts` now composes per surface, and its
  test bans the word "tap" from the chat body outright. The evening check-in
  read `s.placeName` from `/api/checkins`, which returns CheckIn rows whose
  column is `place` — so every stop said "Somewhere", geocoded names and all;
  the fetch boundary is untyped, so a grep guard (comments stripped — the
  android-request-codes lesson, learned twice in one day) is the only thing
  that will catch the next drift. And `/api/emergy` judged the new day at
  00:05 on counters that were one minute old, so the avatar slumped grey at
  midnight regardless of the evening it had just watched; before 05:00 local
  it now scores yesterday — the day still being lived — and the healthLog
  pick gained an `orderBy` because a two-day window with `findFirst` and no
  order is an avatar that flickers between moods on refresh.

- **Four things the engine was already holding and not reading (3.3.1).**
  Audit A2 closed: the Body page's measurement form writes into
  `BodyMeasurementLog` and the engine read only `BodyMeasurement`, so
  form-logged waist never reached the waist family. Both are read now; the
  form's entry wins where both speak for a day, and body fat stays excluded
  (impedance tracks hydration). And the travel spans' other modes finally go
  somewhere: drive + transit + train fold into `vehicleMin` beside `walkMin`,
  with a `vehicle_mood` / `vehicle_sleep` family pair cut at the user's own
  median. The gate demands at least one day with real vehicle time, so a
  person who never drives is not compared against themselves.
  Also: `WeatherLog` gains `pressureMslHpa` (Open-Meteo's
  `pressure_msl_mean`, requested by the cron it already runs), and the gap
  query treats a pressure-less cron row inside the engine's 60-day window as
  a gap, so the column backfills itself once through the machinery that fills
  missing days — bounded, so a day the provider will not serve cannot become
  the endless nightly backfill the query's own comment warns about. A
  `pressure_drop` suspect (≥ 4 hPa between day MEANS — day-averaging flattens
  the intraday 6–10 hPa the literature quotes) fans across every logged
  symptom. And `breathingDisturbance` gets its first reader ever:
  `alcohol_breathing`, in recovery, higher-is-worse declared the way
  `alcohol_hrv`'s comment insists.
  `ENGINE_VERSION` → 20. `correlations-unread-sources.test.ts` plants the first two —
  waist ONLY in the log table, a mood gap on irregular heavy-transit runs —
  and both were broken first and watched to fail. The first vehicle fixture
  used `i % 4` and the block permutation test rightly refused it; the fix was
  an aperiodic plant, not a looser test.
  `correlations-pressure-breathing.test.ts` plants the other two the same
  way, with the drop days ISOLATED as well as irregular — on the second of
  two consecutive low days the pressure has already fallen, the suspect
  rightly says no, and a headache planted there blurs its own effect.

- **The phone's own sensors, and the permission budget they did not spend
  (3.3.0).** Light, barometric pressure, screen/charge moments and the Sleep
  API. The whole design constraint was that **none of them costs a permission
  the app did not already hold** — light and pressure are readable by any app,
  the screen and power broadcasts need nothing, and `SleepSegmentRequest` runs
  on the `ACTIVITY_RECOGNITION` grant the travel-mode transitions already use.
  That is what made it safe to add while the health-apps declaration was being
  filled in, and it is why `play-permissions-documented.test.ts` still passes
  untouched. Data safety is a different question from permissions and COMPLIANCE
  §2 now answers it.

  All four store-and-forward into SharedPreferences and drain on foreground,
  the same shape as `EmergyActivityReceiver` — they happen while the web layer
  does not exist. `/api/phone/sensors` takes all three buffers in one request
  and keys every row by what it is, so the handover and the deterministic id
  fail in opposite directions: one drops, the other doubles, and neither is
  trusted alone.

  **Two things worth knowing before touching this:**

  1. `EmergyPhoneEventReceiver` is deliberately NOT in the manifest, and
     `customize-android.py`'s undeclared-component check exempts it by name.
     `ACTION_SCREEN_ON`/`OFF` are delivered only to receivers registered with
     `registerReceiver()`; a manifest entry is accepted and never fires. So it
     is registered by the location and wake services, it collects only while
     one of them is alive, and the Settings card says so. `phone-sensors.test.ts`
     fails in both directions — if it gets declared, and if no service registers
     it.
  2. It registers through `ContextCompat` with `RECEIVER_NOT_EXPORTED`. Plain
     `registerReceiver()` throws from Android 14 and the caller swallows the
     failure, so it would have collected nothing while looking entirely healthy.
     The wake service's power receiver already had this right; copying it was
     what caught it.

  The light sensor faces the front of the phone, so a pocket reads as darkness
  and a face-down desk reads as night. Anything built on this column has to
  treat it as "light around the phone when it could see" — lux-hours would be
  a lie. The pressure column is **station** pressure, not sea-level adjusted,
  so it moves with altitude as well as weather.

  **No correlation families yet, on purpose.** Families over an empty table
  find nothing, and the cut points cannot be chosen without seeing real
  distributions — the same reason `SOURCE_FROM` exists. They come once there
  are a few weeks of rows.

- **Four ways a background service could stop without saying so (3.2.1).**
  All native, all found by reading the audit's A12 and C10 rather than by
  anything failing.

  The wake-word restart and the watchdog shared request code 920007 against
  the same receiver, so they were one PendingIntent that behaved only because
  their actions differed. `android-request-codes.test.ts` now fails when two
  components share a code from the 9200xx block; it reads the sources with
  comments stripped, because the comment explaining the fix contains the old
  number and the first version of the guard failed on it.

  The watchdog also restarted location and the wake word only, never the head
  — which is on the same sticky-restart path it exists to compensate for — and
  nothing armed the watchdog for the head at all, so a phone with only the
  head on had no heartbeat to be restarted by. `HeadAlarmReceiver
  .anythingWanted()` is now the one list of what keeps the heartbeat alive,
  because the two stop paths each named the other service and neither had
  heard of the head.

  And `flush()` was reachable only from a new fix, including the retry after a
  failed upload, so points queued while the phone then sat still waited for it
  to move — with `MAX_QUEUED` dropping the oldest meanwhile.
  `EmergyLocationService.flushPending()` hangs it off the watchdog tick, which
  works because `setAndAllowWhileIdle` survives Doze and a `postDelayed` does
  not.

  **None of it is verified on a phone.** CI compiles it and the guard covers
  the collision; the rest is reasoning about Android's lifecycle.

- **Finance came out, and the `Transaction` table did not.** The three screens,
  YNAB, TrueLayer, the Revolut imports, recurring-charge detection, the chat
  prompt's `## Finances` section, two MCP tools and both spending insight
  families are gone. It had been flag-gated since 3.0.0 — invisible, and still
  costing two bank APIs polled every thirty minutes, two rows on the sync
  status screen and two Vercel cron entries.

  **The one thing to know if you audit the schema:** `Transaction`,
  `YnabToken` and `TruelayerToken` are still in `schema.prisma` and now have
  no reader except the data export, which reads `Transaction` on purpose so
  anyone who had rows can still take them out. That is deliberate, not the
  dead-table smell — dropping them would be a data-loss migration for no gain.
  If a later pass wants them gone, that is a migration decision, not a
  cleanup.

  The two families that went (`spend_mood`, `spend_mood_next`) were the only
  part of this that earned its keep: card spend is a behavioural signal —
  eating out, drinking, going out — that the engine could read against mood
  without anyone opening a budget. If it is ever wanted back, it needs a
  source of daily spend, not a finance feature.

- **The phone filed two hours of every night under the wrong day.** Health
  Connect sync runs on the user's own device, and `dateStr()` in
  `health-connect-service.ts` was slicing an ISO string — the UTC day. In CEST
  every record between local midnight and 02:00 went to yesterday: the steps
  walked home after midnight, the calories burned with them, a weight taken
  before dawn, each then read against the wrong night's sleep by the engine.
  The standing UTC guard did not see it because it matches
  `.<timestampField>.toISOString()` and this was a bare local in a helper;
  `health-connect-local-day.test.ts` sets a timezone rather than assuming one,
  because CI runs in UTC where the bug is invisible. The same pass also gated
  the chat prefix's 100-row `Transaction` query behind the finances flag;
  the entry above then removed that query altogether, so the Health Connect
  fix is the part of this pass that is still live code. `docs/review-2026-09-20.md`
  has the rest of that pass, including the answer to "is there an easier sync"
  (yes, and it is native — see the open thread below).
- **Months of sleep data that nothing ever read.** The ring records time to
  fall asleep, sleep efficiency, restless periods, time in bed and bedtime on
  **91% of nights**, and every one of them was written faithfully by the sync
  and then read by exactly one stat box on the Health page, for the most recent
  night only. Emergy's `get_health_range` did not return them, so he could not
  answer "how long does it take me to fall asleep" and would reach for sleep
  score instead — which mixes latency in with six other things. The correlation
  engine could not see them either. They are now in the chat tool, the weekly
  answer, `TRACKED_METRICS` (so the anomaly watch and monthly drift cover them,
  thresholds kept equal on both sides by the guard in `drift.ts`), and
  `DayData`. **`tracked-metrics-wired.test.ts` is the guard that matters**: a
  tracked metric is named in four places by hand and missing one silently
  disables it, with no error and no empty chart, just a signal that never fires.
  Two correlation families were added — caffeine against time to fall asleep,
  alcohol against efficiency — deliberately pre-registered rather than a sweep,
  because every family spends false-discovery budget for all the others.
  Bedtime goes through `bedtimeMinutesLate`, shared with the caffeine cutoff:
  01:20 must read as later than 23:08 or a week straddling midnight averages to
  the middle of the afternoon.
- **Three Oura endpoints we had never called.** `daily_cardiovascular_age`
  (vascular age and pulse wave velocity), `vO2_max` (cardio capacity) and
  `daily_resilience` (Oura's own word — solid, strong — kept verbatim rather
  than mapped onto a scale we would have to invent). The stress endpoint's
  `day_summary`, the "Balanced day" wording, was being fetched and thrown away;
  it is stored now. All are weekly-cadence numbers, so a day without one is
  normal rather than a gap, and they render only on the days Oura published
  them rather than showing a stale figure as today's.
  **Every mapper here was written from documentation, not from a payload**,
  which is how `awake_duration` happened — so each one calls `warnIfEmpty`, and
  a document that maps to nothing logs the keys it actually had instead of
  leaving a column quietly null forever. `sleep_time` (the Body Clock card) is
  deliberately **not** included: its response nests an object whose shape could
  not be verified, and guessing a nested shape is precisely the mistake this
  guard exists to catch.
- **Oura closed the personal access token door in December 2025.** New tokens
  cannot be created, and only OAuth works for a new connection. The Settings
  card still said "get yours at cloud.ouraring.com/personal-access-tokens",
  which sent a new user to a page where nothing can be created — a dead end
  dressed as a setup step, and the exact bug class the conventions call *never
  point at a remedy that isn't rendered*. The field stays for tokens that
  already exist, now labelled as such; and when a deployment has no OAuth
  configured the card says plainly that there is no way in rather than leaving
  the token box looking like one. `oura-connect-honest.test.ts` guards it.
- **A night that has not happened is not a night with no data.** Asked at 03:00,
  the weekly sleep answer counted tonight among the gaps, because a night is
  filed under the day you wake and today's row does not exist yet. A false gap
  is worse than no gap: it trains the reader to ignore the real ones.

- **The questions that were lookups, not judgements.** Of 59 questions ever
  asked in chat, about a third have one true answer the app already computes,
  and "How was my sleep this week?" was asked seven times word for word.
  `src/lib/quick-answer.ts` recognises eleven shapes — today's log, one
  drink's total, today's doses, what is still circulating, sleep for a night or
  a week, the morning briefing the chat screen's button sends, the habits still
  due, today's calendar, steps for a day or a week, caffeine in milligrams, and
  the scale — and `quick-answer-run.ts` answers them from the same helpers every
  other reader uses, so a scripted answer and Emergy's can never disagree about
  a number. Two questions that share a word are still two questions:
  **caffeine is milligrams and coffee is millilitres**, so "how much caffeine
  today" reads `CaffeineLog` while "how much coffee today" reads `IntakeLog`,
  and "how much caffeine is still in me" is the body-load answer that already
  existed. **A partial day is reported, never averaged**: today's step count is
  a running total, so it is kept out of the week's mean and out of "fewest day"
  and given its own sentence, on the same principle as the night that has not
  happened above. **The refusals carry the design**: one word — why, compare, affect,
  should, think — hands the message straight back to him, as does a second
  question word, an unstated window, or anything over 120 characters. These
  answers report and never conclude; a test greps for verdict language and
  fails if a script starts editorialising.
- **Charts in chat, without the model drawing them.** A reply carries
  `[chart:sleep-week]`, about ten tokens, and `/api/chat/chart` resolves that
  name against the database. Whoever wrote the reply cannot get a bar wrong
  because they never typed one, which is the source-chip rule applied to
  pictures: a spec not on the whitelist 404s and `ChatChart` renders nothing.
  A stored reply also redraws itself from the data as it is now instead of
  freezing a week that has since been corrected. One series, so one hue — the
  app's own `--primary`, no status colour, because a red bar under a sentence
  that is only reporting a number would be the chart concluding what the words
  did not.
- **The prompt may say why; it may not re-list what.** Every turn pays for the
  whole prefix before Emergy says a word — 41 tool schemas (~8,100 tokens),
  then the system prompt (~2,900). One sentence of the prompt used to write the
  schemas out again in prose ("You have tools to CREATE habits…, LOG
  water/coffee/mood…"), 1,574 tokens of it, 42% of the whole prompt, bought
  twice on every turn. The schemas are the inventory; the prompt is for the
  policy no single schema can hold — which tool when two apply, what to do with
  a photo, how sure to sound on four nights of data. `prompt-budget.test.ts`
  keeps the paragraph from growing back by name rather than by length: a tool
  named in the prompt has to be one of six with genuinely cross-tool policy,
  and a rule that belongs to one tool goes in that tool's description, where it
  is read at the moment it matters.
- **The Console gives one total; the rows say which feature spent it.** Seven
  places call the API — chat, the briefing, the habit garden, the health
  report, the weekly review, a meal photo, a lab document — and for a day only
  chat recorded anything, so a 1.4M-token week had no explanation in it. The
  guard finds those callers by walking `src/` for `messages.create` and
  `messages.stream`, not from a list: the first version of it carried six
  hand-written paths and passed while the garden spent money unrecorded, and
  the second missed chat itself, whose call streams rather than creates. Every call now
  writes a `ModelTurn` row carrying the feature, the model and the effort, and
  "what have you cost me" reports the split, dearest feature first, with chat's
  effort arms underneath. `model-spend.test.ts` fails if a seventh caller
  appears without an entry, or an entry without a caller. Two of the six had
  no user to bill — `analyzeMealPhoto` and `analyzeLabDocument` took only a
  data URL — so the routes thread one in. The Prisma model is `ModelTurn` and
  `@@map`s to the table it was born as, `ChatTurn`: renaming a table under
  `prisma db push` is a drop and a create, and the build runs that command
  without `--accept-data-loss`, so the rename would have failed the deploy.
- **Read the bill before optimising it.** Measured on the real account: 85%
  prompt-cache hit rate, so the prefix is mostly billed at a tenth and prefix
  trimming is worth about a quarter of its face value. That is why the tool
  search idea was dropped rather than built — it would have traded ~6,000
  already-cheap prefix tokens for a discovery round trip billing full output
  tokens. Output is where the money is, which makes effort the lever.
- **The per-turn log line ends in dollars.** `EMERGY_CHAT_EFFORT` is wired,
  validated and deliberately unset — chat is the workload that most often holds
  quality a step below the default, and stepping it down is an experiment
  waiting on production. The `[emergy] turn` line prints in/out/cacheRead/
  cacheWrite and now `usd`, because four token counts that all moved are not an
  answer: Opus input and output are priced five times apart, a cache write
  costs a quarter more and a hit costs a tenth. Prices live plainly in
  `src/lib/model-cost.ts` — the one thing in it that can go stale without
  anything failing. An unpriced model returns null, never zero.
- **A fifth of the chat never needed the model.** Reading the whole
  transcript, 33 of 155 messages ever sent to Emergy were log lines — "log me
  300ml water", "add 1L water", "at kaviaren vtak log cold brew 250ml and
  watter 200ml" — and each one spent an Opus turn and a tool call to write one
  row. `src/lib/quick-log.ts` recognises those by shape and returns the rows;
  `quick-log-run.ts` writes them and says them back; `/api/chat` runs it before
  `streamChatEvents` and streams the same events, so the client refreshes as it
  always did. **The rule is that the whole message parses or none of it does**,
  and every doubt returns null and goes to Emergy: an unknown drink, a
  medication this user has never logged, a number in words, a trailing clause,
  a question mark. **A clock time spreads across the message** — "log batch
  brew 300ml and water 250ml at 15:00" is one visit to the café, and reading
  each clause alone stamped the coffee with the hour it was typed; a caffeine
  row five hours out of place is read against bedtime, so getting that wrong
  quietly is worse than not parsing at all. A relative time ("15min before")
  does not spread: it corrects the one item it follows. The grammar was written
  from the real messages and the
  transcript is the test file — the ones it must catch, and beside them the
  ones it must *not*, each with the reason. A wrong row written silently costs
  far more than the tokens it saves. Drinks and doses now have one writer each
  (`intake-write.ts`, `dose-write.ts`), which is what keeps a caffeine row at
  the same instant as its drink for the fast path and Emergy's own tools alike.
- **The full backup was failing, quietly, for eleven days — and the first
  fix failed too.** Prisma 7's driver adapter refuses Postgres' `name` type,
  which is what `information_schema` returns for identifiers; the backup's
  table-discovery query selected `table_name` bare, so every export — the
  download and the monthly email — died on its first query with nothing on
  screen. `::text` fixed that and broke `SELECT DISTINCT`'s ORDER BY rule;
  `ORDER BY 1` fixed that. The lesson is in `export-sql.test.ts`: the query
  is a constant (`TABLE_DISCOVERY_SQL`) and the test runs it on PGlite, an
  in-process Postgres, because nothing short of Postgres can judge SQL.
  `catalog-identifiers-cast.test.ts` still guards the next catalog query.
  Also: on the APK the download link can never work — the WebView has no
  DownloadListener — which is what "Email me the backup" is for.
- **The evening closes the morning's intention.** `MorningCheckIn` gained
  `intentionOutcome` (done | partly | no) and `intentionNote`;
  `closeIntention` in `src/lib/intention.ts` is the one writer, used by
  `PATCH /api/morning-checkin`, the evening check-in's new first step
  (shown only while an intention is open) and Emergy's `close_intention`
  tool. The 21:00 web push asks the question instead of the journal nudge
  while an intention is open, and lands in chat so a reply closes it; the
  phone lays down a one-shot at 20:00 (id 910004) for the same, rebuilt on
  every foreground so an answered one drops out. Phrasing lives once in
  `intentionQuestion` (`checkin-mode.ts`).
- **Before-and-after for any date, and a live thinking line.**
  `compare_periods` (chat tool) runs the drift comparison on "since
  <date>" against a matched-length window before it — matched on purpose,
  as in the onset family, so "since she left" is 24 days against 24 days
  rather than against 34 weeks of another season. Ten days a side minimum.
  Chat now asks the model for `display: "summarized"` thinking and streams
  the summary as `thinking` events; the chat page shows the latest sentence
  of it in place of the stock "having a think" phrases (`latestThought` in
  `chat-sources.ts`), and after a tool returns, under the aside. Billed the
  same; thinking was already on.
- **Month against month, the weight trend in the prompt, anchor dates, and
  an effort knob.** `src/lib/drift.ts` compares the last 30 days (or last
  calendar month) with the one before: each everyday metric's gap must
  clear a relevance floor AND the engine's block permutation, then the
  report says what the user logged differently alongside (tags, habits,
  workouts, drinks, water) and asks the open question when nothing logged
  moved. Surfaced as `get_analysis kind: "drift"` in chat and as
  `/api/cron/monthly-drift` on the 1st (daytime, once, silent when nothing
  moved). The system prompt now carries the weight *trend* verdict from
  `weight-trend.ts` instead of only the last reading — the "never one
  weigh-in" rule was being handed one weigh-in. `remember` is told to file
  any life-event date the user gives, so "since she left" works next month.
  `EMERGY_CHAT_EFFORT` (low, medium, high or max; unset = model default) sets chat thinking
  depth, and every model turn logs `[emergy] turn {in, out, cacheRead…}` so a
  week at medium can be compared with a week at the default before either
  is made permanent.
- **The night question, and the token cap that silenced chat.** Every Opus
  call ran with a small `max_tokens` (chat 2048, weekly review 700, report
  summary 600) from before thinking was on by default; thinking counts
  against the cap, so "give me a detailed analysis" thought its way to the
  limit after the tool results and returned nothing but the source chips.
  Caps are safety nets now (16k streaming, 8k otherwise) and the chat loop
  says out loud when a turn ends on `max_tokens` or `refusal`. The anomaly
  watch asks instead of stating when one night is unusual in either
  direction on a night metric (`nightQuestion` in `src/lib/anomalies.ts`):
  the push names the night, opens the chat, and the system prompt tells
  Emergy to file the answer against that night, never today.
- **Working for a stranger, part one.** The APK's `versionCode` is stamped
  into the WebView user agent at `cap sync` (`EmergenthealthBuild/1062`,
  from `ANDROID_VERSION_CODE`, which `customize-android.py` exports so the
  offset formula lives once); `src/lib/native/build.ts` reads it back,
  `/api/version` reads the newest build out of the public `latest-android`
  release notes, and a Settings card plus a dismiss-per-build banner say
  when a phone is behind. A phone whose UA carries no number is older than
  every build that does, and is told so. `/api/cron/quiet-source` pushes
  once per quiet spell when an Oura ring has produced no night for two days
  (or its sync is failing — that outranks "charge your ring"); the judge is
  pure in `src/lib/quiet-source.ts`, and it is Oura-only on purpose, since a
  Health Connect gap means the app wasn't opened, not that anything broke.
  The desktop Emergy panel reads `/api/briefing` like everything else;
  `/api/emergy/brief` is gone. Health Connect's service refuses to touch the
  plugin outside the shell, so the smoke suite no longer has to ignore its
  web error. Uncaught page errors and error-boundary catches post to
  `/api/client-error`, which files them as `UserFeedback` rows of type
  `error` (one per distinct message per user per day, no email) so they
  show in the owner's inbox beside the bug reports. The feedback composer
  is one component, rendered by the desktop button and by Settings → Help &
  Support, which is the phone's only path to it.
- **Habits, reminders and the calendar as the only app.** Habits carry a
  schedule (`scheduleDays` weekday list or `timesPerWeek`; empty = daily);
  off-days neither ring nor break a streak, a weekly-target habit counts
  weeks. `HabitSkip` is its own table ("not today, because…") so nothing that
  counts completions can mistake a skip for one; skips and off-days feed
  `makeOffDay` in `src/lib/habit-schedule.ts`, which every streak reader
  (page, dashboard, garden, streaks, widget, cron) now goes through. Habits
  can be edited, archived (history kept) and fixed on past days from the
  heatmap; routines can be edited. Reminders repeat (`repeat` +
  `repeatUntil`, rules in `src/lib/recurrence.ts`); completing one files a
  done copy (`seriesId`) and rolls the row to the next occurrence after
  today — `src/lib/reminders.ts` is the one path, used by the page, the
  widget, Emergy and the notification button. Snooze (`/snooze`), edit, a
  "No date" group. The calendar owns events now (`AppEvent`: repeat,
  per-occurrence delete via `exceptions`, `alertMinutes`), expanded per
  window by `src/lib/app-events.ts`; the composer writes them on web and
  phone alike, with the phone's calendar as an option inside the app.
  The phone scheduler lays down recurring-reminder occurrences, honours
  habit off-days and skips, and rings event alerts.
- **Training sessions and load.** Sessions logged by hand live in
  `StravaActivity` with `source = "manual"`, a synthetic `stravaId`, an
  `rpe` and a `note` — one table, so the engine, brief, chat and Training
  page pick them up with no second code path. `src/lib/workouts.ts` is the
  one writer (API `/api/workouts` and Emergy's `log_workout` both call it);
  `src/lib/training-load.ts` does session-RPE load (minutes × effort, 5 when
  unscored), the 7-day vs 28-day ratio (easing / steady / building /
  spiking) and a readiness-guided suggestion judged against the user's *own*
  30-day median. `/api/strava/activities` now lists rows with or without a
  Strava token. The nav says Training; Strava is the optional feed.
- **Weight goal.** `UserGoals` carries mode (lose / gain / maintain), target,
  pace and a pinned starting line (`pinWeightGoalStart` in `src/lib/goals.ts`
  captures weight and date when the goal appears or changes direction/target,
  and clears them when it goes). `computeTargets` moves calories by
  pace × 7700 ÷ 7 — never under the BMR or 1200 kcal, never more than
  1000 kcal below maintenance — and lifts protein to 1.6 g/kg while losing or
  gaining. `src/lib/weight-trend.ts` merges both weight tables
  (`weight-series.ts`), smooths a 7-day trend, fits a 14-day slope and judges
  the goal on that: on pace / ahead / behind / stalled / reversing, with an
  ETA. Every reader — the Body-page card, the brief, Emergy — is told to
  judge on the trend, never a single weigh-in.
- Body measurements in the correlation engine, and everyday numbers as
  context on lab draws
- Two-way interactions given a real permutation p-value
- Correlation families: consistency, streaks, absence, onset, two-way
  interactions
- Settings regrouped by purpose ("Emergy on this phone" / "Data connections" /
  "Location & weather"); stale sources now say "went quiet"
- Wake word end to end: sherpa-onnx model, mic handoff, error reporting
- The 15-minute watchdog
- Native background location that survives the app closing
- Evening check-in; Emergy setting real alarms; dictation auto-send after 6s

- **A column that recorded the days you looked at your phone.** `WeatherLog`
  had one writer — `WeatherWidget.tsx`, in the browser, when the dashboard is
  on screen — and the engine and the chat prompt both read it as though it
  recorded the weather. That is not a gap like a missing ring night: a ring
  night is missing at random with respect to how the day went, this one is
  missing on exactly the days the app was not opened. `/api/cron/weather` fills
  it nightly from the phone's last fix, and a `source` column keeps the two
  apart — the widget stands where the user stands with the browser's own fix,
  so a `device` row is never overwritten, while the cron corrects its own
  provisional days once the day's maximum temperature and UV have settled. The
  window is sized per user from the oldest hole, floored at their oldest row:
  Open-Meteo's forecast endpoint hands back about 72 days, not the 92 the
  parameter allows, and without that floor the job asks for three months every
  night forever, chasing days that do not exist.
- **Two silent failures in one query, found by running it.** The gap search
  returned 0 on error, which reads as "no gaps" and shrank the backfill to two
  days; underneath it, `generate_series` with an interval step yields
  timestamps so `g.d` needs a date cast, and a bound integer in
  `CURRENT_DATE - $1` makes the whole expression an integer so the series
  signature stops existing. Neither is visible from reading the code, and both
  passed typecheck and lint. The fix names a distinct number for "the query
  could not run" so the two facts can never wear the same answer again.
- **What Emergy says when the model call fails.** The chat route was
  `} catch {` — the thrown value discarded unread, one sentence for every
  cause, which is precisely the pattern `fetch-error.ts` exists to correct on
  the client. `chat-error.ts` names them: a spent balance (the failure this app
  will actually meet), a rotated key, a rate limit, an outage, and the app's
  own malformed request — which deliberately does not say "try again", because
  that sends the user round a loop with no exit. What is not recognised says
  so, and the real error goes to the log either way: the sentence a user reads
  is not a substitute for the line an owner needs.

## Open threads

- **Health Connect only syncs while the app is on screen.** It is
  `driver: "device"` for an honest reason: `HealthConnectAutoSync` fires on
  `visibilitychange`, once an hour, and re-reads 30 days each time. A week
  without opening the app is a week with no steps, no phone-side sleep and no
  weight — missing on exactly the days the app was not opened, which is the
  hole the weather cron was built to close. Android has since grown the two
  pieces that fix it: `READ_HEALTH_DATA_IN_BACKGROUND`, and change tokens for
  incremental reads (they expire after 30 days, so the existing full read
  stays as the cold path). Neither is exposed by
  `@kiwi-health/capacitor-health-connect` or by the maintained alternatives,
  so this is native: a worker under `android-widget/` reading with the
  androidx client and posting with the widget key, exactly as
  `EmergyLocationService` does — no WebView, no session, and the 15-minute
  watchdog already there to keep it alive. Costs an APK.

  **It was to be batched with the 920007 collision and the location queue
  timer; those two went out in 3.2.1 without it, deliberately.** Background
  reads need `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND`, which
  is a health permission, which means the Play health-apps declaration — the
  one being filled in from COMPLIANCE.md §1 right now — would have to be
  answered for a permission the app did not yet have a worked-out story for.
  `health-permissions-declared.test.ts` says the same thing in code: it fails
  on any `android.permission.health.*` line that no entry in `READ_TYPES`
  accounts for, and a background-read permission is not a record type. Doing
  this after the submission costs one more APK; doing it before costs a
  redone declaration. Note also that a failing
  phone sync still reads as a quiet one away from the Settings card:
  `permissionsByType` names the refused types there now, but `safeRead` still
  swallows a per-type read error, the auto-sync swallows the POST failure
  entirely, and the status screen infers health from a timestamp written only
  on success.
- **Two chat-cost levers that need a hand outside this repo.** Both are
  measured and ready; neither can be finished from a session.
  1. **`EMERGY_CHAT_EFFORT=medium` in production.** Opus 5 defaults to `high`
     effort, and effort is spent on output tokens, which cost five times what
     input does — so for a chat turn it is the biggest single lever there is,
     bigger than the whole 11,000-token prefix. Chat is also the workload most
     likely to hold quality a step down. One environment variable on Vercel,
     then read a week of `[emergy] turn` lines: they now carry `usd`, so the
     before-and-after is a subtraction rather than a study. Step back up if the
     answers get thinner.
  2. ~~**The 41 tool schemas behind the API's tool-search tool.**~~ Closed
     without building it. The account's cache hit rate is 85%, so those ~8,100
     prefix tokens are mostly already billed at a tenth; the discovery round
     trip would cost full output tokens to save input tokens that are cheap.
     Reconsider only if the hit rate collapses.

- **The dashboard's React key warning, now reproducible.** `npm run smoke` is
  clean on all 39 screens but `/dashboard` logs `Each child in a list should
  have a unique "key" prop. Check the render method of \`DashboardGrid\`. It was
  passed a child from \`DashboardPage\`.` Dev-only — React strips it from a
  production build — and it predates the current work.

  What is now pinned down, by intercepting `console.error` in the page and
  keeping the call stack:

  * It fires on the **second** visit to `/dashboard` in one browser context,
    never the first. Fresh context, first load: 0. Same context, load it
    again: 1. That is the whole of the intermittency.
  * It is **not** the redirecting routes. `/dashboard/home` and
    `/dashboard/subscriptions` looked guilty because they follow `/dashboard`
    in the smoke sweep; a cold context going straight to `/dashboard/home`
    warns zero times.
  * So it is the `ready === true` path — first render uses the `!ready`
    fallback, and only a warm `localStorage` layout puts the real grid up
    immediately.
  * `warnOnInvalidKey` recurses three deep in the stack, so the offender is a
    **nested** array, not a flat one.
  * Ruled out: neither `header` nor any value in `blocks` is an array at
    render time (logged from the server component), and every `.map` in
    `DashboardGrid` and in the page carries a key.

  Reproduce with a Playwright context that loads `/dashboard` twice and counts
  `console.error` calls matching `unique`/`key`.

- **Health Connect permissions are settled, and how.** *(was an open thread;
  kept because the method is the reusable part.)* The eight record types in
  `READ_TYPES` now pair one-to-one with the
  `android.permission.health.READ_*` lines in `customize-android.py`, and
  `health-permissions-declared.test.ts` fails if they ever stop doing so — in
  either direction, because a declared-but-unread type is a question on the
  Play health-apps form with no honest answer.

  Two were wrong. `RestingHeartRate` had no declaration at all, so Health
  Connect would have refused it on every phone; `READ_HEART_RATE` was declared
  and grants `HeartRateRecord`, which nothing here reads. They are different
  permissions — the first does **not** imply the second.

  The previous note said AndroidX's record→permission table was not verifiable
  from the repo, so the fix waited on a phone. It is verifiable. The table is a
  static map in the library the build already links, and reading it beats
  guessing or waiting:

  ```
  curl -sO https://dl.google.com/dl/android/maven2/androidx/health/connect/\
  connect-client/1.1.0/connect-client-1.1.0.aar
  unzip -p connect-client-1.1.0.aar classes.jar > classes.jar && unzip -q classes.jar -d c
  javap -p -c c/androidx/health/connect/client/permission/HealthPermission.class
  ```

  Each `ldc class …Record` is followed by the permission string it maps to.
  Three of the eight are not what the type name suggests: `SleepSession` →
  `READ_SLEEP`, `HeartRateVariabilityRmssd` → `READ_HEART_RATE_VARIABILITY`,
  `RestingHeartRate` → `READ_RESTING_HEART_RATE`. Pin the version from
  `node_modules/@kiwi-health/capacitor-health-connect/android/build.gradle` —
  a different version could map differently.

  `permissionsByType()` stays. It asks the plugin per type and the Settings
  card names anything not granted, which is still the only way a user learns a
  type was refused: `safeRead` catches everything and returns `[]`, so a
  refused type reads exactly like a type with no records, forever. The
  difference is that it should now have nothing to report.

  Still invisible on an Oura account — resting HR arrives from the ring
  whether or not Health Connect hands it over, which is why this survived.

- **The Oura transcript idea.** An advisor that states one quantified change
  and ends by asking what shifted. The nearest thing in the app is the drift
  card (`DriftCard.tsx`, `drift.ts`): rolling 30 days against the 30 before,
  every shift block-permutation tested, "changed alongside" drawn only from
  what the user logged, and it ends on `driftQuestion` — one copy, shared by
  the push, the chat tool and the card, and the answer can be written back as
  a tag (`log_tag`) so the onset family picks it up. That loop is already the
  intended one. What the card is *not*: one change (it lists every shift,
  worse first), one voice (the question is generic — "did something change
  that isn't in the app?" — rather than aimed at the shift), or a cadence
  (the card is on demand; the push is the 1st of the month). The anomaly
  watch's `nightQuestion` in `anomalies.ts` is the single-night version of
  the same move. The pieces exist; what is missing is the editorial choice of
  *one* thing to say and when to say it.
- **Usage access on the phone — closed, by telling the truth instead.** Android
  lists an app under Settings → Usage access only if its manifest declares
  `PACKAGE_USAGE_STATS`; `customize-android.py` does not, no commit ever has,
  and `play-store/COMPLIANCE.md` says not to. Screen time launched anyway, so
  the dashboard card and the Settings card both told people to grant something
  no screen on their phone offers, behind a Recheck that could never turn
  green — the "remedy that isn't rendered" class exactly. Both now say the
  build cannot read screen time and why. `SCREEN_TIME_READABLE` in
  `lib/native/screen-time.ts` is the single switch; `screen-time-declared.test.ts`
  fails if it and the manifest ever disagree **in either direction**, because a
  declared-but-unread permission is the version that Play asks awkward
  questions about. The `EhUsage` bridge is left intact and correct: the day the
  permission is declared, flipping the constant is the whole change.
- **Onset/withdrawal** in the correlation engine is half-done — onset ships,
  withdrawal needs pre-window history the engine doesn't load.
- **Waist and body-fat correlations.** The body family runs on weight and
  waist; body fat is deliberately excluded (impedance scales track hydration
  more than fat). Waist rarely cleared the gate for a reason fixed in 3.3.1:
  the engine only read `BodyMeasurement`, and the measurement form writes
  `BodyMeasurementLog`, so form entries never counted (audit A2). Both count
  now — whether waist produces cards is finally a question about the data.
- **Toggl** stores a token but no daily log table, so nothing correlates.
- **The upload queue only retries on a new fix.** `flush()` is scheduled from
  `onFix` and nowhere else, so points queued while stationary sit until the
  next one arrives. Needs a timer, and an APK.
- `EMAIL_FROM` is unset — the sender is Resend's sandbox, which only reaches
  the account owner. Needs a domain, and it is the single thing standing
  between every other user and any email at all. Until it is set, the app at
  least says so: `describeMailFailure` checks `EMAIL_SENDER_CONFIGURED`
  **before** reading the provider's wording, because an unset sender is the
  failure this deployment actually meets and a 403's text is the provider's to
  change. The three crons log the rejection through `logMailFailure` rather
  than catching it into nothing — a missed digest really is non-fatal, but
  silence made a deployment whose email has never reached anyone look exactly
  like one that works.
- **`sleep_time` (Oura's Body Clock) is still unsynced.** Its response nests an
  optimal-bedtime object whose exact shape could not be verified from outside
  the API, and the awake-time bug is what guessing a shape looks like. Worth
  adding once a real payload is in hand — `warnIfEmpty` will say immediately
  whether the keys are right.
- **Verify the three new Oura mappers against a real sync.** Vascular age and
  resilience field names came from the API documentation and are believed
  correct; VO2 max's is the least certain. The first sync after deploy will log
  `[oura] <endpoint> mapped no values` with the real keys if any of them is
  wrong. Check the Vercel logs once, then this can be struck off.
- **Typical Sleep Score, Daily Sleep Need and Symptom Radar** appear in the
  Oura app but not in the API docs. Sleep debt and regularity were on this list
  too and are now built from the durations and bedtimes already stored — see
  `sleep-rhythm.ts` — which beats copying a number we cannot explain.
- **The rest of the chat bill.** The parser takes the log lines; three levers
  are left, in order of payoff. (1) `EMERGY_CHAT_EFFORT` is wired
  (`chatEffort()` in `claude.ts`) but unset in production, so every turn runs
  at the default — setting it to `medium` and reading the per-turn
  `[emergy] turn` usage lines for a week is a one-line experiment. (2) Model
  tiering: a cheap per-turn decision sending logging and simple lookups to a
  smaller model and keeping Opus for analysis. (3) Scripted first lines for the
  recurring questions — "how was my sleep this week?" was asked seven times
  and is answerable from the same numbers the model would fetch. A local LLM
  is not on this list: on-device it cannot do the analysis, and server-side it
  is just tiering with a GPU bill attached.
