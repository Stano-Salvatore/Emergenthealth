// Pulls the metric series out of HealthLog and runs the (pure, unit-tested)
// detector over them. Kept separate from `anomalies.ts` so the maths stays
// testable without a database.

import { prisma } from "@/lib/prisma"
import { detectAll, MIN_HISTORY_DAYS, type Anomaly, type DayValue } from "@/lib/anomalies"

/** Long enough for a robust baseline, short enough that it tracks the current you. */
export const SCAN_WINDOW_DAYS = 45

/** How stale the most recent reading may be before we stop calling it "today". */
const MAX_STALENESS_DAYS = 2

export interface ScanResult {
  anomalies: Anomaly[]
  /** Days of data in the window — below MIN_HISTORY_DAYS+1 nothing can fire. */
  days: number
  /** Date of the most recent reading, or null when there is none. */
  latestDate: string | null
  /** True when the newest data is too old to judge. */
  stale: boolean
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function scanUserAnomalies(
  userId: string,
  windowDays = SCAN_WINDOW_DAYS,
): Promise<ScanResult> {
  const since = new Date(Date.now() - windowDays * 86400000)
  const logs = await prisma.healthLog.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      restingHR: true,
      hrv: true,
      sleepScore: true,
      readinessScore: true,
      sleepDuration: true,
      steps: true,
      breathingRate: true,
      skinTemp: true,
    },
  })

  if (logs.length === 0) {
    return { anomalies: [], days: 0, latestDate: null, stale: false }
  }

  // Each metric gets its own series with its own gaps closed up: a day where
  // the ring recorded HRV but not steps shouldn't punch a hole in both.
  const series: Record<string, DayValue[]> = {
    restingHR: [], hrv: [], sleepScore: [], readinessScore: [],
    sleepDuration: [], steps: [], breathingRate: [], skinTemp: [],
  }
  const push = (key: string, date: string, value: number | null | undefined) => {
    if (value == null) return
    series[key].push({ date, value })
  }

  for (const l of logs) {
    const date = iso(l.date)
    push("restingHR", date, l.restingHR)
    push("hrv", date, l.hrv)
    push("sleepScore", date, l.sleepScore)
    push("readinessScore", date, l.readinessScore)
    push("sleepDuration", date, l.sleepDuration != null ? l.sleepDuration / 60 : null)
    push("steps", date, l.steps)
    push("breathingRate", date, l.breathingRate)
    push("skinTemp", date, l.skinTemp)
  }

  const latestDate = iso(logs[logs.length - 1].date)
  const ageDays = Math.floor((Date.now() - logs[logs.length - 1].date.getTime()) / 86400000)
  const stale = ageDays > MAX_STALENESS_DAYS

  // A gap in syncing is not an anomaly. Judging a five-day-old reading as
  // "today is unusual" would be wrong twice over — wrong day, and the user
  // can't act on it.
  const anomalies = stale ? [] : detectAll(series)

  return { anomalies, days: logs.length, latestDate, stale }
}

export { MIN_HISTORY_DAYS }
