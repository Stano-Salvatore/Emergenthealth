# Changelog

## 3.17.0 — iPhone: connect Apple Health without copying a key

Web-only, no new APK. No schema change. The shared shortcut has to be
rebuilt to the new recipe (below) before `APPLE_SHORTCUT_URL` points at it.

**Changed**
- **Quick setup is three steps: Add the shortcut, Connect, Make it automatic.**
  - **Connect:** makes the key and opens
    `shortcuts://run-shortcut?name=Emergenthealth&input=text&text=<key>`. The
    shared shortcut saves that input to `Emergenthealth/key.txt` in its
    Shortcuts folder, and every later run, automations included, reads it
    from there. Nothing to copy or paste, no Import Question.
  - **Knowing it worked:** Shortcuts can't hand an answer back to a Home
    Screen web app (`x-success` opens Safari), so the card asks the server
    every few seconds, and as soon as the app is back on screen, until the
    first run arrives. A run that saved nothing shows its reason. After 45
    seconds of nothing it says what to check.
  - **Make it automatic:** still by hand, since iOS lets nothing create an
    automation. The card lists the taps and links to Shortcuts.
  - **Hand-built shortcuts:** the key controls move under *Or build it
    yourself*. Connecting again warns that a hand-built shortcut stops until
    the new key is pasted in.
- **Onboarding connects an iPhone in place.** With the shared shortcut set,
  the Apple Health row on the connect step is the quick setup itself, not a
  pointer to Settings.
- **Sharing the shortcut:** the card's recipe now takes the key as Text
  input, keeps it in the file, reads it back, stops with a "not connected
  yet" alert when there's none, and sends `Bearer ` + the key.

## 3.16.0 — iPhone: location from the shortcut, and a one-tap install

Web-only, no new APK. No schema change.

**Added**
- **Where you are, from the iPhone shortcut.**
  - **How:** an optional *Get Current Location* step sends the phone's
    position with each run, stored exactly as the Android app's own tracking
    stores it: same rows, same visit detection.
  - **Why:** an iPhone web app gets no background location, so this is what
    place patterns and check-ins get instead. A run that sends only a
    location is a good run.
  - **Bad positions:** half a position, or one off the globe, is named and
    not stored.
- **"Get the shortcut", a one-tap install.**
  - **Sharing it:** once someone has built the shortcut, they share a copy
    as an iCloud link, with their key replaced by `Bearer PASTE_YOUR_KEY`
    and an Import Question asking for the key. Their own key never travels
    in the link.
  - **The card:** explains how to share safely.
  - **Using it:** set the link as `APPLE_SHORTCUT_URL`. Every card then
    offers a quick setup: make a key, tap *Get the shortcut*, paste the key,
    run once, make it automatic.
  - **Only iCloud links:** only an iCloud shortcut link is ever offered.

## 3.15.0 — Apple Watch through Shortcuts; Strava only where it can connect

Web-only, no new APK. Schema: one new table, `AppleHealthKey` (additive).

**Added**
- **Apple Watch and Apple Health on an iPhone.**
  - **Why a shortcut:** Apple lets only native iPhone apps read Apple Health,
    and this app runs in Safari there. So a shortcut in the iPhone's
    Shortcuts app reads sleep, steps, resting heart rate and HRV, and posts
    them to `/api/sync/apple-health`.
  - **Settings → Data connections → Apple Watch & Apple Health** holds the
    whole setup:
    - It makes the key the shortcut sends. The key is shown once; only its
      hash is kept.
    - It walks through building the shortcut and making it run on its own.
    - It shows what the last run saved, or why the last run saved nothing.
      Shortcuts itself doesn't show a refusal.
  - **Sleep:** the night is the sleep that ends on the day being filed. A
    watch stores a night as many short stage samples, so the shortcut sends
    two days of them and the right night is picked:
    - samples before midnight are kept;
    - overlaps between the watch and the phone count once;
    - gaps awake and naps don't count.
  - **Numbers are read as Shortcuts writes them:**
    - decimal commas, and thousands in counts ("12.345" steps);
    - units, Unicode minus, and lists joined by newlines;
    - a 0 is a missing reading and never stored;
    - start and end times that don't pair up are named rather than guessed.
  - **With an Oura ring:** the ring wins where it has a reading. Apple's HRV
    (SDNN) is not written into the ring's RMSSD series.
  - **Onboarding:** on an iPhone, the connect step lists it, to set up in
    Settings afterwards.

**Changed**
- **"Connect Strava" is offered only where it can work.**
  - **Why:** Strava admits one athlete to a new API app until it approves
    more. Everyone else who connected landed on Strava's "Limit of connected
    athletes exceeded" page.
  - **Who still sees it:** the owner, and accounts connected now or before.
    Disconnecting here doesn't free a place in Strava's limit.
  - **When it's approved:** set `STRAVA_OPEN=1` to offer it to everyone.
  - **A request that still arrives** is sent back with that reason.

## 3.14.0 — A security pass: the habits fix, Claude connector sign-in, limits

Web-only, no new APK. No schema change.

A checklist of what AI-built apps usually get wrong, checked against this app.

**Checked and already fine**
- No route answers without a login. Every API route was called with no
  session: 272 refused it, and the few that answered are public by design
  (health check, OAuth metadata, version).
- No route reads or edits another account's rows. About 60 id-taking queries
  and every raw SQL write are filtered by the signed-in user.
- No keys in the code or in any of its 1,386 commits.

**Fixed**
- **A routine could hold another account's habit.** Routines stored whatever
  habit ids they were sent, and "complete routine" ticked each one. Anyone
  who knew another account's habit id could mark that habit done for its
  owner, and the owner couldn't untick it. A routine now keeps only the
  user's own habits, and completing one only ever ticks those.
- **Connecting Claude no longer puts your permanent key in a URL.**
  - The sign-in code used to be your MCP key itself, carried in the redirect
    URL (browser history, logs) and handed over without a click.
  - It is now a one-time code that expires after ten minutes.
  - Only the app that started the sign-in can exchange it, because the PKCE
    check that used to be skipped is now enforced.
  - A signed-in user clicks **Allow** first.
  - The existing connection keeps working. Only reconnecting looks
    different.
- **Paid model calls have daily limits stored in the database.** These
  routes only had limits kept in one server's memory, which reset on every
  restart:
  - lab report reading: 20 a day
  - the doctor's report, viewed or emailed: 10
  - meal photos: 60
  - week review rewrites: 5
  - forced brief refreshes: 8. Past that, today's saved brief is shown.

  The garden's Emergy had no limit at all. It now spends the same 10
  messages a day as the chat, and its message and history are capped in
  length. The owner is exempt from all of these.
- **The phone's health sync is bounded.**
  - It keeps at most the newest 62 days a request, where before any number
    of days was written at once on the shared database.
  - It writes 10 at a time.
  - A value that isn't a plausible number or date is dropped, not written.
  - A day with nothing valid left in it creates no row.
