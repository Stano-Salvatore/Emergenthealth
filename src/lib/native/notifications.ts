/* eslint-disable @typescript-eslint/no-explicit-any */
// Local notification helper — schedules reminders, habits, medication doses and
// the daily nudges as native Android notifications via the Capacitor Local
// Notifications plugin. No-ops on the web.
//
// Anything whose time is knowable in advance belongs here rather than in a
// server cron. A local notification fires at the exact minute, with no network,
// with the app closed, and survives a reboot; a pushed one needs a cron to come
// round, the network to be up and the app to be alive. The server keeps the
// notifications it alone can decide — Emergy's water check, anomaly and
// correlation watches, digests — because those depend on data the phone
// doesn't have.

import { activeOn } from "@/lib/med-schedule"

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

type MedReminder = {
  id: string
  name: string
  dose?: string | null
  times: string[]                // "HH:mm", local
  daysOfWeek: number[]           // 0 = Sunday; empty means every day
  active: boolean
  remind?: boolean
  startDate?: string | null      // YYYY-MM-DD
  endDate?: string | null
  takenToday?: number
}

/** Daily nudge times, from Settings. Noon and evening are on/off only. */
export type NudgePrefs = {
  morningHour: number
  noon: boolean
  evening: boolean
}

const DEFAULT_NUDGE_PREFS: NudgePrefs = { morningHour: 8, noon: true, evening: true }

// How many days ahead each habit's daily reminder is scheduled. A repeating
// alarm can't be cancelled for a single day, so instead of one repeating alarm
// per habit we lay down a short rolling window of one-shots and refresh it
// whenever the app is opened — that way a habit already ticked off today
// doesn't buzz anyway.
const HABIT_WINDOW_DAYS = 7

// Same reasoning for medication: a dose already logged today shouldn't buzz,
// which a repeating alarm can't express.
const MED_WINDOW_DAYS = 7

/** Cap per schedule, so one medication can't consume the whole id block. */
const MAX_MED_TIMES = 7

// Android will accept far more than this, but a runaway loop shouldn't be able
// to flood the notification tray.
const MAX_SCHEDULED = 400

const NUDGES_KEY = "notif_nudges" // localStorage: "off" disables daily nudges

// Action buttons on the notifications themselves, so ticking off a habit or
// logging a dose doesn't require opening the app. Each type's buttons are
// registered with Android once per sync; the ids come back verbatim in the
// localNotificationActionPerformed event handled below.
const ACTION_TYPES = [
  { id: "HABIT_REMINDER", actions: [{ id: "done", title: "✓ Done" }, { id: "snooze", title: "Snooze 30 min" }] },
  { id: "TODO_REMINDER",  actions: [{ id: "done", title: "✓ Done" }, { id: "snooze", title: "Snooze 30 min" }] },
  { id: "MED_REMINDER",   actions: [{ id: "taken", title: "✓ Took it" }, { id: "snooze", title: "Snooze 30 min" }] },
]

const SNOOZE_MINUTES = 30
const SNOOZE_ID_BASE = 950_000
const SNOOZE_ID_SPAN = 10_000

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
// The space is partitioned so the kinds can never collide:
//   0 – 399,999          to-do reminders
//   400,000 – 889,999    habit reminders (hash × 7 + day offset)
//   910,001+             the daily nudges
//   950,000 – 959,999    snoozed copies (random slot at snooze time)
//   1,000,000 – 1,999,999  medication doses (hash × 50 + day × 7 + time index)
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function reminderNotifId(id: string): number {
  return hashId(id) % 400_000
}

export function habitNotifId(habitId: string, dayOffset: number): number {
  return 400_000 + (hashId(habitId) % 70_000) * 7 + dayOffset
}

