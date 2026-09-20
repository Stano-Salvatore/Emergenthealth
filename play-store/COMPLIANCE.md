# Play Console compliance — Emergenthealth V3

What to declare in Play Console before submitting. Sources: Health apps
declaration (support.google.com/googleplay/android-developer/answer/14738291),
Health Connect publishing (developer.android.com/health-and-fitness/health-connect/publish),
January 2026 health-app enforcement.

## 1. Health apps declaration form (App content → Health apps)

- Category: **Health and fitness tracking / coaching** (consumer wellness).
  NOT a medical device; the app gives lifestyle insights, not diagnoses.
- The app reads Health Connect data types:
  `READ_STEPS`, `READ_SLEEP`, `READ_RESTING_HEART_RATE`,
  `READ_HEART_RATE_VARIABILITY`, `READ_OXYGEN_SATURATION`, `READ_WEIGHT`,
  `READ_ACTIVE_CALORIES_BURNED`, `READ_TOTAL_CALORIES_BURNED`
- That list is not typed by hand. It is the manifest's, held to the record
  types in `lib/health-connect-service.ts` by
  `health-permissions-declared.test.ts`, which fails if this file, the manifest
  and the code stop agreeing. Answer the form from here, not from memory.
- Justification (required per-type since Jan 2026): each type feeds the app's
  **primary function** — the daily brief, health dashboard, and the
  correlations engine that relates sleep/activity/vitals to mood, habits, and
  energy. No type is collected without a visible user-facing feature.
- Privacy policy must be reachable from the Health Connect permission
  rationale screen: `https://emergenthealth.vercel.app/privacy`.
  `PermissionsRationaleActivity` handles both forms — Health Connect's own APK
  sends `ACTION_SHOW_PERMISSIONS_RATIONALE`, the platform version on Android 14+
  sends `VIEW_PERMISSION_USAGE` with the `HEALTH_PERMISSIONS` category to a
  system-guarded alias — and opens that page.

  This note used to claim the intent was declared because the action appeared
  in the manifest. It appeared under `<queries>`, which is how this app *finds*
  Health Connect and does nothing to let Health Connect find a rationale
  screen; there was none. Check the element, not the string: a `<queries>`
  entry and an `<intent-filter>` grep identically and mean opposite things.

## 2. Data safety section

Answer it from the permissions table in section 3 — every entry there either
collects something or explains why it does not.

- **Collected:** health & fitness data (the eight types in section 1);
  personal info (email, name via Google sign-in); app activity (habits, mood,
  journal, chat — all user-entered); calendar events; photos the user attaches
  to a log; **precise and approximate location, including in the background**
  (optional, off until switched on — see `ACCESS_BACKGROUND_LOCATION` in
  section 3); physical activity (motion type, for the journey view).
  Financial info: **no** (the feature is disabled in V3 builds).
- **Not collected, though the permission suggests otherwise:** audio. The
  microphone is used for dictation and the wake word, both of which hand back
  text; no recording is stored, no recording leaves the device, and there is
  no endpoint that would accept one. Declare audio as not collected and say
  so in the review notes, because a `RECORD_AUDIO` app that declares no audio
  collection is a question waiting to be asked.
- **Shared with third parties:** health context is sent to Anthropic's Claude
  API to generate the user's own insights/chat responses — declare as
  "Data shared for app functionality". No ads, no data sold, no data used
  for tracking.
- **Security:** encrypted in transit (TLS); user can request deletion
  (in-app account deletion at `/account-delete`); data export available.
- **Prohibited uses (2026 policy):** we do not use health data for
  employment/insurance eligibility or unauthorized social sharing — nothing
  to declare, but keep it that way.

## 3. Permissions review

Every `uses-permission` the build declares has a row here, and
`play-permissions-documented.test.ts` fails if one is added without one. The
Console asks about permissions one at a time and months after they were
written; a permission nobody can explain is either a rejection or an answer
invented on the spot.

