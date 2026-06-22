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

# 3. Override javaVersion to 17.
#    Capacitor 8 sets JavaVersion.VERSION_21 in variables.gradle, which causes
#    Gradle to auto-configure Kotlin JVM target to 21. The kiwi-health Kotlin
#    plugin doesn't support target 21. Overriding to 17 fixes both issues
#    and JDK 17 can compile all the code (capacitor-android doesn't use Java 21 APIs).
with open("android/variables.gradle") as f:
    vars_content = f.read()
vars_content = vars_content.replace("JavaVersion.VERSION_21", "JavaVersion.VERSION_17")
with open("android/variables.gradle", "w") as f:
    f.write(vars_content)
print("✓ variables.gradle: javaVersion set to VERSION_17")

print("All Android customizations applied successfully.")
