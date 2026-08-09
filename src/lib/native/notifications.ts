/* eslint-disable @typescript-eslint/no-explicit-any */
// Local notification helper — schedules reminders + daily nudges as native
// Android notifications via the Capacitor Local Notifications plugin.
// No-ops on the web.

type Reminder = {
  id: string
  title: string
  description?: string | null
  dueDate?: string | null
  reminderTime?: string | null   // "HH:MM", the time the user actually picked
  isCompleted?: boolean
}

type HabitReminder = {
  id: string
  name: string
  reminderTime?: string | null   // "HH:MM"
  completedToday?: boolean
}

// How many days ahead each habit's daily reminder is scheduled. A repeating
// alarm can't be cancelled for a single day, so instead of one repeating alarm
// per habit we lay down a short rolling window of one-shots and refresh it
// whenever the app is opened — that way a habit already ticked off today
// doesn't buzz anyway.
const HABIT_WINDOW_DAYS = 7

// Android will accept far more than this, but a runaway loop shouldn't be able
// to flood the notification tray.
const MAX_SCHEDULED = 400

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

// Local notification ids must be 32-bit ints, so cuids are hashed into one.
// The space is partitioned so the three kinds can never collide:
//   0 – 399,999    to-do reminders
//   400,000 – 889,999  habit reminders (hash × 7 + day offset)
//   910,001+       the fixed daily nudges
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

function reminderNotifId(id: string): number {
  return hashId(id) % 400_000
}

function habitNotifId(habitId: string, dayOffset: number): number {
  return 400_000 + (hashId(habitId) % 70_000) * 7 + dayOffset
}

// A local Date for a given day offset at "HH:MM" in the phone's own timezone.
function localTimeOn(dayOffset: number, hhmm: string): Date | null {
  const [h, m] = hhmm.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d
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
export async function syncNotifications(
  reminders: Reminder[],
  habits: HabitReminder[] = [],
): Promise<number> {
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
    const toSchedule: any[] = []

    // ── To-do reminders ──────────────────────────────────────────────────
    // These used to be scheduled at the due date itself, which is stored at
    // UTC midnight — so "Tomorrow 9am" buzzed at about 02:00 local and the
    // time the user actually picked was never used at all.
    for (const r of reminders) {
      if (r.isCompleted || !r.dueDate) continue
      const [y, mo, d] = r.dueDate.slice(0, 10).split("-").map(Number)
      if (!y || !mo || !d) continue
      const at = new Date(y, mo - 1, d)
      const [h, m] = (r.reminderTime || "09:00").split(":").map(Number)
      // No time set means the whole day is meant, so a morning nudge beats
      // one at midnight.
      at.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0)
      if (at.getTime() <= now) continue
      toSchedule.push({
        id: reminderNotifId(r.id),
        title: r.title,
        body: r.description?.trim() || "Reminder",
        schedule: { at, allowWhileIdle: true },
      })
    }

    // ── Habit reminders ──────────────────────────────────────────────────
    // Never scheduled on the device before: the per-habit 🔔 time was only
    // ever known to the server, whose delivery job required an exact-minute
    // clock match from a once-daily run, so it effectively never fired.
    for (const habit of habits) {
      if (!habit.reminderTime) continue
      for (let day = 0; day < HABIT_WINDOW_DAYS; day++) {
        // Today is skipped once it's already done — the point of the rolling
        // window rather than one repeating alarm.
        if (day === 0 && habit.completedToday) continue
        const at = localTimeOn(day, habit.reminderTime)
        if (!at || at.getTime() <= now) continue
        toSchedule.push({
          id: habitNotifId(habit.id, day),
          title: "Habit reminder 🔔",
          body: `Don't forget: ${habit.name}`,
          schedule: { at, allowWhileIdle: true },
        })
      }
    }

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
    const capped = toSchedule.slice(0, MAX_SCHEDULED)
    await ln.schedule({ notifications: capped })
    return capped.length
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

/** Fetch reminders + habits from the server and (re)schedule everything. */
export async function resyncNotifications(): Promise<number> {
  try {
    const [rRes, hRes] = await Promise.all([
      fetch("/api/reminders").catch(() => null),
      fetch("/api/habits").catch(() => null),
    ])
    const reminders = rRes?.ok ? await rRes.json() : []
    const habits = hRes?.ok ? await hRes.json() : []
    return await syncNotifications(
      Array.isArray(reminders) ? reminders : [],
      Array.isArray(habits) ? habits : [],
    )
  } catch {
    return 0
  }
}
