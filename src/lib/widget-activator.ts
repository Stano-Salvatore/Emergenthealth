/**
 * Stores the widget API key + app URL so the native Android QuickLogWidget
 * (an AppWidgetProvider) can read them. Capacitor's Preferences plugin writes to
 * the "CapacitorStorage" SharedPreferences file — exactly where the widget looks.
 *
 * On web / non-native it falls back to localStorage so the flow is testable.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function isCapacitorAndroid(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as any).Capacitor?.getPlatform?.() === "android"
  )
}

export async function activateWidget(apiKey: string, appUrl: string): Promise<void> {
  const cap = typeof window !== "undefined" ? (window as any).Capacitor : undefined
  if (cap?.isNativePlatform?.()) {
    try {
      const { Preferences } = await import("@capacitor/preferences")
      await Preferences.set({ key: "widget_api_key", value: apiKey })
      await Preferences.set({ key: "widget_app_url", value: appUrl })
      return
    } catch {
      // Fall through to localStorage fallback.
    }
  }

  try {
    localStorage.setItem("widget_api_key", apiKey)
    localStorage.setItem("widget_app_url", appUrl)
  } catch {
    // Storage unavailable — nothing we can do.
  }
}
