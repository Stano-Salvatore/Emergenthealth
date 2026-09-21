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

# The build number has to reach the web layer too: capacitor.config.ts stamps
# it into the WebView's user agent at `cap sync`, which runs after this script.
# Passing it through the job environment keeps the offset formula in one place
# — a second copy in the config would drift the moment either was touched.
github_env = os.environ.get("GITHUB_ENV")
if github_env and run_number.isdigit():
    with open(github_env, "a") as f:
        f.write(f"ANDROID_VERSION_CODE={version_code}\n")

# 1. minSdkVersion 26 (Health Connect requires >= 26)
result = subprocess.run(
    ["sed", "-i", "s/minSdkVersion = 24/minSdkVersion = 26/", "android/variables.gradle"],
    capture_output=True, text=True
)
if result.returncode != 0:
    print(f"WARNING: sed failed: {result.stderr}")
else:
    print("✓ minSdkVersion set to 26")

# 1b. targetSdkVersion floor.
#
# Play refuses an upload that targets below its current floor, and it refuses it
# at the upload, after a green build, a signed bundle and a walk to the Console.
# Nothing before that point cares: a project left on an old target compiles,
# installs and runs exactly as well as a current one.
#
# The value itself is Capacitor's — the generated variables.gradle carries it,
# and pinning a second copy here would only drift. This asserts the floor.
#
# PLAY_TARGET_SDK_FLOOR is Google's requirement for updates to existing apps,
# raised every August. 35 = Android 15, required since 31 August 2025. Raise it
# when Google does; the error below says what to change.
PLAY_TARGET_SDK_FLOOR = 35
with open("android/variables.gradle") as f:
    variables = f.read()
target_match = re.search(r"targetSdkVersion\s*=\s*(\d+)", variables)
if target_match:
    target_sdk = int(target_match.group(1))
else:
    # variables.gradle may not set it at all, in which case Capacitor's own
    # build.gradle supplies the default. Read that rather than failing: a
    # missing key is not a low target, and a red build over one would be this
    # check inventing the problem it exists to catch.
    with open("node_modules/@capacitor/android/capacitor/build.gradle") as f:
        fallback = re.search(r"targetSdkVersion[^\n]*?:\s*(\d+)", f.read())
    if not fallback:
        print("WARNING: no targetSdkVersion in variables.gradle or Capacitor's default — floor unchecked")
        fallback_sdk = None
    else:
        fallback_sdk = int(fallback.group(1))
    if fallback_sdk is None:
        target_sdk = PLAY_TARGET_SDK_FLOOR  # unknown; do not fail the build over it
    else:
        target_sdk = fallback_sdk
        print(f"· targetSdkVersion not pinned in variables.gradle; Capacitor defaults to {target_sdk}")
if target_sdk < PLAY_TARGET_SDK_FLOOR:
    print(
        f"::error::targetSdkVersion is {target_sdk}; Play will not accept an upload below "
        f"{PLAY_TARGET_SDK_FLOOR}. Capacitor sets this in android/variables.gradle — upgrade "
        "Capacitor, or override it here."
    )
    sys.exit(1)
print(f"✓ targetSdkVersion {target_sdk} (Play floor {PLAY_TARGET_SDK_FLOOR})")

# 2. Add Health Connect + location + notification permissions + App Links intent filter
manifest_path = "android/app/src/main/AndroidManifest.xml"
with open(manifest_path) as f:
    content = f.read()

