#!/usr/bin/env python3
"""
Patch the kiwi-health-capacitor-health-connect module's build.gradle to set
kotlinOptions.jvmTarget = "17".

This module bundles an old Kotlin plugin that doesn't support JVM target 21,
but capacitor-android's Java code requires JDK 21. We fix this by forcing
only the kiwi-health module's Kotlin compilation to target JVM 17.

Must run AFTER `cap sync android` (which creates the module directory).
"""

import glob
import os
import sys

patterns = [
    "android/kiwi-health-*/build.gradle",
    "android/*health-connect*/build.gradle",
    "android/*kiwi*/build.gradle",
]

found = []
for p in patterns:
    found.extend(glob.glob(p))

# Fallback: walk android/ looking for kiwi or health-connect dirs
if not found:
    for root, dirs, files in os.walk("android"):
        if any(k in root.lower() for k in ["kiwi", "health-connect", "healthconnect"]):
            for f in files:
                if f == "build.gradle":
                    found.append(os.path.join(root, f))

if not found:
    print("⚠️  kiwi-health build.gradle not found — listing android/ contents:")
    for root, dirs, files in os.walk("android"):
        depth = root.replace("android", "").count(os.sep)
        if depth < 2:
            print(f"  {root}/")
    sys.exit(0)  # non-fatal: build will show the real error

for path in found:
    with open(path) as f:
        content = f.read()

    if "kotlinOptions" in content:
        print(f"ℹ️  {path} already has kotlinOptions — skipping")
        continue

    # Insert kotlinOptions block before the first compileOptions block
    if "compileOptions {" in content:
        content = content.replace(
            "compileOptions {",
            'kotlinOptions { jvmTarget = "17" }\n    compileOptions {',
            1,
        )
    elif "android {" in content:
        # Append inside the android { } block
        content = content.replace(
            "android {",
            'android {\n    kotlinOptions { jvmTarget = "17" }',
            1,
        )
    else:
        print(f"⚠️  {path}: couldn't find insertion point, appending at end")
        content += '\n// CI patch\nconfiguration { kotlinOptions { jvmTarget = "17" } }\n'

    with open(path, "w") as f:
        f.write(content)
    print(f"✓ Patched {path}: Kotlin jvmTarget = 17")
