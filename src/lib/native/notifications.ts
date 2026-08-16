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
import { looksLikeStaleChunk, reloadForFreshBuild } from "@/lib/stale-chunk"

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

// If a native bridge call doesn't respond within `ms`, treat it as unavailable
// rather than hanging forever. On an APK built without the notifications plugin
// registered natively, the call never resolves — it goes to a native side that
// isn't listening. Every bridge call below is wrapped, because one unwrapped
// call is enough to strand the UI: "Send test" sat on "Sending…" forever not
// because the test hung, but because reading the permission afterwards did.
//
// The deadline is kept by two clocks. Samsung's power saving mode throttles a
// WebView's timer queue to a crawl, which froze every setTimeout-based
// timeout together with the calls it was guarding — "Sending…" for five
// minutes on a phone where the same call answers in 8ms with the saver off.
// A MessageChannel pump is a chain of macrotasks, not timers, and is exempt
// from that clamping (it is how React's scheduler dodges the same throttle),
// so the fallback fires on schedule even when setTimeout cannot.
function timeoutSignal(ms: number): Promise<void> {
  return new Promise(resolve => {
    const deadline = Date.now() + ms
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (mc) {
        mc.port1.onmessage = null
        mc.port1.close()
        mc.port2.close()
      }
      resolve()
    }
    const timer = setTimeout(done, ms)
    let mc: MessageChannel | null = null
    try {
      mc = new MessageChannel()
      mc.port1.onmessage = () => {
        if (settled) return
        if (Date.now() >= deadline) done()
        else mc!.port2.postMessage(0)
      }
      mc.port2.postMessage(0)
    } catch {
      // No MessageChannel — the plain timer stays as the only clock.
    }
  })
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, timeoutSignal(ms).then(() => fallback)])
}

/**
 * A deadline the UI can hold independently of the work it is waiting on.
 *
 * Every bounded call in this module still produced a button stuck on
 * "Sending…" past its own timeout, so the screen must be able to give a
 * verdict without trusting anything in here to resolve — a watchdog inside
 * the machinery under suspicion is no watchdog at all.
 */
export function deadline(ms: number): Promise<void> {
  return timeoutSignal(ms)
}

const BRIDGE_TIMEOUT_MS = 6000

/** Await a bridge call, resolving to `fallback` if it never answers or throws. */
async function bridge<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await withTimeout(call(), BRIDGE_TIMEOUT_MS, fallback)
  } catch {
    return fallback
  }
}

// One success is permanent: a phone proved that raw imports and bridge calls
// can all answer in single-digit milliseconds while this wrapper reported
// "nothing there" — every user-visible feature funnels through here, so its
// null IS the notifications outage. Caching means a single good resolution
// anywhere in the session heals every later caller, and when it does fail,
// `lastPluginFailure` records which branch — the word "unavailable" alone has
// cost days.
let cachedPlugin: any | null = null
let lastPluginFailure = "not attempted yet"

// The imports start once, at module evaluation — the moment the page loads.
// A phone spent an evening hanging forever inside on-demand imports of these
// same modules ("loading plugin…" with a live heartbeat right under it),
// while page loads kept working every single time: if this module is
// running, the chunk machinery just worked, so that is when to fetch the
// plugin — never later, from mid-session, where it demonstrably wedges.
const capacitorModules: Promise<{ Cap: any; LN: any } | null> | null =
  typeof window === "undefined"
    ? null
    : Promise.all([import("@capacitor/core"), import("@capacitor/local-notifications")])
        .then(([core, ln]) => ({
          Cap: (core as any).Capacitor ?? (core as any).default?.Capacitor,
          LN: (ln as any).LocalNotifications ?? (ln as any).default?.LocalNotifications,
        }))
        .catch(err => {
          lastPluginFailure = `import threw at page load: ${err instanceof Error ? err.message : String(err)}`
          return null
        })

/** Why the most recent getPlugin() returned null. For diagnostics display. */
export function getLastPluginFailure(): string {
  return lastPluginFailure
}

