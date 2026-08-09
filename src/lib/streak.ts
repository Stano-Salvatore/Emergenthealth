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
