/* eslint-disable @typescript-eslint/no-explicit-any */
// Background location, so being somewhere is enough to log it.
//
// Everything downstream already exists: LocationPoint rows feed detectDwells,
// which feeds the place-checkins cron, which writes a check-in when you have
// been inside a saved place long enough. The only missing piece was a supply of
// points without a second app running — that is what this is.
//
// Android only, and only inside the native shell. On the web every function
// here is a no-op that reports "unavailable", so the settings card can say so
// rather than offering a switch that does nothing.

import { Preferences } from "@capacitor/preferences"

const ENABLED_KEY = "backgroundLocationEnabled"
/**
 * The live watcher's id, kept on disk rather than only in module state.
 *
 * The watcher lives in the Android process; this module's state does not. A
 * reload of the webview resets `watcherId` to null while the service keeps
 * running, and adding another watcher would then mean two notifications and
 * two copies of every point. Persisting the id lets a fresh JS context clear
 * the old one first.
 */
const WATCHER_KEY = "backgroundLocationWatcherId"

/**
 * Deliver every fix the OS produces rather than filtering by distance.
 *
 * A distance filter looks like the obvious battery saving, and it quietly
 * breaks the feature: a visit is only recorded if there are points at least
 * MIN_DWELL_MIN apart inside the place (see lib/place-visits), and sitting
 * still moves you zero metres. Filter by distance and an afternoon in the
 * garden produces one point and no visit — precisely the case this is for.
 *
 * So the filtering happens below instead, on time, where it can guarantee the
 * cadence the dwell detector needs.
 */
const DISTANCE_FILTER_M = 0

/**
 * At most one point every five minutes while you stay put. A 20-minute dwell
 * therefore lands four or five points, comfortably clear of the threshold, and
 * a day of tracking is a few hundred rows rather than a few thousand.
 */
const MIN_UPLOAD_GAP_MS = 5 * 60 * 1000

/** Moving this far uploads immediately, so a journey is a line and not two dots. */
const MOVED_FAR_M = 200

/** Points wait this long for company before going up on their own. */
const FLUSH_DELAY_MS = 20 * 1000

interface Point {
  lat: number
  lng: number
  trackedAt: string
  accuracyM: number | null
  altitudeM: number | null
  speedKmh: number | null
}

let watcherId: string | null = null
let queue: Point[] = []
let lastSent: { lat: number; lng: number; at: number } | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const la1 = (aLat * Math.PI) / 180
  const la2 = (bLat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

async function loadPlugin(): Promise<any | null> {
  if (typeof window === "undefined") return null
  try {
    const core = await import("@capacitor/core")
    if ((core as any).Capacitor?.isNativePlatform?.() !== true) return null
    const mod = await import("@capacitor-community/background-geolocation")
    return (mod as any).BackgroundGeolocation ?? (mod as any).default ?? null
  } catch {
    return null
  }
}

/** Whether this build can track at all — false on the web. */
export async function isBackgroundLocationAvailable(): Promise<boolean> {
  return (await loadPlugin()) !== null
}

async function flush(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (queue.length === 0) return

  const batch = queue
  queue = []
  try {
    const res = await fetch("/api/location/points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: batch }),
    })
    // A rejected batch is gone: ids are derived from time and position, so a
    // point that never arrives is a gap, not a duplicate risk. Put it back and
    // let the next fix carry it — but cap the backlog so a long offline stretch
    // can't grow without limit.
    if (!res.ok) queue = [...batch, ...queue].slice(-200)
  } catch {
    queue = [...batch, ...queue].slice(-200)
  }
}

