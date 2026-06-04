/**
 * WidgetActivator.ts
 *
 * Stores the widget API key and app URL so the Android QuickLogWidget
 * (a native AppWidgetProvider) can read them from SharedPreferences.
 *
 * Capacitor's Preferences plugin writes to the "CapacitorStorage" SharedPreferences
 * file, which is exactly where the Kotlin widget code looks.
 */

export function isCapacitorAndroid(): boolean {
  return (
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Capacitor?.platform === "android"
  )
}

/**
 * Persists `apiKey` and `appUrl` so the Android home-screen widget can read them.
 *
 * On Android (native Capacitor): uses `@capacitor/preferences` — values land in
 * the "CapacitorStorage" SharedPreferences file that QuickLogWidget reads.
 *
 * On web / iOS / dev server: falls back to localStorage for easy testing.
 */
export async function activateWidget(apiKey: string, appUrl: string): Promise<void> {
  if (
    isCapacitorAndroid() &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (window as any).Capacitor?.isNativePlatform === "function" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Capacitor.isNativePlatform()
  ) {
    try {
      // Dynamically import so the bundle doesn't break on web if the package
      // isn't installed yet.
      const { Preferences } = await import("@capacitor/preferences")
      await Preferences.set({ key: "widget_api_key", value: apiKey })
      await Preferences.set({ key: "widget_app_url", value: appUrl })
      return
    } catch {
      // Fall through to localStorage fallback
    }
  }

  // Web / non-native fallback — useful for local testing
  try {
    localStorage.setItem("widget_api_key", apiKey)
    localStorage.setItem("widget_app_url", appUrl)
  } catch {
    // Storage unavailable — nothing we can do
  }
}