extra_permissions = """
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <!--
      The native location tracker (EmergyLocationService) is a foreground
      service of type location. ACCESS_BACKGROUND_LOCATION ("Allow all the
      time") is what lets it come back by itself after a reboot; without it
      the tracker still runs, but only once the app has been opened.
    -->
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <!--
      Motion classification (walking / running / cycling / in a vehicle) from
      the OS's Activity Recognition — what upgrades the journey view's travel
      modes from speed guesses on days the app itself tracks. Runtime
      permission from Android 10; requested from Settings, never at launch.
    -->
    <uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />
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
    <!--
      The floating chat head. SYSTEM_ALERT_WINDOW is the permission that lets
      an app paint over any other app, and it is not granted at install: the
      user has to turn it on by hand under "Display over other apps". Declaring
      it here only makes that switch exist. Nothing floats until someone flips
      it and then asks for the head, and the head's own notification carries a
      Stop button.

      The service is FOREGROUND_SERVICE_TYPE_SPECIAL_USE — it is a window the
      user opened, not location or media. It is sticky only while the user has
      asked for the head to stay, and REQUEST_IGNORE_BATTERY_OPTIMIZATIONS lets
      the app ask to be left out of the "sleeping apps" logic that otherwise
      kills it the moment the app is closed.
    -->
    <!--
      Only to put the chat head's alarms back. Android clears every alarm an
      app holds when the phone restarts, so without this the pop-outs stop at
      the first reboot while the app carries on reporting them as armed.
    -->
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <!--
      Listening for the wake word. RECORD_AUDIO is already declared above for
      dictation; from Android 14 a service that holds the microphone needs its
      own foreground-service permission and type as well, and MICROPHONE is
      the only type the platform will accept for this. That is also the honest
      one: the notification it forces cannot be dismissed, so the microphone is
      never open without something on screen saying so.
    -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
    <!--
      One line per record type in READ_TYPES (lib/health-connect-service.ts),
      in that order, and nothing else. Health Connect never grants a permission
      the manifest does not declare, and the refusal is silent: safeRead returns
      [] for a refused type exactly as it does for a type with no records.

      The record-type -> permission mapping is not mechanical, so it was read
      out of the library the build actually links rather than guessed —
      androidx.health.connect:connect-client 1.1.0, pinned by the plugin's own
      build.gradle, disassembled at HealthPermission's static map:

        RestingHeartRate          -> READ_RESTING_HEART_RATE
        HeartRateVariabilityRmssd -> READ_HEART_RATE_VARIABILITY   (suffix dropped)
        SleepSession              -> READ_SLEEP                    (not READ_SLEEP_SESSION)

      READ_HEART_RATE is deliberately absent. It grants HeartRateRecord, which
      the plugin calls "HeartRateSeries" and nothing here reads; it does NOT
      grant RestingHeartRate. Both halves of that mistake were invisible on the
      account this was built from, where resting heart rate arrives from an Oura
      ring whether Health Connect hands it over or not.

      health-permissions-declared.test.ts fails if this list and READ_TYPES
      drift apart in either direction. Adding a type there is half a change.
    -->
    <uses-permission android:name="android.permission.health.READ_STEPS" />
    <uses-permission android:name="android.permission.health.READ_SLEEP" />
    <uses-permission android:name="android.permission.health.READ_RESTING_HEART_RATE" />
    <uses-permission android:name="android.permission.health.READ_HEART_RATE_VARIABILITY" />
    <uses-permission android:name="android.permission.health.READ_OXYGEN_SATURATION" />
    <uses-permission android:name="android.permission.health.READ_WEIGHT" />
    <uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED" />
    <uses-permission android:name="android.permission.health.READ_TOTAL_CALORIES_BURNED" />

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
    # Bubble — Emergy floating over other apps (Android 11+)
    (f"{widget_src}/EmergyBubblePlugin.java",   f"{pkg_java_dir}/EmergyBubblePlugin.java"),
    # Activity Recognition — motion transitions caught while the app is closed
    (f"{widget_src}/EmergyActivityReceiver.java", f"{pkg_java_dir}/EmergyActivityReceiver.java"),
    # The phone's own sensors and moments — light, pressure, screen, charge,
    # and the Sleep API. None of these costs a permission the app did not
    # already hold; the Sleep API runs on the same ACTIVITY_RECOGNITION grant
    # as the transitions above.
    (f"{widget_src}/EmergyAmbientSampler.java", f"{pkg_java_dir}/EmergyAmbientSampler.java"),
    (f"{widget_src}/EmergyPhoneEventReceiver.java", f"{pkg_java_dir}/EmergyPhoneEventReceiver.java"),
    (f"{widget_src}/EmergySleepReceiver.java", f"{pkg_java_dir}/EmergySleepReceiver.java"),
    (f"{widget_src}/BubbleActivity.java",       f"{pkg_java_dir}/BubbleActivity.java"),
    # Chat head — the Messenger kind: an overlay window this app draws itself,
    # which is the only version that can work on a build with no Bubbles.
    (f"{widget_src}/EmergyHeadService.java",    f"{pkg_java_dir}/EmergyHeadService.java"),
    (f"{widget_src}/HeadAlarmReceiver.java",    f"{pkg_java_dir}/HeadAlarmReceiver.java"),
    (f"{widget_src}/HeadBootReceiver.java",     f"{pkg_java_dir}/HeadBootReceiver.java"),
    (f"{widget_src}/EmergyLocationService.java", f"{pkg_java_dir}/EmergyLocationService.java"),
    (f"{widget_src}/EmergyWakeService.java",     f"{pkg_java_dir}/EmergyWakeService.java"),
    (f"{widget_src}/SherpaWakeDetector.java",    f"{pkg_java_dir}/SherpaWakeDetector.java"),
    # The screen Health Connect opens to show the privacy policy.
    (f"{widget_src}/PermissionsRationaleActivity.java", f"{pkg_java_dir}/PermissionsRationaleActivity.java"),
    (f"{widget_src}/head_circle.xml",           f"{res_drawable}/head_circle.xml"),
    (f"{widget_src}/head_panel.xml",            f"{res_drawable}/head_panel.xml"),
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
    if 'android:name=".QuickLogWidget"' not in m:
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
    # Bubble host activity. Every attribute here is load-bearing: Android
    # hosts a bubble in its own small floating window, and refuses — silently —
    # to bubble a notification whose target is not documentLaunchMode="always",
    # resizeable and embeddable.
    with open(manifest_path) as f:
        m = f.read()
    if 'android:name=".BubbleActivity"' not in m:
        bubble = """
        <activity
            android:name=".BubbleActivity"
            android:exported="false"
            android:label="Emergy"
            android:documentLaunchMode="always"
            android:resizeableActivity="true"
            android:allowEmbedded="true" />
