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
import { localDateStr } from "@/lib/local-date"
import {
  estimateHome, summariseDays, fillMissingDays, detectTrips, awayVsHome, agreementBetween,
  type DatedPoint, type DayMetrics,
} from "@/lib/day-location"
import { loadCoarsePoints } from "@/lib/day-location-load"

const DEFAULT_DAYS = 180
const MAX_DAYS = 730

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

  const [timezone, loaded, healthLogs, moodLogs] = await Promise.all([
    getUserTimezone(userId),
    loadCoarsePoints(userId, since),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, readinessScore: true, sleepDuration: true, hrv: true },
    }).catch(() => [] as HealthRow[]),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since } },
      select: { date: true, mood: true },
    }).catch(() => [] as MoodRow[]),
  ])

  const dated: DatedPoint[] = loaded.points
  const home = estimateHome(dated, timezone)
  const days = summariseDays(dated, timezone, home)

  // Two independent witnesses to the same week. Google's import is the only
  // way to find out whether the app's own tracking actually ran — a week the
  // app has nothing for looks identical, from inside the app, to a week spent
  // at home.
  const pick = (want: (source: string) => boolean): DatedPoint[] =>
    loaded.points.filter(p => want(p.source))
  const appDays = summariseDays(pick(src => src !== "timeline"), timezone, home)
  const timelineDays = summariseDays(pick(src => src === "timeline"), timezone, home)
  // Every strip spans the whole window asked for, not just the days that have
  // data — so the gaps are visible as gaps. A strip that quietly starts at the
  // first recorded day makes patchy tracking look continuous.
  const spanFrom = localDateStr(timezone, since)
  const spanTo = localDateStr(timezone)

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
    // Set when the window held more than could be loaded and its oldest end
    // was dropped — the strip is then shorter than the window asked for.
    truncated: loaded.truncated,
    home,
    days: fillMissingDays(days, spanFrom, spanTo),
    trips: detectTrips(days),
    comparison: awayVsHome(days, metrics),
    sources: {
      app: {
        points: Object.entries(loaded.countsBySource)
          .filter(([src]) => src !== "timeline")
          .reduce((n, [, c]) => n + c, 0),
        days: appDays.length,
        strip: fillMissingDays(appDays, spanFrom, spanTo),
      },
      timeline: {
        points: loaded.countsBySource.timeline ?? 0,
        days: timelineDays.length,
        strip: fillMissingDays(timelineDays, spanFrom, spanTo),
      },
      agreement: agreementBetween(appDays, timelineDays),
    },
  })
}
