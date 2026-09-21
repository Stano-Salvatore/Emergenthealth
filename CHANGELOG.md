# Changelog

## 3.3.0 — The phone had four instruments nobody was reading

Your phone has been taking these readings all along. Nothing was looking at
them, and **none of them costs a permission the app did not already have** —
which is the only reason this could be added while a Play health declaration
was being filled in.

- **Light.** How bright it is around you, in lux. The reason to want it is
  sleep: evening light against how long it takes you to fall asleep is the
  best-established relationship in this app's data, and sleep latency is
  already recorded on most nights. Honest limit, and the card says it: the
  sensor is on the front of the phone, so a pocket reads as darkness. It is
  "light around the phone when it could see", not exposure.
- **Air pressure.** The weather cron already fetches pressure for your rough
  location from an API. This is the same quantity, measured where you actually
  are. Pressure drops are a documented migraine and joint-pain trigger, and
  that is not testable on your own data without the number. Not every phone
  has a barometer; the card says so when yours does not.
- **Screen and charging moments.** When the phone went dark for the night, when
  you first unlocked it, how often you picked it up, when it went on charge.
  This is the honest half of what screen time was wanted for — without
  `PACKAGE_USAGE_STATS`, which the compliance notes say not to declare and
  which this does not reopen. It only records while location or the wake word
  is switched on, because its broadcasts cannot come from a manifest, and the
  card says that rather than implying otherwise.
- **Sleep, when the ring is off.** Android's Sleep API, running on the motion
  permission you already granted for travel modes. It is worse than the ring in
  every respect and **never overwrites it** — it is for the nights the ring was
  on the charger, which until now read as though you had not slept at all.

Everything is stored on the phone and sent when the app next opens, the same
store-and-forward the chat head and the location queue use. Nothing here is
shared, sold or used for tracking.

**Not yet:** correlations over any of it. Insight families over an empty table
find nothing, and the cut points cannot be chosen without seeing real
distributions. Those come once there is a few weeks of data.

## 3.2.1 — Four ways the background services could stop without saying so

All native, so this one needs the new APK to reach you.

- **Two alarms shared one identity.** The wake-word restart and the
  fifteen-minute watchdog were both request code 920007 against the same
  receiver, which makes them one alarm as far as Android is concerned. They
  behaved only because their actions differed; cancelling the watchdog would
  have cancelled the wake restart. The watchdog now has its own code, and
  `android-request-codes.test.ts` fails if two components ever share one again.
- **The watchdog did not watch the chat head.** It restarted location and the
  wake word, never Emergy himself — even though the head sits on exactly the
  sticky-restart path the watchdog exists to compensate for. It does now.
- **Nothing armed the watchdog for the head.** So a phone with only the head
  switched on had no heartbeat running at all: guarded in name, not in fact.
  The head service now arms it on start, the way the other two always did.
- **Points queued while the phone sat still waited for it to move.** Every
  path to the upload ran off a new location fix, including the retry after a
  failed one — so an upload that failed while the phone was then put down
  waited for movement, and the queue drops its oldest points when full. The
  watchdog tick now retries it, which works because it is an alarm that
  survives Doze rather than a timer that does not.

## 3.2.0 — Finance comes out

Money tracking is gone: the three screens, the YNAB and TrueLayer
integrations, the bank-statement imports, the recurring-charge detection and
both spending insight families. It had been flag-gated since 3.0.0, which
meant nobody could open it and it still cost something — two bank APIs polled
every thirty minutes, two rows on the sync status screen, two entries on the
Vercel cron schedule, a hundred `Transaction` rows read into the chat prompt
on every cache write, and a data-safety answer that rested on a feature flag
rather than on the code.

### What went
- `/dashboard/finances`, `/dashboard/bills`, `/dashboard/subscriptions`
- The YNAB and TrueLayer connections, their OAuth routes, syncs and crons —
  and their two entries in the 30-minute sync workflow and in `vercel.json`
