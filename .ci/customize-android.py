#!/usr/bin/env python3
"""Apply Emergenthealth-specific patches to the generated Android project."""

import os
import re
import shutil
import subprocess
import sys

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
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" />
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
    # Habits widget (tap a habit to mark it complete)
    (f"{widget_src}/HabitsWidget.java",         f"{pkg_java_dir}/HabitsWidget.java"),
    (f"{widget_src}/widget_habits.xml",         f"{res_layout}/widget_habits.xml"),
    (f"{widget_src}/habits_widget_info.xml",    f"{res_xml}/habits_widget_info.xml"),
    # Reminders widget (tap a reminder to complete it)
    (f"{widget_src}/RemindersWidget.java",      f"{pkg_java_dir}/RemindersWidget.java"),
    (f"{widget_src}/widget_reminders.xml",      f"{res_layout}/widget_reminders.xml"),
    (f"{widget_src}/reminders_widget_info.xml", f"{res_xml}/reminders_widget_info.xml"),
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
