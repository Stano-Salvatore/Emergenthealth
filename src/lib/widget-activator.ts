/**
 * Stores the widget API key + app URL so the native Android widgets
 * (AppWidgetProviders) can read them. Capacitor's Preferences plugin writes to
 * the "CapacitorStorage" SharedPreferences file — exactly where the widgets look.
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

function capacitor(): any {
  return typeof window !== "undefined" ? (window as any).Capacitor : undefined
}

export async function activateWidget(apiKey: string, appUrl: string): Promise<void> {
  const cap = capacitor()
  if (cap?.isNativePlatform?.()) {
    try {
      const { Preferences } = await import("@capacitor/preferences")
      await Preferences.set({ key: "widget_api_key", value: apiKey })
      await Preferences.set({ key: "widget_app_url", value: appUrl })
      pokeWidgets()
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

/** What the widgets currently hold, or nulls. */
async function readStoredCreds(): Promise<{ key: string | null; url: string | null }> {
  const cap = capacitor()
  if (cap?.isNativePlatform?.()) {
    try {
      const { Preferences } = await import("@capacitor/preferences")
      const [key, url] = await Promise.all([
        Preferences.get({ key: "widget_api_key" }),
        Preferences.get({ key: "widget_app_url" }),
      ])
      return { key: key.value ?? null, url: url.value ?? null }
    } catch {
      return { key: null, url: null }
    }
  }
  try {
    return {
      key: localStorage.getItem("widget_api_key"),
      url: localStorage.getItem("widget_app_url"),
    }
  } catch {
    return { key: null, url: null }
  }
}

/**
 * Asks the native side to redraw every placed widget straight away, so an
 * activation shows up on the home screen instead of waiting for the next
 * update tick. Absent on older APKs — a missing bridge is not an error.
 */
export function pokeWidgets(): void {
  try {
    ;(window as any).EhWidgets?.refresh?.()
  } catch {
    // Bridge not present in this build.
  }
}

/**
 * Make the home-screen widgets work without anyone remembering to press a
 * button in Settings.
 *
 * Four widgets read `widget_api_key` + `widget_app_url` out of SharedPreferences.
 * Those were only ever written by Settings → Android Widget → Activate, so a
 * fresh install, a cleared app storage, or simply never finding that screen left
 * every widget showing "Set up in the app" forever — which is exactly what
 * happened. Running this on app start keeps the stored pair in sync with the
 * server's key, mints one on first run, and re-heals after a regeneration.
 *
 * Returns what it did, for the Settings panel to report.
 */
export async function ensureWidgetActivation(): Promise<"synced" | "unchanged" | "failed"> {
  try {
    const res = await fetch("/api/widget/key")
    if (!res.ok) return "failed"
    let key: string | null = (await res.json())?.key ?? null

    if (!key) {
      // No key on the account yet: mint one. The widgets are a core surface of
      // the Android app, and a credential the user never has to see is a better
      // trade than four dead widgets waiting on a setup step.
      const made = await fetch("/api/widget/key", { method: "POST" })
      if (!made.ok) return "failed"
      key = (await made.json())?.key ?? null
    }
    if (!key) return "failed"

    const appUrl = window.location.origin
    const stored = await readStoredCreds()
    if (stored.key === key && stored.url === appUrl) return "unchanged"

    await activateWidget(key, appUrl)
    return "synced"
  } catch {
    return "failed"
  }
}
