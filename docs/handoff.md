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
(screen time, spending, walking, productivity, distance, listening, custom
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
  `src/lib/quick-answer.ts` recognises those five shapes (today's log, one
  drink's total, today's doses, what is still circulating, sleep for a night or
  a week) and `quick-answer-run.ts` answers them from the same helpers every
  other reader uses, so a scripted answer and Emergy's can never disagree about
  a number. **The refusals carry the design**: one word — why, compare, affect,
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

## Open threads

- **Onset/withdrawal** in the correlation engine is half-done — onset ships,
  withdrawal needs pre-window history the engine doesn't load.
- **Waist and body-fat correlations.** The body family runs on weight and
  waist; body fat is deliberately excluded (impedance scales track hydration
  more than fat). Waist rarely has enough weigh-ins to clear the gate, so in
  practice only weight produces cards.
- **Toggl** stores a token but no daily log table, so nothing correlates.
- **The upload queue only retries on a new fix.** `flush()` is scheduled from
  `onFix` and nowhere else, so points queued while stationary sit until the
  next one arrives. Needs a timer, and an APK.
- `EMAIL_FROM` is unset — the sender is Resend's sandbox, which only reaches
  the account owner. Needs a domain.
- **Four Oura endpoints we have never called**, all confirmed to exist in the
  v2 API and all visible in the user's own Oura app: `daily_cardiovascular_age`,
  `vO2_max`, `daily_resilience` and `sleep_time` (the Body Clock card). The
  `daily_stress` response also carries a day summary — the "Balanced day"
  wording — which the sync currently drops, keeping only the high-stress and
  high-recovery minutes. Cardio capacity and resilience are the two worth
  having: VO2 max is the one number on those screens a training plan moves, and
  cumulative stress went Low to High in mid-August and stayed there. Needs new
  columns, a migration and sync work. Typical Sleep Score, Sleep Debt, Sleep
  Regularity, Daily Sleep Need and Symptom Radar did **not** appear in the API
  docs — sleep debt and regularity we could compute from the bedtimes and
  durations already stored, which beats copying a number we cannot explain.
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