Note that not all of them were written by us, and the ones that were not are
the ones nobody thinks to write down. Two other sources reach the APK: the
manifest merger folds in each Capacitor plugin's own manifest (`WAKE_LOCK`
arrives that way, so `npm install` can change what the app asks for), and
`cap add android` unpacks a project template whose manifest already declares
`INTERNET`. The guard reads all three, which is how both of those rows got
written.

### Declared

| Permission | Why it is there, and what Play wants |
|---|---|
| `android.permission.health.*` (8 read types) | Declared via the Health apps form (section 1). The list there is the manifest's, held to `READ_TYPES` by `health-permissions-declared.test.ts`. |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Place check-ins, journeys and location insights. Runtime-requested, optional — the app works without it. Disclose under Data safety as collected, not shared. |
| `ACCESS_BACKGROUND_LOCATION` | **The highest-risk item in this submission.** `EmergyLocationService` keeps noticing visits after the app is closed, and Android 11+ offers no runtime dialog for this level — only a trip to app settings. Play requires: (a) the **Permissions declaration form**, (b) a **demo video** of the feature and of the disclosure, (c) a **prominent in-app disclosure** shown before the prompt, saying the data is collected when the app is closed or not in use. (c) is `BackgroundLocationCard` and the `loc` row in `PermissionSetup`; both carry that sentence, and the feature is off until the user switches it on. Record the video from Settings → Automatic place check-ins. |
| `ACTIVITY_RECOGNITION` | Motion classification (walking / running / cycling / vehicle) for the journey view's travel modes. Runtime-requested from Settings, never at launch. Data safety: app activity. |
| `POST_NOTIFICATIONS` | Reminders and nudges. Runtime-requested. |
| `READ_CALENDAR` | Device calendar sync — a core feature, it feeds the brief and the correlation engine. |
| `WRITE_CALENDAR` | Creating events writes to the phone's calendar rather than through Google's API: the app's Google scope is `calendar.readonly`, and widening it would make every existing user re-consent before anything worked. |
| `RECORD_AUDIO` | Dictation into Emergy — the browser `SpeechRecognition` API does not exist inside an Android WebView, so the microphone button is served by the native plugin. Also the wake word. Runtime-requested at the point of use. |
| `FOREGROUND_SERVICE_MICROPHONE` | The wake-word service. From Android 14 a service holding the microphone needs its own type, and the notification it forces cannot be dismissed — the microphone is never open without something on screen saying so. |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `FOREGROUND_SERVICE_SPECIAL_USE` | The three services: location tracking (`location`), the wake-word listener (`microphone`), and the chat head (`specialUse`, with `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` declared as the manifest requires). |
| `SYSTEM_ALERT_WINDOW` | The floating chat head. Not granted at install — the user turns it on by hand under "Display over other apps", and the head's own notification carries a Stop button. Nothing floats until somebody asks for it. |
| `RECEIVE_BOOT_COMPLETED` | Only to put the chat head's alarms back. Android clears every alarm an app holds on restart, so without it the pop-outs stop at the first reboot while the app carries on reporting them as armed. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | **Expect a question.** Play allows it only where background work is the core function and the user is asked, not assumed. Here it is asked for from Settings, for two user-visible features they switched on themselves — the location service and the chat head, both of which Samsung's "sleeping apps" logic kills silently. It is never requested at launch. If the reviewer pushes back, the feature degrades rather than breaks, and the ask can move behind a "tracking keeps stopping" prompt. |
| `INTERNET` | **Not ours.** In the Capacitor project template before any of this repo's code runs — an app that loads a hosted web app could hardly do without it. Install-time, no prompt, no form. Listed because a permission with no row is a permission nobody checked. |
| `WAKE_LOCK` | **Not ours.** Declared by `@capacitor/local-notifications` so a scheduled reminder can wake the device enough to post its notification. Install-time, no prompt, no Console form — but it is on the Play listing's permission list, so it is here. It leaves if that plugin does. |
| `SCHEDULE_EXACT_ALARM` | Reminders at user-chosen times. User-granted under "Alarms & reminders"; Settings → Phone Notifications offers it. |

