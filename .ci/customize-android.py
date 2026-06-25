#!/usr/bin/env python3
"""Apply Emergenthealth-specific patches to the generated Android project."""

import os
import re
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

# App Links intent filter (optional deep-link bonus if verified) +
# Custom scheme intent filter (always works, no verification needed).
# The OAuth flow uses emergenthealth:// to return the session token to the app.
deep_link_filters = """
        <intent-filter android:autoVerify="true">
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="https" android:host="emergenthealth.vercel.app" />
        </intent-filter>
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

print("All Android customizations applied successfully.")