"""
        m = m.replace("</application>", bubble + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with BubbleActivity")
    else:
        print("ℹ️  BubbleActivity already present")

    # The privacy-policy screen Health Connect opens.
    #
    # Two declarations, because Android changed how it asks. Health Connect's
    # own APK (Android 13 and below) sends ACTION_SHOW_PERMISSIONS_RATIONALE;
    # the platform version (Android 14+) sends VIEW_PERMISSION_USAGE with the
    # HEALTH_PERMISSIONS category to an alias guarded by
    # START_VIEW_PERMISSION_USAGE, which only the system holds. Declaring one
    # and not the other leaves half the phones with no privacy link.
    #
    # Both are exported on purpose: the whole point is that something outside
    # this app can open them. The alias's android:permission is what keeps
    # "exported" from meaning "anyone".
    #
    # The manifest already listed this action under <queries>. That lets this
    # app find Health Connect and does nothing whatsoever to let Health Connect
    # find this screen — but it greps the same, which is why COMPLIANCE.md
    # claimed for months that the rationale intent was declared.
    with open(manifest_path) as f:
        m = f.read()
    if 'android:name=".PermissionsRationaleActivity"' not in m:
        rationale = """
        <activity
            android:name=".PermissionsRationaleActivity"
            android:exported="true"
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:theme="@android:style/Theme.NoDisplay">
            <intent-filter>
                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
            </intent-filter>
        </activity>
        <activity-alias
            android:name="ViewPermissionUsageActivity"
            android:exported="true"
            android:targetActivity=".PermissionsRationaleActivity"
            android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
            <intent-filter>
                <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
                <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
            </intent-filter>
        </activity-alias>
