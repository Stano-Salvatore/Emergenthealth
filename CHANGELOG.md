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
- v3.1 Finances (bank sync, bills, subscriptions)
- v3.2 Lab results
- v3.3 Gmail inbox card
- v3.4 Strava
- v3.5 Screen time
- v3.6 Last.fm
- v3.7 RescueTime
- v3.8 Smart home (AC control)

Enable any of these early with `NEXT_PUBLIC_ENABLED_FEATURES="finances,labs"`.
