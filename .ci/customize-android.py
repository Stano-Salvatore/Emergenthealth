#!/usr/bin/env python3
"""Apply Emergenthealth-specific patches to the generated Android project."""

import json
import os
import re
import shutil
import subprocess
import sys

# 0. versionCode / versionName — Play Store rejects uploads that reuse a
# versionCode, so CI must bump it on every build (ANDROID_VERSION_CODE is
# derived from the workflow run number). versionName follows package.json.
with open("package.json") as f:
    version_name = json.load(f)["version"]
run_number = os.environ.get("ANDROID_RUN_NUMBER", "").strip()
version_code = str(300 + int(run_number)) if run_number.isdigit() else "1"

app_gradle_path = "android/app/build.gradle"
with open(app_gradle_path) as f:
    gradle = f.read()
gradle, n_code = re.subn(r"versionCode \d+", f"versionCode {version_code}", gradle, count=1)
gradle, n_name = re.subn(r'versionName "[^"]*"', f'versionName "{version_name}"', gradle, count=1)
with open(app_gradle_path, "w") as f:
    f.write(gradle)
if n_code and n_name:
    print(f"✓ versionCode {version_code}, versionName {version_name}")
else:
    print(f"WARNING: version patch incomplete (code={n_code}, name={n_name})")

# 1. minSdkVersion 26 (Health Connect requires >= 26)
result = subprocess.run(
    ["sed", "-i", "s/minSdkVersion = 24/minSdkVersion = 26/", "android/variables.gradle"],
    capture_output=True, text=True
)
if result.returncode != 0:
    print(f"WARNING: sed failed: {result.stderr}")
else:
    print("✓ minSdkVersion set to 26")

# 2. Add Health Connect + location + notification permissions + App Links intent filter
manifest_path = "android/app/src/main/AndroidManifest.xml"
with open(manifest_path) as f:
    content = f.read()

extra_permissions = """
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <!--
      SCHEDULE_EXACT_ALARM, not USE_EXACT_ALARM.

      USE_EXACT_ALARM is granted at install with no prompt, but Play restricts
      it to apps whose *core functionality* is an alarm clock or a calendar.
      Emergenthealth is neither — it is a health app that happens to sync a
      calendar — so declaring it made Play demand a core-functionality answer
      that could only be given falsely, and shipping it was a policy violation
      waiting to be enforced.

      SCHEDULE_EXACT_ALARM covers the same ground for a reminder app and needs
      no eligibility claim; the user grants it under "Alarms & reminders". If
      they don't, the Capacitor plugin falls back to setAndAllowWhileIdle, so
      reminders still arrive — just not to the exact minute. Settings offers
      the upgrade rather than assuming it.
    -->
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.READ_CALENDAR" />
    <!--
      Creating events writes to the phone's calendar rather than through
      Google's API: the app's Google scope is calendar.readonly, and widening
      it would make every user re-consent before anything worked again. The
      phone already holds a writable account and syncs it up itself.
    -->
    <uses-permission android:name="android.permission.WRITE_CALENDAR" />
    <!--
      Dictation into Emergy. The browser's SpeechRecognition API does not exist
      inside an Android WebView — it needs Chrome's own speech service, which
      the WebView never exposes — so the microphone button in the app is served
      by the native speech-recognition plugin, and that needs RECORD_AUDIO.
      Without this the plugin reports unavailable and the UI says so rather
      than offering a button that silently does nothing.
    -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.health.READ_STEPS" />
    <uses-permission android:name="android.permission.health.READ_SLEEP" />
    <uses-permission android:name="android.permission.health.READ_HEART_RATE" />
    <uses-permission android:name="android.permission.health.READ_HEART_RATE_VARIABILITY" />
    <uses-permission android:name="android.permission.health.READ_OXYGEN_SATURATION" />
    <uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED" />
    <uses-permission android:name="android.permission.health.READ_TOTAL_CALORIES_BURNED" />
    <uses-permission android:name="android.permission.health.READ_WEIGHT" />

    <queries>
        <package android:name="com.google.android.apps.healthdata" />
        <intent>
            <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
        </intent>
        <!--
          The speech recognizer and the text-to-speech engine both live in other
          apps. Under Android 11+ package visibility rules an app cannot see
          them without declaring the intents, and the plugin would report "not
          available" on a phone that has both.
        -->
        <intent>
            <action android:name="android.speech.RecognitionService" />
        </intent>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE" />
        </intent>
    </queries>
"""

