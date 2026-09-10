// Which days a habit is due, and what its streak means once not every day is.
//
// A daily habit is the simple case: every day is due, every miss is a miss.
// Two more shapes cover what people actually set up in a habit app:
//
//   - specific weekdays ("gym Mon/Wed/Fri"): off-days hold the streak the way
//     a vacation day does and never ring; a miss on a due day breaks it.
//   - N times a week ("run 3× a week"): no fixed days; the week (Mon–Sun) is
//     the unit, so the streak counts consecutive weeks that hit the target.
//
// Skipped days — the user said "not today, because…" — are treated as
// off-days for streak purposes. They are not completions and are stored apart
// from them (HabitSkip), so nothing that counts completions can be fooled.

import { addDaysISO } from "@/lib/local-date"
import { dayOfWeek } from "@/lib/recurrence"
import { computeStreak } from "@/lib/streak"

export interface HabitSchedule {
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  scheduleDays: number[]
  /** Set for "N times a week" habits. Takes precedence over scheduleDays. */
  timesPerWeek: number | null
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Validate a schedule from the wire. Unknown shapes become "every day". */
export function normalizeSchedule(input: { scheduleDays?: unknown; timesPerWeek?: unknown }): HabitSchedule {
  let days: number[] = []
  if (Array.isArray(input.scheduleDays)) {
    days = [...new Set(input.scheduleDays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    if (days.length === 7) days = []
  }
  let tpw: number | null = null
  if (input.timesPerWeek != null && input.timesPerWeek !== "") {
    const n = Number(input.timesPerWeek)
    if (Number.isInteger(n) && n >= 1 && n <= 6) tpw = n
  }
  if (tpw != null) days = []
  return { scheduleDays: days, timesPerWeek: tpw }
}

/** The Monday that starts the week containing `day`. */
export function weekStart(day: string): string {
  const dow = dayOfWeek(day)
  return addDaysISO(day, -((dow + 6) % 7))
}

/** Whether the calendar says this habit is due on `day` (ignores completions). */
export function isScheduledOn(h: HabitSchedule, day: string): boolean {
  if (h.timesPerWeek != null) return true
  if (h.scheduleDays.length === 0) return true
  return h.scheduleDays.includes(dayOfWeek(day))
}

/** Completions inside the Mon–Sun week of `day`. */
export function weekCount(completionDays: Set<string>, day: string): number {
  const start = weekStart(day)
  let n = 0
  for (let i = 0; i < 7; i++) if (completionDays.has(addDaysISO(start, i))) n++
  return n
}

/**
 * Whether the habit still asks something of the user on `day`: scheduled, and
 * for a weekly-target habit, the week's quota not already met by other days.
 * Done or skipped on the day itself doesn't make it "not due" — that is the
 * page's completedToday, kept separate on purpose.
 */
export function isDueOn(h: HabitSchedule, day: string, completionDays: Set<string>): boolean {
  if (h.timesPerWeek != null) {
    const others = weekCount(completionDays, day) - (completionDays.has(day) ? 1 : 0)
    return others < h.timesPerWeek
  }
  return isScheduledOn(h, day)
}

/**
 * The days that hold a streak together without adding to it: off-days of the
 * schedule, skipped days, and whatever the caller already freezes (vacation).
 */
export function makeOffDay(
  h: HabitSchedule,
  skipDays: Set<string>,
  isFrozen: (day: string) => boolean = () => false,
): (day: string) => boolean {
  return day => isFrozen(day) || skipDays.has(day) || !isScheduledOn(h, day)
}

export interface HabitStreak {
  streak: number
  unit: "days" | "weeks"
}

/**
 * The streak, in the unit the schedule makes meaningful.
 *
 * Weekday and daily habits count days (off-days and skips bridge gaps).
 * Weekly-target habits count consecutive weeks that met the target; the
 * current week counts once it is met and is otherwise still in progress, so
 * — like today for a daily habit — it can extend the run but never end it.
 */
export function habitStreak(
  h: HabitSchedule,
  completionDays: Set<string>,
  skipDays: Set<string>,
  todayStr: string,
  isFrozen: (day: string) => boolean = () => false,
): HabitStreak {
  if (h.timesPerWeek == null) {
    return { streak: computeStreak(completionDays, todayStr, makeOffDay(h, skipDays, isFrozen)), unit: "days" }
  }
  const target = h.timesPerWeek
  let start = weekStart(todayStr)
  let streak = 0
  // A week with every day frozen (vacation) or with a skip in it is bridged.
  const weekBridged = (ws: string) => {
    for (let i = 0; i < 7; i++) {
      const d = addDaysISO(ws, i)
      if (isFrozen(d) || skipDays.has(d)) return true
    }
    return false
  }
  if (weekCount(completionDays, start) >= target) streak++
  start = addDaysISO(start, -7)
  for (let guard = 0; guard < 520; guard++) {
    const n = weekCount(completionDays, start)
    if (n >= target) streak++
    else if (weekBridged(start)) { /* holds */ }
    else break
    start = addDaysISO(start, -7)
  }
  return { streak, unit: "weeks" }
}

/** Human line for the card: "Mon · Wed · Fri", "3× a week", or null for daily. */
export function scheduleLabel(h: HabitSchedule): string | null {
  if (h.timesPerWeek != null) return `${h.timesPerWeek}× a week`
  if (h.scheduleDays.length === 0) return null
  const days = h.scheduleDays
  if (days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d))) return "Weekdays"
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "Weekends"
  return days.map(d => WEEKDAY_SHORT[d]).join(" · ")
}
