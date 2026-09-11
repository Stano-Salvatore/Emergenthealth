import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"

export const runtime = "nodejs"
export const maxDuration = 60 // a year of visits joined to health rows

// Where you were, against how you slept.
//
// This route used to read one thing: a `timeline_visits` blob written by a
// one-off Google Timeline import. That import was run once, in August, and
// nothing has written to it since — so the places page has been answering
// "how is Kaviareň Vták treating me" out of a file that stops before half the
// visits happened, while 125 automatic check-ins sat in the CheckIn table
// being read by a different page entirely.
//
// Check-ins are now the source. They are live, they are the same rows the
// location page correlates, and they carry the place's own name and emoji
// instead of a coordinate that has to be matched. The import is still read,
// but only for an account that has no check-ins at all, so an old import
// keeps working without quietly outvoting today's data.
//
// Two things are also corrected while the source moves:
//
//   The baseline is per place. Averaging every day in the range and calling it
//   "baseline" put the visit days inside the thing they were compared against,
//   which shrinks every delta toward zero — the more you go somewhere, the
//   less going there appears to do.
//
//   Night metrics look at the following morning. HRV, readiness, resting HR
//   and both sleep figures are measured during the night; the row dated the
//   same day as an evening at a café describes the night BEFORE it. That is
//   the alignment rule the correlation engine follows, and this page was the
//   one place still comparing an afternoon to the sleep that preceded it.

// ─── Types ────────────────────────────────────────────────────────────────────

type Visit = { start: string; end: string }

interface LocationTarget {
  lat: number
  lng: number
  label: string
  emoji: string
}

interface TimelineVisitsData {
  targets: Record<string, LocationTarget>
  visits: Record<string, Visit[]>
  summary: Record<string, number>
}

type Metric = "hrv" | "readinessScore" | "sleepDuration" | "sleepEfficiency" | "restingHR" | "steps" | "mood"

/** Measured while you sleep, so they belong to the night AFTER the day you were there. */
const NIGHT_METRICS = new Set<Metric>(["hrv", "readinessScore", "sleepDuration", "sleepEfficiency", "restingHR"])

type Confidence = "insufficient" | "low" | "moderate" | "good"

export interface LocationCorrelationResult {
  locationKey: string
  label: string
  emoji: string
  n: number
  visitAvg: number | null
  baselineAvg: number | null
  delta: number | null
  confidence: Confidence
  caveat?: string
  /** "check-ins" for live data, "timeline-import" for an account still on the old blob. */
  source: "check-ins" | "timeline-import"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConfidence(n: number): Confidence {
  if (n < 6) return "insufficient"
  if (n < 15) return "low"
  if (n < 30) return "moderate"
  return "good"
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** A place with the days it was visited, whichever source produced it. */
interface PlaceDays {
  key: string
  label: string
  emoji: string
  days: Set<string>
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const metric = (searchParams.get("metric") ?? "hrv") as Metric
  const startDateParam = searchParams.get("startDate")
  const endDateParam = searchParams.get("endDate")

  // Valid metrics
  const validMetrics: Metric[] = ["hrv", "readinessScore", "sleepDuration", "sleepEfficiency", "restingHR", "steps", "mood"]
  if (!validMetrics.includes(metric)) {
    return NextResponse.json({ error: "Invalid metric" }, { status: 400 })
  }

  // Date range
  const endDate = endDateParam ? new Date(endDateParam + "T23:59:59Z") : new Date()
  const startDate = startDateParam
    ? new Date(startDateParam + "T00:00:00Z")
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

  // A check-in is an instant, so it needs the user's day; the HealthLog and
  // MoodLog dates below are date-only columns Prisma returns at UTC midnight,
  // where slicing is exact. Slicing an instant files an evening visit under
  // the day before for anyone east of Greenwich — which is every visit that
  // matters here.
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: await getUserTimezone(userId) })
  const localDay = (at: Date) => dayFmt.format(at)

  const isMood = metric === "mood"

