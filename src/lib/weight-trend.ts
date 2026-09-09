// Weight, read as a trend rather than a number.
//
// A scale reading swings a kilogram between morning and night on water alone.
// Anyone chasing a target against raw readings sees noise, feels bad about
// it, and stops weighing. So the goal card never compares a single reading to
// anything: it smooths the series, measures the slope over a fortnight, and
// judges pace against that. The math is plain — trailing mean, least squares
// — because the input is one person's bathroom scale and nothing fancier
// would be honest.

import type { WeightGoalMode } from "@/lib/goals"

export interface WeightPoint {
  /** YYYY-MM-DD */
  date: string
  kg: number
}

export interface WeightTrendPoint extends WeightPoint {
  /** 7-day trailing mean; equals kg on the first reading. */
  trendKg: number
}

export type WeightGoalStatus =
  | "on_pace"    // moving in the right direction at roughly the chosen pace
  | "ahead"      // faster than the chosen pace (a warning when losing fast)
  | "behind"     // right direction, under half the chosen pace
  | "stalled"    // no meaningful movement over the window
  | "reversing"  // moving the wrong way
  | "holding"    // maintain goal: inside the band
  | "drifting"   // maintain goal: drifting out of the band
  | "reached"    // target passed
  | "no_data"    // fewer than two readings in the window

export interface WeightGoalProgress {
  status: WeightGoalStatus
  /** Latest trend value, or null without readings. */
  trendKg: number | null
  /** Latest raw reading. */
  latestKg: number | null
  latestDate: string | null
  /** Slope over the last 14 days of trend, kg per week (signed). */
  slopeKgWk: number | null
  /** Distance from the trend to the target, signed (target − trend). */
  remainingKg: number | null
  /** Progress from start to target, 0–1, clamped. Null without a start. */
  fraction: number | null
  /** Days until the target at the current slope, null when not converging. */
  etaDays: number | null
  /** Where the trend would be in 28 days at the current slope. */
  projectedKg: number | null
  /** Human-readable, one sentence. */
  summary: string
}

const WEEK = 7
const SLOPE_WINDOW_DAYS = 14
/** Under this much movement per week the trend is flat, whatever the sign. */
const FLAT_KG_WK = 0.1
/** How far off a maintain target counts as drifting. */
const MAINTAIN_BAND_KG = 1.5

const round1 = (n: number) => Math.round(n * 10) / 10

function dayIndex(date: string): number {
  return Math.floor(Date.parse(date + "T00:00:00Z") / 86_400_000)
}

/**
 * Merge readings from several sources into one series, one point per day,
 * sorted ascending. Later sources win a tie so the caller decides precedence
 * by order (e.g. `[healthLogWeights, bodyMeasurements]`).
 */
