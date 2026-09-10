// Month against month, honestly.
//
// "This month your sleep score is 78 against 74 — did you change something?"
// is the one question a naive comparison cannot ask without lying: September
// against August moves with daylight, temperature, holidays and the ring's own
// drift, and an autocorrelated series makes a 4-point gap from twelve nights
// look like news. So the comparison here does three things the sentence
// alone would not:
//
//   1. It tests the gap with the engine's block permutation, so a shift has
//      to survive the same week-scale shuffle every correlation card does.
//   2. It says what ELSE changed between the two windows — tags, habits,
//      workouts, drinks — drawn only from what the user logged, so the
//      candidates are theirs, not a wellness bot's.
//   3. When nothing logged moved, it asks. That is the useful part: the
//      answer becomes a tag, and the onset family can take it from there.
//
// Pure: the loader in drift-load.ts fetches, this judges.

import { blockPermutationP } from "@/lib/correlations"
import { TRACKED_METRICS } from "@/lib/anomalies"

export interface DayValue { day: string; value: number }

export interface DriftMetric {
  key: string
  label: string
  unit: string
  /** null when neither direction is "better" (mood is, steps are; nothing here is neutral yet). */
  higherIsBetter: boolean | null
  /** Ignore gaps smaller than this in raw units — significance is not relevance. */
  minShift: number
  decimals: number
}

/** The everyday numbers a month can move. Ring thresholds borrow the anomaly scan's. */
export const DRIFT_METRICS: DriftMetric[] = [
  { key: "sleepScore",     label: "Sleep score",        unit: "",    higherIsBetter: true,  minShift: 6,    decimals: 0 },
  { key: "sleepDuration",  label: "Sleep",              unit: "h",   higherIsBetter: true,  minShift: 0.5,  decimals: 1 },
  { key: "hrv",            label: "HRV",                unit: "ms",  higherIsBetter: true,  minShift: 5,    decimals: 0 },
  { key: "restingHR",      label: "Resting heart rate", unit: "bpm", higherIsBetter: false, minShift: 3,    decimals: 0 },
  { key: "readinessScore", label: "Readiness",          unit: "",    higherIsBetter: true,  minShift: 6,    decimals: 0 },
  { key: "steps",          label: "Steps",              unit: "",    higherIsBetter: true,  minShift: 1500, decimals: 0 },
  { key: "mood",           label: "Mood",               unit: "/5",  higherIsBetter: true,  minShift: 0.4,  decimals: 1 },
  { key: "energy",         label: "Morning energy",     unit: "/5",  higherIsBetter: true,  minShift: 0.4,  decimals: 1 },
]

// Sanity: the ring thresholds must not silently drift apart from the scan's.
for (const m of DRIFT_METRICS) {
  const scan = TRACKED_METRICS.find(t => t.key === m.key)
  if (scan && m.key !== "sleepDuration" && m.key !== "steps" && scan.minAbsShift !== m.minShift) {
    throw new Error(`drift threshold for ${m.key} disagrees with the anomaly scan`)
  }
}

/** Fewer observations than this in either window and the metric is not judged. */
export const MIN_PER_WINDOW = 10
export const P_THRESHOLD = 0.05

export interface Window { from: string; to: string }

export interface MetricShift {
  key: string
  label: string
  unit: string
  recentMean: number
  priorMean: number
  recentN: number
  priorN: number
  delta: number
  p: number
  verdict: "better" | "worse" | "changed"
}

/** A logged factor whose frequency moved between the windows. */
export interface FactorShift {
  label: string
  /** "days" for tags/habits/drinks, "sessions" for workouts, "ml/day" for water. */
  unit: "days" | "sessions" | "ml/day"
  recent: number
  prior: number
}

export interface DriftReport {
  recent: Window
  prior: Window
  /** Metrics that had enough data to be judged. */
  judged: number
  shifts: MetricShift[]
  factors: FactorShift[]
}

const inWindow = (day: string, w: Window) => day >= w.from && day <= w.to
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