async function getPlugin(): Promise<any | null> {
  if (cachedPlugin) return cachedPlugin
  if (typeof window === "undefined") {
    lastPluginFailure = "server render"
    return null
  }
  try {
    const loaded = await withTimeout<{ ln: any | null } | "timeout">((async () => {
      // The page-load import if it is available, an on-demand one otherwise —
      // and still bounded, because a page-load import that wedged would
      // otherwise wedge every caller awaiting it for the life of the session.
      const mods = capacitorModules
        ? await capacitorModules
        : await (async () => {
            const core: any = await import("@capacitor/core")
            const ln: any = await import("@capacitor/local-notifications")
            // `?? default` on both: if a bundler ever serves the CJS build
            // through dynamic import, the exports sit one level down — and
            // this wrapper failing while identical-looking direct imports
            // succeed is exactly the bug being chased.
            return {
              Cap: core?.Capacitor ?? core?.default?.Capacitor,
              LN: ln?.LocalNotifications ?? ln?.default?.LocalNotifications,
            }
          })()
      if (!mods) return { ln: null }
      if (mods.Cap?.isNativePlatform?.() !== true) {
        lastPluginFailure = `isNativePlatform() returned ${String(mods.Cap?.isNativePlatform?.())}`
        return { ln: null }
      }
      if (!mods.LN) lastPluginFailure = "module loaded but has no LocalNotifications export"
      return { ln: mods.LN ?? null }
    })(), BRIDGE_TIMEOUT_MS, "timeout")
    if (loaded === "timeout") {
      lastPluginFailure = `import didn't settle within ${BRIDGE_TIMEOUT_MS}ms`
      return null
    }
    if (loaded.ln) {
      cachedPlugin = loaded.ln
      lastPluginFailure = "loaded"
    }
    return loaded.ln
  } catch (err) {
    // A page left running long enough for its build to be replaced can no
    // longer fetch the plugin's chunk. That reads as "notifications don't
    // work on this phone" when the truth is the tab is out of date, so take
    // the fresh build rather than reporting a fault that isn't there.
    const message = err instanceof Error ? err.message : String(err)
    lastPluginFailure = `threw: ${message}`
    if (looksLikeStaleChunk(message)) reloadForFreshBuild()
    return null
  }
}

