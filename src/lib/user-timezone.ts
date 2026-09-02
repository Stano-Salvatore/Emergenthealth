import { prisma } from "@/lib/prisma"
import { localDateStr, zonedDayRange } from "@/lib/local-date"

// The one database-backed piece of the date helpers, kept apart so that
// lib/local-date.ts stays safe for client components to import. See the note
// there.

export async function getUserTimezone(userId: string): Promise<string> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "timezone" } },
    select: { value: true },
  }).catch(() => null)
  return row?.value?.trim() || "UTC"
}

// Today, as the user's own calendar would call it.
//
// The fallback for "no date was sent" used to be the server's UTC day in a
// dozen routes. For anyone east of Greenwich that is yesterday for the first
// hours of every morning — so a habit ticked at 00:30, a mood logged on the
// way to bed, or a weight taken before dawn all landed on the wrong date, and
// the streak that depended on it broke for no reason the user could see.
export async function userToday(userId: string): Promise<string> {
  return localDateStr(await getUserTimezone(userId))
}

/**
 * Everything a route needs in order to say "today" for this user, from one
 * lookup:
 *
 *   today       — the local calendar date, YYYY-MM-DD
 *   dateColumn  — the same date as a `@db.Date` value (UTC midnight of that
 *                 date, which is what Prisma stores and compares for
 *                 HabitCompletion.date, MoodLog.date, HealthLog.date…)
 *   start / end — the instants the local day runs between, for timestamp
 *                 columns such as IntakeLog.loggedAt
 *
 * The distinction is the whole point. `new Date(); d.setHours(0,0,0,0)` was
 * the idiom in a dozen routes: on Vercel that is UTC midnight, so for the
 * first hours of every Prague morning "today's water" was yesterday's and a
 * habit ticked at 00:30 was filed a day early.
 */
export async function userDay(userId: string): Promise<{
  timezone: string
  today: string
  dateColumn: Date
  start: Date
  end: Date
}> {
  const timezone = await getUserTimezone(userId)
  const today = localDateStr(timezone)
  const { start, end } = zonedDayRange(timezone, today)
  return { timezone, today, dateColumn: new Date(today + "T00:00:00Z"), start, end }
}
