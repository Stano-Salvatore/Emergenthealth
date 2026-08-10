# Play Console compliance — Emergenthealth V3

What to declare in Play Console before submitting. Sources: Health apps
declaration (support.google.com/googleplay/android-developer/answer/14738291),
Health Connect publishing (developer.android.com/health-and-fitness/health-connect/publish),
January 2026 health-app enforcement.

## 1. Health apps declaration form (App content → Health apps)

- Category: **Health and fitness tracking / coaching** (consumer wellness).
  NOT a medical device; the app gives lifestyle insights, not diagnoses.
- The app reads Health Connect data types:
  `READ_STEPS`, `READ_SLEEP`, `READ_HEART_RATE`, `READ_HEART_RATE_VARIABILITY`,
  `READ_OXYGEN_SATURATION`, `READ_ACTIVE_CALORIES_BURNED`,
  `READ_TOTAL_CALORIES_BURNED`, `READ_WEIGHT`
- Justification (required per-type since Jan 2026): each type feeds the app's
  **primary function** — the daily brief, health dashboard, and the
  correlations engine that relates sleep/activity/vitals to mood, habits, and
  energy. No type is collected without a visible user-facing feature.
- Privacy policy must be reachable from the Health Connect permission
  rationale screen: `https://emergenthealth.vercel.app/privacy`
  (the manifest's `ACTION_SHOW_PERMISSIONS_RATIONALE` intent is declared).

## 2. Data safety section

- **Collected:** health & fitness data (listed above), personal info
  (email, name via Google sign-in), app activity (habits, mood, journal —
  user-entered), calendar events, approximate & precise location (optional,
  user-enabled), financial info: **no** (feature disabled in V3 builds).
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

| Permission | Status |
|---|---|
| `android.permission.health.*` (8 read types) | Declared via Health apps form (above) |
| `ACCESS_FINE/COARSE_LOCATION` | Runtime-requested, optional feature (location insights); disclose in Data safety |
| `POST_NOTIFICATIONS` | Runtime-requested (reminders, nudges) |
| `READ_CALENDAR` | Runtime-requested (device calendar sync — core feature) |
| `SCHEDULE_EXACT_ALARM` | Reminders at user-chosen times. User-granted under "Alarms & reminders"; Settings → Phone Notifications offers it. |
| `USE_EXACT_ALARM` | **Removed.** Play restricts it to apps whose core functionality is an alarm clock or calendar — this is neither, so the Console's "Exact alarms" form could only be answered falsely. Without it the Capacitor plugin falls back to `setAndAllowWhileIdle`, so reminders still fire, just not to the minute. Do not re-add it. |
| `PACKAGE_USAGE_STATS` | **Removed in V3** (screen time is feature-flagged off) — do not declare |

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