// 50 slots per schedule = 7 days × 7 times, with room to spare.
export function medNotifId(scheduleId: string, dayOffset: number, timeIndex: number): number {
  return 1_000_000 + (hashId(scheduleId) % 20_000) * 50 + dayOffset * MAX_MED_TIMES + timeIndex
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

/** YYYY-MM-DD for a day offset, in the phone's own timezone. */
function localDateOn(dayOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
 * The three daily nudges, built from the user's Settings.
 *
 * These used to be hard-coded at 08:00, 13:00 and 20:00 with no way to change
 * them — while Settings showed a morning-hour picker and noon/evening toggles
 * that drove three server crons nothing ever scheduled. So the controls you
 * could see did nothing and the notifications you actually got couldn't be
 * configured. Same preferences, now driving the notifications that really fire.
 */
export function buildNudges(prefs: NudgePrefs): { id: number; title: string; body: string; hour: number; minute: number }[] {
  const out = [{
    id: 910001,
    title: "🌅 Morning check-in",
    body: "Log your energy, mood & focus — takes 10 seconds.",
    hour: Math.max(0, Math.min(23, prefs.morningHour)),
    minute: 0,
  }]
  if (prefs.noon) {
    out.push({ id: 910002, title: "💧 Hydration check", body: "How's your water intake looking today?", hour: 13, minute: 0 })
  }
  if (prefs.evening) {
    out.push({ id: 910003, title: "✅ Habits", body: "Any habits left to close out before bed?", hour: 20, minute: 0 })
  }
  return out
}

/**
 * Cancel everything we scheduled and re-schedule from scratch: upcoming
 * reminders (one-shot) + daily nudges (repeating), unless nudges are off.
 * Returns the number of notifications scheduled.
 */
export async function syncNotifications(
  reminders: Reminder[],
  habits: HabitReminder[] = [],
  meds: MedReminder[] = [],
  nudgePrefs: NudgePrefs = DEFAULT_NUDGE_PREFS,
): Promise<number> {
  const ln = await getPlugin()
  if (!ln) return 0

  const granted = await ensureNotificationPermission()
  if (!granted) return 0

  try {
    // Android tolerates re-registering the same types on every sync.
    await ln.registerActionTypes?.({ types: ACTION_TYPES }).catch(() => {})

    // Clear previously scheduled notifications so we don't pile up duplicates.
    // Snoozed copies survive: the user explicitly asked for those, and this
    // rebuild would otherwise eat a snooze whenever the app gets opened
    // before it fires.
    const pending = await ln.getPending()
    const cancellable = (pending?.notifications ?? []).filter(
      (n: { id: number }) => !(n.id >= SNOOZE_ID_BASE && n.id < SNOOZE_ID_BASE + SNOOZE_ID_SPAN),
    )
    if (cancellable.length) {
      await ln.cancel({ notifications: cancellable.map((n: { id: number }) => ({ id: n.id })) })
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
        actionTypeId: "TODO_REMINDER",
        extra: { kind: "reminder", id: r.id },
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
          actionTypeId: "HABIT_REMINDER",
          extra: { kind: "habit", id: habit.id },
        })
      }
    }

    // ── Medication doses ─────────────────────────────────────────────────
    // Previously server-push only, which made the one thing that most needs
    // an exact time the least reliably delivered thing in the app: a 21:00
    // dose depended on a ten-minute poll reaching a live app. Scheduled on
    // the device it fires at 21:00, offline, with the app closed.
    for (const med of meds) {
      if (med.active === false || med.remind === false) continue
      const times = [...(med.times ?? [])].sort().slice(0, MAX_MED_TIMES)
      if (times.length === 0) continue

      for (let day = 0; day < MED_WINDOW_DAYS; day++) {
        // daysOfWeek / startDate / endDate are interpreted by exactly the same
        // function the server cron and the medications page use, so the phone
        // can't disagree with either about which days a course runs.
        if (!activeOn({
          id: med.id, name: med.name, times, daysOfWeek: med.daysOfWeek ?? [],
          active: med.active, startDate: med.startDate, endDate: med.endDate,
        }, localDateOn(day))) continue

        times.forEach((time, i) => {
          // Doses cover times in order, so today's first `takenToday` slots are
          // already dealt with — the same rule the page and the cron apply.
          if (day === 0 && i < (med.takenToday ?? 0)) return
          const at = localTimeOn(day, time)
          if (!at || at.getTime() <= now) return
          toSchedule.push({
            id: medNotifId(med.id, day, i),
            title: "💊 Time for your dose",
            body: med.dose ? `${med.name} (${med.dose})` : med.name,
            schedule: { at, allowWhileIdle: true },
            actionTypeId: "MED_REMINDER",
            // The dose log keys on the medication's name, same as the page.
            extra: { kind: "med", name: med.name },
          })
        })
      }
    }

    if (nudgesEnabled()) {
      for (const n of buildNudges(nudgePrefs)) {
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

/**
 * Whether Android will let us schedule *exact* alarms.
 *
 * Separate from the notification permission above, and separately grantable.
 * The app declares SCHEDULE_EXACT_ALARM rather than USE_EXACT_ALARM — the
 * latter is reserved by Play for alarm-clock and calendar apps, which this
 * isn't. On Android 13+ SCHEDULE_EXACT_ALARM starts denied, so reminders land
 * via setAndAllowWhileIdle: they still fire, but Android may batch them a few
 * minutes either side. Fine for "take your vitamins", less so for someone who
 * wants 07:30 to mean 07:30 — hence the opt-in.
 */
export async function getExactAlarmPermission(): Promise<"granted" | "denied" | "unavailable"> {
  const ln = await getPlugin()
  if (!ln?.checkExactNotificationSetting) return "unavailable"
  try {
    const res = await ln.checkExactNotificationSetting()
    return res?.exact_alarm === "granted" ? "granted" : "denied"
  } catch {
    return "unavailable"
  }
}

/**
 * Send the user to Android's "Alarms & reminders" screen for this app. There
 * is no in-app prompt for this one — the system settings page is the only way
 * to grant it. Returns the state after they come back.
 */
export async function requestExactAlarmPermission(): Promise<"granted" | "denied" | "unavailable"> {
  const ln = await getPlugin()
  if (!ln?.changeExactNotificationSetting) return "unavailable"
  try {
    const res = await ln.changeExactNotificationSetting()
    return res?.exact_alarm === "granted" ? "granted" : "denied"
  } catch {
    return "unavailable"
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

// Registered once per app session; the plugin queues events that arrive while
// the app is closed and replays them once a listener exists, so registering
// early in the app's lifetime is what makes closed-app button taps count.
let actionHandlerRegistered = false

/**
 * Handle the notification action buttons: complete the habit, log the dose,
 * tick off the to-do, or snooze the notification half an hour — all without
 * the app being opened first. A plain body tap has actionId "tap" and is left
 * alone: it opens the app, which is already the right thing.
 */
export async function registerNotificationActionHandler(): Promise<void> {
  if (actionHandlerRegistered) return
  const ln = await getPlugin()
  if (!ln) return
  actionHandlerRegistered = true

  try {
    await ln.addListener("localNotificationActionPerformed", async (event: any) => {
      try {
        const actionId: string = event?.actionId ?? ""
        const notif = event?.notification
        const extra = notif?.extra ?? {}

        if (actionId === "snooze") {
          await ln.schedule({
            notifications: [{
              id: SNOOZE_ID_BASE + Math.floor(Math.random() * SNOOZE_ID_SPAN),
              title: notif?.title ?? "Reminder",
              body: notif?.body ?? "",
              schedule: { at: new Date(Date.now() + SNOOZE_MINUTES * 60_000), allowWhileIdle: true },
              actionTypeId: notif?.actionTypeId,
              extra,
            }],
          })
          return
        }

        const json = { "Content-Type": "application/json" }
        if (actionId === "done" && extra.kind === "habit" && extra.id) {
          // The phone's date, not the server's — same rule as the habits page.
          await fetch(`/api/habits/${extra.id}/complete`, {
            method: "POST", headers: json, body: JSON.stringify({ date: localDateOn(0) }),
          })
        } else if (actionId === "done" && extra.kind === "reminder" && extra.id) {
          await fetch(`/api/reminders/${extra.id}`, {
            method: "PATCH", headers: json, body: JSON.stringify({ isCompleted: true }),
          })
        } else if (actionId === "taken" && extra.kind === "med" && extra.name) {
          await fetch("/api/medications", {
            method: "POST", headers: json, body: JSON.stringify({ name: extra.name }),
          })
        } else {
          return
        }

        // The completion just logged makes some of today's still-pending
        // copies stale (a later dose slot, tomorrow's habit window) — rebuild.
        await resyncNotifications()
      } catch {
        // A failed action tap must never take the app down with it.
      }
    })
  } catch {
    actionHandlerRegistered = false
  }
}

/**
 * What is actually laid down on this phone right now. This is the ground truth
 * the Settings card shows: `syncNotifications` swallows every failure and
 * returns 0, so without this the difference between "everything scheduled" and
 * "nothing will ever fire" was invisible — the exact shape of the "no
 * notifications, no idea why" bug report.
 */
export interface ScheduledStatus {
  /** False when not in the native app, or the plugin is missing from this APK. */
  available: boolean
  pending: number
  /** Soonest one-shot, ISO. Null when only repeating nudges are scheduled. */
  nextAt: string | null
}

export async function getScheduledStatus(): Promise<ScheduledStatus> {
  const ln = await getPlugin()
  if (!ln) return { available: false, pending: 0, nextAt: null }
  try {
    const res = await withTimeout<any>(ln.getPending(), 6000, null)
    if (!res) return { available: false, pending: 0, nextAt: null }
    const list: any[] = res.notifications ?? []
    let next: number | null = null
    for (const n of list) {
      const at = n?.schedule?.at ? new Date(n.schedule.at).getTime() : NaN
      if (Number.isFinite(at) && (next === null || at < next)) next = at
    }
    return { available: true, pending: list.length, nextAt: next !== null ? new Date(next).toISOString() : null }
  } catch {
    return { available: false, pending: 0, nextAt: null }
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

async function json<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url)
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

/** Fetch everything schedulable and (re)schedule from scratch. */
export async function resyncNotifications(): Promise<number> {
  try {
    const [reminders, habits, medPayload, morning, noon, evening] = await Promise.all([
      json<Reminder[]>("/api/reminders", []),
      json<HabitReminder[]>("/api/habits", []),
      json<{ items?: MedReminder[] }>("/api/med-schedule", {}),
      json<{ hour?: number }>("/api/preferences/reminder-time", {}),
      json<{ enabled?: boolean }>("/api/preferences/noon-reminder", {}),
      json<{ enabled?: boolean }>("/api/preferences/evening-reminder", {}),
    ])

    const count = await syncNotifications(
      Array.isArray(reminders) ? reminders : [],
      Array.isArray(habits) ? habits : [],
      Array.isArray(medPayload?.items) ? medPayload.items : [],
      {
        morningHour: typeof morning?.hour === "number" ? morning.hour : DEFAULT_NUDGE_PREFS.morningHour,
        noon: noon?.enabled !== false,
        evening: evening?.enabled !== false,
      },
    )

    // Tell the server the phone has these laid down locally, so its own
    // habit-reminder push stands down rather than buzzing a second time for
    // the same thing. The timestamp expires on the server side, so if the app
    // stops being opened the push quietly takes over again as the backstop.
    if (count > 0) {
      fetch("/api/preferences/local-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowDays: HABIT_WINDOW_DAYS }),
      }).catch(() => {})
    }

    return count
  } catch {
    return 0
  }
}
