/* eslint-disable @typescript-eslint/no-explicit-any */
// Device calendar reader — runs inside the Capacitor Android WebView and reads
// the native Android Calendar Provider, which aggregates EVERY calendar account
// on the phone: Samsung Calendar, Google, and local "My calendar" alike. That's
// the only way to pull Samsung Calendar events, since Samsung exposes no public
// cloud/CalDAV API.
//
// Uses @ebarooni/capacitor-calendar (readonly). Gracefully no-ops in the
// browser / SSR context or on an APK built without the plugin registered.

const READ_SCOPE = "readCalendar" // CalendarPermissionScope.READ_CALENDAR
// Rolling window, generous on both sides so the whole of the current year is
// always covered no matter the date (and a good chunk either side of it):
// ~13 months back + ~13 months ahead.
const DAYS_BACK = 400
const DAYS_AHEAD = 400

// If a native bridge/import call doesn't settle within `ms`, treat it as
// unavailable instead of hanging forever. On an APK built without the calendar
// plugin registered, the dynamic import or bridge call can stall — that's what
// left the "Connect & Sync" button stuck disabled ("untappable").
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

/**
 * Synchronous check for "are we inside the native app?" — reads the Capacitor
 * global that the Android WebView injects. No dynamic import, so it can't hang;
 * this is what the UI gates the button on. Whether the calendar *plugin* is
 * actually present is proven later, on tap, with a timeout.
 */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false
  const cap = (window as any).Capacitor
  try {
    return cap?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

// Resolved plugin proxy, cached so we resolve it at most once.
let cachedPlugin: any = null
// How the plugin was obtained last — surfaced in sync diagnostics.
let pluginSource: "global" | "import" | "none" = "none"
export function getPluginSource(): "global" | "import" | "none" {
  return pluginSource
}

// Grab the plugin without a network round-trip when possible. Capacitor's native
// bridge injects registered native plugins onto `window.Capacitor.Plugins` at
// startup, so reading it there is instant and can't fail like a dynamic import
// of the JS chunk (which, over a mobile connection in the WebView, was throwing
// ChunkLoadError / timing out — leaving permission "unavailable", 0 events).
function pluginFromGlobal(): any | null {
  const plugins = (window as any)?.Capacitor?.Plugins
  const p = plugins?.CapacitorCalendar
  // Sanity-check it looks like our plugin (has the methods we call).
  return p && typeof p.checkPermission === "function" ? p : null
}

async function getPlugin(): Promise<any | null> {
  if (!isNativeApp()) return null
  if (cachedPlugin) return cachedPlugin

  const fromGlobal = pluginFromGlobal()
  if (fromGlobal) {
    cachedPlugin = fromGlobal
    pluginSource = "global"
    return cachedPlugin
  }

  // Fall back to the JS wrapper (its import registers the proxy).
  try {
    const mod = await import("@ebarooni/capacitor-calendar")
    cachedPlugin = (mod as any).CapacitorCalendar ?? pluginFromGlobal()
    pluginSource = cachedPlugin ? "import" : "none"
    return cachedPlugin
  } catch {
    // Import failed (e.g. ChunkLoadError) — last try at the global, in case the
    // native bridge registered it even though the wrapper chunk didn't load.
    const g = pluginFromGlobal()
    pluginSource = g ? "global" : "none"
    return g
  }
}

/**
 * Whether to offer device-calendar sync at all. Deliberately just the native
 * check — it's instant and never hangs, so the button is always tappable in the
 * app. (Older behaviour awaited the plugin import here, which could stall and
 * leave the button permanently disabled.)
 */
export async function isDeviceCalendarAvailable(): Promise<boolean> {
  return isNativeApp()
}

export type CalPermission = "granted" | "denied" | "prompt" | "unavailable"

function normalizeState(state: unknown): CalPermission {
  if (state === "granted") return "granted"
  if (state === "denied") return "denied"
  return "prompt"
}

/** Current READ_CALENDAR permission state (native only). */
export async function getPermissionState(): Promise<CalPermission> {
  const cal = await withTimeout(getPlugin(), 12000, null)
  if (!cal) return "unavailable"
  try {
    const res = await withTimeout<any>(cal.checkPermission({ scope: READ_SCOPE }), 6000, null)
    if (!res) return "unavailable"
    return normalizeState(res.result)
  } catch {
    return "unavailable"
  }
}

export type PermissionOutcome = "granted" | "denied" | "unavailable"

// A short, technical reason attached to an "unavailable" outcome, so the UI can
// show *why* — which pins down whether the plugin's JS failed to load, the
// native side isn't implemented (old APK), or a call stalled.
export type PermissionResult = { outcome: PermissionOutcome; reason?: string }

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  try {
    return typeof e === "string" ? e : JSON.stringify(e)
  } catch {
    return String(e)
  }
}

/**
 * Request read-only calendar access, returning the outcome plus a diagnostic
 * `reason` when it's "unavailable":
 *  - "granted": permission is available, ready to sync
 *  - "denied": the user (or the OS) refused it — grantable in system settings
 *  - "unavailable": couldn't reach the calendar plugin. `reason` distinguishes
 *    JS-not-loaded vs native-not-implemented (old APK) vs a stalled bridge call.
 */