- **Log Day says why it didn't save.** A refused value (negative steps, a
  date it can't read) closed nothing and said nothing. The route now names
  the field, and the form shows it, along with an offline failure.
- **Weight and OwnTracks points need real values.** Weight must be 20–400 kg
  and coordinates must be on the globe. These used to cause a 500 or plant
  a figure in the trend line.
- **A link Emergy writes as `//site` is no longer drawn as one of the app's
  buttons.** A browser reads it as another site.

## 3.13.2 — Emergy's brief: sleep first, then what's left of the day

Web-only, no new APK. No schema change.

**Changed**
- **The brief has a fixed order.**
  - **First, last night's sleep:** hours, sleep score, deep and REM sleep,
    readiness.
  - **Then what is left of the day:** the next calendar event, and the habits,
    doses and reminders still to do. In the evening this becomes what's left
    of tonight.
  - **Strain and baseline notes** (like a blood-oxygen dip) are folded into the
    sleep part instead of leading the brief.
  - **New data:** the brief is now given the rest of today, where before it
    only knew the habits already done.
  - **Cached briefs:** today's brief is rewritten in the new shape rather than
    served in the old one.
- **The phone home layout is back as it was.** 3.13.1 moved the cards. The
  request was about the brief's order, not the screen's.

**Fixed**
- **A strain note from the night before was called "last night".** Before
  this morning's ring sync, the brief was told both "no sleep data for last
  night yet" and "last night as a whole: strain". Each note is now named by
  the night it is about.

## 3.13.1 — What's left of the day's Emergy messages

Web-only, no new APK. No schema change.

**New**
- **The chat shows what's left today** above the message box: "3 of 10
  Emergy messages left today · quick logs are free". It turns amber at
  none left. It updates with each reply, and quick logs and lookups leave
  it alone. The owner sees nothing, having no limit.

**Fixed**
- **A reply that fails no longer uses up a message.** If the model errors,
  the turn is given back, in the app's chat and on Telegram.

## 3.13.0 — A daily allowance for Emergy

Web-only, no new APK. No schema change.

**Changed**
- **Accounts other than the owner get 10 messages a day with Emergy.** The
  allowance counts only messages Emergy's model answers; it resets at the
  user's own midnight.
  - **Never counted:** quick logs ("log 300ml water") and quick lookups
    ("how was my sleep this week"), which the app answers itself, and the
    messages Emergy sends on its own.
  - **The 11th message** gets a reply in Emergy's voice, saved in the chat,
    saying the limit is reached until tomorrow and that quick things still
    work.
  - **Telegram** draws on the same allowance. Its reply points to the app
    for quick things, because Telegram has no quick path.
  - **The owner** (`FEEDBACK_NOTIFY_EMAIL`, or `OWNER_EMAIL`) is never
    limited.

## 3.12.0 — Onboarding, how patterns work, and no more Google Drive

Web-only, no new APK. No schema change.

**Fixed**
- **New accounts never saw onboarding.** The dashboard's redirect to the
  wizard sat inside a try/catch, and `redirect()` works by throwing, so the
  catch swallowed it and every new account went straight to an empty
  dashboard. The check now lives in `lib/onboarding.ts`, outside any catch.
- **Skip setup didn't stick.** It was a plain link to the dashboard, so once
  the redirect worked it would have sent people straight back. Skipping now
  records the wizard as done.
- **Getting started never showed on a new account's first visit.** Its
  fortnight was timed from a stamp the card wrote after deciding whether to
  show, and restarted on every new device. It is now timed from when the
  account was made.
- **"Keep logging!" where logging can't help.** The 7-day window cannot hold
  a comparison (five days a side need ten), yet its empty state asked for
  more logging, as did windows whose patterns were all hidden as chance.

**New**
- **How patterns work, right after the welcome.** Before anything is asked:
  - Each day becomes a row, and days with something are set against days
    without. The comparisons use only your own days.
  - An example card, labelled as one, drawn with the Insights page's own
    pieces: the real late-caffeine card's title and sentence, invented
    numbers.
  - What Solid, Suggestive and Could be chance mean, in terms of shuffling
    the days.
  - What a pattern is not: two things that went together, not a cause.
    Cards say when weekends or bedtimes could explain a gap, and some can be
    run as experiments.
- **What happens next, at the end.** The first check-in today, the earliest
  a pattern can appear (day 10: five days on each side) and when sides
  reach the size the app treats as enough (day 20). The numbers come from
  the engine's own constants.
- **Empty states that say why, in days.** The Insights page and the
  dashboard panel give the days of data so far and the earliest day a
  comparison can appear, or that a window is too short to hold one. A brand
  new account sees this once on the dashboard, not three times.

**Changed**
- **The wizard asks only what the app uses, and saves all of it.**
  - **Welcome:** greets you by first name, says in three lines what the app
    does, and on iPhone starts with Add to Home Screen, which notifications
    need.
  - **About you:** sex, birth year, weight and height, all optional, saved
    to Goals. These feed the water, protein and calorie targets and body
    strain. An empty box is not saved, so it never erases a value already
    there. Nothing is preselected, and "Rather not say" clears an earlier
    answer.
  - **Cycle tracking:** asked unless the answer above was male. Yes turns
    the Cycle page on with the last period's start and contraception; no
    keeps it out of the menu.
  - **Connect:** real buttons for Oura and Strava that come back to this
    step, and Health Connect inside the Android app. Each source says what
    it brings. Google Calendar shows as connected only when the account
    really holds a Google grant that includes it.
  - **Notifications:** lists what is actually sent: the morning check-in
    reminder, the evening intention question or journal nudge, medication
    and habit reminders, and notes from Emergy. The old list promised a
    "streak protection alert" that doesn't exist.
  - The categories and free-text goal steps are gone; nothing read them.
- **Built for a phone.** The wizard fills the screen with the buttons kept
  at the bottom, has a back arrow and a progress bar, and from tablet width
  up it sits in a card. A new step starts at its top, focus moves to its
  title, and its short entrance animation is off under reduced motion. Your
  name, saved answers and connections are loaded on the server, so nothing
  pops in after the page appears. The browser's timezone is saved during the
  wizard, so the 7:00 reminder it describes is 7:00 where you are. The
  corner Privacy/Terms links make way for the buttons, and the steps that
  ask personal things link the policy instead.
- **Insight cards' group labels wrap to two lines** instead of being cut off
  mid-word ("all caffeine before 1…").
- **Google Drive is no longer requested at sign-in.** It only fed GPX tracks
  from one folder in the owner's Drive, and location now comes from the
  app's own GPS. The Location page and card read only the app's own points.

## 3.11.0 — Cycle tracking

Web-only, no new APK. The schema change is additive only: a new `CycleDay`
table and three nullable pill-pack columns on `MedSchedule`.

