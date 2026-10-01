// Scheduled doses, and whether they actually happened.
//
// Nothing here stores adherence. A dose exists in exactly one place — the dose
// log — whether it arrived from the Oura ring, a manual tap, or a reminder.
// This module only says what *should* have happened and compares. That keeps
// "I took it but forgot to tick it off" impossible: ticking it off and logging
// it are the same action.

import { normalizeSupplement, cleanLabel, fold } from "@/lib/supplement-normalize"
import { addDaysISO, localDateStr, localTimeStr } from "@/lib/local-date"

export interface ScheduleLike {
  id: string
  name: string
  /** Local times of day, "HH:mm", any order. */
  times: string[]
  /** 0 = Sunday. Empty means every day. */
  daysOfWeek: number[]
  active: boolean
  startDate?: string | null
  endDate?: string | null
  /**
   * The local day the schedule was added. Adherence starts here when no
   * start date was set: the days before the plan existed are not misses.
   */
  createdDay?: string | null
  /** A pack rhythm — the pill's 21 on, 7 off — counted from packStart. */
  packOnDays?: number | null
  packOffDays?: number | null
  packStart?: string | null
}

/** The pack fields of a schedule row, for building a ScheduleLike from it. */
export function packOf(s: { packOnDays?: number | null; packOffDays?: number | null; packStart?: string | null }) {
  return { packOnDays: s.packOnDays ?? null, packOffDays: s.packOffDays ?? null, packStart: s.packStart ?? null }
}

/** Inside the "on" days of the pack, or no pack at all. */
function onPackDay(s: ScheduleLike, day: string): boolean {
  const on = s.packOnDays
  const off = s.packOffDays
  if (!on || !off || !s.packStart) return true
  const since = Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(s.packStart + "T00:00:00Z")) / 86400000)
  if (since < 0) return false
  return since % (on + off) < on
}

export interface DoseLike {
  /** YYYY-MM-DD in the user's timezone. */
  day: string
  /** Whatever label the dose was logged under. */
  name: string
  /** When it was taken, epoch ms. Without it a dose is only its day. */
  at?: number
  /** Local minutes past midnight on `day`. */
  minutes?: number
  /** Logged in the app rather than tagged on the ring. */
  manual?: boolean
}

/** A row of the dose log, as the readers select it. */
export interface DoseRow {
  id: string
  day: string
  timestamp: Date
  tagName: string | null
  text: string | null
}

export function toDose(r: DoseRow, tz: string): DoseLike | null {
  const name = (r.tagName ?? r.text ?? "").trim()
  if (!name) return null
  const at = r.timestamp.getTime()
  // The clock only means something on the day the row is filed under.
  const onDay = localDateStr(tz, r.timestamp) === r.day
  const mins = onDay ? minutesOfDay(localTimeStr(tz, r.timestamp)) : Number.MAX_SAFE_INTEGER
  return {
    day: r.day,
    name,
    at,
    minutes: mins === Number.MAX_SAFE_INTEGER ? undefined : mins,
    manual: r.id.startsWith("manual_"),
  }
}

// The evening a late dose belongs to lasts until 05:00, as it does for the
// evening check-in (lib/checkin-mode).
const NIGHT_ENDS_MIN = 5 * 60

// One pill tagged on the ring and ticked off in the app arrives as two rows,
// minutes apart; two taps in the app are two doses, and so are two ring tags.
const SAME_DOSE_MS = 45 * 60_000

/**
 * How many of this schedule's doses each local day holds. A dose in the small
 * hours that sits nearer the previous day's last time than today's first
 * fills that day's slot while it is still open: Atarax due at 22:00 and taken
 * at 00:30 is last night's, and tonight's is still owed. A morning medicine is
 * never nearer yesterday, so it stays on the day it was taken.
 */
export function dosesByDay(s: ScheduleLike, doses: DoseLike[]): Map<string, number> {
  const key = matchKey(s.name)
  const mine = doses
    .filter(d => matchKey(d.name) === key)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.at ?? 0) - (b.at ?? 0))

  const kept: DoseLike[] = []
  const paired = new Set<DoseLike>()
  for (const d of mine) {
    const twin = d.at != null && kept.find(k =>
      !paired.has(k) && k.at != null && k.manual !== d.manual && Math.abs(k.at - d.at!) <= SAME_DOSE_MS)
    if (twin) { paired.add(twin); continue }
    kept.push(d)
  }

  const slots = sortedTimes(s).map(minutesOfDay)
  const counts = new Map<string, number>()
  for (const d of kept) {
    let day = d.day
    if (slots.length > 0 && d.minutes != null && d.minutes < NIGHT_ENDS_MIN) {
      const prev = addDaysISO(d.day, -1)
      const sinceLast = 1440 - slots[slots.length - 1] + d.minutes
      const untilFirst = Math.abs(slots[0] - d.minutes)
      if (sinceLast < untilFirst && activeOn(s, prev) && (counts.get(prev) ?? 0) < slots.length) day = prev
    }
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return counts
}