function enqueue(location: any): void {
  const at = typeof location.time === "number" ? location.time : Date.now()
  const lat = location.latitude
  const lng = location.longitude
  if (typeof lat !== "number" || typeof lng !== "number") return

  const movedFar = lastSent
    ? metresBetween(lastSent.lat, lastSent.lng, lat, lng) >= MOVED_FAR_M
    : true
  const dueByTime = !lastSent || at - lastSent.at >= MIN_UPLOAD_GAP_MS
  if (!movedFar && !dueByTime) return

  lastSent = { lat, lng, at }
  queue.push({
    lat,
    lng,
    trackedAt: new Date(at).toISOString(),
    accuracyM: typeof location.accuracy === "number" ? Math.round(location.accuracy) : null,
    altitudeM: typeof location.altitude === "number" ? location.altitude : null,
    // The plugin reports metres per second; everything downstream stores km/h.
    speedKmh: typeof location.speed === "number" ? location.speed * 3.6 : null,
  })

  // Give a moving device a moment to produce its next fix so a journey uploads
  // as one request instead of one per point.
  flushTimer ??= setTimeout(() => { void flush() }, FLUSH_DELAY_MS)
}

/**
 * Start tracking. Returns false when the plugin is unavailable or the user
 * declines the permission — the caller shows the reason rather than leaving a
 * switch that flipped on and did nothing.
 */
export async function startBackgroundLocation(): Promise<boolean> {
  const plugin = await loadPlugin()
  if (!plugin) return false
  if (watcherId) return true

  try {
    // Clear a watcher left behind by a previous JS context before adding ours.
    const { value: stale } = await Preferences.get({ key: WATCHER_KEY })
    if (stale) await plugin.removeWatcher({ id: stale }).catch(() => {})

    const id: string = await plugin.addWatcher(
      {
        // Naming the message is what makes this a background watcher at all:
        // without it the plugin only guarantees updates in the foreground.
        // Android shows it as a persistent notification, which is also the
        // honest thing — the tracking is visible the whole time it runs.
        backgroundTitle: "Emergy is following along",
        backgroundMessage: "Logging the places you spend time at",
        requestPermissions: true,
        stale: false,
        distanceFilter: DISTANCE_FILTER_M,
      },
      (location?: any, error?: any) => {
        if (error) {
          // NOT_AUTHORIZED means the permission was refused outright; there is
          // nothing to retry, so stop rather than hold a dead watcher open.
          if (error.code === "NOT_AUTHORIZED") void stopBackgroundLocation()
          return
        }
        if (location) enqueue(location)
      },
    )
    watcherId = id
    await Preferences.set({ key: WATCHER_KEY, value: id })
    await Preferences.set({ key: ENABLED_KEY, value: "1" })
    return true
  } catch {
    watcherId = null
    return false
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  await Preferences.set({ key: ENABLED_KEY, value: "0" }).catch(() => {})
  const plugin = await loadPlugin()
  // Prefer this context's id, but fall back to the stored one — after a reload
  // that is the only handle on the watcher still running.
  const stored = await Preferences.get({ key: WATCHER_KEY }).then(r => r.value).catch(() => null)
  const id = watcherId ?? stored
  if (plugin && id) {
    await plugin.removeWatcher({ id }).catch(() => {})
  }
  await Preferences.remove({ key: WATCHER_KEY }).catch(() => {})
  watcherId = null
  lastSent = null
  await flush()
}

/** Whether the user has turned this on, whatever the watcher is doing now. */
export async function isBackgroundLocationEnabled(): Promise<boolean> {
  try {
    const { value } = await Preferences.get({ key: ENABLED_KEY })
    return value === "1"
  } catch {
    return false
  }
}

/**
 * Re-attach the watcher on app start if it was on when the app last closed.
 * Android drops the foreground service on reboot and cannot legally start one
 * from the background, so the app opening is the moment tracking can resume.
 */
export async function resumeBackgroundLocation(): Promise<void> {
  if (!(await isBackgroundLocationEnabled())) return
  await startBackgroundLocation()
}

/** Opens the OS settings page for the app, for a permission set to "never". */
export async function openLocationSettings(): Promise<void> {
  try {
    const plugin = await loadPlugin()
    await plugin?.openSettings?.()
  } catch {
    // Nothing useful to say if the OS won't open its own settings page.
  }
}