**New**
- **A Cycle page** (🌸, under Body) for periods and phases. It is off until
  you turn it on. People whose Goals sex setting is female see it suggested
  in the sidebar; anyone can open it from search.
  - **Today:** a ring of your own cycle with today marked, "Period · day 2"
    or "Luteal · day 20", the next period's likely dates and an ovulation
    estimate.
  - **Learns your cycle:** predictions come from your own logged cycles after
    two of them, until then from the length you entered or a typical 28 days.
    The page always says which. Spotting never starts a period, and bleeding
    soon after a period is noted as between-period bleeding.
  - **Log a day in taps:** flow, pain, 13 body symptoms, mood, discharge, an
    ovulation test and a note. "None" on a day ends the period. "Period
    started today" is one button.
  - **Calendar:** logged days as logged; the predicted period, fertile window
    and ovulation drawn only from today forward.
  - **Every phase explained:** period, follicular, ovulation, luteal and the
    premenstrual days. For each: what is happening, what many people notice,
    food, movement, sleep, and medicines and supplements. It is written as
    information, with no doses; medicine questions go to the label, the
    leaflet or a pharmacist. Your latest ferritin from Labs shows beside the
    period's iron advice.
  - **Your phases in your data:** after two complete cycles with ring data,
    your own sleep score, HRV, resting heart rate, readiness, mood and energy
    in each phase.
  - **Ring temperature:** with an Oura ring, the temperature rise after
    ovulation confirms when it happened (a "three over six" rule). The
    estimate then uses it, and a chart shows it.
  - **Contraception:** the combined pill, mini-pill, hormonal and copper coil,
    implant, injection, ring and patch each change what the page shows.
    - On the pill, ring or patch the ring becomes the pack: pill day, break
      week and the withdrawal bleed.
    - Under other hormonal methods no ovulation or fertile window is drawn.
    - Each method has its own notes, such as missed pills ("the leaflet
      says") and medicines that make it less effective.
  - **When to talk to a doctor,** and a list of past periods with each
    cycle's length.
- **On the home page,** only when it matters: "Period · day 2" with a line
  for that day, "Period likely in 2 days", a late period (as a count of days,
  for up to two weeks), and the pill's break week. Every other day the home
  page is unchanged.
- **Pill reminders that skip the break week.** Medication schedules can have
  a pack rhythm (21 days on, 7 off). Reminders, the phone's alarms,
  adherence, the missed-dose follow-up and the calendar all leave the break
  alone. The Cycle page adds the reminder in one tap.
- **An optional notification two days before.** It says only "Cycle heads-up"
  on the lock screen; the detail goes to your chat with Emergy.
- **Emergy knows the cycle:** the phase, the predictions and today's log.
  "My period started yesterday" or "cramps today" gets logged. In the luteal
  phase, Emergy and the vitals card note that a warmer body, a higher resting
  heart rate and a lower HRV are usual for those days.
- **The health report** gets a menstrual-cycle section: when the last period
  started, cycle and period length, contraception, and the period's heavy
  days, painful days and between-period bleeding.

## 3.10.0 — Emergy keeps track of your medicines, and points the way

Web-only, no new APK.

**New**
- **Emergy can change a medication schedule.** For example: "add a 21:00
  Elicea", "only weekdays now", "half a tablet from today", "turn off the
  reminders", "pause the iron" or "I stopped the Atarax". A stopped
  schedule ends today and keeps its history; a paused one expects nothing
  until it is resumed. If a name could mean two schedules, Emergy asks which.
  Telling Emergy about a medicine you already have a schedule for changes
  that schedule instead of adding a second one.
- **Emergy knows today's doses:** which are logged, which aren't yet and which
  come later. "Did I take my pill?" now gets a real answer. "Not logged yet"
  is treated as a question, not as a missed dose.
- **One follow-up for a missed dose.** If a scheduled dose is still not logged
  two hours after its time, Emergy asks once, in the chat and as a
  notification: "Your 08:00 Elicea isn't logged yet. Did you take it?"
  Answering yes logs it at 08:00. Never between 22:00 and 07:00, and never
  once the next dose of the same medicine is due.
- **"✓ Took it" on web notifications** (Chrome, desktop), as the Android app
  already has. It logs the dose without opening anything, and a dose already
  ticked off is not logged twice. iPhone notifications can't show buttons,
  so there a tap opens the app instead.
- **Buttons in Emergy's messages.** Emergy can send you to 23 places in the
  app, up from 14, and its own messages (anomalies, patterns, the weekly
  review, water and habit nudges, the evening check-in, a quiet ring) now
  end with a button to the page they're about.

**Fixed**
- A schedule added today read "0% taken over 14 days". The two weeks before
  it existed were counted as missed doses on the Medications page, in
  Emergy's adherence read and in the doctor report. Adherence now starts
  the day the schedule was added (or its start date, if one was set).
- Adding a schedule through Emergy with a time like "8:00" saved it with no
  time at all.
- In the brief, "1:50am" had only the "1" coloured, as a sleep figure. Clock
  times with am/pm are now one figure.
- The brief's "Generated at" used a 12-hour clock ("01:30 PM"); it is
  24-hour like the rest of the app.
- Skin temperature on the vitals card read "0 °C · usual 0 °C". It is a
  change from your usual, so it now shows a sign: "+0.0 °C".

## 3.9.1 — Ready for an iPhone

Web-only, no new APK.

**Fixed**
- **iPhone notifications had no way in.** iOS only gives web push to an app
  opened from the Home Screen. In a Safari tab the notifications card simply
  wasn't there. It now says how to get them: Share, then Add to Home Screen.
  Onboarding says the same instead of a button that could only fail.
- **Onboarding's "Enable notifications" now registers the phone.** It used
  to ask for permission, say "Notifications enabled!" and register nothing,
  so no push arrived until Enable was also found in Settings. Settings,
  Emergy's panel and onboarding now share one subscribe path.
- **The calendar's toolbar ran 66px off a phone screen.** The view switcher
  now scrolls sideways inside itself, as it was meant to.
- The smoke test's sideways-scroll check now looks inside the page's own
  scroll area. Pages scroll there rather than in the window, which is why
  the calendar passed it.

## 3.9.0 — Body strain, lab limits, a tidy, and blood oxygen watched

Web-only, no new APK. The two new lab columns are added (never renamed or
dropped) by the build's own schema push.

**New**
- **Body strain: last night graded none, minor or major.**
  - It reads seven overnight signals against your own usual: resting heart
    rate, HRV, temperature, breathing, blood oxygen, time to fall asleep and
    sleep efficiency.
  - A body signal counts more than a sleep one. A signal far from usual, or
    held for three nights, counts more again. A slow night of falling asleep
    on its own is not strain, and the infection pattern is always major.
  - It reads next to readiness: on 1 Oct it would have said "Readiness looks
    typical at 75, but blood oxygen, time to fall asleep and sleep efficiency
    were off your usual last night." Oura called that night major, and the
    app had said nothing.
  - Shown on the dashboard's vitals card and the Insights page, given to the
    morning brief and Emergy, and on a major night the push says it in one
    sentence instead of two metric lines.
  - A night the ring measured none of the seven gets no grade, not "none".
- **Lab results keep the lab's own H/L mark and a printed "<" or ">".**
  - A "<5" is stored as a limit, not as an exact 5, and the sign is printed
    everywhere the value appears: the labs page, the doctor report and its
    email, the long view, and Emergy.
  - Trends never claim a size of change across a limit. They say "below the
    detection limit both times" or "now measurable" instead.
  - A result with no range on file takes the lab's own H/L.
- **Tidy lab names.** A card on the labs page offers to rename results saved
  before 3.8.0 onto today's names, so "LDL-cholesterol" joins LDL. It also
  moves a "<"/">" out of old notes into the new column. Anything a name
  can't settle is listed for you and never changed:
  - a "Urea" in mg/dL, which is likely BUN from a US report
  - two results that would share one name on one day
- **Blood oxygen is watched.** It was read every night but never checked.
  A night like 93.7% against your usual 96–98% now shows up as an anomaly.
  A 0 reading, when the ring wasn't measuring, is ignored.

**Fixed**
- Emergy's medication adherence counts the way the Medications page does:
  - a dose logged in Oura and the app counts once
  - a 00:30 dose counts for the night before
  - today is left out
  - as-needed meds are reported by how often they were taken
- A place saved by chatting with Emergy now fills in its past visits.
- Five more places turned a saved timestamp into a UTC day, so an event just
  after midnight landed on the day before:
  - fasting days in your patterns and in Emergy's context
  - the fasting page's longest streak
  - a habit's start day in the completion rate and the heatmap

  The guard test now catches this shape too.
- Add Result's "×5 jump" warning no longer measures from a previous "<5".

## 3.8.0 — Drinks by name, and the rest of the audit

Web-only: everything here is live on merge, no new APK.

**New**
- **Log a drink or meal at the time it happened**, up to a week back. The
  Log and Food tabs have a *When* row: now, 1h or 3h ago, or a picked time.
  On a past day it defaults to 20:00, and you can now add to past days at
  all. The drink's caffeine is filed at that time too, so body load and the
  bedtime cutoff read the real hour. A back-filled meal carries no location.
- **Symptom look-back.** Tap a symptom and it shows what was different in
  the ~36 hours before it, compared with your own last 45 days: a short
  night, drinks, late caffeine, a pressure drop, an unusual dose. Anything
  the app didn't measure is left out rather than called zero. From the
  third episode, it notes which factors keep showing up, as an observation.
- **Emergy reads your logs back.** "What did I eat on Tuesday?", "my blood
  pressure last week", "how's my stress tracker this month?" now get real
  answers, and Emergy can find, fix or delete a wrong meal, blood-pressure
  reading, tracker value or symptom (with the same confirm step as
  before). Fixing a meal's calories scales its macros with it.
- **Where you're signed in.** Settings lists your signed-in devices and can
  sign out one, or all of them except the one you're holding.
- **Doctor report: as-needed and stopped medicines.** Medicines taken with
  no schedule (Frontin ½, a one-off painkiller, supplements) get their own
  *Other doses logged* table. A schedule you stopped still appears, marked
  stopped, when it had doses in the period.

**Fixed (the 26 audit findings that had never been checked)**

Each one was re-checked against today's code first: 21 were real and are
fixed, 3 had already been fixed, and 2 need a database change (below).
- **Samsung import:**
  - It now respects the ring: it fills only gaps and never overwrites a
    ring night or a weight you typed.
  - It no longer stores the day's average heart rate as resting HR, or
    zero sleep scores as readings.
  - An import that writes nothing no longer shows a green tick.
  - Mood rows are counted only when they were actually written.
- **Google Timeline:**
  - A stay longer than 90 minutes becomes a check-in.
  - A stay crossing an upload batch no longer gets two check-ins.
  - Dates show in your own time zone.
  - Saving a new place back-fills its visits from stored history.
  - The Settings importer is now the same one the Location page uses. The
    old one wrote data nothing read.
- **Medications:**
  - A dose after midnight (Atarax at 00:30) now counts for the evening it
    belonged to.
  - A dose logged both in Oura and in the app counts once.
  - A tag re-timed in the Oura app moves here too.
  - "What did I take today" and the brief no longer list drinks as doses.
- **Lab results:**
  - "Cholesterol HDL" is no longer merged into total cholesterol, and the
    same goes for free testosterone, direct bilirubin, CA 19-9 and urine
    creatinine.
  - BUN is no longer converted as urea, which was 2.14× off.
  - "LDL-cholesterol" and "Gama-GT" collapse onto LDL and GGT.
  - Small values keep their digits (0.45 µkat/l no longer shows as 0.5).
  - The same unit written differently now converts: mU/l and µU/ml,
    mEq/L, HbA1c % and mmol/mol.
  - Every save path canonicalises marker names.
  - Add Result pre-fills your last unit, not US units, and warns about a
    ×5 jump.
  - An earlier value is never shown without its unit.
  - Imports question a range that looks copied from the wrong unit column,
    and keep a printed "<5" or ">90" as a limit rather than an exact value.
- **Lab trends** no longer read the months before you logged drinks or
  workouts as sober or sedentary days.
- **Lab import** refuses files the platform can't deliver, instead of
  failing mid-upload, and gets 5 minutes to read.
- **YouTube Music import** uploads in whole-day slices within the platform
  limits.
- Emergy's blood-pressure log and the visit counter no longer report writes
  that failed.

**Caught by the pre-merge review**
- "1h ago" just after midnight no longer lands in the future, and it counts
  from the moment you tap Save, not from when the page opened.
- Days too old to accept an entry no longer offer one.
- "Stoptussin sirup", "cough syrup" and "Milk thistle" stay medicines
  rather than becoming drinks.
- "B-12 v sére" stays vitamin B12.
- Moving a meal's time with Emergy moves its coffee and caffeine too.
- YouTube Music import stops rather than splitting a day when your time
  zone can't be read.
- A café's usual drink can be yerba mate.

**Still open**
- **Needs a database change:** storing a lab's own H/L flag and a "<"/">"
  qualifier as real columns (today the qualifier is kept in the note).
- **One-off data fixes:**
  - Old lab rows keep their old marker names until they are re-canonicalised.
  - Resting HR values an earlier Samsung import wrote from average heart
    rate are still stored.

### Also in this release (first shipped as 3.7.1)


- **More medicines, with half-lives.** Stilnox (zolpidem) was missing from
  the medicine table, so a dose logged at 22:28 got no half-life and never
  appeared in *In my body*. It's there now, however the tag spells it
  ("Stillnox" too), along with about thirty others, each with a half-life,
  timing advice and cautions:
  - **Sleep and anxiety:** zopiclone, clonazepam, diazepam, bromazepam
    (Lexaurin), lorazepam, oxazepam, trazodone, quetiapine, pregabalin,
    gabapentin
  - **Antidepressants:** sertraline, bupropion, vortioxetine, duloxetine
  - **Pain:** metamizole (Novalgin/Algifen), diclofenac, ketoprofen,
    nimesulide (Aulin), tramadol (with the serotonin warning next to
    Elicea), codeine, sumatriptan
  - **Allergy:** desloratadine, levocetirizine, bilastine, fexofenadine
  - **Everyday prescriptions:** propranolol, bisoprolol, levothyroxine,
    metformin, loperamide, famotidine, amoxicillin, azithromycin

  Correlation cards recompute so the new half-lives are used.

- **…and a second batch of medicines** (now about 90 in total):
  - **Antidepressants and mood medicines:** citalopram (kept apart from
    escitalopram), paroxetine, fluoxetine, venlafaxine, lamotrigine,
    lithium, valproate, aripiprazole, olanzapine
  - **ADHD:** Ritalin/Concerta, Elvanse, Strattera
  - **Heart and blood:** amlodipine, telmisartan, atorvastatin,
    rosuvastatin, Eliquis, Xarelto, warfarin — the blood thinners warn
    against ibuprofen
  - **Colds and stomach:** dextromethorphan (with a serotonin warning next
    to Elicea), ACC, ambroxol, Degan, ondansetron
  - **Steroids and muscle relaxants:** Medrol, prednisone, Mydocalm
  - **Everything else:** Fenistil, nicotine (gum, pouches, vape),
    sildenafil, tadalafil, finasteride, oxycodone, and the antibiotics
    doxycycline, ciprofloxacin, clarithromycin and cefuroxime
- **Drinks, by name.** One shared list of named drinks, used by the Oura
  sync, the caffeine estimate, the calorie count, the alcohol curve and
  Emergy's drink logging:
  - **Oura tags that were ignored now count:** Kofola, cola, energy drinks,
    Club-Mate and yerba mate, juice and smoothies, milk, kefir, hot
    chocolate and kombucha. Before, they never reached the intake log.
  - **Caffeine by drink:** Kofola ≈15 mg/100 ml, cola 10, energy drinks 32,
    Club-Mate 20; green tea has less than black tea; herbal and fruit teas
    have none; decaf is nearly none.
  - **Calories by drink:** the milk in a latte, cappuccino, flat white or
    mocha; syrup in water; juice, smoothies and kefir. Zero and light sodas
    cost nothing.
  - **Alcohol by strength:** alcohol-free beer ("nealko", Birell, 0.0)
    counts no alcohol, even when Emergy files it as beer. Radler counts at
    radler strength, prosecco and liqueurs at their own; Tatratea,
    Becherovka and fernet are spirits. A strength written in the label
    still wins.
  - **Log page:** a new *Other drinks* row (juice, Kofola, cola, energy
    drink, syrup water, milk, yerba mate, alcohol-free beer), and custom
    entries can now be mate, juice, soft drink or milk.

- Emergy's afternoon water push no longer screams "I AM WILTING" at a
  litre by five o'clock. Anything under a fixed 1500 ml used to get the
  capitals, whatever the time and whatever your goal. It now reads your
  intake against your own water goal and the time of day. On pace: nothing.
  Somewhat behind: a quiet line with how many ml you're off. The capitals
  are kept for a day that has barely started drinking.

## 3.7.0 — The audit

A full sweep: 16 auditors across every subsystem, production logs and the
owner's live data, a skeptic trying to refute every finding. 160 findings
survived; this release fixes about 138 of them, each behind a test that
failed first. **One part needs the new APK** (the home-screen widgets'
shared "open app" shortcut, and the phone-sensor pipeline fixes ride along
with it); everything else is live on merge.

**Your data stops being overwritten or misread**
- The hourly Health Connect sync no longer overwrites the ring's numbers —
  "the ring wins" had been wired into the manual form instead of the real
  sync. Days the ring wasn't worn are no longer stored as 0 steps and scored.
- Drinks deleted or relabelled in the Oura app now leave the intake log;
  "Ferrum" and "Centrum" are no longer logged as rum; vitamin D in IU is no
  longer stored as milligrams; "half of Atarax 25mg" records half.
- Health Connect steps are no longer summed across apps that both count
  them; night "pickups" were counted 2–4× and are now counted once.

**Numbers that tell the truth**
- The daily score no longer drops every morning (it compared this morning's
  partial steps with full-day averages). The Brief page's "How you slept"
  is last night, not the night before. Stress shows in the right unit.
- The vitals card uses the same spread as the anomaly scan, and no longer
  says "all in your usual band" over empty rows.
- Habit numbers agree across Home, the Week page, the weekly review, the
  15:00 push and Emergy: counted against each habit's schedule, skips and
  vacation — no more "0-day streak" every morning or "3/7" for a perfect
  Mon/Wed/Fri week. Week percentages no longer go over 100%.
- One water total and one water goal everywhere; one caffeine ceiling; a
  meal-photo drink is no longer counted twice in the day's calories.
- Insight cards compare a day with the night AFTER it (interaction cards
  had it the other way), days before symptom tracking began are no longer
  "severity 0", untracked days stay out of both sides of a comparison, and
  experiment verdicts use the same permutation test as the rest of the
  engine (the old one called ~1 in 4 do-nothing experiments "clear").

**Nothing says "done" when it wasn't**
- Chat water/coffee logging, check-ins, habit taps, the Log tab's quick
  adds and the MCP key manager now report a failed save instead of a tick.
- Phone alarms are no longer wiped when a re-sync fetch fails; a
  "✓ Took it" tapped offline is kept and sent later; medication schedule
  changes re-sync the phone's alarms; dose alarms skip doses already taken.
- Emails report a provider rejection instead of success; failed crons log.

**Emergy and the connector**
- Emergy sees message timestamps, the right habit streaks, every drink type
  over a date range, the day's drink totals, and medicines still in the
  body. The desktop Emergy panel keeps context and no longer shows its
  reasoning as the reply. A pocketed turn no longer offers a Retry that
  would run its tools twice.
- The MCP connector reads the app's own records (weight, sleep, activity)
  in local time and local days, completes repeating reminders correctly,
  and validates the reminders it creates.

**Security**
- Smart-home control is owner-only; the mobile sign-in bridge gets a
  server-side stopgap against phishing; account deletion removes all data
  and push subscriptions; the backup export no longer contains the GitHub
  token; the Auth.js open redirect and the unchecked OAuth-callback state
  are closed; passkey sign-in can actually succeed.

## 3.6.7 — Send it and pocket the phone

- **A chat turn no longer needs an audience.** "log xy", lock the screen:
  the turn used to live inside the response stream, so cancelling it killed
  the run mid-flight — tools half-executed, reply never written. The server
  now finishes the turn on its own (the stream is just narration; a dead
  one is noted and ignored), the reply — or the failure and its reason —
  always lands in the transcript, and when the app comes back to the
  foreground the chat screen polls the transcript and replaces whatever
  half-streamed bubble it was left holding.

## 3.6.6 — The phone's nights get judged, and the sync stops hiding

- **Phone-in-bed finally reaches the correlation engine.** The phone has
  described its nights since 3.4.2 (pickups after 22:00, the quiet gap);
  now the engine asks whether they cost anything: "Phone In Bed & Sleep"
  and "Phone In Bed & Morning Energy", split on your own median pickup
  count. One query loads the whole window; a night without a qualifying
  quiet gap is absent, never zero — a phone in another room says nothing
  about phone use in bed.
- **A failing Health Connect sync no longer poses as a quiet week.** Every
  sync run records its outcome — success with the record types the phone
  refused this run, or the failure and its reason — and the Settings card
  reads it back, background runs included.

## 3.6.5 — First paint

The native app is the live site in a WebView (a service worker in that
shell is a scar, not an option — it pinned phones to dead builds), so the
dashboard's server render IS app startup time. Three things sat on that
critical path that didn't need to:

- **A live Google Calendar round trip on every open** — hundreds of ms of
  someone else's latency. The Google half is now cached for two minutes;
  device and app events stay live (an event added a second ago must not
  vanish), and a failed fetch is never cached, so a lapsed grant keeps its
  banner.
- **The vitals anomaly scan blocked the whole page's HTML** for one card.
  It streams in behind Suspense now — the dashboard paints, the card says
  "Checking against your baselines…" and fills in.
- **Three sequential awaits after the parallel batch** (weigh-in, daily
  score, reminder count) — folded into the batch.

## 3.6.4 — The bill, cut where the bill was

One week of the spend ledger: $4.91, of which chat was $4.53 — 92%.

- **Chat, meal photos and the weekly review move to the mid-tier model**
  (Sonnet 5, $2/$10 per MTok vs $5/$25) — conversational tool work it does
  well. **Lab documents and the health report stay on the top-tier model**:
  the two places where being subtly wrong costs the most. Briefing and
  garden stay on the small model. `model-choice.test.ts` pins the
  assignment; the ledger records the model per row, so before/after is
  readable in the app ("how much did you cost me this week?").
- **Chat effort defaults to `medium`** instead of the model's own default —
  the experiment the code always said to run, now running.
  `EMERGY_CHAT_EFFORT=high` puts it back; `=default` hands the choice to
  the model. Expected together: roughly 60–70% off the bill.

## 3.6.3 — Drinks count, and the alcohol card speaks ‰

- **Drink calories join the daily total.** Wine, beer, spirits, juice, soda
  and milk are costed (alcohol from its actual ethanol grams at 7 kcal/g —
  a stated "8%" IPA is priced as an 8% IPA — plus residual sugar; soft
  drinks per 100 ml) and counted into the Overview calorie ring, Emergy's
  day context, chat drink replies, and `get_food_log`. Water, coffee and
  tea stay zero: ~2 kcal a cup is rounding noise dressed up as tracking.
- **The alcohol card shows ‰.** Same Widmark model that already draws the
  clearance ramp, so the "clear by" time and the ‰ describe the same body.
  Headline ≈‰ now, ‰ still there at bedtime, grams kept alongside. Said
  plainly on the card: not a breathalyzer, never a basis for deciding
  whether to drive.

## 3.6.2 — Chat writes tell the truth

- **"Logged" now means logged.** Every chat tool that stores something
  (food, mood, weight, tags, journal note, morning check-in, memories)
  checked nothing: a failed database write was swallowed and the success
  line ran anyway. That is how a whole meal said "Logged 🍲" on 26 Sept
  and never reached the food log. Each write is now checked; a failure
  answers "didn't write — worth retrying" and lands in the server log
  with its cause.
- **A failed memory read no longer poses as an empty list.** `remember`
  parsed a read error as "no facts yet", and the write that followed
  would have replaced every saved fact with the new one. Both memory
  tools now abort loudly when the store can't be reached.

## 3.6.1 — Subscriptions that survive a restart

**Needs the new APK** — CI builds and signs it on merge; the in-app update
banner offers it.

- **A reboot no longer silently kills sleep detection and travel modes.**
  Android drops Play Services subscriptions on restart and app update while
  the app's stored flags kept saying "On" — so the Settings card claimed a
  dead subscription was alive, and the first ring-off night recorded
  nothing under a smiling toggle. The boot receiver now re-subscribes both
  from the stored flags; a re-subscribe that cannot succeed (permission
  revoked, Play Services refusal) turns its flag OFF, so the card tells
  the truth either way. The plugin and the receivers now build their
  PendingIntents in one place each, so the request codes can never
  quietly diverge.
- **Settings shows what is stuck on the phone**: when sleep segments are
  queued and not yet uploaded, the sleep section says how many.

## 3.6.0 — The long view

Web only — no new APK.

- **The stats page gains the long view.** This quarter judged against the
  last through the same drift engine the monthly card uses — 90 days a
  side, relevance floor and permutation test included, so every shift
  shown is one that survived. "Same as last quarter" is said as the real
  answer it is. Below it, twelve months of sleep and step averages where
  an absent month is a hole, never a zero bar, and the blood-work markers
  that moved since their previous draw. Deliberately no synthetic "health
  age": trends against your own history, nothing more.
- **Emergy answers at quarter scale.** A new season analysis joins the
  monthly drift: "how does this quarter compare?" gets tested shifts and
  candidate factors, and Emergy can point at the Long view with a button.
- Corrected on the way: the barcode reader's comment promised a manual
  code-entry fallback that was never built.

## 3.5.0 — The score survives the ring, vitals get a card, bedtime gets a suggestion

Web only — no new APK. The three top items from the September platform
comparison (Samsung Health 7.0, Apple Health iOS 27, Google Health), built
the house way: personal baselines, honest absence, no invented numbers.

- **The daily score survives a ring-off night.** Sleep, recovery and steps
  all read absent without the ring, coverage fell under the floor, and the
  home screen's one number went blank — on exactly the days the phone's
  estimate sat in its table. Today's sleep now fills from the phone when
  the ring has nothing, the card says "Sleep is the phone's estimate", and
  history baselines stay ring-only, per the no-blending rule.
- **Last night's vitals, as a card.** Five overnight signals — resting
  heart rate, HRV, breathing, skin temperature, blood oxygen — each against
  your own 45-day median. "All in your usual band" is shown, not silence;
  a flag is the same two-sigma spike the anomaly scan would call; a signal
  the ring didn't report shows a dash, and a quiet ring gets one honest
  line instead of stale rows.
- **Tonight aim for ~23:30.** The evening brief suggests a bedtime: the
  median start of your better recent nights (by your own sleep scores),
  falling back to phone-down times when the ring's record is thin, with a
  gentle 20-minute-earlier nudge when the week is more than an hour short
  of your sleep goal. Midnight doesn't cut the calculation in half, and
  too little data is no answer rather than a made-up one. The AI brief and
  the Tonight card share one suggestion, so they can never disagree.

## 3.4.4 — Replies that stay, changes you can ask about, buttons that go places

Web only — no new APK.

- **Chat replies no longer vanish.** The reply was saved to the transcript
  after the response stream closed — and closing the stream is exactly what
  lets the serverless runtime freeze the function, so the save sometimes
  never ran. A reply you watched stream in full could be gone on the next
  open. It is now written before the stream reports done.
- **"What else moved?" has an answer.** The pattern watch computed exactly
  which patterns changed, sent one sentence, and discarded the list — so
  neither Emergy nor the insights page could name the rest. The change list
  is stored now, Emergy's patterns tool leads with it for three days, and
  the bubble says "Ask me what else moved" instead of pointing at a page
  that never knew.
- **The empty-cache lie.** Two readers of the pattern cache disagreed about
  its shape: the chat context saw ten patterns while the patterns tool read
  the wrong level, saw nothing, and said the run was empty. One shared
  parser now, guarded so a third reader can never disagree again.
- **Emergy's replies can navigate.** An internal markdown link renders as a
  tappable chip — "the full list is on [Patterns] →" — for a fixed list of
  app pages. External links open in a new tab.

## 3.4.3 — Emergy reads the phone and the record shelf, and stops narrating GPS drift

Web only — no new APK.

- **"What did I listen to?" now works.** Emergy and the connector gain a
  music tool over the Last.fm / YouTube Music history, through one shared
  range reader: per-day tracks, minutes, top artist and track, late-evening
  tracks, and the stretch's top artists with plays and genre. Old imported
  days whose minutes were never counted say so instead of posing as
  silence.
- **"What did my phone see?" now works in chat.** Emergy's own chat gains
  the phone-day tool the connector already had, through the same shared
  summary, so the two can never describe the same phone differently. It
  answers with phone-down and first-pickup times, pickups after 22:00,
  evening light, any phone-detected sleep, and the day's raw counts — and
  the chat shows "reading what your phone noticed" while it runs, with a
  Phone sensors source chip under the reply.
- **July can no longer pose as "last 7 days".** The chat's screen-time
  context took the seven newest rows whatever their age, under a heading
  that said last 7 days — so a table last written in July answered as this
  week. The query is floored to the actual week; when there is nothing
  recent, the section is absent instead of stale.
- **The 5 a.m. walk that never happened.** A sleeping phone's fixes drift
  onto wifi/cell accuracy, cluster a few hundred metres out, and the day
  then read "a 262m walk to somewhere unnamed at 05:27" about someone in
  bed. Two consecutive stops closer together than their combined reported
  accuracy now merge into one stay — a 260m separation on 400m accuracy
  distinguishes nothing, while the same 260m on a 15m outdoor fix is a real
  errand and survives. Stops with no reported accuracy never merge: the
  absence of an error bar is not a small one.

## 3.4.2 — The screen events get their first reader

Web only — no new APK.

- **"Phone down at 00:40."** The screen and charge moments the phone has
  been collecting since 3.3.6 were written and never read. `lib/phone-day.ts`
  is their first reader and the one definition: the night is the longest
  quiet gap between screen events (so a 3 a.m. glance does not become the
  bedtime), under three hours is not a night, and evening light is the
  median of what was actually sampled. The morning brief now knows when the
  phone went quiet and was picked up, plus pickups after 22:00 — labelled
  as a bedtime clue, never as sleep.
- **`get_phone_day` in the chat tools.** Emergy (and the MCP connector) can
  now answer "what did my phone see yesterday": phone-down and pickup
  times, quiet minutes, pickups after 22:00, evening light, any
  phone-detected sleep, and the day's raw counts with lux min/max and
  average pressure.
- The must-be-read guard now covers `PhoneEvent` and `AmbientSample`, so
  these tables can never silently return to being written-only.

## 3.4.1 — The brief waits for the phone

Web only — no new APK.

- **The morning brief asks after the phone has been drained.** The dashboard
  mounts the brief before the native bridge, so on every cold open the brief
  was generated — and cached — before the Sleep API's segments had left the
  phone. On a ring-off night that meant "No sleep data came through last
  night" one second before the night landed, and that answer stayed all
  morning because the cache only re-checked the ring's table. The brief now
  holds for the drain (bounded to four seconds, nothing on the web), and a
  cached sleepless brief is re-checked against the phone's nights too.
- **The sensors route says what it received.** One log line per upload
  (`[phone-sensors] … sleep=N/M`), so a morning with no phone sleep can be
  told apart as "the phone sent nothing" or "it arrived after the brief".

## 3.4.0 — Tonight's brief, one thing to say, and the ring wins where it speaks

Web only — no new APK.

- **Tonight's brief.** After 17:00 the Brief page reads like the phone's own
  night brief: one line about tonight, a two-day outlook (tonight's low,
  tomorrow's high and low, rain chance), "You have N events tomorrow" from
  Google and the app's own calendar, and how today's targets ended — steps,
  hydration and habits as rings against the goals you set — with when the
  ring or phone last synced. Each part comes from its own source and is
  absent, not invented, when that source has nothing.
- **The drift card says one thing first.** It used to open on a table of
  every shift; now it leads with the one that matters most (worse before
  better, the most certain first), folds the rest under "N more moved", and
  its question is aimed at that shift — "HRV is down to 44 ms from 52 ms.
  Did something change that isn't in the app?" — on the card, in the push
  and in chat alike.
- **Figures you can find.** Emergy's replies and the daily brief are prose
  with the numbers buried in it. Every figure now renders bold and in the
  hue of what it measures — sleep hours indigo, HRV and readiness rose,
  steps and kilometres lime, litres and milligrams cyan, mood and energy
  violet — the same identity colours the rest of the app uses, never a
  verdict colour. A number that merely counts ("14 days") stays as prose.
  The pattern-watch chat message also gained the full stop it was missing.
- **The ring wins where it speaks.** Health Connect and the Oura sync wrote
  the same daily row and the last one to sync won, hourly. Now a row the
  ring has written keeps the ring's sleep, steps and resting heart rate,
  and the phone fills only what the ring left blank.

## 3.3.6 — Where the sweeps had not been

Web only — no new APK. An adversarial pass over the surfaces the last four
releases skipped: the dashboard pages, the phone bridge, the insights cards
and Settings. Four families, each with a guard that was broken first.

- **Your check-in moods were invisible to seven screens.** The Health chart's
  mood line, the month view's glyphs, both "how you feel at this place"
  comparisons, "mood today vs your average", the daily quests and three of
  the MCP tools read only the standalone mood log — and since the dashboard's
  mood buttons came off, the morning check-in is where most moods are
  answered. The quests card said "Log your mood" all day directly under a
  check-in quest that had just reported "Energy & mood logged". All read both
  now, and the guard that was supposed to catch this walks the whole tree
  instead of a hand-written list of readers.
- **The phone's sensors only reached the server when you opened Settings.**
  Light, pressure, screen moments, the phone's own sleep estimate and the
  travel modes were collected faithfully on the phone and uploaded by two
  Settings cards and nothing else. The 3.3.4 fix — "the phone knew you
  slept" — read a table that stayed empty for anyone who never visited
  Settings. The app now uploads them every time it comes to the front.
- **Midnight, again.** The Week page showed last week until 02:00 on
  Mondays and yesterday as today for two hours every night; the dashboard
  said "Good morning" until two in the afternoon and marked every reminder
  due today as overdue from the moment the day began; the Check-in tab
  opened on "How did you sleep?" at 00:30 and, switched to the evening one,
  filed the day under the new date. All of these now run on your clock and
  the app's one rule for when the day turns (05:00).
- **The Help card described a score that no longer exists**, and a streak
  rule from before off-days and skips. Both rewritten, and a test now reads
  the score's real components back against the prose.
- The daily quests also respect habit off-days and skips, use the water
  goal you set, and see weigh-ins from the Body page.
- **The Journal showed no mood for any day but today**, and none at all on
  days answered in the check-in: it asked for "the last 24 hours" whatever
  day the picker was on, from the one table. It asks for the day now, from
  both. A check-in at 00:30 also filed itself under the day before in the
  Journal's list; it doesn't any more.
- **Seven of the eleven digest toggles did nothing.** Only Sleep, Steps,
  HRV and Habits were ever read, and only by the Sunday review email;
  Mood, Focus, Weight, Strava, GitHub, Last.fm and a Spending toggle for a
  feature removed a release ago were switches wired to nothing. The card
  now offers the four that work and says which email they shape.
- **Weight, the same disease as mood.** Six readers picked weigh-ins from
  the ring's column alone: "what does the scale say?" answered "No weight
  recorded yet" over a year of Body-page weigh-ins, the substance curve and
  the quick-log box used a stale or missing figure, two achievements never
  counted a Body-page weigh-in, and the Health card labelled "Latest weight"
  showed a 7-day mean under that label. All read both tables now, and a
  tree-walking guard holds it.
- **Emergy now knows about the phone's nights in chat and in the Sunday
  review.** The 3.3.4 fix taught the brief; the chat prompt still told him
  "never state or imply sleep figures" over a night the phone had recorded,
  and the weekly review averaged "no data". Both consult the phone's
  estimate first and label it as one — never folded into the ring average.
- **Three hydration totals still counted only water.** The intake tab's own
  tile, the MCP daily summary and the drift report's "drank less alongside"
  factor filtered rows typed "water", while the dashboard counted every
  drink at its hydration factor — so a day that ran on tea read as nearly
  dry on one screen and fine on another. All three use the one helper now.
- For whoever sweeps next: `.ci/fake-clock.cjs` and `.ci/render-at.mjs`
  render every page with the server's and the browser's clocks both set to
  a chosen instant, which is how the header above was caught.

## 3.3.4 — The phone knew you slept, and the app said it didn't

Web only — no new APK. Found by looking for more of yesterday's bug rather
than waiting for it to be reported.

3.3.0 added phone-detected sleep "for the nights the ring was on its charger".
It collected faithfully and **nothing ever read it** — so on exactly those
nights the daily brief still told Emergy there was no sleep data and not to
imply any, and asking "how did I sleep?" still answered "No sleep data for
last night". The estimate was sitting in the table the whole time.

- The brief and the quick answer now fall back to the phone's estimate when
  the ring has nothing, and label it honestly: the phone's guess from motion,
  no stages and no score. Naps are excluded — under three hours is not a night.
- A week's answer says the phone recorded N nights rather than folding rough
  estimates into ring averages as though they were the same measurement.
- A new guard fails when a table the app collects has no reader at all, so
  "shipped a writer, forgot the reader" can't happen quietly again.

## 3.3.3 — "Four weeks without training" said to someone who'd walked all day

Web only — no new APK.

The training-load line reads Strava and nothing else, and its summary said
"No sessions in the last four weeks" without saying whose sessions. The daily
brief pastes that straight into Emergy's prompt — and the brief carried **no
step count at all**, so there was nothing there to contradict it. The result
was Emergy telling someone who had walked 12,000 steps around Prague the day
before that they hadn't trained in a month.

- The summary now names Strava, and says outright that walks and step counts
  are not in it.
- The brief now carries your steps and the minutes the phone recognised as
  walking, with the instruction not to call a day like that inactive. Walking
  to the shops still isn't a training session — but it isn't stillness either,
  and the app knew the difference all along without ever saying so.

## 3.3.2 — Three things a screenshot caught at midnight

All three arrived in one set of screenshots from a real evening, which is
better QA than any sweep this repo runs. Web only — no new APK.

- **"Tap to see" sat in a chat bubble with nothing to tap.** The pattern-watch
  message was written for the push notification, whose tap opens the insights
  page — and then the same string was reused as an Emergy chat message, where
  it is plain text. The chat now says the news instead of teasing it: the
  first changed pattern in full, and where the rest live, in words.
- **Every place you visited was "Somewhere".** The evening check-in's Where
  card read a field called `placeName` from an API that has never returned
  one — the check-in rows call it `place` — so a day spent in Prague rendered
  as five "Somewhere"s while the geocoded names sat unused in the response.
  One word, and a guard so it stays fixed: the fetch boundary is untyped, so
  nothing but that test would notice the next drift.
- **Emergy went grey at midnight.** Thriving at 23:58, tired at 00:05 — not
  because anything changed, but because the new day's counters opened at zero
  and the empty ledger averaged out as exhaustion. Until 05:00 he now judges
  the day still being lived, which is yesterday's; a companion that slumps
  the moment the date changes was sulking at exactly the wrong moment.

## 3.3.1 — Four things the engine was already holding and not reading

Server-side only: this reaches the phone with no new APK.

- **Waist measurements from the Body page now count.** The measurement form
  wrote waist, chest and hips into one table and the correlation engine read
  a different one, so a person could tape-measure themselves for a year and
  the waist insight would keep saying there was not enough to go on (audit
  finding A2). The engine now reads both; where the two tables speak for the
  same day, the form's entry wins.
- **Time in a vehicle is now a cause.** Drive, transit and train spans were
  loaded by the engine in the same query as walking — and then thrown away;
  only walking was ever folded into the day series. Two new insight families
  ask what your heavier-transit days do to mood and to that night's sleep,
  cut at your own median like walking is. Flights stay out: a flight day is
  an away day, and the places insights already cover it.

- **Falling pressure can now be tested against your symptoms.** The weather
  cron asks Open-Meteo for one more number — the day's mean sea-level
  pressure — and backfills its own past rows once. A new suspect in the
  symptom engine then tests every symptom you log against the days pressure
  fell, headaches first among them. The phone's barometer (3.3.0) will
  corroborate this at finer grain as its rows accumulate.
- **Alcohol and the night's breathing.** Oura has written a breathing
  disturbance index on every ring night since the v2 sync, and nothing ever
  read the column. Its first reader: a family asking what nights after a
  drink do to it — one of the better-evidenced effects in sleep medicine,
  and a number you have never seen moved by your own behaviour, because
  nothing ever showed you.

`ENGINE_VERSION` → 20, so every cached result is recomputed with the new
columns in.

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