/** Request notification permission. Returns true if granted (or already granted). */
export async function ensureNotificationPermission(): Promise<boolean> {
  const ln = await getPlugin()
  if (!ln) return false
  const check = await bridge<any>(() => ln.checkPermissions(), null)
  if (check?.display === "granted") return true
  // The OS prompt is user-driven, so it gets longer than a plain bridge call.
  const req = await withTimeout<any>(ln.requestPermissions().catch(() => null), 60_000, null)
  return req?.display === "granted"
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
    const pending = await bridge<any>(() => ln.getPending(), null)
    const cancellable = (pending?.notifications ?? []).filter(
      (n: { id: number }) => !(n.id >= SNOOZE_ID_BASE && n.id < SNOOZE_ID_BASE + SNOOZE_ID_SPAN),
    )
    if (cancellable.length) {
      await bridge<any>(() => ln.cancel({ notifications: cancellable.map((n: { id: number }) => ({ id: n.id })) }), null)
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
    // A schedule call that never answers means nothing was laid down, so it
    // must not be reported as success.
    const ok = await bridge(async () => { await ln.schedule({ notifications: capped }); return true }, false)
    return ok ? capped.length : 0
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
  const res = await bridge<any>(() => ln.checkExactNotificationSetting(), null)
  if (!res) return "unavailable"
  return res.exact_alarm === "granted" ? "granted" : "denied"
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
  const c = await bridge<any>(() => ln.checkPermissions(), null)
  // No answer from the bridge is not "prompt" — it means this build cannot
  // schedule anything, which is what the card needs to say.
  if (!c) return "unavailable"
  if (c.display === "granted") return "granted"
  if (c.display === "denied") return "denied"
  return "prompt"
}

// Registered once per app session; the plugin queues events that arrive while
// the app is closed and replays them once a listener exists, so registering
// early in the app's lifetime is what makes closed-app button taps count.
let actionHandlerRegistered = false

/**
 * Why notifications can't work here, when they can't.
 *
 * "Unavailable" has several very different causes that all look identical from
 * the outside — an old APK with no native plugin, a web bundle that failed to
 * ship the plugin's JS, a bridge that accepts calls and never answers — and
 * telling someone to update the app is only right for one of them. Capacitor
 * can distinguish them, so ask it rather than guess.
 */
export type NotifDiagnosis =
  | "ok"                    // the plugin answered
  | "not-native"            // a browser, not the app
  | "plugin-missing-in-app" // the installed APK has no LocalNotifications
  | "js-module-missing"     // the web build didn't ship the plugin's JS
  | "bridge-silent"         // registered, but calls go unanswered

export async function diagnoseNotifications(): Promise<{ reason: NotifDiagnosis; detail: string }> {
  if (typeof window === "undefined") return { reason: "not-native", detail: "server" }

  const core = await bridge<any>(() => import("@capacitor/core"), null)
  const Cap = core?.Capacitor
  if (!Cap?.isNativePlatform?.()) return { reason: "not-native", detail: "web browser" }

  const platform = Cap.getPlatform?.() ?? "unknown"

  // The injected bridge carries the definitive registry of what the installed
  // APK's native side registered — synchronous, no bridge round-trip, so it
  // can neither time out nor lose a race. This is what tells an out-of-date
  // *installed* APK apart from every check done on the *published* one: the
  // notifications plugin only entered the app on 2026-08-04 (#167), the app
  // never went through Play, and a shell sideloaded before then loads today's
  // web code against last month's native side. Naming what the phone actually
  // has makes that visible from the Settings screen.
  const headers = (Cap as any).PluginHeaders as { name?: string }[] | undefined
  const native = Array.isArray(headers) ? headers.map(h => h?.name).filter(Boolean) : null
  if (native && !native.includes("LocalNotifications")) {
    return {
      reason: "plugin-missing-in-app",
      detail: `${platform}: installed APK carries [${native.join(", ") || "no plugins"}] — no LocalNotifications. Sideload the current APK.`,
    }
  }

  // The bridge's own register of what the native side actually carries.
  if (Cap.isPluginAvailable?.("LocalNotifications") === false) {
    return { reason: "plugin-missing-in-app", detail: `${platform}: native plugin not registered` }
  }

  const mod = await bridge<any>(() => import("@capacitor/local-notifications"), null)
  if (!mod?.LocalNotifications) {
    return { reason: "js-module-missing", detail: `${platform}: plugin JS not in this web build` }
  }

  const perms = await bridge<any>(() => mod.LocalNotifications.checkPermissions(), null)
  if (!perms) {
    // Silence with the plugin in the registry is a different animal from
    // silence because it was never there — say which one this is.
    const registered = native ? ` (native side carries [${native.join(", ")}])` : ""
    return { reason: "bridge-silent", detail: `${platform}: no answer from the native side${registered}` }
  }

  return { reason: "ok", detail: `${platform}: permission ${perms.display}` }
}

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
    const res = await bridge<any>(() => ln.getPending(), null)
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

/**
 * Fire a test local notification a few seconds out so the user can confirm
 * notifications actually arrive on this phone. Returns what happened:
 *  - "scheduled": on its way (check in ~3s)
 *  - "denied": permission not granted
 *  - "unavailable": the plugin didn't load or the schedule call failed —
 *    `detail` carries the real reason, because "unavailable" alone has already
 *    proven itself a diagnostic dead end.
 *
 * `onStep` narrates each stage as it starts, because a test that says only
 * "Sending…" while it waits for an OS permission dialog is indistinguishable
 * from one that hung — which is precisely how a revoked permission spent an
 * evening masquerading as a broken bridge. The dialog wait gets a full
 * minute, not a race against a 6-second watchdog: a human is answering it.
 */
export async function scheduleTestNotification(
  onStep?: (step: string) => void,
): Promise<{ status: "scheduled" | "denied" | "unavailable"; detail?: string }> {
  onStep?.("loading plugin…")
  const ln = await getPlugin()
  if (!ln) return { status: "unavailable", detail: `plugin didn't load — ${getLastPluginFailure()}` }
  onStep?.("checking permission…")
  const check = await bridge<any>(() => ln.checkPermissions(), null)
  if (!check) return { status: "unavailable", detail: "checkPermissions(): no answer from the native side" }
  if (check.display !== "granted") {
    // Android 13 stops showing this dialog after it has been dismissed
    // twice — the request then reports denied without anything appearing.
    onStep?.("asking Android for permission — answer the dialog…")
    const req = await withTimeout<any>(ln.requestPermissions().catch(() => null), 60_000, null)
    if (req?.display !== "granted") {
      return {
        status: "denied",
        detail: "If no dialog appeared, Android has stopped asking: grant it in Settings → Apps → Emergenthealth → Notifications.",
      }
    }
  }
  onStep?.("scheduling…")
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
    ).then(r => { if (r === "timeout") throw new Error(`schedule(): no answer after 6000ms`) })
    return { status: "scheduled" }
  } catch (err) {
    return { status: "unavailable", detail: err instanceof Error ? err.message : String(err) }
  }
}

// ── Self-test ───────────────────────────────────────────────────────────────
// A phone showed `ok · permission granted` rendered inside the red box that
// only exists because the same call answered nothing moments earlier: the
// bridge on that device is nondeterministic, and any summary that averages
// nondeterminism into one word will keep contradicting itself. This makes no
// summary. It runs each raw call, times it, repeats the one that flakes, and
// reports what actually came back — including the real exception text the
// production code swallows.

export interface SelfTestStep {
  step: string
  ok: boolean
  ms: number
  detail: string
}

async function timedStep<T>(
  label: string,
  call: () => Promise<T>,
  describe: (v: T) => string,
): Promise<SelfTestStep> {
  const t0 = Date.now()
  try {
    const r = await withTimeout<{ v: T } | "timeout">(call().then(v => ({ v })), BRIDGE_TIMEOUT_MS, "timeout")
    if (r === "timeout") {
      return { step: label, ok: false, ms: Date.now() - t0, detail: `no answer after ${BRIDGE_TIMEOUT_MS}ms` }
    }
    return { step: label, ok: true, ms: Date.now() - t0, detail: describe(r.v) }
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return { step: label, ok: false, ms: Date.now() - t0, detail: msg }
  }
}

