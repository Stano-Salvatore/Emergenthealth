#!/usr/bin/env python3
# v3
"""
Patch the kiwi-health-capacitor-health-connect module's build.gradle so it
compiles with JVM target 17.

Problem: capacitor-android requires JDK 21 (hardcodes VERSION_21), but the
Kotlin plugin bundled with kiwi-health is too old to support jvmTarget = 21.
AGP 8.x also auto-propagates compileOptions sourceCompatibility → Kotlin
jvmTarget, so we must patch BOTH compileOptions AND kotlinOptions.

In Capacitor 8, plugins are NOT copied to android/ — they are included via
Gradle includeBuild() pointing to node_modules/<pkg>/android/.
Must run AFTER `cap sync android`.
"""

import glob
import os
import re
import sys

# In Capacitor 8, plugins live in node_modules and are included via includeBuild
patterns = [
    # Capacitor 8: plugin code stays in node_modules
    "node_modules/@kiwi-health/capacitor-health-connect/android/build.gradle",
    "node_modules/@kiwi-health/*/android/build.gradle",
    # Capacitor <8 fallback: plugin copied to android/
    "android/kiwi-health-*/build.gradle",
    "android/*health-connect*/build.gradle",
    "android/*kiwi*/build.gradle",
]

found = []
for p in patterns:
    found.extend(glob.glob(p))

# Fallback: walk node_modules for kiwi/health-connect android dirs
if not found:
    for root, dirs, files in os.walk("node_modules"):
        if any(k in root.lower() for k in ["kiwi", "health-connect", "healthconnect"]):
            if "android" in root and "build.gradle" in files:
                found.append(os.path.join(root, "build.gradle"))
        # Don't walk too deep
        depth = root.count(os.sep)
        if depth > 5:
            dirs.clear()

# Fallback: walk android/ looking for kiwi or health-connect dirs (old Capacitor)
if not found:
    for root, dirs, files in os.walk("android"):
        if any(k in root.lower() for k in ["kiwi", "health-connect", "healthconnect"]):
            for f in files:
                if f == "build.gradle":
                    found.append(os.path.join(root, f))

if not found:
    print("⚠️  kiwi-health build.gradle not found — listing search locations:")
    print("  node_modules/@kiwi-health/ contents:")
    kiwi_dir = "node_modules/@kiwi-health"
    if os.path.exists(kiwi_dir):
        for item in os.listdir(kiwi_dir):
            print(f"    {kiwi_dir}/{item}/")
    else:
        print(f"    (directory not found: {kiwi_dir})")
    print("  android/ top-level contents:")
    for root, dirs, files in os.walk("android"):
        depth = root.replace("android", "").count(os.sep)
        if depth < 2:
            print(f"    {root}/")
    sys.exit(0)  # non-fatal: build will show the real error

for path in found:
    with open(path) as f:
        content = f.read()

    original = content

    # 1. Replace any jvmTarget = "21" or jvmTarget = '21' → "17"
    content = re.sub(r'(jvmTarget\s*=\s*)["\']?21["\']?', r'\g<1>"17"', content)

    # 2. Replace Java 21 compat in compileOptions (AGP propagates this to Kotlin jvmTarget)
    content = content.replace("VERSION_21", "VERSION_17")

    # 3. If no kotlinOptions block exists at all, inject one before compileOptions
    if "kotlinOptions" not in content:
        if "compileOptions {" in content:
            content = content.replace(
                "compileOptions {",
                'kotlinOptions { jvmTarget = "17" }\n    compileOptions {',
                1,
            )
        elif "android {" in content:
            content = content.replace(
                "android {",
                'android {\n    kotlinOptions { jvmTarget = "17" }',
                1,
            )
        else:
            content += '\n// CI patch\nandroid { kotlinOptions { jvmTarget = "17" } }\n'

    if content == original:
        print(f"ℹ️  {path}: no changes needed (already targeting ≤17?)")
    else:
        with open(path, "w") as f:
            f.write(content)
        print(f"✓ Patched {path}: forced Kotlin jvmTarget=17, compileOptions VERSION_17")

# ── Patch MainActivity ────────────────────────────────────────────────────────
#
# The Capacitor template generates a Java MainActivity (empty BridgeActivity subclass).
# We replace it with a Java file (NOT Kotlin) because the root build.gradle has no
# Kotlin classpath entry — any .kt file in the app module is silently skipped by the
# Java compiler, leaving the APK without a MainActivity class and causing an instant
# ActivityNotFoundException crash on launch.
#
# On Chromebook ARC the WebView IS Chrome, so Google OAuth runs directly inside the
# WebView without any Custom Tab or deep-link dance. The bridge page at
# /api/mobile-auth-bridge detects the Capacitor User-Agent and redirects straight
# to /dashboard. The onNewIntent handler below is a belt-and-suspenders fallback for
# physical Android phones where Chrome opens OAuth externally and fires the deep link.

main_activity_dir = None
for root, dirs, files in os.walk("android/app/src/main/java"):
    if "MainActivity.java" in files or "MainActivity.kt" in files:
        main_activity_dir = root
        break

if not main_activity_dir:
    print("WARNING: MainActivity not found — skipping patch")
else:
    java_root = "android/app/src/main/java/"
    pkg = main_activity_dir.replace(java_root, "").replace(os.sep, ".")

    # Remove any stale .kt that would be silently ignored and confuse the build.
    stale_kt = os.path.join(main_activity_dir, "MainActivity.kt")
    if os.path.exists(stale_kt):
        os.remove(stale_kt)
        print(f"✓ Removed stale {stale_kt}")

    main_activity_java = os.path.join(main_activity_dir, "MainActivity.java")
    content = (
        "package " + pkg + ";\n\n"
        "import android.content.Intent;\n"
        "import android.net.Uri;\n"
        "import com.getcapacitor.BridgeActivity;\n\n"
        "public class MainActivity extends BridgeActivity {\n\n"
        "    @Override\n"
        "    public void onNewIntent(Intent intent) {\n"
        "        super.onNewIntent(intent);\n"
        "        setIntent(intent);\n"
        "        handleAuthIntent(intent);\n"
        "    }\n\n"
        "    private void handleAuthIntent(Intent intent) {\n"
        "        if (intent == null) return;\n"
        "        Uri data = intent.getData();\n"
        "        if (data == null || !\"emergenthealth\".equals(data.getScheme())) return;\n"
        "        String key = data.getQueryParameter(\"key\");\n"
        "        if (key == null || key.isEmpty()) return;\n"
        "        if (bridge != null) {\n"
        "            bridge.getWebView().post(() ->\n"
        "                bridge.getWebView().loadUrl(\n"
        "                    \"https://emergenthealth.vercel.app/api/mobile-set-cookie?key=\"\n"
        "                    + Uri.encode(key)));\n"
        "        }\n"
        "    }\n"
        "}\n"
    )
    with open(main_activity_java, "w") as f:
        f.write(content)
    print(f"✓ {main_activity_java}: Java BridgeActivity with deep-link handler")
