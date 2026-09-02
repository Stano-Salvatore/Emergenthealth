// One definition of "what is this habit's streak".
//
// The habits API and the garden each used to work this out for themselves, and
// they disagreed: the garden ignored vacation mode entirely, so a streak the
// Habits page reported as frozen still wilted the plant, and it counted in the
// server's UTC days rather than the user's. Both now call in here.

import { prisma } from "@/lib/prisma"
import { addDaysISO } from "@/lib/local-date"

export interface VacationWindow {
  from: string   // YYYY-MM-DD
  until: string  // YYYY-MM-DD, inclusive
}

export async function getVacationWindow(userId: string): Promise<VacationWindow | null> {
  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "UserPreference" WHERE "userId" = ${userId} AND "key" = 'vacation_mode' LIMIT 1
    `
    if (!rows.length) return null
    const v = JSON.parse(rows[0].value)
    if (!v.active || !v.from || !v.until) return null
    return { from: String(v.from).slice(0, 10), until: String(v.until).slice(0, 10) }
  } catch {
    return null
  }
}

// Date strings compare correctly as strings, so no Date objects are involved.
export function makeIsFrozen(window: VacationWindow | null): (day: string) => boolean {
  if (!window) return () => false
  return day => day >= window.from && day <= window.until
}

/**
 * Length of the unbroken run ending today.
 *
 * Today is still in progress: it can extend a streak but never end one, so
 * when today isn't done yet the walk starts from yesterday. Frozen days
 * (vacation mode) hold a streak together without adding to its length.
 */
export function computeStreak(
  completionDays: Set<string>,
  todayStr: string,
  isFrozen: (day: string) => boolean = () => false,
): number {
  let cursor = completionDays.has(todayStr) || isFrozen(todayStr) ? todayStr : addDaysISO(todayStr, -1)
  let streak = 0
  while (completionDays.has(cursor) || isFrozen(cursor)) {
    if (!isFrozen(cursor)) streak++
    cursor = addDaysISO(cursor, -1)
    if (streak > 365) break // safety
  }
  return streak
}

/** Consecutive days missed, counting back from yesterday — what makes a plant wilt. */
export function computeMissedDays(
  completionDays: Set<string>,
  todayStr: string,
  isFrozen: (day: string) => boolean = () => false,
  cap = 10,
): number {
  let cursor = addDaysISO(todayStr, -1)
  let missed = 0
  while (missed < cap && !completionDays.has(cursor) && !isFrozen(cursor)) {
    missed++
    cursor = addDaysISO(cursor, -1)
  }
  return missed
}

/**
 * The longest run this habit has ever managed inside the history it has.
 *
 * The Habits page called `Math.max(...currentStreaks)` "Best streak", so it
 * read 0 on any day nothing had been ticked yet — under four weeks of
 * heatmap squares showing the opposite. A best is a record: missing today
 * cannot lower it.
 *
 * Frozen days hold a run together without lengthening it, exactly as
 * computeStreak treats them, so a fortnight away doesn't split one record
 * into two.
 */
export function computeBestStreak(
  completionDays: Set<string>,
  isFrozen: (day: string) => boolean = () => false,
): number {
  if (completionDays.size === 0) return 0
  const days = [...completionDays].sort()
  let best = 0
  let run = 0
  let prev: string | null = null

  for (const day of days) {
    if (prev === null) {
      run = 1
    } else {
      // Walk the gap: it keeps the run alive only if every day in it is frozen.
      let cursor = addDaysISO(prev, 1)
      let bridged = true
      while (cursor < day) {
        if (!isFrozen(cursor)) { bridged = false; break }
        cursor = addDaysISO(cursor, 1)
      }
      run = bridged ? run + 1 : 1
    }
    if (run > best) best = run
    prev = day
  }
  return best
}

/**
 * What share of the last `days` days each habit was actually kept, averaged
 * over the habits.
 *
 * The page showed `done today / habit count` under the label "Completion",
 * which is the number already displayed beside it as "Done today" — the same
 * fact twice, and a rate that reads 0% every morning before the first tick.
 *
 * A habit counts only from the day it was created: one added yesterday is not
 * 3% adherent because it did not exist last month. Days before any habit
 * existed are excluded rather than counted as missed.
 */
export function computeCompletionRate(
  habits: { completionDays: Set<string>; createdAt?: string | null }[],
  todayStr: string,
  days = 30,
): number | null {
  let due = 0
  let kept = 0
  for (const habit of habits) {
    for (let i = 0; i < days; i++) {
      const day = addDaysISO(todayStr, -i)
      // Today is still in progress — counting it as missed drags the rate
      // down all morning for no reason.
      if (i === 0) continue
      if (habit.createdAt && day < habit.createdAt.slice(0, 10)) continue
      due++
      if (habit.completionDays.has(day)) kept++
    }
  }
  return due === 0 ? null : kept / due
}