export async function runNotificationSelfTest(): Promise<SelfTestStep[]> {
  const steps: SelfTestStep[] = []
  const t0 = Date.now()
  try {
    // Timers first: every timeout below assumes setTimeout fires roughly on
    // schedule, and Samsung's power saving mode throttles a WebView's timer
    // queue to a crawl — which reads as "everything hangs forever" while taps
    // still respond. The probe races a 1s setTimeout against the untrottled
    // MessageChannel clock, so it reports the freeze instead of joining it —
    // its first version awaited the setTimeout directly and hung with
    // everything else, a probe made of the thing it was probing.
    const tTimer = Date.now()
    const timerFired = await Promise.race([
      new Promise<boolean>(r => setTimeout(() => r(true), 1000)),
      timeoutSignal(4000).then(() => false),
    ])
    const timerMs = Date.now() - tTimer
    steps.push({
      step: "timers",
      ok: timerFired && timerMs < 3000,
      ms: timerMs,
      detail: timerFired
        ? `1s setTimeout fired after ${timerMs}ms${timerMs < 3000 ? "" : " — badly delayed, power saving is throttling this WebView"}`
        : "1s setTimeout hadn't fired after 4s — power saving mode is freezing this WebView's timers. Charge the phone and turn off battery saver.",
    })

    const core: any = await withTimeout<any>(import("@capacitor/core"), BRIDGE_TIMEOUT_MS, null)
    if (!core) {
      steps.push({ step: "bridge", ok: false, ms: BRIDGE_TIMEOUT_MS, detail: "import of @capacitor/core didn't settle — chunk fetch hung" })
      return steps
    }
    const Cap = core?.Capacitor
    const native = Cap?.isNativePlatform?.() === true
    const headers = Array.isArray(Cap?.PluginHeaders)
      ? Cap.PluginHeaders.map((h: any) => h?.name).filter(Boolean)
      : null
    // System WebView versions carry their own bridge bugs, so name it.
    const webview = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "unknown"
    steps.push({
      step: "bridge",
      ok: native,
      ms: Date.now() - t0,
      detail: native
        ? `${Cap.getPlatform?.() ?? "?"}, WebView ${webview}, native side carries [${headers?.join(", ") ?? "unknown"}]`
        : "not running in the native app",
    })
    if (!native) return steps

    const t1 = Date.now()
    let ln: any = null
    try {
      const mod: any = await withTimeout<any>(import("@capacitor/local-notifications"), BRIDGE_TIMEOUT_MS, null)
      ln = mod?.LocalNotifications ?? mod?.default?.LocalNotifications ?? null
      steps.push({
        step: "plugin JS",
        ok: !!ln,
        ms: Date.now() - t1,
        detail: ln ? "module loaded" : mod ? "module has no LocalNotifications export" : "import didn't settle — chunk fetch hung",
      })
    } catch (err) {
      steps.push({ step: "plugin JS", ok: false, ms: Date.now() - t1, detail: err instanceof Error ? err.message : String(err) })
    }
    if (!ln) return steps

    // The production wrapper everything else routes through. The raw calls
    // above all passing while this fails is precisely the observed outage —
    // this line is the difference between "the phone is broken" and "one
    // function in this web app is broken".
    const t2 = Date.now()
    const viaWrapper = await getPlugin()
    steps.push({
      step: "getPlugin (app path)",
      ok: !!viaWrapper,
      ms: Date.now() - t2,
      detail: viaWrapper ? "plugin resolved" : getLastPluginFailure(),
    })

    // Three times over, sequentially: one dropped call renders as a missing
    // feature, and only repetition tells flaky from absent.
    for (let i = 1; i <= 3; i++) {
      steps.push(await timedStep(`checkPermissions #${i}`, () => ln.checkPermissions(), (v: any) => `display ${v?.display}`))
    }

    steps.push(await timedStep("getPending", () => ln.getPending(), (v: any) => `${v?.notifications?.length ?? 0} queued`))

    steps.push(await timedStep(
      "schedule probe",
      () => ln.schedule({
        notifications: [{
          id: 999_002,
          title: "🔎 Diagnostic probe",
          body: "If you can read this in your tray, scheduling works.",
          schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
        }],
      }),
      () => "accepted — should appear in ~5s",
    ))

    steps.push(await timedStep(
      "exact alarms",
      () => (ln.checkExactNotificationSetting ? ln.checkExactNotificationSetting() : Promise.resolve(null)),
      (v: any) => (v ? `exact_alarm ${v.exact_alarm}` : "not supported by this plugin version"),
    ))
  } catch (err) {
    steps.push({
      step: "self-test",
      ok: false,
      ms: Date.now() - t0,
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    })
  }
  return steps
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
