// "Where was I, by the day" — and what the away days did to sleep and mood.
//
// Deliberately built on the location points that already exist rather than on
// check-ins: a trip to Athens leaves an obvious trace in a handful of fixes,
// while a check-in needs a saved place, which nobody has in Athens. That also
// means this answers for the past, not only from today onwards.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import {
  estimateHome, summariseDays, fillMissingDays, detectTrips, awayVsHome,
  type DatedPoint, type DayMetrics,
} from "@/lib/day-location"

const DEFAULT_DAYS = 180
const MAX_DAYS = 730

/** A day's worth of points is plenty to place it; a year of raw fixes is not. */
const MAX_POINTS = 40_000

type PointRow = { lat: number; lng: number; trackedAt: Date }
type HealthRow = { date: Date; readinessScore: number | null; sleepDuration: number | null; hrv: number | null }
type MoodRow = { date: Date; mood: number }

const dayOf = (d: Date) => d.toISOString().slice(0, 10)

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const asked = Number(new URL(req.url).searchParams.get("days"))
  const window = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_DAYS) : DEFAULT_DAYS
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000)

  const [timezone, points, healthLogs, moodLogs] = await Promise.all([
    getUserTimezone(userId),
    prisma.locationPoint.findMany({
      where: { userId, trackedAt: { gte: since } },
      select: { lat: true, lng: true, trackedAt: true },
      orderBy: { trackedAt: "asc" },
      take: MAX_POINTS,
    }).catch(() => [] as PointRow[]),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, readinessScore: true, sleepDuration: true, hrv: true },
    }).catch(() => [] as HealthRow[]),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, mood: true },
    }).catch(() => [] as MoodRow[]),
  ])

  const dated: DatedPoint[] = (points as PointRow[]).map(p => ({ lat: p.lat, lng: p.lng, at: p.trackedAt }))
  const home = estimateHome(dated, timezone)
  const days = summariseDays(dated, timezone, home)

  const metrics = new Map<string, DayMetrics>()
  for (const h of healthLogs as HealthRow[]) {
    metrics.set(dayOf(h.date), {
      sleepHours: h.sleepDuration == null ? null : h.sleepDuration / 60,
      readiness: h.readinessScore,
      hrv: h.hrv,
      mood: null,
    })
  }
  for (const m of moodLogs as MoodRow[]) {
    const key = dayOf(m.date)
    const row = metrics.get(key)
    if (row) row.mood = m.mood
    else metrics.set(key, { sleepHours: null, readiness: null, hrv: null, mood: m.mood })
  }

  return NextResponse.json({
    timezone,
    windowDays: window,
    // Truthful about how much of the window was actually observed — every
    // number below is only as good as this.
    trackedDays: days.length,
    home,
    days: fillMissingDays(days),
    trips: detectTrips(days),
    comparison: awayVsHome(days, metrics),
  })
}
