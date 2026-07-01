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
#   1. JS calls EhAuthBridge.openSignIn(key) — stores key in mPendingAuthKey,
#      opens Chrome Custom Tab at /mobile-signin?auth_key=UUID.
#   2. Chrome Custom Tab handles Google OAuth (Google blocks plain WebView OAuth).
#   3. After OAuth, Auth.js redirects Chrome to /dashboard (not to the bridge route).
#   4. onResume() fires when app returns to foreground (Chrome tab closes or user
#      switches back). redeemPendingAuthKey() loads /api/mobile-set-cookie?key=UUID
#      in the native WebView, which sets the session cookie (200 + Set-Cookie) and
#      JS-redirects to /dashboard.

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
        "import android.webkit.JavascriptInterface;\n"
        "import android.webkit.WebResourceRequest;\n"
        "import android.webkit.WebSettings;\n"
        "import android.webkit.WebView;\n"
        "import androidx.browser.customtabs.CustomTabsIntent;\n"
        "import com.getcapacitor.BridgeActivity;\n"
        "import com.getcapacitor.BridgeWebViewClient;\n\n"
        "public class MainActivity extends BridgeActivity {\n\n"
        "    private boolean bridgeSetUp = false;\n"
        "    // Set by openSignIn(); redeemed in onResume() once app returns to foreground.\n"
        "    private volatile String mPendingAuthKey = null;\n\n"
        "    private class EhAuthBridge {\n"
        "        @JavascriptInterface\n"
        "        public void openSignIn(final String key) {\n"
        "            if (key == null || key.isEmpty()) return;\n"
        "            mPendingAuthKey = key;\n"
        "            runOnUiThread(new Runnable() {\n"
        "                @Override public void run() {\n"
        "                    Uri signInUri = Uri.parse(\n"
        "                        \"https://emergenthealth.vercel.app/mobile-signin?auth_key=\"\n"
        "                        + Uri.encode(key));\n"
        "                    new CustomTabsIntent.Builder().build()\n"
        "                        .launchUrl(MainActivity.this, signInUri);\n"
        "                    try {\n"
        "                        bridge.getWebView().loadUrl(\n"
        "                            \"https://emergenthealth.vercel.app/mobile-wait?auth_key=\"\n"
        "                            + Uri.encode(key));\n"
        "                    } catch (Exception ignored) {}\n"
        "                }\n"
        "            });\n"
        "        }\n"
        "    }\n\n"
        "    // Screen-time bridge — reads UsageStatsManager. Requires the user to grant\n"
        "    // Usage Access (special permission) via openSettings(). All methods are\n"
        "    // fully qualified to avoid touching the import block.\n"
        "    private class EhUsage {\n"
        "        @JavascriptInterface\n"
        "        public boolean hasPermission() {\n"
        "            try {\n"
        "                android.app.AppOpsManager appOps = (android.app.AppOpsManager) getSystemService(android.content.Context.APP_OPS_SERVICE);\n"
        "                int mode = appOps.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), getPackageName());\n"
        "                return mode == android.app.AppOpsManager.MODE_ALLOWED;\n"
        "            } catch (Exception e) { return false; }\n"
        "        }\n\n"
        "        @JavascriptInterface\n"
        "        public void openSettings() {\n"
        "            try {\n"
        "                Intent intent = new Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS);\n"
        "                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);\n"
        "                startActivity(intent);\n"
        "            } catch (Exception ignored) {}\n"
        "        }\n\n"
        "        @JavascriptInterface\n"
        "        public String getToday() {\n"
        "            try {\n"
        "                android.app.usage.UsageStatsManager usm = (android.app.usage.UsageStatsManager) getSystemService(android.content.Context.USAGE_STATS_SERVICE);\n"
        "                if (usm == null) return \"{\\\"hasPermission\\\":false}\";\n"
        "                java.util.Calendar cal = java.util.Calendar.getInstance();\n"
        "                cal.set(java.util.Calendar.HOUR_OF_DAY, 0);\n"
        "                cal.set(java.util.Calendar.MINUTE, 0);\n"
        "                cal.set(java.util.Calendar.SECOND, 0);\n"
        "                cal.set(java.util.Calendar.MILLISECOND, 0);\n"
        "                long start = cal.getTimeInMillis();\n"
        "                long end = System.currentTimeMillis();\n"
        "                android.app.usage.UsageEvents events = usm.queryEvents(start, end);\n"
        "                long totalMs = 0; long lastFg = -1; long firstFg = -1;\n"
        "                android.app.usage.UsageEvents.Event ev = new android.app.usage.UsageEvents.Event();\n"
        "                while (events != null && events.hasNextEvent()) {\n"
        "                    events.getNextEvent(ev);\n"
        "                    int t = ev.getEventType();\n"
        "                    if (t == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND) {\n"
        "                        lastFg = ev.getTimeStamp();\n"
        "                        if (firstFg < 0) firstFg = ev.getTimeStamp();\n"
        "                    } else if (t == android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND) {\n"
        "                        if (lastFg > 0) { totalMs += (ev.getTimeStamp() - lastFg); lastFg = -1; }\n"
        "                    }\n"
        "                }\n"
        "                if (lastFg > 0) totalMs += (end - lastFg);\n"
        "                int totalMin = (int)(totalMs / 60000);\n"
        "                int firstMin = firstFg > 0 ? (int)((firstFg - start) / 60000) : -1;\n"
        "                return \"{\\\"hasPermission\\\":\" + hasPermission() + \",\\\"totalMin\\\":\" + totalMin + \",\\\"firstUnlockMin\\\":\" + firstMin + \"}\";\n"
        "            } catch (Exception e) { return \"{\\\"hasPermission\\\":false}\"; }\n"
        "        }\n"
        "    }\n\n"
        "    private void setupBridgeHooks() {\n"
        "        if (bridgeSetUp) return;\n"
        "        try {\n"
        "            WebView wv = bridge.getWebView();\n"
        "            if (wv == null) return;\n"
        "            wv.addJavascriptInterface(new EhAuthBridge(), \"EhAuthBridge\");\n"
        "            wv.addJavascriptInterface(new EhUsage(), \"EhUsage\");\n"
        "            wv.setWebViewClient(new BridgeWebViewClient(bridge) {\n"
        "                @Override\n"
        "                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {\n"
        "                    Uri uri = request.getUrl();\n"
        "                    String host = uri.getHost();\n\n"
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
        "            bridgeSetUp = true;\n"
        "        } catch (Exception ignored) {}\n"
        "    }\n\n"
        "    // Called from onResume(). Loads /api/mobile-set-cookie in the WebView so\n"
        "    // the session cookie is planted the moment the app returns to the foreground\n"
        "    // after Chrome Custom Tab OAuth completes — regardless of whether the\n"
        "    // intent:// URI fired or the user simply closed the Chrome tab manually.\n"
        "    private void redeemPendingAuthKey() {\n"
        "        if (mPendingAuthKey == null) return;\n"
        "        WebView wv;\n"
        "        try { wv = bridge.getWebView(); } catch (Exception e) { return; }\n"
        "        if (wv == null) return;\n"
        "        final String key = mPendingAuthKey;\n"
        "        mPendingAuthKey = null;\n"
        "        wv.post(new Runnable() {\n"
        "            @Override public void run() {\n"
        "                wv.loadUrl(\n"
        "                    \"https://emergenthealth.vercel.app/api/mobile-set-cookie?key=\"\n"
        "                    + Uri.encode(key));\n"
        "            }\n"
        "        });\n"
        "    }\n\n"
        "    @Override\n"
        "    public void onCreate(Bundle savedInstanceState) {\n"
        "        super.onCreate(savedInstanceState);\n"
        "        setupBridgeHooks();\n"
        "        configureWebViewViewport();\n"
        "    }\n\n"
        "    // The web app scales its layout via the viewport <meta> tag (width=N) instead\n"
        "    // of CSS zoom, to avoid a WebView bug where CSS zoom<1 on a tall page paints\n"
        "    // part of the screen black. That only visually scales the page down (instead of\n"
        "    // just widening the layout and requiring horizontal scroll) if the WebView has\n"
        "    // wide-viewport + overview-mode enabled — off by default on Capacitor's WebView.\n"
        "    private void configureWebViewViewport() {\n"
        "        try {\n"
        "            WebView wv = bridge.getWebView();\n"
        "            if (wv == null) return;\n"
        "            WebSettings ws = wv.getSettings();\n"
        "            ws.setUseWideViewPort(true);\n"
        "            ws.setLoadWithOverviewMode(true);\n"
        "        } catch (Exception ignored) {}\n"
        "    }\n\n"
        "    @Override\n"
        "    public void onStart() {\n"
        "        super.onStart();\n"
        "        setupBridgeHooks();\n"
        "    }\n\n"
        "    @Override\n"
        "    public void onResume() {\n"
        "        super.onResume();\n"
        "        setupBridgeHooks();\n"
        "        redeemPendingAuthKey();\n"
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
        "        mPendingAuthKey = null;\n"
        "        try {\n"
        "            bridge.getWebView().post(new Runnable() {\n"
        "                @Override public void run() {\n"
        "                    bridge.getWebView().loadUrl(\n"
        "                        \"https://emergenthealth.vercel.app/api/mobile-set-cookie?key=\"\n"
        "                        + Uri.encode(key));\n"
        "                }\n"
        "            });\n"
        "        } catch (Exception ignored) {}\n"
        "    }\n"
        "}\n"
    )
    with open(main_activity_java, "w") as f:
        f.write(content)
    print(f"✓ {main_activity_java}: Java BridgeActivity with Custom Tab OAuth intercept")