- Revolut CSV import, by upload and from Google Drive
- Recurring-charge detection
- The `## Finances` section of Emergy's prompt, and the `get_transactions` /
  `get_spending_by_category` MCP tools
- **Spending & Mood** and **Spending & Next-Day Mood** in the correlation
  engine. These were the one part that earned its keep — card spend is a
  behavioural signal, not just a financial one — and they go with the sync
  that fed them. `ENGINE_VERSION` → 18, so every cached result is recomputed.

### What stayed
- The `Transaction` table and its rows. Nothing writes to it any more and
  nothing reads it except **data export**, which is the point: anyone who had
  transactions can still take them out. No migration, no data loss.
- `Subscription` — that is the Stripe plan, not recurring bills, and is
  untouched. So is everything else about Pro.

### Also
- Data safety can now answer "financial info: no" about the code instead of
  about a flag.

## 3.1.0 — Honest empty states, and a phone that asks for the right things

Everything in 3.0.0 plus the work below. Nothing was removed from the feature
set; `HELD_BACK` in `src/lib/features.ts` is unchanged, and remains the truth
about what ships.

### Sleep
- **Sleep regularity.** The Sleep Regularity Index — how much of one day's
  sleep/wake pattern repeats the next — on the health page, over 60 nights.
- **One definition of sleep debt.** The health page, the week view and Emergy's
  quick answers each had their own; they now share `lib/sleep-rhythm.ts`, so
  the same night cannot be a shortfall on one screen and not on another.
- **Bedtime is its own question.** The sleep panel asks about lights-out
  directly instead of carrying it as a caveat on another card, and its
  experiments got their "Test this" button.

### What the app says when it has nothing to say
- **Weather.** A user who has never set a location saw a confident hourly
  forecast for Bratislava with an outfit suggestion under it. No location now
  means no weather card, and the brief says how to fix it.
- **Screen time.** The build cannot read screen time — the permission Android
  needs for it is deliberately not declared — so the card says that, instead of
  offering a button to a settings list the app does not appear in.
- **Email.** A failed send used to say "the mail service rejected the message",
  which is true of every cause and useful for none. It now names the cause, and
  the three crons that silently discarded the rejection log it.
- **Health Connect.** A refused record type read exactly like a type with no
  records, forever. The settings card names anything not being handed over.

### Correlations
- **A source only speaks for the days it existed.** Connecting Strava mid-way
  through your history used to turn every earlier day into a "rest day" —
  nine real ones became fifty-one, and the card still called them rest days.
  Same for calendar, workouts and screen time.
- Combination cards get their "Test this" button back.

### Appearance
- A full appearance system, and **Sunny**: a new base theme with a coral accent.

### Emergy
- Several questions that were buying a model turn to read a single row now
  answer from the data directly — faster, and a good deal cheaper.
- A turn's cost is recorded rather than logged and lost.

### Fixed on the phone
- **Background location tracking never started.** `EmergyLocationService` was
  compiled into the APK and declared nowhere in the manifest, because the
  build script's "is it already there?" check searched for the class *name*
  and matched a comment the same script writes into the manifest, which
  mentions that class in prose. Android refuses to start an undeclared
  service, so switching on automatic place check-ins failed — and the app
  blamed the location permission, or Samsung's battery settings. Since
  2026-09-02. The build now verifies every component class it compiles in is
  declared, and stops rather than shipping one that isn't.
- **Health Connect had no privacy-policy screen.** Health Connect requires an
  activity that answers `ACTION_SHOW_PERMISSIONS_RATIONALE` (and, on Android
  14+, `VIEW_PERMISSION_USAGE`); the manifest carried that action only under
  `<queries>`, which points the other way. `PermissionsRationaleActivity`
  now opens the policy, which is also a publishing requirement.