export function mergeWeightSeries(...sources: WeightPoint[][]): WeightPoint[] {
  const byDay = new Map<string, number>()
  for (const src of sources) {
    for (const p of src) {
      if (!p || typeof p.kg !== "number" || !Number.isFinite(p.kg)) continue
      if (p.kg < 20 || p.kg > 400) continue
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) continue
      byDay.set(p.date, p.kg)
    }
  }
  return [...byDay.entries()]
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Trailing mean over the previous `windowDays` calendar days (not the previous
 * N readings — a week with one weigh-in shouldn't borrow from last month).
 */
export function weightTrend(series: WeightPoint[], windowDays = WEEK): WeightTrendPoint[] {
  const out: WeightTrendPoint[] = []
  for (let i = 0; i < series.length; i++) {
    const end = dayIndex(series[i].date)
    let sum = 0, n = 0
    for (let j = i; j >= 0; j--) {
      if (end - dayIndex(series[j].date) >= windowDays) break
      sum += series[j].kg
      n++
    }
    out.push({ ...series[i], trendKg: round1(sum / n) })
  }
  return out
}

/**
 * Least-squares slope of the trend over the last `windowDays`, in kg/week.
 * Null with fewer than two points or a span under three days — two readings
 * on consecutive days extrapolate to anything.
 */
export function weightSlopeKgWk(trend: WeightTrendPoint[], windowDays = SLOPE_WINDOW_DAYS): number | null {
  if (trend.length < 2) return null
  const last = dayIndex(trend[trend.length - 1].date)
  const pts = trend.filter(p => last - dayIndex(p.date) < windowDays)
  if (pts.length < 2) return null
  const span = dayIndex(pts[pts.length - 1].date) - dayIndex(pts[0].date)
  if (span < 3) return null
  const xs = pts.map(p => dayIndex(p.date) - last)
  const ys = pts.map(p => p.trendKg)
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0, den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  if (den === 0) return null
  return Math.round((num / den) * WEEK * 100) / 100
}

export interface WeightGoalInput {
  mode: WeightGoalMode
  targetKg: number | null
  paceKgWk: number | null
  startKg: number | null
}

/** Where a weight goal stands, judged on the trend rather than the last reading. */
export function weightGoalProgress(series: WeightPoint[], goal: WeightGoalInput): WeightGoalProgress {
  const trend = weightTrend(series)
  const latest = trend[trend.length - 1] ?? null
  const slope = weightSlopeKgWk(trend)
  const dir = goal.mode === "lose" ? -1 : goal.mode === "gain" ? 1 : 0

  const base: WeightGoalProgress = {
    status: "no_data",
    trendKg: latest ? latest.trendKg : null,
    latestKg: latest ? latest.kg : null,
    latestDate: latest ? latest.date : null,
    slopeKgWk: slope,
    remainingKg: latest && goal.targetKg != null ? round1(goal.targetKg - latest.trendKg) : null,
    fraction: null,
    etaDays: null,
    projectedKg: latest && slope != null ? round1(latest.trendKg + (slope / WEEK) * 28) : null,
    summary: "Log a few weigh-ins and the trend will show up here.",
  }

  if (!latest) return base

  if (goal.startKg != null && goal.targetKg != null && goal.startKg !== goal.targetKg) {
    const f = (latest.trendKg - goal.startKg) / (goal.targetKg - goal.startKg)
    base.fraction = Math.max(0, Math.min(1, Math.round(f * 100) / 100))
  }

  if (goal.mode === "maintain") {
    const anchor = goal.targetKg ?? goal.startKg
    if (anchor == null) {
      base.status = slope == null || Math.abs(slope) < FLAT_KG_WK ? "holding" : "drifting"
    } else {
      base.status = Math.abs(latest.trendKg - anchor) <= MAINTAIN_BAND_KG ? "holding" : "drifting"
    }
    base.summary = base.status === "holding"
      ? `Holding steady at ${latest.trendKg} kg.`
      : `Trend is ${latest.trendKg} kg, ${anchor != null ? `${round1(Math.abs(latest.trendKg - anchor))} kg ${latest.trendKg > anchor ? "above" : "below"} where you wanted to stay` : "drifting"}.`
    return base
  }

  // lose / gain
  if (goal.targetKg != null && (dir < 0 ? latest.trendKg <= goal.targetKg : latest.trendKg >= goal.targetKg)) {
    base.status = "reached"
    base.summary = `Trend is ${latest.trendKg} kg — target reached.`
    return base
  }

  if (slope == null) {
    base.summary = `Trend is ${latest.trendKg} kg. A few more weigh-ins and the pace shows.`
    return base
  }

  const towards = slope * dir // positive when moving the right way
  const pace = goal.paceKgWk ?? 0.5
  if (Math.abs(slope) < FLAT_KG_WK) base.status = "stalled"
  else if (towards < 0) base.status = "reversing"
  else if (towards < pace * 0.5) base.status = "behind"
  else if (towards > pace * 1.5) base.status = "ahead"
  else base.status = "on_pace"

  if (towards > 0 && base.remainingKg != null) {
    base.etaDays = Math.max(0, Math.round((Math.abs(base.remainingKg) / towards) * WEEK))
  }

  const verb = goal.mode === "lose" ? "losing" : "gaining"
  const rate = `${round1(Math.abs(slope))} kg/week`
  const eta = base.etaDays != null
    ? base.etaDays < 7 ? "under a week to go" : `about ${Math.round(base.etaDays / WEEK)} weeks to go`
    : null
  switch (base.status) {
    case "on_pace":   base.summary = `On pace — ${verb} ${rate}${eta ? `, ${eta}` : ""}.`; break
    case "ahead":     base.summary = goal.mode === "lose"
      ? `Faster than planned — ${verb} ${rate}. Under 1 kg a week keeps muscle; consider eating a little more.`
      : `Faster than planned — ${verb} ${rate}. Some of that will be fat; ease the surplus a touch.`; break
    case "behind":    base.summary = `Moving the right way, ${verb} ${rate} — under the ${pace} kg/week you set${eta ? `, ${eta}` : ""}.`; break
    case "stalled":   base.summary = `Flat at ${latest.trendKg} kg for the last two weeks. Plateaus are normal; check portions before changing anything else.`; break
    case "reversing": base.summary = `Trend is moving the wrong way, ${goal.mode === "lose" ? "up" : "down"} ${rate}.`; break
    default: break
  }
  return base
}
