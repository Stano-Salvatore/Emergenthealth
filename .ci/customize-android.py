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

# 2. Add Health Connect + location + notification permissions to AndroidManifest
manifest_path = "android/app/src/main/AndroidManifest.xml"
with open(manifest_path) as f:
    content = f.read()

extra = """
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

content = content.replace("</manifest>", extra + "\n</manifest>")
with open(manifest_path, "w") as f:
    f.write(content)
print("✓ AndroidManifest.xml updated with Health Connect permissions")

# 3. Force Kotlin JVM target 17 for all subprojects.
#    kiwi-health bundles a Kotlin plugin that doesn't support JVM 21,
#    while capacitor-android Java compilation requires JDK 21.
#    Use task name matching to avoid class-resolution issues in the root build.gradle.
kotlin_patch = """
subprojects {
    afterEvaluate {
        tasks.matching { it.class.name.contains("KotlinCompile") }.each {
            it.kotlinOptions.jvmTarget = "17"
        }
    }
}
"""
with open("android/build.gradle", "a") as f:
    f.write(kotlin_patch)
print("✓ build.gradle patched: Kotlin JVM target forced to 17")

print("All Android customizations applied successfully.")
