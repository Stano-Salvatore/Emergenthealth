/* eslint-disable @typescript-eslint/no-explicit-any */
// Local notification helper — schedules reminders as native Android
// notifications via the Capacitor Local Notifications plugin. No-ops on the web.

type Reminder = {
  id: string
  title: string
  description?: string | null
  dueDate?: string | null
  isCompleted?: boolean
}

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

// Local notification ids must be 32-bit ints; hash the reminder cuid into one.
function idToInt(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return Math.abs(h) % 2_000_000_000
}

/**
 * Sync upcoming reminders into the device's scheduled notifications.
 * Cancels anything we previously scheduled, then re-schedules every
 * incomplete reminder with a future due date.
 */
export async function syncReminderNotifications(reminders: Reminder[]): Promise<number> {
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
    const toSchedule = reminders
      .filter(r => !r.isCompleted && r.dueDate && new Date(r.dueDate).getTime() > now)
      .map(r => ({
        id: idToInt(r.id),
        title: r.title,
        body: r.description?.trim() || "Reminder",
        schedule: { at: new Date(r.dueDate as string), allowWhileIdle: true },
        smallIcon: "ic_stat_icon_config_sample",
      }))

    if (toSchedule.length === 0) return 0
    await ln.schedule({ notifications: toSchedule })
    return toSchedule.length
  } catch {
    return 0
  }
}