"""
        m = m.replace("</application>", rationale + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with PermissionsRationaleActivity")
    else:
        print("ℹ️  PermissionsRationaleActivity already present")

    # The privacy URL the rationale screen falls back to before the app has
    # ever run. Taken from capacitor.config.ts so there is one address, not
    # two — and NEXT_PUBLIC_APP_URL overrides it the same way it does there.
    rationale_java = f"{pkg_java_dir}/PermissionsRationaleActivity.java"
    if os.path.exists(rationale_java):
        with open("capacitor.config.ts") as f:
            cfg_url = re.search(r"NEXT_PUBLIC_APP_URL \?\? '([^']+)'", f.read())
        app_url = os.environ.get("NEXT_PUBLIC_APP_URL") or (cfg_url.group(1) if cfg_url else "")
        if not app_url.startswith("http"):
            print("::error::Could not work out the app URL for PermissionsRationaleActivity "
                  "(no NEXT_PUBLIC_APP_URL, and capacitor.config.ts has no default to read). "
                  "Health Connect's privacy link would open nothing.")
            sys.exit(1)
        with open(rationale_java) as f:
            rj = f.read()
        rj = rj.replace("__APP_URL__", app_url)
        if "__APP_URL__" in rj:
            print("::error::PermissionsRationaleActivity still carries the __APP_URL__ placeholder")
            sys.exit(1)
        with open(rationale_java, "w") as f:
            f.write(rj)
        print(f"✓ PermissionsRationaleActivity points at {app_url}/privacy")

    # The transition receiver. Not exported and with no intent-filter: the
    # only sender is the explicit PendingIntent the plugin registers.
    with open(manifest_path) as f:
        m = f.read()
    if 'android:name=".EmergyActivityReceiver"' not in m:
        receiver = """
        <receiver
            android:name=".EmergyActivityReceiver"
            android:exported="false" />
"""
        m = m.replace("</application>", receiver + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with EmergyActivityReceiver")
    else:
        print("ℹ️  EmergyActivityReceiver already present")

    # The Sleep API delivers to an explicit PendingIntent, same as the
    # transitions above, so this is not exported either.
    #
    # EmergyPhoneEventReceiver is deliberately absent: SCREEN_ON and SCREEN_OFF
    # are protected broadcasts the system delivers ONLY to receivers registered
    # at runtime. Declaring it here would look like it worked and collect
    # nothing — so the foreground services register it instead.
    if 'android:name=".EmergySleepReceiver"' not in m:
        sleep_receiver = """
        <receiver
            android:name=".EmergySleepReceiver"
            android:exported="false" />
"""
        m = m.replace("</application>", sleep_receiver + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with EmergySleepReceiver")
    else:
        print("ℹ️  EmergySleepReceiver already present")

    # Activity Recognition lives in play-services-location, which only the
    # background-geolocation plugin's own module depends on — that does not
    # put it on the app module's compile classpath, so the plugin code here
    # would not build without it. Unconditional, unlike Firebase: it needs no
    # config file and pulls no service alive by existing.
    with open(app_gradle_path) as f:
        g = f.read()
    if "play-services-location" not in g:
        g = g.replace(
            "dependencies {",
            "dependencies {\n    implementation 'com.google.android.gms:play-services-location:21.3.0'",
            1)
        with open(app_gradle_path, "w") as f:
            f.write(g)
        print("✓ app/build.gradle given play-services-location for activity recognition")
    else:
        print("ℹ️  play-services-location already present")

    # The chat head's service. Android 14+ refuses to start a foreground
    # service with no declared type, and specialUse needs the property below
    # spelling out what the special use actually is.
    with open(manifest_path) as f:
        m = f.read()
    if 'android:name=".EmergyHeadService"' not in m:
        head_service = """
        <service
            android:name=".EmergyHeadService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="A floating chat window the user switches on and can stop from its own notification" />
        </service>
"""
        m = m.replace("</application>", head_service + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with EmergyHeadService")
    else:
        print("ℹ️  EmergyHeadService already present")

    # The native location tracker. Type "location" is what lets a foreground
    # service receive fixes while the app is in the background at all.
    with open(manifest_path) as f:
        m = f.read()
    if 'android:name=".EmergyLocationService"' not in m:
        location_service = """
        <service
            android:name=".EmergyLocationService"
            android:exported="false"
            android:foregroundServiceType="location" />
"""
        m = m.replace("</application>", location_service + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with EmergyLocationService")

    # The wake-word listener. Type "microphone" is the only one Android 14
    # accepts for a service that opens the mic, and it forces an ongoing
    # notification — which is the right trade for something always listening.
    with open(manifest_path) as f:
        m = f.read()
    if 'android:name=".EmergyWakeService"' not in m:
        wake_service = """
        <service
            android:name=".EmergyWakeService"
            android:exported="false"
            android:foregroundServiceType="microphone" />
