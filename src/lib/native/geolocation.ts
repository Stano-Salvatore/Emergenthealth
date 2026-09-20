/* eslint-disable @typescript-eslint/no-explicit-any */
// Geolocation helper — uses the Capacitor Geolocation plugin inside the Android
// app (which properly prompts for the runtime permission), and falls back to the
// browser's navigator.geolocation on the web. Both return the same shape.

export type Coords = { lat: number; lon: number; accuracy?: number }

async function getCapacitor(): Promise<{ isNative: boolean; Geolocation: any | null }> {
  if (typeof window === "undefined") return { isNative: false, Geolocation: null }
  try {
    const core = await import("@capacitor/core")
    const isNative = (core as any).Capacitor?.isNativePlatform?.() === true
    if (!isNative) return { isNative: false, Geolocation: null }
    const mod = await import("@capacitor/geolocation")
    return { isNative: true, Geolocation: (mod as any).Geolocation ?? null }
  } catch {
    return { isNative: false, Geolocation: null }
  }
}

/** Whether we're running inside the native Android app. */
export async function isNativeApp(): Promise<boolean> {
  return (await getCapacitor()).isNative
}

/**
 * Has location already been granted — without asking?
 *
 * `getCurrentPosition` is the only way to READ a position and also the thing
 * that raises the permission dialog, so calling it to find out whether we may
 * call it is not an option. Native has `checkPermissions`; the web has the
 * Permissions API. Both answer without a prompt.
 *
 * Returns null when nothing can say — an old WebView, a browser that refuses
 * the query. Callers should treat null as "do not ask": the cost of being
 * wrong that way is a feature that waits for Settings, and the cost of being
 * wrong the other way is a permission dialog on a screen that never mentioned
 * location.
 *
 * This is for surfaces that run on their own — the dashboard's weather and
 * place detection. A screen the user opened *in order to* turn location on
 * should call `getCurrentPosition` directly: there, the prompt is the answer
 * to something they just asked for.
 */
export async function locationAlreadyGranted(): Promise<boolean | null> {
  const { isNative, Geolocation } = await getCapacitor()

  if (isNative && Geolocation) {
    try {
      const perm = await Geolocation.checkPermissions()
      return perm.location === "granted" || perm.coarseLocation === "granted"
    } catch {
      return null
    }
  }

  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return null
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName })
    return status.state === "granted"
  } catch {
    return null
  }
}

/**
 * Get the device's current position. Prompts for permission on native.
 * Returns null if unavailable or the user denies.
 */
export async function getCurrentPosition(): Promise<Coords | null> {
  const { isNative, Geolocation } = await getCapacitor()

  if (isNative && Geolocation) {
    try {
      const perm = await Geolocation.checkPermissions()
      if (perm.location !== "granted") {
        const req = await Geolocation.requestPermissions()
        if (req.location !== "granted") return null
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
      return { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }
    } catch {
      return null
    }
  }

  // Web fallback
  if (typeof navigator === "undefined" || !navigator.geolocation) return null
  return new Promise<Coords | null>(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  })
}
