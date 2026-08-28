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

import { Capacitor, registerPlugin } from "@capacitor/core"
import { Preferences } from "@capacitor/preferences"
import type { BackgroundGeolocationPlugin, CallbackError, Location } from "@capacitor-community/background-geolocation"

/**
 * The plugin ships NO JavaScript — its package.json has no main, no module and
 * no exports, and its `files` list is native sources plus a .d.ts. So there is
 * nothing to import at runtime, and `await import(...)` of it always threw;
 * the catch below turned that into "unavailable", which is why this feature
 * reported itself off on every device it ever ran on.
 *
 * The documented usage is registerPlugin with the name the Android class
 * declares in its @CapacitorPlugin annotation — the same shape lib/native/
 * bubble.ts already uses for EmergyBubble.
 */
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation")

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
 * Points collected but not yet accepted by the server.
 *
 * The queue lives in module state, and module state dies with the page. Android
 * suspends and eventually kills a backgrounded WebView whenever it likes, so
 * every point gathered since the last successful upload went with it — silently,
 * and exactly when tracking is doing the thing it exists for: running while
 * nobody is looking at the screen.
 *
 * Ids are derived from time and position, so re-sending a batch that did arrive
 * is a no-op rather than a duplicate. That makes it safe to keep the copy until
 * the server has actually said yes.
 */
const QUEUE_KEY = "backgroundLocationQueue"

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

/** Roughly a day of stationary tracking; beyond this the oldest points go. */
const MAX_QUEUED_POINTS = 200

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
/** Set from the watcher callback; see startBackgroundLocation. */
let denied = false
/** Concurrent starts share one attempt rather than adding a watcher each. */
let starting: Promise<boolean> | null = null

/**
 * Read a stored queue back, keeping only what is still usable.
 *
 * Whatever is on disk was written by some earlier version of this file, so it
 * is validated rather than trusted: one malformed row should cost that row, not
 * the whole backlog behind it.
 */
export function parseStoredQueue(raw: string | null | undefined): Point[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const points: Point[] = []
  for (const row of parsed) {
    if (typeof row !== "object" || row === null) continue
    const r = row as Record<string, unknown>
    if (typeof r.lat !== "number" || !Number.isFinite(r.lat)) continue
    if (typeof r.lng !== "number" || !Number.isFinite(r.lng)) continue
    if (typeof r.trackedAt !== "string" || !Number.isFinite(Date.parse(r.trackedAt))) continue
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
    points.push({
      lat: r.lat,
      lng: r.lng,
      trackedAt: r.trackedAt,
      accuracyM: num(r.accuracyM),
      altitudeM: num(r.altitudeM),
      speedKmh: num(r.speedKmh),
    })
  }
  return points.slice(-MAX_QUEUED_POINTS)
}

/**
 * Write the queue out. Fire and forget: memory is the source of truth while
 * the page lives, and this copy only has to survive the page not living.
 */
function persistQueue(): void {
  void Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(queue) }).catch(() => {})
}

/** Take back anything a previous page collected and never managed to send. */
async function restoreQueue(): Promise<void> {
  try {
    const { value } = await bridgeTimeout(Preferences.get({ key: QUEUE_KEY }), "Preferences.get")
    const saved = parseStoredQueue(value)
    if (saved.length === 0) return
    // Older points go in front: anything already in memory happened after them.
    queue = [...saved, ...queue].slice(-MAX_QUEUED_POINTS)
  } catch {
    // A queue that cannot be read is a queue that cannot be sent. Carry on
    // collecting rather than refusing to start over a backlog.
  }
}

