/* eslint-disable @typescript-eslint/no-explicit-any */
// Local notification helper — schedules reminders + daily nudges as native
// Android notifications via the Capacitor Local Notifications plugin.
// No-ops on the web.

type Reminder = {
  id: string
  title: string
  description?: string | null
  dueDate?: string | null
  isCompleted?: boolean
}

const NUDGES_KEY = "notif_nudges" // localStorage: "off" disables daily nudges

// Fixed daily nudges (ids in a high range so they never collide with reminders).
const NUDGES = [
  { id: 910001, title: "🌅 Morning check-in", body: "Log your energy, mood & focus — takes 10 seconds.", hour: 8, minute: 0 },
  { id: 910002, title: "💧 Hydration check", body: "How's your water intake looking today?", hour: 13, minute: 0 },
  { id: 910003, title: "✅ Habits", body: "Any habits left to close out before bed?", hour: 20, minute: 0 },
]

async function getPlugin(): Promise<any | null> {
  if (typeof window === "undefined") return null
  try {
    const core = await import("@capacitor/core")
    if ((core as any).Capacitor?.isNativePlatform?.() !== true) return null
    const mod = await import("@capacitor/local-notifications")
    return (mod as any).LocalNotifications ?? null
  } catch {
    return null
  }
}

/** Request notification permission. Returns true if granted (or already granted). */
export async function ensureNotificationPermission(): Promise<boolean> {
  const ln = await getPlugin()
  if (!ln) return false
  try {
    const check = await ln.checkPermissions()
    if (check.display === "granted") return true
    const req = await ln.requestPermissions()
    return req.display === "granted"
  } catch {
    return false
  }
}

// Local notification ids must be 32-bit ints; hash the reminder cuid into one
// (kept under 900000 so it never collides with the fixed nudge ids).
function idToInt(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return Math.abs(h) % 800_000
}

/** Whether daily nudges are enabled (default on). */
export function nudgesEnabled(): boolean {
  try {
    return localStorage.getItem(NUDGES_KEY) !== "off"
  } catch {
    return true
  }
}

export function setNudgesEnabled(on: boolean): void {
  try {
    localStorage.setItem(NUDGES_KEY, on ? "on" : "off")
  } catch {
    /* ignore */
  }
}

/**
 * Cancel everything we scheduled and re-schedule from scratch: upcoming
 * reminders (one-shot) + daily nudges (repeating), unless nudges are off.
 * Returns the number of notifications scheduled.
 */
export async function syncNotifications(reminders: Reminder[]): Promise<number> {
  const ln = await getPlugin()
  if (!ln) return 0

  const granted = await ensureNotificationPermission()
  if (!granted) return 0

  try {
    // Clear previously scheduled notifications so we don't pile up duplicates.
    const pending = await ln.getPending()
    if (pending?.notifications?.length) {
      await ln.cancel({ notifications: pending.notifications.map((n: { id: number }) => ({ id: n.id })) })
    }

    const now = Date.now()
    const toSchedule: any[] = reminders
      .filter(r => !r.isCompleted && r.dueDate && new Date(r.dueDate).getTime() > now)
      .map(r => ({
        id: idToInt(r.id),
        title: r.title,
        body: r.description?.trim() || "Reminder",
        schedule: { at: new Date(r.dueDate as string), allowWhileIdle: true },
      }))

    if (nudgesEnabled()) {
      for (const n of NUDGES) {
        toSchedule.push({
          id: n.id,
          title: n.title,
          body: n.body,
          schedule: { on: { hour: n.hour, minute: n.minute }, repeats: true, allowWhileIdle: true },
        })
      }
    }

    if (toSchedule.length === 0) return 0
    await ln.schedule({ notifications: toSchedule })
    return toSchedule.length
  } catch {
    return 0
  }
}

/** Current notification permission state (native only). */
export async function getNotificationPermission(): Promise<"granted" | "denied" | "prompt" | "unavailable"> {
  const ln = await getPlugin()
  if (!ln) return "unavailable"
  try {
    const c = await ln.checkPermissions()
    if (c.display === "granted") return "granted"
    if (c.display === "denied") return "denied"
    return "prompt"
  } catch {
    return "unavailable"
  }
}

// If a native bridge call doesn't respond within `ms`, treat it as unavailable
// rather than hanging forever. On an APK built without the notifications plugin
// registered natively, the bridge call never resolves — this is what made the
// "Send test" button stick on "Sending…" indefinitely.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ])
}

/**
 * Fire a test local notification a few seconds out so the user can confirm
 * notifications actually arrive on this phone. Returns what happened:
 *  - "scheduled": on its way (check in ~3s)
 *  - "denied": permission not granted
 *  - "unavailable": not running in the native app / plugin missing (APK too old)
 */
export async function scheduleTestNotification(): Promise<"scheduled" | "denied" | "unavailable"> {
  const ln = await getPlugin()
  if (!ln) return "unavailable"
  const granted = await withTimeout(ensureNotificationPermission(), 6000, false)
  if (!granted) return "denied"
  try {
    await withTimeout(
      ln.schedule({
        notifications: [{
          id: 999_001,
          title: "🔔 Test notification",
          body: "Nice — notifications work on this phone!",
          schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true },
        }],
      }),
      6000,
      "timeout",
    ).then(r => { if (r === "timeout") throw new Error("bridge timeout") })
    return "scheduled"
  } catch {
    return "unavailable"
  }
}

/** Fetch reminders from the server and (re)schedule all notifications. */
export async function resyncNotifications(): Promise<number> {
  try {
    const res = await fetch("/api/reminders")
    const reminders = res.ok ? await res.json() : []
    return await syncNotifications(Array.isArray(reminders) ? reminders : [])
  } catch {
    return 0
  }
}
