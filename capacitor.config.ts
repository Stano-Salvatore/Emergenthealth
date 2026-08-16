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
    // how "notifications don't work" stayed undiagnosable for weeks. The app
    // is sideloaded onto our own phones and inspection still requires USB
    // debugging to be enabled on the device, so the exposure is acceptable.
    webContentsDebuggingEnabled: true,
    appendUserAgent: 'Emergenthealth-Capacitor',
  },
}

export default config
