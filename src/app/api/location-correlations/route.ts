import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { readFileSync } from "fs"
import path from "path"

export const runtime = "nodejs"

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

  // ── Load visit data ────────────────────────────────────────────────────────
  let visitsData: TimelineVisitsData
  try {
    const filePath = path.join(process.cwd(), "data", "timeline-visits.json")
    visitsData = JSON.parse(readFileSync(filePath, "utf-8")) as TimelineVisitsData
  } catch {
    return NextResponse.json({ error: "Could not load timeline-visits.json" }, { status: 500 })
  }

  // ── Fetch health & mood data ───────────────────────────────────────────────
  const isMood = metric === "mood"

  const [healthLogs, moodLogs] = await Promise.all([
    isMood
      ? Promise.resolve([])
      : prisma.healthLog.findMany({
          where: {
            userId,
            date: { gte: startDate, lte: endDate },
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

  // ── Build date → metric value map ─────────────────────────────────────────
  const dateMetricMap = new Map<string, number>()

  if (isMood) {
    for (const log of moodLogs) {
      const dateStr = (log.date as Date).toISOString().slice(0, 10)
      if (log.mood != null) {
        dateMetricMap.set(dateStr, log.mood)
      }
    }
  } else {
    for (const log of healthLogs) {
      const dateStr = (log.date as Date).toISOString().slice(0, 10)
      const value = log[metric as keyof typeof log] as number | null | undefined
      if (value != null) {
        dateMetricMap.set(dateStr, value)
      }
    }
  }

  // ── Baseline: all values in the range ─────────────────────────────────────
  const allValues = Array.from(dateMetricMap.values())
  const baselineAvg = avg(allValues)

  // ── Per-location correlations ─────────────────────────────────────────────
  const results: LocationCorrelationResult[] = []

  for (const [locationKey, target] of Object.entries(visitsData.targets)) {
    const visits: Visit[] = visitsData.visits[locationKey] ?? []

    // Collect visit "end nights" (ISO date of when the visit ended)
    const visitDays = new Set<string>()
    for (const visit of visits) {
      const endNight = new Date(visit.end).toISOString().slice(0, 10)
      visitDays.add(endNight)
    }

    // Collect metric values on visit days
    const visitValues: number[] = []
    for (const day of visitDays) {
      const val = dateMetricMap.get(day)
      if (val != null) visitValues.push(val)
    }

    const n = visitValues.length
    const visitAvg = avg(visitValues)
    const delta = visitAvg != null && baselineAvg != null ? visitAvg - baselineAvg : null
    const confidence = getConfidence(n)

    const result: LocationCorrelationResult = {
      locationKey,
      label: target.label,
      emoji: target.emoji,
      n,
      visitAvg: visitAvg != null ? Math.round(visitAvg * 10) / 10 : null,
      baselineAvg: baselineAvg != null ? Math.round(baselineAvg * 10) / 10 : null,
      delta: delta != null ? Math.round(delta * 10) / 10 : null,
      confidence,
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