"""
        m = m.replace("</application>", wake_service + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with EmergyWakeService")
    else:
        print("ℹ️  EmergyWakeService already present")

    # The alarm that makes a reminder pop the head. Not exported: nothing
    # outside this app has any business making it draw over the screen.
    with open(manifest_path) as f:
        m = f.read()
    if 'android:name=".HeadAlarmReceiver"' not in m:
        head_receiver = """
        <receiver android:name=".HeadAlarmReceiver" android:exported="false">
            <intent-filter>
                <action android:name="app.emergenthealth.HEAD_POP" />
            </intent-filter>
        </receiver>
"""
        m = m.replace("</application>", head_receiver + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with HeadAlarmReceiver")
    else:
        print("ℹ️  HeadAlarmReceiver already present")

    # Re-arms the head's alarms after a reboot or an app update, both of which
    # wipe them. Exported, because the system is the sender.
    with open(manifest_path) as f:
        m = f.read()
    if 'android:name=".HeadBootReceiver"' not in m:
        boot_receiver = """
        <receiver android:name=".HeadBootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
"""
        m = m.replace("</application>", boot_receiver + "    </application>", 1)
        with open(manifest_path, "w") as f:
            f.write(m)
        print("✓ AndroidManifest.xml updated with HeadBootReceiver")
    else:
        print("ℹ️  HeadBootReceiver already present")

    # ── Native push (FCM) ────────────────────────────────────────────────
    #
    # Everything here is conditional on google-services.json existing, which
    # CI writes from a secret. Without it the Google Services Gradle plugin
    # fails the build outright, and firebase-messaging has nothing to
    # configure itself from — so an unconfigured project must produce exactly
    # the APK it produced before this existed, not a broken one.
    #
    # The plugin's fcmToken() reaches Firebase by reflection for the same
    # reason: it has to compile whether or not the SDK is in the build.
    if os.path.exists("android/app/google-services.json"):
        shutil.copyfile(f"{widget_src}/EmergyFcmService.java",
                        f"{pkg_java_dir}/EmergyFcmService.java")

        with open(app_gradle_path) as f:
            g = f.read()
        if "firebase-messaging" not in g:
            g = g.replace(
                "apply plugin: 'com.android.application'",
                "apply plugin: 'com.android.application'\napply plugin: 'com.google.gms.google-services'",
                1)
            g = g.replace(
                "dependencies {",
                "dependencies {\n    implementation platform('com.google.firebase:firebase-bom:33.7.0')\n"
                "    implementation 'com.google.firebase:firebase-messaging'",
                1)
            with open(app_gradle_path, "w") as f:
                f.write(g)
            print("✓ app/build.gradle wired for Firebase messaging")

        root_gradle = "android/build.gradle"
        with open(root_gradle) as f:
            rg = f.read()
        if "google-services" not in rg:
            rg = rg.replace(
                "dependencies {",
                "dependencies {\n        classpath 'com.google.gms:google-services:4.4.2'",
                1)
            with open(root_gradle, "w") as f:
                f.write(rg)
            print("✓ root build.gradle got the google-services classpath")

        with open(manifest_path) as f:
            m = f.read()
        if 'android:name=".EmergyFcmService"' not in m:
            fcm_service = """
        <service
            android:name=".EmergyFcmService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
