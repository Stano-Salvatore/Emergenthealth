// Anomaly detection against the user's own baseline.
//
// The correlation engine answers "what generally affects what". This answers a
// different question: "is today unusual for me?" — the one a person actually
// wants pushed to their phone. A resting heart rate of 62 means nothing in the
// abstract; 62 when you have run 54 for a month means something.
//
// Median and MAD rather than mean and standard deviation, because physiological
// series are full of legitimate outliers (one terrible night, one hard workout)
// and a mean-based baseline lets those outliers widen the band until nothing
// ever looks unusual again. MAD ignores them.

export type Direction = "higher-is-worse" | "lower-is-worse"

export interface MetricSpec {
  key: string
  label: string
  unit: string
  direction: Direction
  emoji: string
  /** Ignore wobbles smaller than this in raw units — statistical significance isn't clinical relevance. */
  minAbsShift: number
}

export const TRACKED_METRICS: MetricSpec[] = [
  { key: "restingHR",      label: "Resting heart rate", unit: "bpm", direction: "higher-is-worse", emoji: "❤️", minAbsShift: 3 },
  { key: "hrv",            label: "HRV",                unit: "ms",  direction: "lower-is-worse",  emoji: "💓", minAbsShift: 5 },
  { key: "sleepScore",     label: "Sleep score",        unit: "",    direction: "lower-is-worse",  emoji: "🌙", minAbsShift: 6 },
  { key: "readinessScore", label: "Readiness",          unit: "",    direction: "lower-is-worse",  emoji: "🔋", minAbsShift: 6 },
  { key: "sleepDuration",  label: "Sleep duration",     unit: "h",   direction: "lower-is-worse",  emoji: "😴", minAbsShift: 0.8 },
  { key: "steps",          label: "Steps",              unit: "",    direction: "lower-is-worse",  emoji: "🚶", minAbsShift: 2000 },
  { key: "breathingRate",  label: "Breathing rate",     unit: "/min", direction: "higher-is-worse", emoji: "🫁", minAbsShift: 1 },
  { key: "skinTemp",       label: "Skin temperature",   unit: "°C",  direction: "higher-is-worse", emoji: "🌡️", minAbsShift: 0.4 },
]

export interface Anomaly {
  metric: string
  label: string
  emoji: string
  unit: string
  value: number
  baseline: number
  /** Robust z-score: how many MAD-scaled deviations from the user's own median. */
  z: number
  direction: "above" | "below"
  /** True when the shift is in the unhelpful direction for this metric. */
  concerning: boolean
  /** Consecutive days (including this one) on the same side beyond 1 deviation. */
  runLength: number
  date: string
  summary: string
}

/** Minimum history before a baseline means anything. */
export const MIN_HISTORY_DAYS = 14
const Z_THRESHOLD = 2
const RUN_Z_THRESHOLD = 1
const MIN_RUN = 3

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

/** Median absolute deviation, scaled so it's comparable to a standard deviation. */
export function mad(values: number[], center?: number): number {
  if (values.length === 0) return 0
  const m = center ?? median(values)
  return median(values.map(v => Math.abs(v - m))) * 1.4826
}

export interface DayValue { date: string; value: number }

/**
 * Detect anomalies in the most recent day of a series. `history` must be
 * ordered oldest-first and include the day being tested as its last element.
 */
export function detectAnomaly(spec: MetricSpec, history: DayValue[]): Anomaly | null {
  if (history.length < MIN_HISTORY_DAYS + 1) return null

  const today = history[history.length - 1]
  const past = history.slice(0, -1).map(d => d.value)
  const baseline = median(past)
  const spread = mad(past, baseline)
  // A flat series has no meaningful notion of "unusual"; guard against dividing
  // by a zero spread rather than reporting infinite significance.
  if (spread <= 0) return null

  const z = (today.value - baseline) / spread
  const shift = Math.abs(today.value - baseline)

  // How long has it been drifting? A three-day run of mild deviation is more
  // interesting than one dramatic day, which is usually just a bad night.
  let runLength = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const zi = (history[i].value - baseline) / spread
    if (Math.sign(zi) === Math.sign(z) && Math.abs(zi) >= RUN_Z_THRESHOLD) runLength++
    else break
  }

  const isSpike = Math.abs(z) >= Z_THRESHOLD
  const isDrift = runLength >= MIN_RUN
  if (!isSpike && !isDrift) return null

  // Relevance floor, so statistical significance can't masquerade as clinical
  // meaning — a metronomic series makes a 1 bpm wobble look enormous in z
  // terms. A sustained drift earns a lower bar than a one-day spike: the same
  // small shift means more when it has held for days.
  const floor = isDrift && !isSpike ? spec.minAbsShift / 2 : spec.minAbsShift
  if (shift < floor) return null

  const direction: "above" | "below" = z > 0 ? "above" : "below"
  const concerning = spec.direction === "higher-is-worse" ? direction === "above" : direction === "below"

  const r = (n: number) => Math.round(n * 10) / 10
  const word = direction === "above" ? "above" : "below"
  const summary = isDrift && !isSpike
    ? `${spec.label} has been ${word} your usual ${r(baseline)}${spec.unit} for ${runLength} days (now ${r(today.value)}${spec.unit})`
    : `${spec.label} is ${r(shift)}${spec.unit} ${word} your usual ${r(baseline)}${spec.unit} (${r(today.value)}${spec.unit})`

  return {
    metric: spec.key,
    label: spec.label,
    emoji: spec.emoji,
    unit: spec.unit,
    value: r(today.value),
    baseline: r(baseline),
    z: r(z),
    direction,
    concerning,
    runLength,
    date: today.date,
    summary,
  }
}

/** Run every tracked metric over a map of series, strongest first. */
export function detectAll(seriesByMetric: Record<string, DayValue[]>): Anomaly[] {
  const found: Anomaly[] = []
  for (const spec of TRACKED_METRICS) {
    const series = seriesByMetric[spec.key]
    if (!series || series.length === 0) continue
    const anomaly = detectAnomaly(spec, series)
    if (anomaly) found.push(anomaly)
  }
  // Concerning ones first, then by how far out they are
  return found.sort((a, b) =>
    (Number(b.concerning) - Number(a.concerning)) || (Math.abs(b.z) - Math.abs(a.z)))
}