function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const la1 = (aLat * Math.PI) / 180
  const la2 = (bLat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * SYNCHRONOUS, and it must stay that way.
 *
 * registerPlugin returns a Proxy whose get-handler answers EVERY property with
 * a function that calls the native bridge — `then` included. That makes the
 * plugin a thenable, so the moment it passes through promise resolution
 * (returning it from an async function is enough) the runtime calls
 * `then(resolve, reject)` on it, which posts a bridge call for a method named
 * "then" that no plugin implements. Android never answers, nothing rejects,
 * and the promise stays pending for the life of the page.
 *
 * That is what "the location check did not answer in 6s" was, with every
 * individual call underneath it measured at 4ms. It also meant starting,
 * stopping and opening settings each hung forever on a real device: the whole
 * feature, not just the card that reported it.
 *
 * Returning it synchronously never resolves it, so the proxy is only ever
 * touched by calling a method that actually exists.
 */
function loadPlugin(): BackgroundGeolocationPlugin | null {
  if (typeof window === "undefined") return null
  // registerPlugin returns a proxy that only fails when CALLED, so the platform
  // check is what decides availability — not whether a module resolved.
  return Capacitor.isNativePlatform() ? BackgroundGeolocation : null
}

/**
 * Why tracking is or is not on offer.
 *
 * "web" and "plugin-missing" both used to read as "your device can't do this",
 * and they are not the same thing at all. The second one is an APK built
 * before the plugin was added — the JS ships from the server on every load,
 * but the native class only arrives with an install, so the two halves of this
 * feature can be months apart on one phone.
 */
export type LocationSupport = "web" | "plugin-missing" | "ready"

export async function backgroundLocationSupport(): Promise<LocationSupport> {
  if (loadPlugin() === null) return "web"
  // registerPlugin hands back a proxy regardless of what the APK contains, so
  // this is the only thing that knows whether the native class is really
  // there. Without it the card offers a switch that answers every press with
  // "not implemented on android".
  return Capacitor.isPluginAvailable("BackgroundGeolocation") ? "ready" : "plugin-missing"
}

/** Whether this build can track at all — false on the web. */
export async function isBackgroundLocationAvailable(): Promise<boolean> {
  return (await backgroundLocationSupport()) === "ready"
}

async function flush(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (queue.length === 0) return

  const batch = queue
  queue = []
  // Deliberately NOT persisting the emptying here. Between clearing the queue
  // and learning whether the POST succeeded there is a request's worth of time,
  // and a WebView killed inside it would leave disk saying "nothing pending"
  // about points that never arrived. Leaving the stored copy alone until the
  // outcome is known makes the worst case a re-send, which the server dedupes
  // by id, rather than a loss, which nothing can undo.
  try {
    const res = await fetch("/api/location/points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: batch }),
    })
    if (res.ok) { persistQueue(); return }
    // A signed-out session refuses this batch and every future one identically,
    // so re-queueing would repost the same points on every fix for as long as
    // tracking runs. That backlog is dropped; anything else is worth holding.
    if (res.status === 401 || res.status === 403) { persistQueue(); return }
    retry(batch)
  } catch {
    retry(batch)
  }
}

/**
 * Hold a failed batch for the next flush — ids come from time and position, so
 * a point that never arrives is a gap rather than a duplicate risk.
 *
 * Only the SIZE is capped, deliberately. Counting failed attempts sounds like
 * the safer bound and is not: a flush follows every point, so a drive through
 * a dead spot burns a dozen attempts in minutes and would throw away the very
 * backlog that exists to survive it. An hour in a tunnel should upload on the
 * far side, not arrive empty.
 */
function retry(batch: Point[]): void {
  queue = [...batch, ...queue].slice(-MAX_QUEUED_POINTS)
  persistQueue()
}

function enqueue(location: Location): void {
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
  // Trim here too, not only in retry(). The cap used to live only there, so a
  // failed batch came back at exactly MAX_QUEUED_POINTS and then every new fix
  // pushed past it. The server keeps the first MAX_BATCH of an oversized post
  // and answers ok, so the points silently discarded were the NEWEST ones —
  // the opposite of what a backlog is for.
  if (queue.length >= MAX_QUEUED_POINTS) queue = queue.slice(-(MAX_QUEUED_POINTS - 1))
  queue.push({
    lat,
    lng,
    trackedAt: new Date(at).toISOString(),
    accuracyM: typeof location.accuracy === "number" ? Math.round(location.accuracy) : null,
    altitudeM: typeof location.altitude === "number" ? location.altitude : null,
    // The plugin reports metres per second; everything downstream stores km/h.
    speedKmh: typeof location.speed === "number" ? location.speed * 3.6 : null,
  })

  persistQueue()

  // Give a moving device a moment to produce its next fix so a journey uploads
  // as one request instead of one per point.
  flushTimer ??= setTimeout(() => { void flush() }, FLUSH_DELAY_MS)
}

/**
 * Start tracking.
 *
 * `addWatcher` is a Capacitor RETURN_CALLBACK method: its promise resolves with
 * the watcher's id the moment the call is made, and a refused permission is
 * delivered to the CALLBACK afterwards, never to the promise. So the return
 * value here can only mean "the watcher was registered" — it can never mean
 * "and the user allowed it". Refusal arrives through `onDenied`, which is why
 * the caller is given one rather than being told to read the boolean.
 */
export async function startBackgroundLocation(onDenied?: () => void): Promise<boolean> {
  // One attempt at a time. The id is only known once addWatcher resolves, and
  // three awaits happen before that — two overlapping callers would otherwise
  // both sail past the guard and register a watcher each, leaving the first
  // with no handle: exactly the duplication WATCHER_KEY exists to prevent.
  if (starting) return starting
  // A watcher we already hold — including one a failed stop could not remove —
  // is running, so say so AND put the flag back, or the button reads "Stop
  // following along" over a watcher nothing will resume after a restart.
  if (watcherId) {
    await Preferences.set({ key: ENABLED_KEY, value: "1" }).catch(() => {})
    return true
  }
  starting = attachWatcher(onDenied).finally(() => { starting = null })
  return starting
}

