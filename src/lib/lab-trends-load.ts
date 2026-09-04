// Feeds the trend calculator from the database. Split from `lab-trends.ts` so
// the reasoning about what a change means stays testable without Postgres.

import { prisma } from "@/lib/prisma"
import { computeLabTrends, notableTrends, type DayFacts, type DayTags, type LabReading, type MarkerTrend } from "@/lib/lab-trends"
import { getUserTimezone } from "@/lib/user-timezone"

export interface LabTrendsResult {
  trends: MarkerTrend[]
  notable: MarkerTrend[]
  markerCount: number
}

export async function loadLabTrends(userId: string): Promise<LabTrendsResult> {
  const results = await prisma.labResult.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { marker: true, value: true, unit: true, date: true, referenceMin: true, referenceMax: true },
  })

  if (results.length === 0) return { trends: [], notable: [], markerCount: 0 }

  const readings: LabReading[] = results.map(r => ({
    marker: r.marker,
    value: r.value,
    unit: r.unit,
    date: r.date.toISOString().slice(0, 10),
    referenceMin: r.referenceMin,
    referenceMax: r.referenceMax,
  }))

  // Only doses from the earliest draw onwards can sit between two of them, and
  // one window's worth before that, for the "was this newly started?" check.
  const earliest = readings[0].date
  const lookback = new Date(earliest + "T00:00:00Z")
  lookback.setUTCFullYear(lookback.getUTCFullYear() - 1)
  const since = lookback.toISOString().slice(0, 10)

  const tagRows = await prisma.$queryRaw<{ day: string; tagName: string | null; text: string | null }[]>`
    SELECT "day", "tagName", "text" FROM "OuraTag"
    WHERE "userId" = ${userId} AND "day" >= ${since}
  `.catch(() => [] as { day: string; tagName: string | null; text: string | null }[])

  const tags: DayTags[] = tagRows
    .map(t => ({ day: t.day, name: (t.tagName ?? t.text ?? "").trim() }))
    .filter(t => t.name.length > 0)

  // Only as far back as a behaviour window can actually reach — see below.
  const floor = behaviourFloor(readings)
  const facts = floor ? await loadDayFacts(userId, floor) : []

  const trends = computeLabTrends(readings, tags, facts)
  return { trends, notable: notableTrends(trends), markerCount: trends.length }
}

const asMs = (day: string) => Date.parse(day + "T00:00:00Z")

/**
 * The earliest day any behaviour window can reach: one interval before the
 * second-most-recent draw of whichever marker was drawn longest ago.
 *
 * Without this the day rows would be read from the earliest draw minus a
 * year, which for someone with a few years of lab history means thousands of
 * rows that nothing then looks at. `readings` arrives sorted ascending, so
 * the last two entries per marker are the two the trend compares.
 */
function behaviourFloor(readings: LabReading[]): string | null {
  const lastTwo = new Map<string, string[]>()
  for (const r of readings) {
    const dates = lastTwo.get(r.marker) ?? []
    dates.push(r.date)
    if (dates.length > 2) dates.shift()
    lastTwo.set(r.marker, dates)
  }

  let floor: string | null = null
  for (const dates of lastTwo.values()) {
    if (dates.length < 2) continue
    const [previous, latest] = dates
    const span = asMs(latest) - asMs(previous)
    if (span <= 0) continue
    const from = new Date(asMs(previous) - span).toISOString().slice(0, 10)
    if (floor == null || from < floor) floor = from
  }
  return floor
}

/**
 * The everyday numbers, for the days the app genuinely knows something about.
 *
 * HealthLog is what defines "knows something about": it is the row the daily
 * sync writes, so its presence means the app was live that day and an absent
 * drink really is a day without one. Building the day set from the logs
 * themselves instead would make every window look sober and sedentary except
 * the days something was recorded — the exact bias this comparison exists to
 * avoid. A user with no health sync gets no rows here and no behaviour
 * context, which is the honest answer rather than an invented one.
 */
async function loadDayFacts(userId: string, since: string): Promise<DayFacts[]> {
  const sinceDate = new Date(since + "T00:00:00Z")

  const [healthLogs, stravaRows, bodyRows, alcoholRows, tz] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: sinceDate } },
      select: { date: true, sleepDuration: true, steps: true },
    }).catch(() => [] as { date: Date; sleepDuration: number | null; steps: number | null }[]),

    prisma.stravaActivity.findMany({
      where: { userId, day: { gte: since } },
      select: { day: true, movingTimeSec: true },
    }).catch(() => [] as { day: string; movingTimeSec: number }[]),

    prisma.bodyMeasurement.findMany({
      where: { userId, date: { gte: sinceDate } },
      select: { date: true, weightKg: true },
    }).catch(() => [] as { date: Date; weightKg: number | null }[]),

    prisma.intakeLog.findMany({
      where: { userId, type: "alcohol", loggedAt: { gte: sinceDate } },
      select: { loggedAt: true, amountMl: true },
    }).catch(() => [] as { loggedAt: Date; amountMl: number }[]),

    getUserTimezone(userId),
  ])

  if (healthLogs.length === 0) return []

  // A nightcap at 00:30 belongs to the evening it was drunk, not to the UTC
  // day the timestamp happens to fall in.
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz })

  const workoutByDay = new Map<string, number>()
  for (const a of stravaRows) {
    workoutByDay.set(a.day, (workoutByDay.get(a.day) ?? 0) + Math.round(a.movingTimeSec / 60))
  }

  const weightByDay = new Map<string, number>()
  for (const b of bodyRows) {
    // Date-only column: the UTC slice is the day it was recorded for.
    if (b.weightKg != null) weightByDay.set(b.date.toISOString().slice(0, 10), b.weightKg)
  }

  const alcoholByDay = new Map<string, number>()
  for (const a of alcoholRows) {
    const day = dayFmt.format(a.loggedAt)
    alcoholByDay.set(day, (alcoholByDay.get(day) ?? 0) + a.amountMl)
  }

  return healthLogs.map(l => {
    const day = l.date.toISOString().slice(0, 10)
    return {
      day,
      sleepH: l.sleepDuration != null ? l.sleepDuration / 60 : null,
      steps: l.steps,
      workoutMin: workoutByDay.get(day) ?? 0,
      alcoholMl: alcoholByDay.get(day) ?? 0,
      weightKg: weightByDay.get(day) ?? null,
    }
  }).sort((a, b) => a.day.localeCompare(b.day))
}