# Custom scheme intent filter only.
#
# DO NOT add an https://emergenthealth.vercel.app App Links filter here.
# assetlinks.json is verified, so Android intercepts Chrome's navigation to
# /api/mobile-auth-bridge BEFORE Chrome can load the page. That means the
# bridge never stores the signed session code in the DB, polling always sees
# {done:false}, and the app opens on the sign-in page with no session.
#
# Without the https filter, Chrome loads the bridge URL normally, stores the
# code, shows the "Return to app" page, and the polling loop redeems it.
deep_link_filters = """
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="emergenthealth" />
        </intent-filter>"""

content = content.replace("</manifest>", extra_permissions + "\n</manifest>")
# Insert deep-link filters inside the main activity, before its closing tag
content = content.replace("</activity>", deep_link_filters + "\n    </activity>", 1)

with open(manifest_path, "w") as f:
    f.write(content)
print("✓ AndroidManifest.xml updated with permissions + App Links intent filter")

# 3. Patch android/app/build.gradle for release signing via env vars
app_build_gradle = "android/app/build.gradle"
with open(app_build_gradle) as f:
    build_content = f.read()

if "signingConfigs" not in build_content:
    signing_block = """    signingConfigs {
        release {
            def ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
            def ksFile = ksPath ? new File(ksPath) : null
            def validKs = ksFile?.exists() && ksFile?.length() > 100
            storeFile = validKs ? ksFile : null
            storePassword = validKs ? System.getenv("ANDROID_STORE_PASSWORD") : null
            keyAlias = validKs ? System.getenv("ANDROID_KEY_ALIAS") : null
            keyPassword = validKs ? System.getenv("ANDROID_KEY_PASSWORD") : null
        }
    }
"""
    if "    buildTypes {" in build_content:
        build_content = build_content.replace("    buildTypes {", signing_block + "    buildTypes {", 1)

    # Add conditional signingConfig inside buildTypes.release.
    # Target "minifyEnabled false" — unique to buildTypes, not in signingConfigs block.
    signing_line = '            def _ksFile = System.getenv("ANDROID_KEYSTORE_PATH") ? new File(System.getenv("ANDROID_KEYSTORE_PATH")) : null\n            if (_ksFile?.exists() && _ksFile?.length() > 100) { signingConfig signingConfigs.release }\n'
    if "            minifyEnabled false" in build_content:
        build_content = build_content.replace(
            "            minifyEnabled false",
            signing_line + "            minifyEnabled false",
            1
        )
    elif "            minifyEnabled true" in build_content:
        build_content = build_content.replace(
            "            minifyEnabled true",
            signing_line + "            minifyEnabled true",
            1
        )

    with open(app_build_gradle, "w") as f:
        f.write(build_content)
    print("✓ android/app/build.gradle patched with release signing config")
else:
    print("ℹ️  android/app/build.gradle already has signingConfigs")

# 4. Create a placeholder @drawable/splash so the launch theme doesn't fail.
# The Capacitor template's styles.xml references @drawable/splash for the window
# background of AppTheme.NoActionBarLaunch (the activity's launch theme). Without
# this drawable the app may crash or show a build error on some Android versions.
splash_dir = "android/app/src/main/res/drawable"
os.makedirs(splash_dir, exist_ok=True)
splash_xml = os.path.join(splash_dir, "splash.xml")
splash_png = os.path.join(splash_dir, "splash.png")
if os.path.exists(splash_png):
    # splash.png already present (e.g. placed by cap sync) — creating splash.xml
    # would produce a "Duplicate resources" build error, so skip it.
    print("ℹ️  drawable/splash.png exists — skipping splash.xml placeholder")
elif not os.path.exists(splash_xml):
    with open(splash_xml, "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<shape xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <solid android:color="#0f0e1a" />\n'
                '</shape>\n')
    print("✓ Created drawable/splash.xml placeholder (dark background)")
else:
    print("ℹ️  drawable/splash.xml already exists")

# 5. Install the Quick Log home-screen widget (Java provider + resources) and
# register its AppWidgetProvider receiver in the manifest. The widget lets the
# user log water/coffee/beer from the home screen without opening the app.
widget_src   = "android-widget"
pkg_java_dir = "android/app/src/main/java/app/emergenthealth"
res_layout   = "android/app/src/main/res/layout"
res_xml      = "android/app/src/main/res/xml"
res_drawable = "android/app/src/main/res/drawable"

