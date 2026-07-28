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

async function getPlugin(): Promise<any | null> {
  if (typeof window === "undefined") return null
  try {
    const core = await import("@capacitor/core")
    if ((core as any).Capacitor?.isNativePlatform?.() !== true) return null
    const mod = await import("@ebarooni/capacitor-calendar")
    return (mod as any).CapacitorCalendar ?? null
  } catch {
    return null
  }
}

/** Whether native device-calendar reads are possible on this device. */
export async function isDeviceCalendarAvailable(): Promise<boolean> {
  return (await getPlugin()) !== null
}

export type CalPermission = "granted" | "denied" | "prompt" | "unavailable"

function normalizeState(state: unknown): CalPermission {
  if (state === "granted") return "granted"
  if (state === "denied") return "denied"
  return "prompt"
}

/** Current READ_CALENDAR permission state (native only). */
export async function getPermissionState(): Promise<CalPermission> {
  const cal = await getPlugin()
  if (!cal) return "unavailable"
  try {
    const { result } = await cal.checkPermission({ scope: READ_SCOPE })
    return normalizeState(result)
  } catch {
    return "unavailable"
  }
}

/** Request read-only calendar access. Returns true if granted. */
export async function requestPermission(): Promise<boolean> {
  const cal = await getPlugin()
  if (!cal) return false
  try {
    const current = await cal.checkPermission({ scope: READ_SCOPE })
    if (current?.result === "granted") return true
    const { result } = await cal.requestReadOnlyCalendarAccess()
    return result === "granted"
  } catch {
    return false
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
  const cal = await getPlugin()
  const fromMs = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000
  const toMs = Date.now() + DAYS_AHEAD * 24 * 60 * 60 * 1000
  const from = new Date(fromMs).toISOString()
  const to = new Date(toMs).toISOString()
  if (!cal) return { from, to, events: [] }

  let raw: any[] = []
  try {
    const res = await cal.listEventsInRange({ from: fromMs, to: toMs })
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
