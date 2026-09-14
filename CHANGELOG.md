# Changelog

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

- Finances (bank sync, bills, subscriptions) — four aggregators, only two on a
  cron; wants a pruning pass first
- Gmail inbox card — a separate OAuth surface, and Bills depends on it
- Smart home (AC control) — depends on a self-hosted UDP bridge, not
  multi-tenant

Enable either early with `NEXT_PUBLIC_ENABLED_FEATURES="finances,gmail"`.

### Launched since V3 shipped, and no longer gated
Lab results, Strava, Screen time, Last.fm, RescueTime, Fasting. Each is
self-contained — it needs nothing but its own connection — and each now feeds
the correlation engine and Emergy's context, so hiding the pages only hid the
data's home.