  const [checkIns, healthLogs, moodLogs] = await Promise.all([
    prisma.$queryRaw<{ checkedAt: Date; place: string; emoji: string; savedPlaceId: string | null }[]>`
      SELECT "checkedAt", "place", "emoji", "savedPlaceId" FROM "CheckIn"
      WHERE "userId" = ${userId}
        AND "checkedAt" >= ${startDate}
        AND "checkedAt" <= ${endDate}
    `.catch(() => [] as { checkedAt: Date; place: string; emoji: string; savedPlaceId: string | null }[]),

    isMood
      ? Promise.resolve([])
      : prisma.healthLog.findMany({
          where: {
            userId,
            date: { gte: startDate, lte: new Date(endDate.getTime() + 24 * 60 * 60 * 1000) },
          },
          select: {
            date: true,
            hrv: true,
            readinessScore: true,
            sleepDuration: true,
            sleepEfficiency: true,
            restingHR: true,
            steps: true,
          },
          orderBy: { date: "asc" },
        }),

    isMood
      ? prisma.moodLog.findMany({
          where: {
            userId,
            date: { gte: startDate, lte: endDate },
          },
          select: { date: true, mood: true },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([]),
  ])

  // ── Which places, and which days ──────────────────────────────────────────
  let places: PlaceDays[] = []
  let source: LocationCorrelationResult["source"] = "check-ins"

  if (checkIns.length > 0) {
    // Grouped by saved place where there is one, and by name otherwise, so a
    // manual "Kaviareň Vták" and the automatic check-in at the same café are
    // one place rather than two half-powered ones.
    const byKey = new Map<string, PlaceDays>()
    for (const c of checkIns) {
      const key = c.savedPlaceId ?? `name:${c.place.trim().toLowerCase()}`
      let entry = byKey.get(key)
      if (!entry) {
        entry = { key, label: c.place, emoji: c.emoji, days: new Set<string>() }
        byKey.set(key, entry)
      }
      entry.days.add(localDay(c.checkedAt))
    }
    places = Array.from(byKey.values())
  } else {
    // No check-ins on this account. Fall back to an old Timeline import if one
    // was ever run, so nobody loses a page they had — but never mix the two.
    const pref = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "timeline_visits" } },
      select: { value: true },
    }).catch(() => null)

    if (!pref?.value) return NextResponse.json([], { status: 200 })

    let visitsData: TimelineVisitsData
    try {
      visitsData = JSON.parse(pref.value) as TimelineVisitsData
    } catch {
      return NextResponse.json({ error: "Corrupted timeline data in DB" }, { status: 500 })
    }

    source = "timeline-import"
    places = Object.entries(visitsData.targets).map(([key, target]) => {
      const days = new Set<string>()
      for (const visit of visitsData.visits[key] ?? []) {
        const startMs = new Date(visit.start).getTime()
        const endMs = new Date(visit.end).getTime()
        for (let cursor = startMs; cursor <= endMs; cursor += 24 * 60 * 60 * 1000) {
          days.add(localDay(new Date(cursor)))
        }
        days.add(localDay(new Date(endMs)))
      }
      return { key, label: target.label, emoji: target.emoji, days }
    })
  }

  // ── Build date → metric value map ─────────────────────────────────────────
  const dateMetricMap = new Map<string, number>()

  if (isMood) {
    for (const log of moodLogs) {
      const dateStr = (log.date as Date).toISOString().slice(0, 10)
      if (log.mood != null) dateMetricMap.set(dateStr, log.mood)
    }
  } else {
    for (const log of healthLogs) {
      const dateStr = (log.date as Date).toISOString().slice(0, 10)
      const value = log[metric as keyof typeof log] as number | null | undefined
      if (value != null) dateMetricMap.set(dateStr, value)
    }
  }

  // A day you were there reads its own value for a daytime metric, and the
  // following morning's for anything measured during the night.
  const readingFor = (day: string) =>
    dateMetricMap.get(NIGHT_METRICS.has(metric) ? nextDay(day) : day)

  // ── Per-location correlations ─────────────────────────────────────────────
  const results: LocationCorrelationResult[] = []

  // The comparison pool is every day that produced a reading. For a night
  // metric that is the day BEFORE each row, since that is the day whose
  // behaviour the night reflects.
  const candidateDays = new Set<string>()
  for (const key of dateMetricMap.keys()) {
    candidateDays.add(NIGHT_METRICS.has(metric) ? isoMinusOne(key) : key)
  }

  for (const place of places) {
    const visitValues: number[] = []
    for (const day of place.days) {
      const val = readingFor(day)
      if (val != null) visitValues.push(val)
    }

    // Baseline excludes this place's own days. Including them was the reason a
    // favourite haunt looked like it did nothing: the more nights it owned,
    // the more it became its own control group.
    const baselineValues: number[] = []
    for (const day of candidateDays) {
      if (place.days.has(day)) continue
      const val = readingFor(day)
      if (val != null) baselineValues.push(val)
    }

    const n = visitValues.length
    const visitAvg = avg(visitValues)
    const baselineAvg = avg(baselineValues)
    const delta = visitAvg != null && baselineAvg != null ? visitAvg - baselineAvg : null

    const result: LocationCorrelationResult = {
      locationKey: place.key,
      label: place.label,
      emoji: place.emoji,
      n,
      visitAvg: visitAvg != null ? Math.round(visitAvg * 10) / 10 : null,
      baselineAvg: baselineAvg != null ? Math.round(baselineAvg * 10) / 10 : null,
      delta: delta != null ? Math.round(delta * 10) / 10 : null,
      confidence: getConfidence(n),
      source,
    }

    if (metric === "steps") {
      result.caveat = "Steps correlate with transit distance to this location, not activity level at the location."
    }

    results.push(result)
  }

  // ── Sort by |delta| descending (nulls last) ───────────────────────────────
  results.sort((a, b) => {
    if (a.delta == null && b.delta == null) return 0
    if (a.delta == null) return 1
    if (b.delta == null) return -1
    return Math.abs(b.delta) - Math.abs(a.delta)
  })

  return NextResponse.json(results)
}

function isoMinusOne(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