async function attachWatcher(onDenied?: () => void): Promise<boolean> {
  const plugin = loadPlugin()
  if (!plugin) return false

  denied = false
  try {
    // Anything a previous page collected and never sent is still owed to the
    // server — take it back before collecting more, and send it.
    await restoreQueue()
    if (queue.length > 0) void flush()

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
      (location?: Location, error?: CallbackError) => {
        if (error) {
          // Refused outright, or location switched off at the OS level. Both
          // are delivered here rather than to the promise, and both can arrive
          // before addWatcher has even resolved — hence the flag, which the
          // code below reads once it knows the id it needs in order to stop.
          if (error.code === "NOT_AUTHORIZED") {
            denied = true
            onDenied?.()
            void stopBackgroundLocation()
          }
          return
        }
        if (location) enqueue(location)
      },
    )
    watcherId = id
    await Preferences.set({ key: WATCHER_KEY, value: id })

    // The refusal may already have come and gone while the above was running.
    // Marking it enabled now would leave a notification nobody can dismiss and
    // a flag that re-arms the whole thing on every launch.
    if (denied) {
      await stopBackgroundLocation()
      return false
    }

    await Preferences.set({ key: ENABLED_KEY, value: "1" })

    // And once more, because that write is itself a suspension point. A denial
    // landing inside it races stopBackgroundLocation's "0" against this "1" —
    // and if "1" lands last the flag outlives the watcher, so every launch
    // re-arms tracking the user just refused. Checking after settles it
    // whichever order they arrived in.
    if (denied) {
      await stopBackgroundLocation()
      return false
    }
    return true
  } catch {
    watcherId = null
    return false
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  await Preferences.set({ key: ENABLED_KEY, value: "0" }).catch(() => {})
  const plugin = loadPlugin()
  // Prefer this context's id, but fall back to the stored one — after a reload
  // that is the only handle on the watcher still running.
  const stored = await Preferences.get({ key: WATCHER_KEY }).then(r => r.value).catch(() => null)
  const id = watcherId ?? stored
  let removed = true
  if (plugin && id) {
    removed = await plugin.removeWatcher({ id }).then(() => true).catch(() => false)
  }
  // Only let go of the handle once the watcher is actually gone. Forgetting an
  // id that still refers to a running watcher strands it: the notification
  // stays up, points keep uploading, and nothing can reach it to stop it.
  if (removed) {
    await Preferences.remove({ key: WATCHER_KEY }).catch(() => {})
    watcherId = null
  }
  lastSent = null
  await flush()
}

/**
 * How long any single bridge call gets before we stop waiting on it.
 *
 * Capacitor answers a plugin call by posting a message and resolving a promise
 * when the native side posts back. Nothing times that out: if the reply never
 * comes the promise simply stays pending for the life of the page. So every
 * call here needs its own bound, or one unanswered read hangs whatever awaited
 * it — which is exactly how reading a saved on/off flag took the entire
 * settings card down with it.
 */
const BRIDGE_TIMEOUT_MS = 4000

function bridgeTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} did not answer in ${BRIDGE_TIMEOUT_MS / 1000}s`)), BRIDGE_TIMEOUT_MS),
    ),
  ])
}

/**
 * Whether the user has turned this on, and whether we could actually find out.
 *
 * The two are worth separating. Falling back to "off" when the read fails is
 * the right behaviour — the card stays usable — but reporting nothing about
 * the failure would swallow the one symptom currently worth chasing. A fix
 * that removes the evidence of the thing it fixed is half a fix.
 */
export async function readBackgroundLocationEnabled(): Promise<{ enabled: boolean; failure: string | null }> {
  try {
    const { value } = await bridgeTimeout(Preferences.get({ key: ENABLED_KEY }), "Preferences.get")
    return { enabled: value === "1", failure: null }
  } catch (err) {
    return { enabled: false, failure: err instanceof Error ? err.message : String(err) }
  }
}

/** Whether the user has turned this on, whatever the watcher is doing now. */
export async function isBackgroundLocationEnabled(): Promise<boolean> {
  return (await readBackgroundLocationEnabled()).enabled
}

/**
 * What each piece of the check actually did, as one line short enough to read
 * off a phone screen.
 *
 * Written because two rounds of reasoning about which call was hanging were
 * both wrong. The platform and plugin checks are synchronous and cannot hang;
 * only the bridge can. Measuring beats inferring, and this costs one line.
 */
export async function diagnoseBackgroundLocation(): Promise<string> {
  const parts: string[] = []
  const say = (err: unknown) => (err instanceof Error ? err.message : String(err))

  try {
    parts.push(`native=${typeof window !== "undefined" && Capacitor.isNativePlatform()}`)
  } catch (err) {
    parts.push(`native threw: ${say(err)}`)
  }
  try {
    parts.push(`plugin=${Capacitor.isPluginAvailable("BackgroundGeolocation")}`)
  } catch (err) {
    parts.push(`plugin threw: ${say(err)}`)
  }

  const started = Date.now()
  try {
    await bridgeTimeout(Preferences.get({ key: ENABLED_KEY }), "Preferences.get")
    parts.push(`prefs=ok in ${Date.now() - started}ms`)
  } catch (err) {
    parts.push(`prefs=${say(err)}`)
  }
  return parts.join(" · ")
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
    const plugin = loadPlugin()
    await plugin?.openSettings?.()
  } catch {
    // Nothing useful to say if the OS won't open its own settings page.
  }
}
