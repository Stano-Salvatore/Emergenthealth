// Mood lives in two tables, and every reader has to know it.
//
// `MorningCheckIn.mood` is the deliberate answer, given once, inside the
// check-in. `MoodLog` is the standalone one — Emergy's log_mood tool, and
// until this shipped, two buttons on the dashboard. Neither table is a
// superset of the other and neither is going away.
//
// Four readers took mood from MoodLog alone (the drift report, the weekly
// review, and both of Emergy's context loads) while two merged the pair with
// their own copy of the rule. So the day the dashboard buttons came off, mood
// would have quietly drained out of the monthly comparison, the Sunday email
// and everything Emergy says about how the week went — no error anywhere, just
// a metric that stops appearing.
//
// One merge, one rule, in one place: THE CHECK-IN WINS. It is the answer
// someone stopped to give, and a standalone log on the same day is the more
// casual tap.

import { prisma } from "@/lib/prisma"

/** A `@db.Date` column arrives at UTC midnight; a raw query may hand back either. */
export function moodDay(d: string | Date): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

/**
 * Every day in `[fromDay, toDay]` that has a mood, from either table.
 *
 * Both bounds are `YYYY-MM-DD` and inclusive. Failures fall back to the other
 * source rather than to nothing — a mood series with one table missing still
 * beats an empty one.
 */
export async function loadMoodByDay(
  userId: string, fromDay: string, toDay: string,
): Promise<Map<string, number>> {
  const from = new Date(fromDay + "T00:00:00.000Z")
  const to = new Date(toDay + "T23:59:59.999Z")

  const [standalone, checkIns] = await Promise.all([
    prisma.moodLog.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { date: true, mood: true },
    }).catch(() => [] as { date: Date; mood: number }[]),

    prisma.$queryRaw<{ date: string | Date; mood: number | null }[]>`
      SELECT "date", "mood" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" >= ${fromDay} AND "date" <= ${toDay}
    `.catch(() => [] as { date: string | Date; mood: number | null }[]),
  ])

  const byDay = new Map<string, number>()
  // Standalone first, so the check-in overwrites it rather than the reverse.
  for (const m of standalone) byDay.set(moodDay(m.date), m.mood)
  for (const c of checkIns) if (c.mood != null) byDay.set(moodDay(c.date), c.mood)
  return byDay
}

/** Day/value pairs, oldest first — the shape the series readers want. */
export async function loadMoodSeries(
  userId: string, fromDay: string, toDay: string,
): Promise<{ day: string; mood: number }[]> {
  const byDay = await loadMoodByDay(userId, fromDay, toDay)
  return [...byDay.entries()]
    .map(([day, mood]) => ({ day, mood }))
    .sort((a, b) => a.day.localeCompare(b.day))
}
