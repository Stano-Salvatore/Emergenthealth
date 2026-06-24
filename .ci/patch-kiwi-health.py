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

# ── Add androidx.browser for Chrome Custom Tabs ───────────────────────────────
app_build_gradle_path = "android/app/build.gradle"
with open(app_build_gradle_path) as f:
    bg_content = f.read()

if "androidx.browser" not in bg_content:
    bg_content = bg_content.replace(
        "dependencies {",
        "dependencies {\n    implementation 'androidx.browser:browser:1.8.0'",
        1,
    )
    with open(app_build_gradle_path, "w") as f:
        f.write(bg_content)
    print("✓ Added androidx.browser:browser:1.8.0 for Chrome Custom Tabs")
else:
    print("ℹ️  androidx.browser already in build.gradle")

# ── Patch MainActivity.kt ─────────────────────────────────────────────────────
#
# OAuth strategy: Chrome Custom Tabs + App Links
#
# Why not WebView OAuth?
#   Google detects Android WebView (via window.chrome absence and other APIs)
#   and blocks the sign-in flow even when the User-Agent "wv" marker is removed.
#
# Why not plain Chrome?
#   Chrome does NOT fire Android App Links for server-side 3xx redirects that
#   happen within an existing browser session (the OAuth callback redirect is
#   a 302 that Chrome follows internally, so the app never receives the URL).
#
# Why Custom Tabs works:
#   Chrome Custom Tabs DO fire App Links when the navigation target matches a
#   verified App Link, including while following server-side redirects.
#   When Google redirects to emergenthealth.vercel.app/api/auth/callback/google,
#   Android intercepts the URL before Chrome loads it, opens the app via
#   onNewIntent(), and we load it in the WebView to complete the NextAuth flow.
#   Google accepts Custom Tabs for OAuth (it's an embedded Chrome, not a WebView).

main_activity_path = None
for root, dirs, files in os.walk("android/app/src/main/java"):
    for fname in files:
        if fname == "MainActivity.kt":
            main_activity_path = os.path.join(root, fname)
            break

if not main_activity_path:
    print("WARNING: MainActivity.kt not found -- skipping Google OAuth patch")
else:
    with open(main_activity_path) as f:
        ma_content = f.read()

    # Always rewrite MainActivity.kt so we get the latest OAuth architecture
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
        "import androidx.browser.customtabs.CustomTabsIntent\n"
        "import com.getcapacitor.BridgeActivity\n"
        "import com.getcapacitor.BridgeWebViewClient\n"
        "import java.util.UUID\n\n"
        "class MainActivity : BridgeActivity() {\n"
        "    // UUID generated before opening Chrome Custom Tab.\n"
        "    // The server stores the signed session code under this key;\n"
        "    // onResume() redeems it without needing a deep-link callback.\n"
        "    private var pendingAuthKey: String? = null\n\n"
        "    override fun onCreate(savedInstanceState: Bundle?) {\n"
        "        super.onCreate(savedInstanceState)\n"
        "        bridge.webView.webViewClient = object : BridgeWebViewClient(bridge) {\n"
        "            override fun shouldOverrideUrlLoading(\n"
        "                view: WebView, request: WebResourceRequest\n"
        "            ): Boolean {\n"
        '                val host = request.url.host ?: ""\n'
        '                val path = request.url.path ?: ""\n'
        '                if (path == "/mobile-signin") {\n'
        "                    // Generate a UUID key, attach it to the URL so the bridge\n"
        "                    // can store the code under that key in the database.\n"
        '                    val key = UUID.randomUUID().toString()\n'
        '                    pendingAuthKey = key\n'
        '                    val urlWithKey = request.url.buildUpon()\n'
        '                        .appendQueryParameter("auth_key", key).build()\n'
        "                    CustomTabsIntent.Builder().build()\n"
        "                        .launchUrl(this@MainActivity, urlWithKey)\n"
        "                    return true\n"
        "                }\n"
        "                if (host == \"accounts.google.com\" || host.endsWith(\".google.com\")) {\n"
        "                    CustomTabsIntent.Builder().build()\n"
        "                        .launchUrl(this@MainActivity, request.url)\n"
        "                    return true\n"
        "                }\n"
        "                return super.shouldOverrideUrlLoading(view, request)\n"
        "            }\n"
        "        }\n"
        "        handleIntent(intent)\n"
        "    }\n\n"
        "    // Called when Chrome Custom Tab fires an intent URI back to the app.\n"
        "    // If Chrome blocks the intent URI, onResume() handles it instead.\n"
        "    override fun onNewIntent(intent: Intent) {\n"
        "        super.onNewIntent(intent)\n"
        "        handleIntent(intent)\n"
        "    }\n\n"
        "    // Fallback: fired whenever the app comes to the foreground.\n"
        "    // If Chrome blocked the intent URI, pendingAuthKey is still set here\n"
        "    // and we load the redeem endpoint directly — no deep link needed.\n"
        "    override fun onResume() {\n"
        "        super.onResume()\n"
        "        val key = pendingAuthKey ?: return\n"
        "        pendingAuthKey = null\n"
        "        bridge?.webView?.post {\n"
        "            bridge?.webView?.loadUrl(\n"
        '                "https://emergenthealth.vercel.app/api/mobile-redeem?key=" +\n'
        "                Uri.encode(key)\n"
        "            )\n"
        "        }\n"
        "    }\n\n"
        "    private fun handleIntent(intent: Intent) {\n"
        "        val data: Uri = intent.data ?: return\n"
        "\n"
        '        if (data.scheme == "emergenthealth" && data.host == "auth") {\n'
        "            // New: key-based redemption (code stored server-side by bridge)\n"
        '            val key = data.getQueryParameter("key")\n'
        "            if (key != null) {\n"
        "                pendingAuthKey = null\n"
        "                bridge?.webView?.post {\n"
        "                    bridge?.webView?.loadUrl(\n"
        '                        "https://emergenthealth.vercel.app/api/mobile-redeem?key=" +\n'
        "                        Uri.encode(key)\n"
        "                    )\n"
        "                }\n"
        "                return\n"
        "            }\n"
        "            // Legacy: code-in-URL (kept for backward compat with old APK builds)\n"
        '            val code = data.getQueryParameter("code") ?: return\n'
        "            pendingAuthKey = null\n"
        "            bridge?.webView?.post {\n"
        "                bridge?.webView?.loadUrl(\n"
        '                    "https://emergenthealth.vercel.app/api/mobile-exchange?code=" +\n'
        "                    Uri.encode(code)\n"
        "                )\n"
        "            }\n"
        "            return\n"
        "        }\n"
        "\n"
        '        if (data.host == "emergenthealth.vercel.app") {\n'
        '            val path = data.path ?: ""\n'
        '            if (path.startsWith("/api/auth/callback")) {\n'
        "                bridge?.webView?.post { bridge?.webView?.loadUrl(data.toString()) }\n"
        "            }\n"
        "        }\n"
        "    }\n"
        "}\n"
    )

    with open(main_activity_path, "w") as f:
        f.write(patched_main)
    print("OK " + main_activity_path + ": patched for polling-based OAuth (no deep link required)")
