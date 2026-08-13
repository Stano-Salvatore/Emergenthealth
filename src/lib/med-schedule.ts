// Scheduled doses, and whether they actually happened.
//
// Nothing here stores adherence. A dose exists in exactly one place — the dose
// log — whether it arrived from the Oura ring, a manual tap, or a reminder.
// This module only says what *should* have happened and compares. That keeps
// "I took it but forgot to tick it off" impossible: ticking it off and logging
// it are the same action.

import { normalizeSupplement, cleanLabel, fold } from "@/lib/supplement-normalize"

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
}

export interface DoseLike {
  /** YYYY-MM-DD in the user's timezone. */
  day: string
  /** Whatever label the dose was logged under. */
  name: string
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
  const countByDayKey = new Map<string, number>()
  for (const d of doses) {
    const k = `${d.day}|${matchKey(d.name)}`
    countByDayKey.set(k, (countByDayKey.get(k) ?? 0) + 1)
  }

  return schedules.map(s => {
    const key = matchKey(s.name)
    let expected = 0
    let taken = 0
    const missedDays: string[] = []
    for (const day of days) {
      if (!activeOn(s, day)) continue
      const want = sortedTimes(s).length
      const got = Math.min(countByDayKey.get(`${day}|${key}`) ?? 0, want)
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
    }
  })
}