/**
 * One metric, two windows. Null when either side is too thin, or when the gap
 * is below the relevance floor, or when it does not survive the permutation.
 * The observations are pushed prior-first in day order, which is what the
 * block shuffle needs to keep week-scale structure in the null.
 */
export function judgeMetric(metric: DriftMetric, values: DayValue[], prior: Window, recent: Window, seedKey: string): MetricShift | null {
  const sorted = [...values].sort((a, b) => a.day.localeCompare(b.day))
  const p0 = sorted.filter(v => inWindow(v.day, prior))
  const r0 = sorted.filter(v => inWindow(v.day, recent))
  if (p0.length < MIN_PER_WINDOW || r0.length < MIN_PER_WINDOW) return null

  const priorMean = mean(p0.map(v => v.value))
  const recentMean = mean(r0.map(v => v.value))
  const delta = recentMean - priorMean
  if (Math.abs(delta) < metric.minShift) return null

  const obs = [...p0.map(v => ({ v: v.value, hi: false })), ...r0.map(v => ({ v: v.value, hi: true }))]
  const p = blockPermutationP(obs, `${seedKey}:${metric.key}`)
  if (p >= P_THRESHOLD) return null

  const verdict = metric.higherIsBetter == null ? "changed"
    : (delta > 0) === metric.higherIsBetter ? "better" : "worse"
  return {
    key: metric.key, label: metric.label, unit: metric.unit,
    recentMean: round(recentMean, metric.decimals), priorMean: round(priorMean, metric.decimals),
    recentN: r0.length, priorN: p0.length,
    delta: round(delta, metric.decimals), p: round(p, 3), verdict,
  }
}

export interface FactorInput {
  /** Day → labels present that day (tags, habits done, drink types). */
  daysByLabel: Map<string, Set<string>>
  /** Workout days, possibly several a day. */
  workoutDays: string[]
  /** Water per day in ml. */
  waterByDay: Map<string, number>
}

/** Days counted in a window, so a rate can be compared across unequal windows. */
function windowDays(w: Window): number {
  return Math.round((Date.parse(w.to + "T00:00:00Z") - Date.parse(w.from + "T00:00:00Z")) / 86_400_000) + 1
}

/** A factor is reported when its share of days moved by this much. */
const FACTOR_RATE_SHIFT = 0.15
/** …and it was present on at least this many days in one of the windows. */
const FACTOR_MIN_DAYS = 3

/**
 * What the user did differently, by their own logs. Rates are compared as a
 * share of the window, then reported as days, scaled to the recent window's
 * length so "18 days vs 26" reads as a like-for-like count.
 */
export function judgeFactors(input: FactorInput, prior: Window, recent: Window): FactorShift[] {
  const out: FactorShift[] = []
  const pd = windowDays(prior), rd = windowDays(recent)

  const scaledPrior = (n: number) => Math.round((n / pd) * rd)

  for (const [label, days] of input.daysByLabel) {
    const pn = [...days].filter(d => inWindow(d, prior)).length
    const rn = [...days].filter(d => inWindow(d, recent)).length
    if (Math.max(pn, rn) < FACTOR_MIN_DAYS) continue
    if (Math.abs(rn / rd - pn / pd) < FACTOR_RATE_SHIFT) continue
    out.push({ label, unit: "days", recent: rn, prior: scaledPrior(pn) })
  }

  const wp = input.workoutDays.filter(d => inWindow(d, prior)).length
  const wr = input.workoutDays.filter(d => inWindow(d, recent)).length
  if (Math.max(wp, wr) >= FACTOR_MIN_DAYS && Math.abs(wr / rd - wp / pd) >= FACTOR_RATE_SHIFT / 2) {
    out.push({ label: "Workouts", unit: "sessions", recent: wr, prior: scaledPrior(wp) })
  }

  const water = (w: Window) => {
    const vals = [...input.waterByDay].filter(([d]) => inWindow(d, w)).map(([, v]) => v)
    return vals.length >= FACTOR_MIN_DAYS ? Math.round(mean(vals)) : null
  }
  const waterP = water(prior), waterR = water(recent)
  if (waterP != null && waterR != null && Math.abs(waterR - waterP) >= 300) {
    out.push({ label: "Water", unit: "ml/day", recent: waterR, prior: waterP })
  }

  // Biggest movers first, so a push that shows two shows the two that matter.
  return out.sort((a, b) => Math.abs(b.recent - b.prior) / Math.max(1, b.prior + b.recent) - Math.abs(a.recent - a.prior) / Math.max(1, a.prior + a.recent))
}