export async function requestPermission(): Promise<PermissionResult> {
  if (!isNativeApp()) return { outcome: "unavailable", reason: "not the native app" }

  // Prefer the native-registered global (no chunk fetch); only import the JS
  // wrapper as a fallback. A failed import is reported distinctly.
  let cal: any = pluginFromGlobal()
  if (!cal) {
    try {
      const mod = await withTimeout<any>(import("@ebarooni/capacitor-calendar"), 15000, "TIMEOUT")
      if (mod === "TIMEOUT") return { outcome: "unavailable", reason: "plugin JS load timed out" }
      cal = mod?.CapacitorCalendar ?? pluginFromGlobal()
      if (!cal) return { outcome: "unavailable", reason: "CapacitorCalendar export missing" }
    } catch (e) {
      cal = pluginFromGlobal()
      if (!cal) return { outcome: "unavailable", reason: `plugin import failed: ${errMsg(e)}` }
    }
  }

  try {
    // checkPermission is non-interactive: a throw here is the native plugin
    // being absent (old APK); a stall means the bridge isn't answering.
    const current = await withTimeout<any>(cal.checkPermission({ scope: READ_SCOPE }), 8000, "TIMEOUT")
    if (current === "TIMEOUT") return { outcome: "unavailable", reason: "native checkPermission timed out" }
    if (current?.result === "granted") return { outcome: "granted" }
    // Plugin answered, so it's alive — the request prompt is interactive and
    // may sit while the user decides, so don't time this one out.
    const { result } = await cal.requestReadOnlyCalendarAccess()
    return { outcome: result === "granted" ? "granted" : "denied" }
  } catch (e) {
    return { outcome: "unavailable", reason: `native call failed: ${errMsg(e)}` }
  }
}

export type DeviceEventPayload = {
  externalId: string
  calendarId: string | null
  title: string
  description: string | null
  location: string | null
  color: string | null   // hex, so events can match the phone's calendar colors
  start: string          // ISO
  end: string | null     // ISO
  isAllDay: boolean
}

export type DeviceCalendarInfo = { id: string; name: string; color: string | null }

// The phone's calendars (id, name, colour) — for the per-calendar colour picker
// and to colour events by their calendar (how Samsung colours them).
async function listDeviceCalendars(cal: any): Promise<DeviceCalendarInfo[]> {
  try {
    const res = await withTimeout<any>(cal.listCalendars(), 8000, null)
    return (res?.result ?? [])
      .filter((c: any) => c?.id != null)
      .map((c: any) => ({
        id: String(c.id),
        name: (c.title ?? c.internalTitle ?? c.accountName ?? "Calendar").toString(),
        color: typeof c.color === "string" ? c.color : null,
      }))
  } catch {
    return []
  }
}

/** Read events from every device calendar within the sync window. */
export async function readEvents(): Promise<{
  from: string
  to: string
  events: DeviceEventPayload[]
  rawCount: number
  calendars: DeviceCalendarInfo[]
}> {
  const cal = await withTimeout(getPlugin(), 12000, null)
  const fromMs = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000
  const toMs = Date.now() + DAYS_AHEAD * 24 * 60 * 60 * 1000
  const from = new Date(fromMs).toISOString()
  const to = new Date(toMs).toISOString()
  if (!cal) return { from, to, events: [], rawCount: 0, calendars: [] }

  let raw: any[] = []
  try {
    const res = await withTimeout<any>(cal.listEventsInRange({ from: fromMs, to: toMs }), 25000, null)
    raw = Array.isArray(res?.result) ? res.result : []
  } catch {
    return { from, to, events: [], rawCount: 0, calendars: [] }
  }

  const calendars = await listDeviceCalendars(cal)
  const colors: Record<string, string> = {}
  for (const c of calendars) if (c.color) colors[c.id] = c.color

  const events: DeviceEventPayload[] = raw
    .filter((e) => e && e.id != null && typeof e.startDate === "number")
    .map((e) => {
      const calId = e.calendarId != null ? String(e.calendarId) : null
      // Prefer the CALENDAR's colour (Samsung colours events by calendar),
      // falling back to a per-event colour override.
      const color =
        (calId != null ? colors[calId] : null) ||
        (typeof e.color === "string" && e.color) ||
        null
      return {
        // The plugin returns the event id (shared across every occurrence of a
        // recurring event), so compose it with the instance start to keep each
        // occurrence distinct — otherwise they collapse onto one DB row.
        externalId: `${String(e.id)}:${e.startDate}`,
        calendarId: calId,
        title: (e.title ?? "").toString().trim() || "(No title)",
        description: e.description ?? null,
        location: e.location ?? null,
        color,
        start: new Date(e.startDate).toISOString(),
        end: typeof e.endDate === "number" ? new Date(e.endDate).toISOString() : null,
        isAllDay: e.isAllDay === true,
      }
    })

  return { from, to, events, rawCount: raw.length, calendars }
}

export type SyncResult = {
  synced: number
  rawCount: number
  calendars: number
  permission: CalPermission
  pluginSource: "global" | "import" | "none"
}

/** Read the device calendar and push it to the server, with diagnostics. */
export async function syncToServer(): Promise<SyncResult> {
  // Resolve the plugin first (also warms the cache + records how it was found).
  await getPlugin()

  // Gather diagnostics alongside the read so a "0 events" result is explainable.
  const [permission, read] = await Promise.all([
    getPermissionState(),
    readEvents(),
  ])
  const { from, to, events, rawCount, calendars } = read

  const res = await fetch("/api/sync/device-calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Send the calendar list too, so Settings can offer a per-calendar colour picker.
    body: JSON.stringify({ from, to, events, calendars }),
  })
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`)
  const data = await res.json().catch(() => ({}))
  return {
    synced: data.synced ?? events.length,
    rawCount,
    calendars: calendars.length,
    permission,
    pluginSource: getPluginSource(),
  }
}
