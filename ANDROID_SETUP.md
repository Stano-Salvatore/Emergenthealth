# Android Setup Guide

## Prerequisites
- Node.js installed
- Android Studio installed (free: developer.android.com/studio)
- Your app deployed to Vercel (get the URL)

## Step 1: Install Capacitor (run in project folder)
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/push-notifications @capacitor/preferences @capacitor/splash-screen
```

## Step 2: Set your app URL
Edit `capacitor.config.ts` — replace `your-app.vercel.app` with your actual Vercel URL.

## Step 3: Initialize Android project
```bash
npx cap add android
npx cap sync
```

## Step 4: Add the widget files
Copy these files:
```
android-widget/QuickLogWidget.kt
→ android/app/src/main/java/app/emergenthealth/QuickLogWidget.kt

android-widget/widget_quick_log.xml
→ android/app/src/main/res/layout/widget_quick_log.xml

android-widget/quick_log_widget_info.xml
→ android/app/src/main/res/xml/quick_log_widget_info.xml

android-widget/widget_background.xml
→ android/app/src/main/res/drawable/widget_background.xml
```

Then add the manifest snippet from `android-widget/manifest_additions.xml` to `android/app/src/main/AndroidManifest.xml` inside the `<application>` tag.

## Step 5: Build the APK
```bash
npx cap open android
```
In Android Studio: Build → Build Bundle(s) / APK(s) → Build APK(s)

## Step 6: Set up the widget
1. In the app: Settings → Android Widget → Generate Key → "Setup Widget"
2. Long-press home screen → Widgets → find "Emergenthealth Quick Log"
3. Drag to home screen

## Step 7: Play Store (optional)
- Create account at play.google.com/console
- Build → Generate Signed Bundle/APK → Android App Bundle
- Upload the .aab file
- Fill in store listing (title, description, screenshots)
- Publish!

## Phone calendar sync (Samsung Calendar, local calendars)

The app can read every calendar on the phone — Samsung Calendar, local
calendars, and any synced account — via the native Calendar Provider, so those
events show up alongside Google Calendar. (Google Calendar already syncs on
every platform through your Google sign-in; this is only for the calendars that
live on the device itself.)

The `@ebarooni/capacitor-calendar` plugin is picked up automatically by
`npx cap sync`, and the required `READ_CALENDAR` manifest permission is injected
by the CI build (`.ci/customize-android.py`) — the same place Location,
Notifications, and Screen Time permissions come from. So **if you install the
APK from CI you don't need to touch the manifest at all.**

If you're building the APK by hand instead (not via CI), add this line to
`android/app/src/main/AndroidManifest.xml`, above the `<application>` tag:

```xml
<uses-permission android:name="android.permission.READ_CALENDAR" />
```

Either way, in the app: **Settings → Phone calendar (Samsung, local) → Connect &
Sync**, and grant the calendar permission when prompted. After that, it re-syncs
automatically in the background whenever you open the app.

## Getting the APK (no local build needed)

Every push to `main` builds a **signed** APK in GitHub Actions and publishes it
to a rolling GitHub Release. Bookmark this link on your phone and tap it to grab
the latest build — it always points at the newest APK:

```
https://github.com/Stano-Salvatore/Emergenthealth/releases/latest/download/emergenthealth.apk
```

Because it's signed with the same keystore each time, installing a newer APK
**updates the app in place** — your local data and granted permissions are kept,
no uninstall required. (The APK is also attached to each Actions run as the
`emergenthealth-release` artifact if you ever need a specific build.)

## Push Notifications
Already work via the existing service worker — no extra setup needed for web push.
For native Firebase push (more reliable), see: capacitorjs.com/docs/apis/push-notifications
