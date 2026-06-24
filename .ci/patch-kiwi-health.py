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

# Look for MainActivity.kt first; fall back to the directory containing MainActivity.java
# (customize-android.py writes .java; we must replace it with .kt before compiling)
main_activity_path = None
main_activity_dir = None
for root, dirs, files in os.walk("android/app/src/main/java"):
    if "MainActivity.kt" in files:
        main_activity_path = os.path.join(root, "MainActivity.kt")
        main_activity_dir = root
        break
    if "MainActivity.java" in files and main_activity_dir is None:
        main_activity_dir = root

if main_activity_dir and not main_activity_path:
    # Found package dir via .java — set path where we'll write the .kt
    main_activity_path = os.path.join(main_activity_dir, "MainActivity.kt")

if not main_activity_path:
    print("WARNING: MainActivity not found -- skipping Google OAuth patch")
else:
    # Always rewrite MainActivity.kt so we get the latest OAuth architecture.
    # Remove any MainActivity.java written by customize-android.py first —
    # having both .java and .kt for the same class is a compile error.
    java_root = "android/app/src/main/java/"
    relative = os.path.dirname(main_activity_path).replace(java_root, "")
    pkg = relative.replace(os.sep, ".")
    java_counterpart = main_activity_path.replace("MainActivity.kt", "MainActivity.java")
    if os.path.exists(java_counterpart):
        os.remove(java_counterpart)
        print(f"✓ Removed {java_counterpart} (superseded by Kotlin version)")

    patched_main = (
        "package " + pkg + "\n\n"
        "import android.content.Intent\n"
        "import android.graphics.Bitmap\n"
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
        "        // Null-safe: bridge and webView may not be ready until after super.onCreate.\n"
        "        val _b = bridge\n"
        "        val _wv = _b?.webView\n"
        "        if (_b != null && _wv != null) {\n"
        "        _wv.webViewClient = object : BridgeWebViewClient(_b) {\n"
        "            override fun shouldOverrideUrlLoading(\n"
        "                view: WebView, request: WebResourceRequest\n"
        "            ): Boolean {\n"
        '                val host = request.url.host ?: ""\n'
        '                val path = request.url.path ?: ""\n'
        '                if (path == "/mobile-signin") {\n'
        "                    // Re-use an auth_key already embedded by the JS button;\n"
        "                    // only generate a fresh UUID when the URL has none.\n"
        '                    val existing = request.url.getQueryParameter("auth_key")\n'
        '                    val key = existing ?: UUID.randomUUID().toString()\n'
        '                    pendingAuthKey = key\n'
        '                    android.util.Log.d("EH_AUTH", "intercept /mobile-signin key=$key (reused=${existing != null})")\n'
        '                    val urlWithKey = if (existing != null) request.url\n'
        '                        else request.url.buildUpon().appendQueryParameter("auth_key", key).build()\n'
        "                    CustomTabsIntent.Builder().build()\n"
        "                        .launchUrl(this@MainActivity, urlWithKey)\n"
        "                    return true\n"
        "                }\n"
        "                if (host == \"accounts.google.com\" || host.endsWith(\".google.com\")) {\n"
        "                    if (pendingAuthKey == null) {\n"
        '                        val key = UUID.randomUUID().toString()\n'
        '                        pendingAuthKey = key\n'
        '                        android.util.Log.d("EH_AUTH", "google intercept no-key, rerouting key=$key")\n'
        '                        val mobileSigninUrl = Uri.parse("https://emergenthealth.vercel.app/mobile-signin")\n'
        '                            .buildUpon().appendQueryParameter("auth_key", key).build()\n'
        "                        CustomTabsIntent.Builder().build()\n"
        "                            .launchUrl(this@MainActivity, mobileSigninUrl)\n"
        "                    } else {\n"
        '                        android.util.Log.d("EH_AUTH", "google intercept key=$pendingAuthKey")\n'
        "                        CustomTabsIntent.Builder().build()\n"
        "                            .launchUrl(this@MainActivity, request.url)\n"
        "                    }\n"
        "                    return true\n"
        "                }\n"
        "                return super.shouldOverrideUrlLoading(view, request)\n"
        "            }\n"
        "\n"
        "            // Clear pendingAuthKey once /dashboard is successfully loading so\n"
        "            // a later onResume() does not attempt a redundant redeem.\n"
        "            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {\n"
        "                super.onPageStarted(view, url, favicon)\n"
        '                if (url != null && Uri.parse(url).path?.startsWith("/dashboard") == true) {\n'
        '                    android.util.Log.d("EH_AUTH", "dashboard loaded, clearing pendingAuthKey")\n'
        "                    pendingAuthKey = null\n"
        "                }\n"
        "            }\n"
        "        } // close webViewClient object\n"
        "        } // close null check\n"
        "        handleIntent(intent)\n"
        "    }\n\n"
        "    // Called when Chrome Custom Tab fires an intent URI back to the app.\n"
        "    // If Chrome blocks the intent URI, onResume() handles it instead.\n"
        "    override fun onNewIntent(intent: Intent) {\n"
        "        super.onNewIntent(intent)\n"
        "        handleIntent(intent)\n"
        "    }\n\n"
        "    // Fired when the Chrome Custom Tab closes and the app returns to foreground.\n"
        "    // Does NOT clear pendingAuthKey before calling redeemKey so that if this\n"
        "    // fires prematurely (before OAuth completes) the next onResume() can retry.\n"
        "    // pendingAuthKey is cleared by onPageStarted when /dashboard loads.\n"
        "    override fun onResume() {\n"
        "        super.onResume()\n"
        "        val key = pendingAuthKey ?: return\n"
        '        android.util.Log.d("EH_AUTH", "onResume: redeeming key=$key")\n'
        "        redeemKey(key)\n"
        "    }\n\n"
        "    // Load /api/mobile-set-cookie in the WebView. The server validates the key,\n"
        "    // then responds 200 + Set-Cookie so the WebView stores the session cookie\n"
        "    // natively (Android WebView drops Set-Cookie from 302 redirects but honours\n"
        "    // it in 200 responses). The page body meta-refreshes to /dashboard.\n"
        "    private fun redeemKey(key: String) {\n"
        '        android.util.Log.d("EH_AUTH", "redeemKey -> /api/mobile-set-cookie key=$key")\n'
        "        runOnUiThread {\n"
        "            bridge?.webView?.loadUrl(\n"
        '                "https://emergenthealth.vercel.app/api/mobile-set-cookie?key=" + Uri.encode(key)\n'
        "            )\n"
        "        }\n"
        "    }\n\n"
        "    private fun handleIntent(intent: Intent) {\n"
        "        val data: Uri = intent.data ?: return\n"
        "\n"
        '        if (data.scheme == "emergenthealth" && data.host == "auth") {\n'
        '            val key = data.getQueryParameter("key")\n'
        "            if (key != null) {\n"
        "                pendingAuthKey = null\n"
        '                android.util.Log.d("EH_AUTH", "handleIntent key=$key")\n'
        "                redeemKey(key)\n"
        "                return\n"
        "            }\n"
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
