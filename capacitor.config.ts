import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.emergenthealth',
  appName: 'Emergenthealth',
  webDir: 'out',
  server: {
    url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://emergenthealth.vercel.app',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: [
      'accounts.google.com',
      '*.google.com',
      '*.googleapis.com',
    ],
  },
  plugins: {
    LocalNotifications: {
      // Without this Android has no small icon to draw and falls back to its
      // generic "!" glyph, which is what every reminder was arriving with.
      // Generated into drawable-* by .ci/generate-android-icons.mjs: the
      // brand pulse as a flat white silhouette, the only form Android accepts
      // here — it keeps the alpha channel and discards the colour.
      // Emergy, as a flat silhouette with his eyes punched out — the only
      // form Android accepts here, since it keeps the alpha and discards the
      // colour. He appears in full colour as each notification's large icon;
      // see largeIcon in src/lib/native/notifications.ts.
      smallIcon: 'ic_stat_emergy',
      // Tints the icon in the shade — Emergy's own amber rather than the
      // app's indigo, so the two icons read as one character.
      iconColor: '#f59e0b',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: '#09090f',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    // chrome://inspect over USB is the only window into the WebView's console,
    // and with this off the WebView refuses to be inspected at all — which is
    // how "notifications don't work" stayed undiagnosable for weeks.
    //
    // It stays off by default all the same. The published APK is a public
    // download and this app holds health data and a live session: anyone with
    // the phone and USB debugging could read both out of an inspectable
    // WebView. Build with ANDROID_DEBUG_WEBVIEW=1 when a device genuinely
    // needs inspecting.
    webContentsDebuggingEnabled: process.env.ANDROID_DEBUG_WEBVIEW === '1',
    appendUserAgent: 'Emergenthealth-Capacitor',
  },
}

export default config
