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

# ── Patch MainActivity.kt ─────────────────────────────────────────────────────
#
# Two problems solved here:
#
# Problem 1: Capacitor opens accounts.google.com in Chrome (external browser).
#   OAuth state cookie lives in the WebView cookie jar; Chrome's jar is separate.
#   Fix: Override UA (removes "wv" marker) + keep *.google.com in WebView.
#
# Problem 2: When Chrome handles OAuth (because Google detects WebView despite
#   UA spoof, or the user's first install), Android App Links intercepts the
#   callback URL and opens the app — but Capacitor's BridgeActivity never
#   navigates the WebView to the callback URL.  The WebView just stays on the
#   sign-in page and the OAuth code is never exchanged.
#   Fix: Override onNewIntent() to detect /api/auth/callback/* URLs and load
#   them in the WebView.  The state cookie was set in the WebView cookie jar
#   by the original server-action POST response, so NextAuth state validation
#   still passes when the callback request is made by the WebView.

main_activity_path = None
for root, dirs, files in os.walk("android/app/src/main/java"):
    for fname in files:
        if fname == "MainActivity.kt":
            main_activity_path = os.path.join(root, fname)
            break

if not main_activity_path:
    print("WARNING: MainActivity.kt not found -- skipping Google OAuth WebView patch")
else:
    with open(main_activity_path) as f:
        ma_content = f.read()

    if "handleIntent" in ma_content:
        print("INFO: MainActivity.kt already patched for Google OAuth WebView")
    else:
        java_root = "android/app/src/main/java/"
        relative = main_activity_path.replace(java_root, "").replace("/MainActivity.kt", "")
        pkg = relative.replace("/", ".")

        patched_main = (
            "package " + pkg + "\n\n"
            "import android.content.Intent\n"
            "import android.net.Uri\n"
            "import android.os.Bundle\n"
            "import android.webkit.WebResourceRequest\n"
            "import android.webkit.WebView\n"
            "import com.getcapacitor.BridgeActivity\n"
            "import com.getcapacitor.BridgeWebViewClient\n\n"
            "class MainActivity : BridgeActivity() {\n"
            "    override fun onCreate(savedInstanceState: Bundle?) {\n"
            "        super.onCreate(savedInstanceState)\n"
            "        val wv = bridge.webView\n"
            "        wv.settings.userAgentString =\n"
            '            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +\n'
            '            "(KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"\n'
            "        wv.webViewClient = object : BridgeWebViewClient(bridge) {\n"
            "            override fun shouldOverrideUrlLoading(\n"
            "                view: WebView, request: WebResourceRequest\n"
            "            ): Boolean {\n"
            '                val host = request.url.host ?: ""\n'
            "                if (host == \"accounts.google.com\" || host.endsWith(\".google.com\")) return false\n"
            "                return super.shouldOverrideUrlLoading(view, request)\n"
            "            }\n"
            "        }\n"
            "        handleIntent(intent)\n"
            "    }\n\n"
            "    override fun onNewIntent(intent: Intent) {\n"
            "        super.onNewIntent(intent)\n"
            "        handleIntent(intent)\n"
            "    }\n\n"
            "    private fun handleIntent(intent: Intent) {\n"
            "        val data: Uri = intent.data ?: return\n"
            '        if (data.host == "emergenthealth.vercel.app") {\n'
            '            val path = data.path ?: ""\n'
            '            if (path.startsWith("/api/auth/callback")) {\n'
            "                bridge.webView.post { bridge.webView.loadUrl(data.toString()) }\n"
            "            }\n"
            "        }\n"
            "    }\n"
            "}\n"
        )

        with open(main_activity_path, "w") as f:
            f.write(patched_main)
        print("OK " + main_activity_path + ": patched for Google OAuth WebView compatibility")