"""
            m = m.replace("</application>", fcm_service + "    </application>", 1)
            with open(manifest_path, "w") as f:
                f.write(m)
            print("✓ AndroidManifest.xml updated with EmergyFcmService")
    else:
        print("ℹ️  No google-services.json — native push left out, APK otherwise unchanged")

    for name, block in extra_receivers.items():
        with open(manifest_path) as f:
            m = f.read()
        # The declaration, not the bare name — see the note on the
        # verification pass at the end of this file.
        if f'android:name=".{name}"' not in m:
            m = m.replace("</application>", block + "    </application>", 1)
            with open(manifest_path, "w") as f:
                f.write(m)
            print(f"✓ AndroidManifest.xml updated with {name} receiver")
        else:
            print(f"ℹ️  {name} receiver already present")
else:
    print("ℹ️  Skipped widget install (source files not found)")

# ── The wake word's ears: sherpa-onnx + KWS model ───────────────────────
#
# Neither artifact belongs in git (49 MB of AAR, 18 MB of model), so the
# build downloads both from k2-fsa's GitHub releases and refuses to continue
# if either doesn't hash to the pinned sha256. Pinning makes the download as
# reproducible as a vendored copy; failing loudly is the point — an APK that
# silently shipped without its ears would say "listening" and hear nothing,
# which is the exact failure the wake card was built not to have.
#
# Both are Apache 2.0 (engine, JNI libs, and the gigaspeech model), which is
# what made sherpa-onnx the shippable choice over the alternatives.

import hashlib
import tarfile
import time
import urllib.request

SHERPA_AAR_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-1.13.7.aar"
SHERPA_AAR_SHA256 = "c4ef49e309f24fcee5c106b8a279481aaecaabb078cd37b2cd6e9a62cc8a73c8"
KWS_MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2"
KWS_MODEL_SHA256 = "f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a"
KWS_MODEL_DIR = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"


def fetch_pinned(url: str, sha256: str, dest: str) -> None:
    """Download to dest unless a file with the right hash is already there."""
    if os.path.exists(dest):
        with open(dest, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() == sha256:
                print(f"✓ cached: {os.path.basename(dest)}")
                return
    last = None
    for attempt in range(3):
        if attempt:
            time.sleep(5 * attempt)
        try:
            urllib.request.urlretrieve(url, dest)
            with open(dest, "rb") as f:
                got = hashlib.sha256(f.read()).hexdigest()
            if got != sha256:
                # A wrong hash is not a flaky network: the file changed under
                # the pin. Retrying cannot help and pretending would ship it.
                sys.exit(f"FATAL: {url} hashed {got}, pinned {sha256}")
            print(f"✓ downloaded: {os.path.basename(dest)}")
            return
        except OSError as e:
            last = e
    sys.exit(f"FATAL: could not download {url}: {last}")


kws_keywords_src = f"{widget_src}/kws-keywords.txt"
if not os.path.exists(kws_keywords_src):
    sys.exit(f"FATAL: {kws_keywords_src} missing — the wake word has nothing to listen for")

cache_dir = os.environ.get("EMERGI_ANDROID_CACHE", ".ci-cache")
os.makedirs(cache_dir, exist_ok=True)
aar_cache = os.path.join(cache_dir, "sherpa-onnx-1.13.7.aar")
model_cache = os.path.join(cache_dir, "kws-model.tar.bz2")
fetch_pinned(SHERPA_AAR_URL, SHERPA_AAR_SHA256, aar_cache)
fetch_pinned(KWS_MODEL_URL, KWS_MODEL_SHA256, model_cache)

os.makedirs("android/app/libs", exist_ok=True)
shutil.copyfile(aar_cache, "android/app/libs/sherpa-onnx.aar")

kws_assets = "android/app/src/main/assets/kws"
os.makedirs(kws_assets, exist_ok=True)
with tarfile.open(model_cache, "r:bz2") as tar:
    # Only the int8 set and the token table: 5.3 MB instead of 20. The fp32
    # models, the BPE model and the test wavs stay out of the APK — keyword
    # encoding happened at development time (see kws-keywords.README.md).
    wanted = {
        f"{KWS_MODEL_DIR}/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx": "encoder.int8.onnx",
        f"{KWS_MODEL_DIR}/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx": "decoder.int8.onnx",
        f"{KWS_MODEL_DIR}/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx": "joiner.int8.onnx",
        f"{KWS_MODEL_DIR}/tokens.txt": "tokens.txt",
    }
    for member, out_name in wanted.items():
        src = tar.extractfile(member)
        if src is None:
            sys.exit(f"FATAL: {member} missing from the KWS model tarball")
        with open(os.path.join(kws_assets, out_name), "wb") as out:
            shutil.copyfileobj(src, out)
shutil.copyfile(kws_keywords_src, os.path.join(kws_assets, "keywords.txt"))
print("✓ KWS model + keywords installed into assets/kws")

with open(app_gradle_path) as f:
    g = f.read()
changed = False
if "sherpa-onnx.aar" not in g:
    g = g.replace(
        "dependencies {",
        "dependencies {\n    implementation files('libs/sherpa-onnx.aar')",
        1)
    changed = True
if "abiFilters" not in g:
    # The AAR carries x86 and x86_64 too — emulator architectures that no
    # phone this app is sideloaded onto uses, at ~35 MB of .so. Filtered
    # here rather than trimmed from the AAR so the pin stays byte-exact.
    g = re.sub(
        r'(versionName "[^"]*")',
        "\\1\n        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }",
        g, count=1)
    changed = True
if changed:
    with open(app_gradle_path, "w") as f:
        f.write(g)
    print("✓ app/build.gradle given the sherpa-onnx AAR and abiFilters")
else:
    print("ℹ️  sherpa-onnx already wired into app/build.gradle")

# ── Verify what actually ended up declared ───────────────────────────────
#
# Every idempotency check above used to ask whether a class NAME appeared
# anywhere in the manifest. The manifest also carries the comments this
# script writes into it — and the one explaining ACCESS_BACKGROUND_LOCATION
# names EmergyLocationService in prose. So that check matched its own
# comment, concluded the service was already there, and the <service>
# element was never added.
#
# The class still compiled into the APK. Android refuses to start a service
# the manifest does not declare, so startForegroundService threw, the plugin
# rejected the call, and the Settings card told people their location
# permission or Samsung's battery settings were to blame. On every phone,
# from 2026-09-02 until this was found.
#
# The checks now look for android:name=".Class". This pass is the one that
# does not depend on them being right: a component compiled into the app has
# to be in the manifest, and the build stops here rather than on a phone.
#
# Which classes are components is read from the sources rather than listed —
# a list is one more thing to forget. Android requires a manifest entry for
# exactly these base classes, and nothing else in this package has one:
# EmergyBubblePlugin extends Plugin and is registered in code,
# SherpaWakeDetector is a plain helper.
COMPONENT_BASES = ("Activity", "Service", "BroadcastReceiver", "AppWidgetProvider")

if os.path.isdir(pkg_java_dir):
    with open(manifest_path) as f:
        final_manifest = f.read()

    undeclared = []
    for java in sorted(os.listdir(pkg_java_dir)):
        if not java.endswith(".java"):
            continue
        cls = java[:-5]
        with open(os.path.join(pkg_java_dir, java)) as f:
            base = re.search(rf"class\s+{re.escape(cls)}\s+extends\s+(\w+)", f.read())
        if not base or not base.group(1).endswith(COMPONENT_BASES):
            continue
        # Push is the one conditional component: without google-services.json
        # the service is deliberately left out of the manifest, and the file
        # it needs is not in git.
        if cls == "EmergyFcmService" and not os.path.exists("android/app/google-services.json"):
            continue
        # Registered at runtime, and it HAS to be. ACTION_SCREEN_ON and
        # ACTION_SCREEN_OFF are protected broadcasts Android delivers only to
        # a receiver registered with registerReceiver() — a manifest entry for
        # them is accepted, looks correct, and never fires. So this one is
        # declared nowhere on purpose, and the foreground services register it.
        # It is exempted by name rather than by rule because "extends
        # BroadcastReceiver and is missing" is exactly the mistake this check
        # exists to catch, and a rule would let the next one through.
        if cls == "EmergyPhoneEventReceiver":
            continue
        if f'android:name=".{cls}"' not in final_manifest:
            undeclared.append(f"{cls} (extends {base.group(1)})")

    if undeclared:
        print(
            "::error::These classes are compiled into the app but declared nowhere in "
            "AndroidManifest.xml: " + ", ".join(undeclared) + ". Android will refuse to start "
            "them at runtime, and the failure looks like a permission problem rather than a "
            "missing declaration. Add the element in this script."
        )
        sys.exit(1)
    print("✓ every component class compiled into the app is declared in the manifest")

print("All Android customizations applied successfully.")

