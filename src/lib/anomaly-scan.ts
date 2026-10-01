// Pulls the metric series out of HealthLog and runs the (pure, unit-tested)
// detector over them. Kept separate from `anomalies.ts` so the maths stays
// testable without a database.

import { prisma } from "@/lib/prisma"
import { detectEach, withComposites, MIN_HISTORY_DAYS, TRACKED_METRICS, type Anomaly, type DayValue } from "@/lib/anomalies"
import { bodyStrain, type BodyStrain } from "@/lib/body-strain"
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
  /** The night the vitals panel describes: the newest one with any vital on it. */
  vitalsDate: string | null
  /** True when the newest data is too old to judge. */
  stale: boolean
  /**
   * True when the newest night with vitals is too old to judge, though other
   * rows are recent: steps keep syncing from the phone while the ring sits in
   * a drawer, and `stale` alone would pass a two-week-old night to the card.
   */
  vitalsStale: boolean
  /** The vitals night graded as a whole; null when there is no fresh night to grade. */
  strain: BodyStrain | null
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
    return { anomalies: [], vitals: [], days: 0, latestDate: null, vitalsDate: null, stale: false, vitalsStale: false, strain: null }
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
    // 0 is the ring not measuring, not a reading — the report skips it too.
    push("spo2", date, l.spo2 != null && l.spo2 > 0 ? l.spo2 : null)
  }

  const latestDate = iso(logs[logs.length - 1].date)
  const ageDays = Math.floor((Date.now() - logs[logs.length - 1].date.getTime()) / 86400000)
  const stale = ageDays > MAX_STALENESS_DAYS

  // A gap in syncing is not an anomaly. Judging a five-day-old reading as
  // "today is unusual" would be wrong twice over — wrong day, and the user
  // can't act on it.
  const raw = stale ? [] : detectEach(series)
  const anomalies = withComposites(raw)

  // The panel's night comes from the vital series themselves. The newest row
  // of any kind is often a steps-only row an activity sync wrote this morning,
  // before the ring sent last night or on a night it spent on the charger —
  // and five dashes read off that row were headed "all in your usual band".
  const vitalsDate = VITAL_DEFS
    .map(d => series[d.key]?.at(-1)?.date)
    .filter((d): d is string => d != null)
    .sort()
    .at(-1) ?? null

  // The same staleness rule as the rows as a whole, applied to that night.
  const vitalsStale = vitalsDate != null
    && Math.floor((Date.now() - Date.parse(vitalsDate + "T00:00:00Z")) / 86400000) > MAX_STALENESS_DAYS

  return {
    anomalies, days: logs.length, latestDate, stale, vitalsDate, vitalsStale,
    vitals: stale || vitalsStale ? [] : vitalsPanel(series, vitalsDate),
    strain: stale || vitalsStale || !vitalsDate ? null : strainFor(raw, series, vitalsDate),
  }
}

function strainFor(raw: Anomaly[], series: Record<string, DayValue[]>, date: string): BodyStrain | null {
  const on = (key: string) => series[key]?.find(d => d.date === date)?.value ?? null
  const measured = Object.keys(series).filter(k => on(k) != null)
  // "Typical" is a claim about the usual, so readiness is named only once
  // there is enough history for the scan to have judged it.
  const readinessKnown = (series.readinessScore?.length ?? 0) > MIN_HISTORY_DAYS
  return bodyStrain(raw, {
    date,
    measured,
    readiness: readinessKnown ? on("readinessScore") : null,
    readinessLow: raw.some(a => a.metric === "readinessScore" && a.date === date && a.concerning),
  })
}

// ── The vitals panel ────────────────────────────────────────────────────────
//
// The scanner above reports only the OUTLIERS. A card needs the normal
// readings too: "all five inside your usual band" is information, not the
// absence of it. Same series, same robust statistics, no new thresholds —
// flagged means the same two-sigma spike the anomaly scan would call. That
// holds only while the baseline is built the same way: from the nights BEFORE
// the one being judged, with mad() already scaled to a standard deviation,
// and past the same minAbsShift relevance floor. Including the night itself
// and scaling twice made the card's band about half again as wide as the
// scan's, so it showed green under a brief that had just called the same HRV
// unusual; dropping the floor turns a 1.5 bpm wobble in a metronomic resting
// HR amber while the scan and the brief say nothing. Blood oxygen has no
// scan spec, so the panel judges it on z alone.

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

const floorFor = (key: string): number => TRACKED_METRICS.find(m => m.key === key)?.minAbsShift ?? 0

export function vitalsPanel(series: Record<string, DayValue[]>, latestDate: string | null): Vital[] {
  if (!latestDate) return []
  const out: Vital[] = []
  for (const def of VITAL_DEFS) {
    const s = series[def.key] ?? []
    const past = s.filter(d => d.date !== latestDate).map(d => d.value)
    if (past.length < MIN_HISTORY_DAYS) continue
    const med = median(past)
    const sigma = mad(past, med)
    const latest = s.find(d => d.date === latestDate)?.value ?? null
    const round = (v: number) => Math.round(v * 10 ** def.decimals) / 10 ** def.decimals
    const z = latest != null && sigma > 0 ? (latest - med) / sigma : null
    out.push({
      key: def.key, label: def.label, unit: def.unit,
      value: latest != null ? round(latest) : null,
      baseline: round(med),
      z: z != null ? Math.round(z * 10) / 10 : null,
      flagged: latest != null && z != null && Math.abs(z) >= 2 && Math.abs(latest - med) >= floorFor(def.key),
    })
  }
  return out
}

export { MIN_HISTORY_DAYS }
