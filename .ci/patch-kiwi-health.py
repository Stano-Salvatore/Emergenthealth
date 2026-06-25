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

# ── Patch MainActivity ────────────────────────────────────────────────────────
#
# The Capacitor template generates a Java MainActivity (empty BridgeActivity subclass).
# We replace it with a Java file (NOT Kotlin) because the root build.gradle has no
# Kotlin classpath entry — any .kt file in the app module is silently skipped by the
# Java compiler, leaving the APK without a MainActivity class and causing an instant
# ActivityNotFoundException crash on launch.
#
# OAuth flow (physical Android phone):
#   1. WebView loads /mobile-signin?auth_key=UUID — page auto-submits, NextAuth
#      redirects to accounts.google.com.
#   2. shouldOverrideUrlLoading intercepts accounts.google.com and opens a Chrome
#      Custom Tab (Google accepts Custom Tabs; it blocks plain WebView OAuth).
#   3. User completes OAuth in Chrome. Chrome loads /api/mobile-auth-bridge which
#      stores the signed session code under mobile-auth:UUID in the DB.
#   4. The polling loop running in the WebView detects {done:true} and loads
#      /api/mobile-set-cookie?key=UUID which sets the session cookie (200 + Set-Cookie)
#      and meta-refreshes to /dashboard.

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
        "import android.os.Bundle;\n"
        "import android.webkit.WebResourceRequest;\n"
        "import android.webkit.WebView;\n"
        "import androidx.browser.customtabs.CustomTabsIntent;\n"
        "import com.getcapacitor.BridgeActivity;\n"
        "import com.getcapacitor.BridgeWebViewClient;\n\n"
        "public class MainActivity extends BridgeActivity {\n\n"
        "    @Override\n"
        "    public void onCreate(Bundle savedInstanceState) {\n"
        "        super.onCreate(savedInstanceState);\n"
        "        if (bridge != null && bridge.getWebView() != null) {\n"
        "            bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {\n"
        "                @Override\n"
        "                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {\n"
        "                    Uri uri = request.getUrl();\n"
        "                    String scheme = uri.getScheme();\n"
        "                    String host = uri.getHost();\n\n"
        "                    // ehauth://open?auth_key=UUID — custom scheme fired by MobileSignInButton.\n"
        "                    // Using a non-https scheme guarantees shouldOverrideUrlLoading fires;\n"
        "                    // same-origin https navigations are skipped on some Capacitor builds.\n"
        "                    // Open Chrome Custom Tab for the FULL OAuth flow (state cookies stay in\n"
        "                    // Chrome's jar), and show /mobile-wait in the WebView for polling.\n"
        "                    if (\"ehauth\".equals(scheme) && \"open\".equals(host)) {\n"
        "                        String key = uri.getQueryParameter(\"auth_key\");\n"
        "                        if (key != null && !key.isEmpty()) {\n"
        "                            Uri signInUri = Uri.parse(\n"
        "                                \"https://emergenthealth.vercel.app/mobile-signin?auth_key=\"\n"
        "                                + Uri.encode(key));\n"
        "                            new CustomTabsIntent.Builder().build()\n"
        "                                .launchUrl(MainActivity.this, signInUri);\n"
        "                            final String k = key;\n"
        "                            view.post(() -> view.loadUrl(\n"
        "                                \"https://emergenthealth.vercel.app/mobile-wait?auth_key=\"\n"
        "                                + Uri.encode(k)));\n"
        "                        }\n"
        "                        return true;\n"
        "                    }\n\n"
        "                    // Safety net: if Google OAuth somehow reaches the WebView, open Chrome.\n"
        "                    if (\"accounts.google.com\".equals(host)\n"
        "                            || (host != null && host.endsWith(\".google.com\"))) {\n"
        "                        new CustomTabsIntent.Builder().build()\n"
        "                            .launchUrl(MainActivity.this, request.getUrl());\n"
        "                        return true;\n"
        "                    }\n\n"
        "                    return super.shouldOverrideUrlLoading(view, request);\n"
        "                }\n"
        "            });\n"
        "        }\n"
        "    }\n\n"
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
    print(f"✓ {main_activity_java}: Java BridgeActivity with Custom Tab OAuth intercept")