function fmt(n: number, unit: string): string {
  const s = unit === "" && n >= 1000 ? n.toLocaleString("en-GB") : String(n)
  return unit === "/5" ? `${s}/5` : unit ? `${s}${unit === "h" || unit === "" ? unit : " " + unit}` : s
}

function shiftLine(s: MetricShift): string {
  const arrow = s.delta > 0 ? "up" : "down"
  return `${s.label} ${fmt(s.recentMean, s.unit)} vs ${fmt(s.priorMean, s.unit)} (${arrow}, ${s.recentN} vs ${s.priorN} days)`
}

function factorLine(f: FactorShift): string {
  if (f.unit === "ml/day") return `water ${f.recent} vs ${f.prior} ml/day`
  return `${f.label.toLowerCase()} ${f.recent} vs ${f.prior} ${f.unit}`
}

export interface DriftText {
  /** One notification's worth, under 300 characters, ends with the question. */
  headline: string
  /** Everything, for the chat tool. */
  detail: string
}

function monthLabel(w: Window): string {
  const d = new Date(w.from + "T00:00:00Z")
  return d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })
}

/**
 * The words. Numbers first, candidates second, the question last — and the
 * question changes with whether anything logged can account for the shift.
 */
export function renderDrift(
  r: DriftReport,
  opts: { calendarMonths?: boolean; names?: { recent: string; prior: string } } = {},
): DriftText | null {
  if (r.shifts.length === 0) return null
  const recentName = opts.names?.recent ?? (opts.calendarMonths ? monthLabel(r.recent) : "the last 30 days")
  const priorName = opts.names?.prior ?? (opts.calendarMonths ? monthLabel(r.prior) : "the 30 before")

  const better = r.shifts.filter(s => s.verdict === "better")
  const worse = r.shifts.filter(s => s.verdict === "worse")
  const lead = [...better, ...worse].sort((a, b) => a.p - b.p)[0]

  const question = r.factors.length === 0
    ? "Nothing logged accounts for it — did something change that isn't in the app?"
    : "Does one of these ring true, or was it something else?"

  const candidates = r.factors.slice(0, 2).map(factorLine).join(", ")
  let headline = `${recentName} vs ${priorName}: ${shiftLine(lead)}.`
  if (r.shifts.length > 1) headline += ` ${r.shifts.length - 1} more moved.`
  if (candidates) headline += ` Changed alongside: ${candidates}.`
  headline += ` ${question}`
  if (headline.length > 296) headline = headline.slice(0, 293).replace(/\s+\S*$/, "") + "…"

  const lines = [
    `${recentName.charAt(0).toUpperCase() + recentName.slice(1)} (${r.recent.from} to ${r.recent.to}) against ${priorName} (${r.prior.from} to ${r.prior.to}); ${r.judged} metrics had enough data, each gap tested with the engine's block permutation (p < 0.05) and a relevance floor.`,
    better.length ? `Better: ${better.map(shiftLine).join("; ")}.` : null,
    worse.length ? `Worse: ${worse.map(shiftLine).join("; ")}.` : null,
    r.factors.length
      ? `Changed alongside, from their own logs: ${r.factors.map(factorLine).join("; ")}. These are candidates, not causes — the engine's cards are where a factor earns a claim.`
      : "Nothing they logged moved between the windows, so the app has no candidate for why.",
    question,
  ]
  return { headline, detail: lines.filter((l): l is string => l != null).join("\n") }
}