### The first screen
- **The dashboard no longer asks for your location on sight.** Two components
  requested a position in a mount effect, so opening the app — on a first
  launch, before anything had explained why — raised a permission dialog, and
  the weather widget then pulsed a grey skeleton in the greeting card for up
  to fifteen seconds while you decided. Both now check whether location has
  already been granted, which can be asked without prompting, and stay quiet
  otherwise. Settings is where location is turned on, with the disclosure.
- **Weather uses the location you set.** The widget asked the browser and
  ignored Settings → Weather location entirely, so the one place to set it
  changed nothing on the dashboard. It reads the saved position first now, and
  needs no permission at all to do it.
- **A brief that cannot be written says so.** The model call was unwrapped, so
  an expired API credit threw a 500; the client turned every failure into
  "nothing to say" and rendered nothing, leaving a hole where the first thing
  on the dashboard had been. The server now prefers a stale brief over an
  error and an error over a blank, and the card says one quiet line with a
  Try again.

### Small things on a phone
- Garden habit chips truncated into their own streak badge — "No coffee..2".
  The name now stops before the number.
- The streaks toast's dismiss ✕ was a 15×18 target; it is 40×40 now, without
  the toast changing height.

### Play Store readiness
- **Health Connect asks for the permission it actually needs.**
  `RestingHeartRate` was never declared, so no phone could have granted it;
  `READ_HEART_RATE` was declared and grants a record type nothing reads. Both
  are fixed, and a test now holds the manifest, the code and the compliance
  notes together.
- **The privacy policy says what the app does.** It claimed no background
  collection while the build shipped background location, and never mentioned
  Health Connect — the policy its own permission-rationale screen links to.
- **Every declared permission is documented**, including the ones Capacitor's
  plugins add to the merged manifest, and a test fails if one is not.
- The build now checks its `targetSdkVersion` against Play's floor rather than
  finding out at upload.
- `/api/newsletter` removed: a public endpoint collecting email addresses
  through a door no user could reach.

## 3.0.0 — Google Play launch

The first Play Store release. V3 ships a focused health core; several finished
features are held back behind flags (`src/lib/features.ts`) and will be enabled
one per update — see the roadmap below.

### In this release
- Emergy AI companion: chat, daily brief, and insights grounded in your own data
- Correlations engine — cross-domain "what actually affects your energy" analysis
- Wearable sync: Health Connect (steps, sleep stages, resting HR, HRV, SpO₂,
  weight, calories), Oura, Samsung Health via Health Sync + Google Drive
- Phone calendar sync with Samsung colour-coding, all-day and recurring events
- Habits, routines, streaks, XP levels, garden gamification and daily quests
- Morning check-in, mood, journal, medications, intake, fasting, caffeine,
  weight and body measurements, custom trackers
- Focus timer, reminders, timeline, location insights
- Home-screen widgets (quick log, habits, reminders), push and local notifications
- Passkey sign-in, data export, account deletion

### Release plumbing
- Android `versionCode`/`versionName` now injected at build time (`.ci/customize-android.py`)
- CI builds an `.aab` bundle for Play alongside the sideload APK
- Removed the restricted `PACKAGE_USAGE_STATS` permission (screen time is
  feature-flagged off in V3)
- Stripe pricing/checkout is unreachable from inside the Android app
  (Play billing policy) — the web app is unaffected

### Held back for future updates (already built, flag-gated)

The list below is `HELD_BACK` in `src/lib/features.ts` — that array is the
truth, and this section drifted from it once already.

- Gmail inbox card — a separate OAuth surface of its own
- Smart home (AC control) — depends on a self-hosted UDP bridge, not
  multi-tenant

Enable either early with `NEXT_PUBLIC_ENABLED_FEATURES="gmail"`.

### Launched since V3 shipped, and no longer gated
Lab results, Strava, Screen time, Last.fm, RescueTime, Fasting. Each is
self-contained — it needs nothing but its own connection — and each now feeds
the correlation engine and Emergy's context, so hiding the pages only hid the
data's home.