### Deliberately absent — do not add without reading the row

| Permission | Why |
|---|---|
| `android.permission.health.READ_HEART_RATE` | **Removed.** It grants `HeartRateRecord` — the plugin's `HeartRateSeries` — which nothing in the app reads, and it does *not* grant resting heart rate; that is its own permission, now declared. Both halves were invisible on an account whose resting heart rate arrives from an Oura ring regardless. Do not re-add it without a feature that reads the series. |
| `USE_EXACT_ALARM` | **Removed.** Play restricts it to apps whose core functionality is an alarm clock or calendar — this is neither, so the Console's "Exact alarms" form could only be answered falsely. Without it the Capacitor plugin falls back to `setAndAllowWhileIdle`, so reminders still fire, just not to the minute. Do not re-add it. |
| `PACKAGE_USAGE_STATS` | **Not declared — do not declare.** The reason given here used to be "screen time is feature-flagged off", which stopped being true when `screentime` launched: the feature ships, the permission does not, and Android therefore never lists Emergenthealth under Settings → Usage access. The app says so plainly rather than offering a button to that list (`SCREEN_TIME_READABLE` in `lib/native/screen-time.ts`, guarded by `screen-time-declared.test.ts`). Declaring it means answering the Play form this row exists to avoid, and flipping that constant in the same change. |

## 4. Billing

- No in-app purchases in V3 (Pro is free during beta; Stripe checkout is
  hidden from the Android app). If/when Pro launches on Android it must use
  **Google Play Billing**, not Stripe.

## 5. Known review risks

- The APK is a Capacitor shell loading the hosted web app. Native surface
  (Health Connect, calendar, widgets, notifications, camera, geolocation)
  provides the required beyond-webview functionality — call these out in the
  review notes if questioned.
- Provide a demo account (email+password credentials provider) in
  Play Console → App access so reviewers can sign in without Google OAuth.

## 6. Uploading a build

In order, because two of these cannot be undone from inside the Console.

1. **Build it.** Push to `main`; the Android workflow signs the bundle and
   publishes it to the rolling `latest-android` GitHub Release. Take
   `emergenthealth.aab` from there — Play will not accept the `.apk`, which is
   for sideloading. The Release notes carry the `versionCode`; Play rejects a
   bundle whose `versionCode` it has already seen, so that number is the one to
   expect in the Console, and it comes from the workflow run number.
2. **`versionName`** is `package.json`'s `version` — nothing else sets it.
   Bump it in the same commit as the `CHANGELOG.md` entry, and copy the release
   notes out of `play-store/LISTING.md`, which keeps them under Play's 500
   characters.
3. **Health apps declaration** (App content → Health apps). Answer it from
   section 1 above, per type. The list there is the manifest's, held to the
   code by a test — do not retype it from memory.
4. **Permissions declaration for background location.** This is the slow one.
   It needs the form, and a video showing both the feature and the in-app
   disclosure that precedes the prompt. Record it from Settings → Automatic
   place check-ins: the card states the collection, then the Android dialog
   appears. Budget days, not minutes, for the review of this one.
5. **Data safety.** Section 2. It has to match what the app does, not what it
   could do — a held-back feature (`src/lib/features.ts`) collects nothing.
6. **App access.** Give reviewers the demo account: the email+password
   credentials provider exists precisely so they never need Google OAuth.
   `DEMO_USERNAME` / `DEMO_PASSWORD` in the environment.
7. **Store listing assets.** `play-store/LISTING.md` has the checklist and the
   commands that regenerate them.

If a submission is rejected, write the reason into section 5 before fixing it.
The fix is usually obvious in hindsight and the reason never is.
