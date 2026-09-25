// Assembles the day bags the scorer eats. Kept out of `daily-score.ts` so the
// scoring rules stay testable without a database.

import { prisma } from "@/lib/prisma"
import { localDateStr, addDaysISO } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { computeDailyScore, type DailyScore, type ScoreDay } from "@/lib/daily-score"
import { zonedDayRange } from "@/lib/local-date"
import { phoneNights } from "@/lib/phone-sleep"

/** Enough for a stable median without reaching back to a different version of you. */
export const SCORE_WINDOW_DAYS = 45

export async function loadDailyScore(
  userId: string, day?: string,
): Promise<DailyScore & { date: string; sleepSource: "ring" | "phone" | null }> {
  const tz = await getUserTimezone(userId)
  const date = day ?? localDateStr(tz)
  const since = addDaysISO(date, -SCORE_WINDOW_DAYS)
  const sinceDate = new Date(since + "T00:00:00Z")

  const [healthLogs, checkIns, moodLogs] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: sinceDate } },
      orderBy: { date: "asc" },
      select: {
        date: true, sleepScore: true, sleepDuration: true, deepSleep: true,
        readinessScore: true, hrv: true, restingHR: true,
        steps: true, activeMinutes: true, stressHigh: true,
      },
    }).catch(() => []),
    prisma.$queryRaw<{ date: string; energy: number | null; mood: number | null }[]>`
      SELECT "date", "energy", "mood" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" >= ${since}
    `.catch(() => [] as { date: string; energy: number | null; mood: number | null }[]),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: sinceDate } },
      select: { date: true, mood: true },
    }).catch(() => [] as { date: Date; mood: number | null }[]),
  ])

  const byDate = new Map<string, ScoreDay>()
  const get = (d: string): ScoreDay => {
    let bag = byDate.get(d)
    if (!bag) { bag = { date: d }; byDate.set(d, bag) }
    return bag
  }

  for (const l of healthLogs) {
    const bag = get(l.date.toISOString().slice(0, 10))
    bag.sleepScore = l.sleepScore
    bag.sleepDuration = l.sleepDuration
    bag.deepSleep = l.deepSleep
    bag.readinessScore = l.readinessScore
    bag.hrv = l.hrv
    bag.restingHR = l.restingHR
    bag.steps = l.steps
    bag.activeMinutes = l.activeMinutes
    bag.stressHigh = l.stressHigh
  }
  for (const c of checkIns) {
    const bag = get(c.date)
    bag.energy = c.energy
    bag.mood = c.mood
  }
  // A standalone mood log fills in for a morning that had no check-in; a
  // check-in's own mood is the more deliberate answer, so it wins.
  for (const m of moodLogs) {
    const bag = get(m.date.toISOString().slice(0, 10))
    if (bag.mood == null) bag.mood = m.mood
  }

  const today = byDate.get(date) ?? { date }
  const history = [...byDate.values()].filter(d => d.date < date)

  // A ring-off night used to blank the whole number: sleep, recovery and
  // steps all read absent, coverage fell under the floor, and the score died
  // on exactly the days the phone's estimate sat in its table. The fill is
  // TODAY only and ring-first — history baselines stay ring-only, because a
  // phone guess averaged into ring medians is the blend phone-sleep.ts
  // forbids. The source comes back so the card can label the estimate.
  let sleepSource: "ring" | "phone" | null = today.sleepDuration != null ? "ring" : null
  if (today.sleepDuration == null) {
    const { start, end } = zonedDayRange(tz, date)
    const nights = await phoneNights(userId, start, end, tz).catch(() => [])
    if (nights.length > 0) {
      today.sleepDuration = nights[nights.length - 1].minutes
      sleepSource = "phone"
    }
  }

  return { ...computeDailyScore(today, history), date, sleepSource }
}
