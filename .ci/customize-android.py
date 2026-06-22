#!/usr/bin/env python3
"""Apply Emergenthealth-specific patches to the generated Android project."""

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

# App Links intent filter — routes OAuth callbacks from external browser back into the app.
# android:autoVerify="true" triggers Android's domain verification against
# https://emergenthealth.vercel.app/.well-known/assetlinks.json
app_links_filter = """
        <intent-filter android:autoVerify="true">
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="https" android:host="emergenthealth.vercel.app" />
        </intent-filter>"""

content = content.replace("</manifest>", extra_permissions + "\n</manifest>")
# Insert App Links filter inside the main activity, before its closing tag
content = content.replace("</activity>", app_links_filter + "\n    </activity>", 1)

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
            storeFile = ksPath ? file(ksPath) : null
            storePassword = System.getenv("ANDROID_STORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
"""
    if "    buildTypes {" in build_content:
        build_content = build_content.replace("    buildTypes {", signing_block + "    buildTypes {", 1)

    # Add conditional signingConfig inside buildTypes.release.
    # Target "minifyEnabled false" — unique to buildTypes, not in signingConfigs block.
    signing_line = '            if (System.getenv("ANDROID_KEYSTORE_PATH")) { signingConfig signingConfigs.release }\n'
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

print("All customizations applied (kiwi-health Kotlin patch runs post-sync).")
print("All Android customizations applied successfully.")