widget_copies = [
    (f"{widget_src}/QuickLogWidget.java",       f"{pkg_java_dir}/QuickLogWidget.java"),
    (f"{widget_src}/widget_quick_log.xml",      f"{res_layout}/widget_quick_log.xml"),
    (f"{widget_src}/quick_log_widget_info.xml", f"{res_xml}/quick_log_widget_info.xml"),
    (f"{widget_src}/widget_background.xml",      f"{res_drawable}/widget_background.xml"),
    (f"{widget_src}/widget_button.xml",          f"{res_drawable}/widget_button.xml"),
    (f"{widget_src}/widget_button_primary.xml",  f"{res_drawable}/widget_button_primary.xml"),
    # Habits widget (tap a habit to mark it complete)
    (f"{widget_src}/HabitsWidget.java",         f"{pkg_java_dir}/HabitsWidget.java"),
    (f"{widget_src}/widget_habits.xml",         f"{res_layout}/widget_habits.xml"),
    (f"{widget_src}/habits_widget_info.xml",    f"{res_xml}/habits_widget_info.xml"),
    # Reminders widget (tap a reminder to complete it)
    (f"{widget_src}/RemindersWidget.java",      f"{pkg_java_dir}/RemindersWidget.java"),
    (f"{widget_src}/widget_reminders.xml",      f"{res_layout}/widget_reminders.xml"),
    (f"{widget_src}/reminders_widget_info.xml", f"{res_xml}/reminders_widget_info.xml"),
    # Today widget (readiness, sleep, steps, habits, next dose — read-only)
    (f"{widget_src}/TodayWidget.java",          f"{pkg_java_dir}/TodayWidget.java"),
    (f"{widget_src}/widget_today.xml",          f"{res_layout}/widget_today.xml"),
    (f"{widget_src}/today_widget_info.xml",     f"{res_xml}/today_widget_info.xml"),
    # Emergy widget (one tap to talk — no network, no key, nothing to go stale)
    (f"{widget_src}/EmergyWidget.java",         f"{pkg_java_dir}/EmergyWidget.java"),
    (f"{widget_src}/widget_emergy.xml",         f"{res_layout}/widget_emergy.xml"),
    (f"{widget_src}/emergy_widget_info.xml",    f"{res_xml}/emergy_widget_info.xml"),
]

widget_ok = True
for src, dst in widget_copies:
    if not os.path.exists(src):
        print(f"WARNING: widget source missing, skipping widget: {src}")
        widget_ok = False
        break

if widget_ok:
    for d in (pkg_java_dir, res_layout, res_xml, res_drawable):
        os.makedirs(d, exist_ok=True)
    for src, dst in widget_copies:
        shutil.copyfile(src, dst)
    print("✓ Quick Log widget files installed")

    # Register the widget receiver inside <application> (idempotent).
    with open(manifest_path) as f:
        m = f.read()
    if "QuickLogWidget" not in m:
        widget_receiver = """
        <receiver android:name=".QuickLogWidget" android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="app.emergenthealth.LOG_WATER_250" />
                <action android:name="app.emergenthealth.LOG_WATER_500" />
                <action android:name="app.emergenthealth.LOG_COFFEE" />
                <action android:name="app.emergenthealth.LOG_BEER" />
                <action android:name="app.emergenthealth.LOG_WINE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/quick_log_widget_info" />
        </receiver>
"""
        m = m.replace("</application>", widget_receiver + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with QuickLogWidget receiver")
    else:
        print("ℹ️  QuickLogWidget receiver already present")

    # Habits + Reminders receivers (idempotent).
    extra_receivers = {
        "HabitsWidget": """
        <receiver android:name=".HabitsWidget" android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="app.emergenthealth.TOGGLE_HABIT" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/habits_widget_info" />
        </receiver>
""",
        "RemindersWidget": """
        <receiver android:name=".RemindersWidget" android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="app.emergenthealth.COMPLETE_REMINDER" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/reminders_widget_info" />
        </receiver>
""",
        "TodayWidget": """
        <receiver android:name=".TodayWidget" android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/today_widget_info" />
        </receiver>
""",
        "EmergyWidget": """
        <receiver android:name=".EmergyWidget" android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/emergy_widget_info" />
        </receiver>
""",
    }
    for name, block in extra_receivers.items():
        with open(manifest_path) as f:
            m = f.read()
        if name not in m:
            m = m.replace("</application>", block + "    </application>", 1)
            with open(manifest_path, "w") as f:
                f.write(m)
            print(f"✓ AndroidManifest.xml updated with {name} receiver")
        else:
            print(f"ℹ️  {name} receiver already present")
else:
    print("ℹ️  Skipped widget install (source files not found)")

print("All Android customizations applied successfully.")
