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
const DAYS_BACK = 30
const DAYS_AHEAD = 120

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

async function getPlugin(): Promise<any | null> {
  if (!isNativeApp()) return null
  try {
    const mod = await import("@ebarooni/capacitor-calendar")
    return (mod as any).CapacitorCalendar ?? null
  } catch {
    return null
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
  const cal = await withTimeout(getPlugin(), 4000, null)
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

/**
 * Request read-only calendar access.
 *  - "granted": permission is available, ready to sync
 *  - "denied": the user (or the OS) refused it — grantable in system settings
 *  - "unavailable": the calendar plugin didn't respond — usually an APK built
 *    before the plugin shipped; the app needs updating to the latest build
 */
export async function requestPermission(): Promise<PermissionOutcome> {
  const cal = await withTimeout(getPlugin(), 4000, null)
  if (!cal) return "unavailable"
  try {
    // checkPermission is non-interactive, so a stall here means the plugin
    // isn't really there (old APK). Time-box it and bail as "unavailable".
    const current = await withTimeout<any>(cal.checkPermission({ scope: READ_SCOPE }), 6000, null)
    if (!current) return "unavailable"
    if (current.result === "granted") return "granted"
    // The plugin answered, so it's alive — the request prompt is interactive
    // and may sit while the user decides, so don't time this one out.
    const { result } = await cal.requestReadOnlyCalendarAccess()
    return result === "granted" ? "granted" : "denied"
  } catch {
    return "unavailable"
  }
}

export type DeviceEventPayload = {
  externalId: string
  calendarId: string | null
  title: string
  description: string | null
  location: string | null
  start: string          // ISO
  end: string | null     // ISO
  isAllDay: boolean
}

/** Read events from every device calendar within the sync window. */
export async function readEvents(): Promise<{
  from: string
  to: string
  events: DeviceEventPayload[]
}> {
  const cal = await withTimeout(getPlugin(), 4000, null)
  const fromMs = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000
  const toMs = Date.now() + DAYS_AHEAD * 24 * 60 * 60 * 1000
  const from = new Date(fromMs).toISOString()
  const to = new Date(toMs).toISOString()
  if (!cal) return { from, to, events: [] }

  let raw: any[] = []
  try {
    const res = await withTimeout<any>(cal.listEventsInRange({ from: fromMs, to: toMs }), 15000, null)
    raw = Array.isArray(res?.result) ? res.result : []
  } catch {
    return { from, to, events: [] }
  }

  const events: DeviceEventPayload[] = raw
    .filter((e) => e && e.id != null && typeof e.startDate === "number")
    .map((e) => ({
      externalId: String(e.id),
      calendarId: e.calendarId != null ? String(e.calendarId) : null,
      title: (e.title ?? "").toString().trim() || "(No title)",
      description: e.description ?? null,
      location: e.location ?? null,
      start: new Date(e.startDate).toISOString(),
      end: typeof e.endDate === "number" ? new Date(e.endDate).toISOString() : null,
      isAllDay: e.isAllDay === true,
    }))

  return { from, to, events }
}

/** Read the device calendar and push it to the server. Returns event count. */
export async function syncToServer(): Promise<{ synced: number }> {
  const { from, to, events } = await readEvents()
  const res = await fetch("/api/sync/device-calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, events }),
  })
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`)
  const data = await res.json().catch(() => ({}))
  return { synced: data.synced ?? events.length }
}