/**
 * The key two names have to share to count as the same substance. Canonical
 * form first so "D3", "vit d 2000IU" and "vitamín D" collapse together, then
 * folded so diacritics and casing don't matter.
 */
export function matchKey(name: string): string {
  return fold(normalizeSupplement(name) ?? cleanLabel(name))
}

/** "HH:mm" → minutes since local midnight; NaN-safe, invalid sorts last. */
export function minutesOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return Number.MAX_SAFE_INTEGER
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return Number.MAX_SAFE_INTEGER
  return h * 60 + min
}

export function sortedTimes(s: ScheduleLike): string[] {
  return [...s.times].filter(t => minutesOfDay(t) !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => minutesOfDay(a) - minutesOfDay(b))
}

function dayOfWeek(day: string): number {
  return new Date(day + "T00:00:00Z").getUTCDay()
}

/** Is this schedule meant to run on this local date? */
export function activeOn(s: ScheduleLike, day: string): boolean {
  if (!s.active) return false
  if (s.startDate && day < s.startDate) return false
  if (s.endDate && day > s.endDate) return false
  if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(dayOfWeek(day))) return false
  if (!onPackDay(s, day)) return false
  return sortedTimes(s).length > 0
}

export type DoseStatus = "taken" | "missed" | "upcoming"

export interface ScheduledDose {
  scheduleId: string
  name: string
  time: string
  status: DoseStatus
}

/**
 * Today's doses for one schedule, given how many doses of that substance are
 * already logged and the current local time in minutes.
 *
 * Logged doses are assigned to the earliest scheduled times rather than matched
 * by clock time: someone who takes their morning pill at 11 has still taken the
 * morning pill, and pretending otherwise would mark it missed and the evening
 * one taken. Grace applies to the deadline, not the assignment — a time only
 * becomes "missed" once it is more than `graceMin` past.
 */
export function dosesForDay(
  s: ScheduleLike,
  loggedCount: number,
  nowMinutes: number,
  graceMin = 90,
): ScheduledDose[] {
  const times = sortedTimes(s)
  return times.map((time, i) => {
    const covered = i < loggedCount
    const overdue = nowMinutes > minutesOfDay(time) + graceMin
    const status: DoseStatus = covered ? "taken" : overdue ? "missed" : "upcoming"
    return { scheduleId: s.id, name: s.name, time, status }
  })
}

/** How many doses should have been taken by `nowMinutes` on this day. */
export function dueByNow(s: ScheduleLike, nowMinutes: number, graceMin = 0): number {
  return sortedTimes(s).filter(t => nowMinutes >= minutesOfDay(t) + graceMin).length
}

export interface Adherence {
  scheduleId: string
  name: string
  expected: number
  taken: number
  /** 0-100, or null when nothing was expected in the window. */
  pct: number | null
  /** Local dates in the window on which at least one dose was missed. */
  missedDays: string[]
  /** Days in the window the schedule was expected to run. */
  daysCounted: number
}

/**
 * Adherence over a set of complete days. The current day is deliberately left
 * out by the caller — counting a schedule as missed at 9am because the evening
 * dose hasn't happened yet would make every number a lie.
 */
export function adherenceOver(
  schedules: ScheduleLike[],
  doses: DoseLike[],
  days: string[],
): Adherence[] {
  return schedules.map(s => {
    const byDay = dosesByDay(s, doses)
    let expected = 0
    let taken = 0
    let daysCounted = 0
    const missedDays: string[] = []
    const from = s.startDate ? null : s.createdDay ?? null
    for (const day of days) {
      if (!activeOn(s, day)) continue
      if (from && day < from) continue
      daysCounted++
      const want = sortedTimes(s).length
      const got = Math.min(byDay.get(day) ?? 0, want)
      expected += want
      taken += got
      if (got < want) missedDays.push(day)
    }
    return {
      scheduleId: s.id,
      name: s.name,
      expected,
      taken,
      pct: expected > 0 ? Math.round((taken / expected) * 100) : null,
      missedDays,
      daysCounted,
    }
  })
}

/**
 * Today's doses as Emergy reads them: per schedule running today, each time
 * and whether a dose is logged for it. "Not logged yet" is what the log
 * says, not what happened — a pill taken and never ticked off looks the same,
 * so he asks rather than concludes.
 */
export function todayDoseLines(
  schedules: (ScheduleLike & { dose?: string | null })[],
  doses: DoseLike[],
  today: string,
  nowMinutes: number,
): string[] {
  const lines: string[] = []
  for (const s of schedules) {
    if (!activeOn(s, today)) continue
    const logged = dosesByDay(s, doses).get(today) ?? 0
    const parts = dosesForDay(s, logged, nowMinutes).map(d => {
      const state = d.status === "taken" ? "logged"
        : d.status === "missed" ? "not logged yet"
        : nowMinutes >= minutesOfDay(d.time) ? "due now" : "due later"
      return `${d.time} ${state}`
    })
    lines.push(`${s.name}${s.dose ? ` (${s.dose})` : ""}: ${parts.join(", ")}`)
  }
  return lines
}
