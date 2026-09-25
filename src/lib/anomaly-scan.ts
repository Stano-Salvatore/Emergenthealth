// Pulls the metric series out of HealthLog and runs the (pure, unit-tested)
// detector over them. Kept separate from `anomalies.ts` so the maths stays
// testable without a database.

import { prisma } from "@/lib/prisma"
import { detectAll, MIN_HISTORY_DAYS, type Anomaly, type DayValue } from "@/lib/anomalies"
import { median, mad } from "@/lib/anomalies"

/** Long enough for a robust baseline, short enough that it tracks the current you. */
export const SCAN_WINDOW_DAYS = 45

/** How stale the most recent reading may be before we stop calling it "today". */
const MAX_STALENESS_DAYS = 2

export interface ScanResult {
  anomalies: Anomaly[]
  /** The five overnight signals against their own baselines, outliers or not. */
  vitals: Vital[]
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
      sleepLatency: true,
      sleepEfficiency: true,
      spo2: true,
    },
  })

  if (logs.length === 0) {
    return { anomalies: [], vitals: [], days: 0, latestDate: null, stale: false }
  }

  // Each metric gets its own series with its own gaps closed up: a day where
  // the ring recorded HRV but not steps shouldn't punch a hole in both.
  const series: Record<string, DayValue[]> = {
    restingHR: [], hrv: [], sleepScore: [], readinessScore: [],
    sleepDuration: [], steps: [], breathingRate: [], skinTemp: [],
    sleepLatency: [], sleepEfficiency: [], spo2: [],
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
    push("sleepLatency", date, l.sleepLatency)
    push("sleepEfficiency", date, l.sleepEfficiency)
    push("spo2", date, l.spo2)
  }

  const latestDate = iso(logs[logs.length - 1].date)
  const ageDays = Math.floor((Date.now() - logs[logs.length - 1].date.getTime()) / 86400000)
  const stale = ageDays > MAX_STALENESS_DAYS

  // A gap in syncing is not an anomaly. Judging a five-day-old reading as
  // "today is unusual" would be wrong twice over — wrong day, and the user
  // can't act on it.
  const anomalies = stale ? [] : detectAll(series)

  return { anomalies, days: logs.length, latestDate, stale, vitals: stale ? [] : vitalsPanel(series, latestDate) }
}

// ── The vitals panel ────────────────────────────────────────────────────────
//
// The scanner above reports only the OUTLIERS. A card needs the normal
// readings too: "all five inside your usual band" is information, not the
// absence of it. Same series, same robust statistics, no new thresholds —
// flagged means the same two-sigma spike the anomaly scan would call.

const VITAL_DEFS: { key: string; label: string; unit: string; decimals: number }[] = [
  { key: "restingHR", label: "Resting heart rate", unit: " bpm", decimals: 0 },
  { key: "hrv", label: "HRV", unit: " ms", decimals: 0 },
  { key: "breathingRate", label: "Breathing", unit: " /min", decimals: 1 },
  { key: "skinTemp", label: "Skin temperature", unit: " °C", decimals: 1 },
  { key: "spo2", label: "Blood oxygen", unit: "%", decimals: 1 },
]

export interface Vital {
  key: string
  label: string
  unit: string
  /** The latest night's reading; null when that night had none. */
  value: number | null
  /** The personal median over the window. */
  baseline: number
  z: number | null
  flagged: boolean
}

export function vitalsPanel(series: Record<string, DayValue[]>, latestDate: string | null): Vital[] {
  if (!latestDate) return []
  const out: Vital[] = []
  for (const def of VITAL_DEFS) {
    const s = series[def.key] ?? []
    if (s.length < MIN_HISTORY_DAYS) continue
    const values = s.map(d => d.value)
    const med = median(values)
    const sigma = 1.4826 * mad(values, med)
    const latest = s.find(d => d.date === latestDate)?.value ?? null
    const round = (v: number) => Math.round(v * 10 ** def.decimals) / 10 ** def.decimals
    const z = latest != null && sigma > 0 ? (latest - med) / sigma : null
    out.push({
      key: def.key, label: def.label, unit: def.unit,
      value: latest != null ? round(latest) : null,
      baseline: round(med),
      z: z != null ? Math.round(z * 10) / 10 : null,
      flagged: z != null && Math.abs(z) >= 2,
    })
  }
  return out
}

export { MIN_HISTORY_DAYS }
