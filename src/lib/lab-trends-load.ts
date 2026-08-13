// Feeds the trend calculator from the database. Split from `lab-trends.ts` so
// the reasoning about what a change means stays testable without Postgres.

import { prisma } from "@/lib/prisma"
import { computeLabTrends, notableTrends, type DayTags, type LabReading, type MarkerTrend } from "@/lib/lab-trends"

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

  const trends = computeLabTrends(readings, tags)
  return { trends, notable: notableTrends(trends), markerCount: trends.length }
}
