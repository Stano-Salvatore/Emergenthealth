// One number for the day — measured against you, not against a poster in a gym.
//
// The score this replaces added up four fixed goals: 8 hours of sleep, 10,000
// steps, readiness out of 100, habits done. That has two failures which matter
// more than any weighting question. A metric that didn't sync scored **zero**,
// so a flat ring battery looked identical to a terrible day. And the goals were
// somebody else's: a person who genuinely runs on 7 hours could never score
// well no matter how well they actually slept.
//
// Here every metric is scored against the user's own median over the recent
// past, on a scale where **50 is your typical day**, higher is better, and each
// robust deviation is worth 15 points. A metric with no data is *absent*, not
// zero — it drops out and the remaining weights are renormalised, with the
// resulting coverage reported so the number can never quietly stand for less
// than it claims.

import { median, mad } from "@/lib/anomalies"

/** Below this many days with a value, a metric has no baseline worth using. */
export const MIN_BASIS_DAYS = 10
/** Below this fraction of the total weight, the day gets no score at all. */
const MIN_COVERAGE = 0.4
/** Points per robust deviation. 15 puts a 2σ day near 80 or near 20. */
const POINTS_PER_SIGMA = 15

export interface ScoreDay {
  date: string
  sleepScore?: number | null
  /** Minutes. */
  sleepDuration?: number | null
  /** Minutes. */
  deepSleep?: number | null
  readinessScore?: number | null
  hrv?: number | null
  restingHR?: number | null
  steps?: number | null
  activeMinutes?: number | null
  /** 1-5. */
  mood?: number | null
  /** 1-5. */
  energy?: number | null
  /** Seconds of high stress. */
  stressHigh?: number | null
}

type MetricKey = keyof Omit<ScoreDay, "date">

interface MetricDef {
  key: MetricKey
  label: string
  /** False when a lower reading is the better one (resting HR, stress). */
  higherIsBetter: boolean
  format: (v: number) => string
}

interface ComponentDef {
  key: "sleep" | "recovery" | "activity" | "mind"
  label: string
  emoji: string
  weight: number
  metrics: MetricDef[]
}

const round1 = (v: number) => String(Math.round(v * 10) / 10)

export const COMPONENTS: ComponentDef[] = [
  {
    key: "sleep", label: "Sleep", emoji: "🌙", weight: 30,
    metrics: [
      { key: "sleepScore", label: "Sleep score", higherIsBetter: true, format: v => String(Math.round(v)) },
      { key: "sleepDuration", label: "Duration", higherIsBetter: true, format: v => `${round1(v / 60)}h` },
      { key: "deepSleep", label: "Deep sleep", higherIsBetter: true, format: v => `${Math.round(v)}m` },
    ],
  },
  {
    key: "recovery", label: "Recovery", emoji: "❤️", weight: 30,
    metrics: [
      { key: "readinessScore", label: "Readiness", higherIsBetter: true, format: v => String(Math.round(v)) },
      { key: "hrv", label: "HRV", higherIsBetter: true, format: v => `${Math.round(v)}ms` },
      { key: "restingHR", label: "Resting HR", higherIsBetter: false, format: v => `${Math.round(v)}bpm` },
    ],
  },
  {
    key: "activity", label: "Movement", emoji: "🚶", weight: 20,
    metrics: [
      { key: "steps", label: "Steps", higherIsBetter: true, format: v => v.toLocaleString("en-US") },
      { key: "activeMinutes", label: "Active minutes", higherIsBetter: true, format: v => `${Math.round(v)}m` },
    ],
  },
  {
    key: "mind", label: "Mind", emoji: "🧠", weight: 20,
    metrics: [
      { key: "mood", label: "Mood", higherIsBetter: true, format: v => `${round1(v)}/5` },
      { key: "energy", label: "Energy", higherIsBetter: true, format: v => `${round1(v)}/5` },
      { key: "stressHigh", label: "High stress", higherIsBetter: false, format: v => `${Math.round(v / 60)}m` },
    ],
  },
]

export interface ScoredPart {
  label: string
  /** 0-100 on the same self-relative scale, or null when there's no baseline. */
  score: number | null
  /** Today's reading, already formatted. */
  value: string | null
  baseline: string | null
}

export interface ScoredComponent {
  key: ComponentDef["key"]
  label: string
  emoji: string
  weight: number
  /** 0-100, or null when nothing in it could be scored today. */
  score: number | null
  parts: ScoredPart[]
}

export interface DailyScore {
  /** 0-100 where 50 is a typical day for this person — null when unknowable. */
  score: number | null
  components: ScoredComponent[]
  /** Fraction of the total weight that actually had data, 0-1. */
  coverage: number
  /** Days of history the baselines were drawn from. */
  basis: number
  /** The component furthest from typical — what actually moved the number. */
  driver: { label: string; emoji: string; score: number; direction: "up" | "down" } | null
  /** Present only when `score` is null: why. */
  reason?: string
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

/**
 * Score one reading against its own history. Returns null when there isn't
 * enough history, or when the series is so flat that a deviation is
 * meaningless — silence beats a confident number built on nothing.
 */
export function relativeScore(
  value: number,
  history: number[],
  higherIsBetter: boolean,
): { score: number; baseline: number } | null {
  if (history.length < MIN_BASIS_DAYS) return null
  const baseline = median(history)
  const spread = mad(history, baseline)
  if (spread <= 0) return null
  const z = (value - baseline) / spread
  const dir = higherIsBetter ? 1 : -1
  return { score: Math.round(clamp(50 + POINTS_PER_SIGMA * z * dir)), baseline }
}

/**
 * `today` is the day being scored; `history` is the days before it (any order,
 * today excluded). Both are plain metric bags — anything absent is absent, and
 * absence never costs points.
 */
export function computeDailyScore(today: ScoreDay, history: ScoreDay[]): DailyScore {
  const components: ScoredComponent[] = []
  let weighted = 0
  let weightUsed = 0

  for (const def of COMPONENTS) {
    const parts: ScoredPart[] = []
    const scores: number[] = []

    for (const m of def.metrics) {
      const value = today[m.key]
      if (value == null) continue
      const series = history.map(d => d[m.key]).filter((v): v is number => v != null)
      const scored = relativeScore(value, series, m.higherIsBetter)
      parts.push({
        label: m.label,
        score: scored?.score ?? null,
        value: m.format(value),
        baseline: scored ? m.format(scored.baseline) : null,
      })
      if (scored) scores.push(scored.score)
    }

    const score = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null
    components.push({ key: def.key, label: def.label, emoji: def.emoji, weight: def.weight, score, parts })
    if (score != null) {
      weighted += score * def.weight
      weightUsed += def.weight
    }
  }

  const totalWeight = COMPONENTS.reduce((a, c) => a + c.weight, 0)
  const coverage = weightUsed / totalWeight

  if (weightUsed === 0) {
    return {
      score: null, components, coverage, basis: history.length, driver: null,
      reason: history.length < MIN_BASIS_DAYS
        ? `Needs about ${MIN_BASIS_DAYS} days of history before a "usual" exists to compare against`
        : "Nothing synced for today yet",
    }
  }
  if (coverage < MIN_COVERAGE) {
    return {
      score: null, components, coverage, basis: history.length, driver: null,
      reason: "Too little of today has data to stand behind a single number",
    }
  }

  const score = Math.round(weighted / weightUsed)

  // What actually moved it — the component furthest from typical, so the number
  // always arrives with its explanation attached.
  const scoredComponents = components.filter(c => c.score != null)
  const driverComp = scoredComponents.reduce((best, c) =>
    Math.abs(c.score! - 50) > Math.abs(best.score! - 50) ? c : best, scoredComponents[0])
  const driver = Math.abs(driverComp.score! - 50) >= 8
    ? {
      label: driverComp.label,
      emoji: driverComp.emoji,
      score: driverComp.score!,
      direction: (driverComp.score! > 50 ? "up" : "down") as "up" | "down",
    }
    : null

  return { score, components, coverage, basis: history.length, driver }
}

/**
 * Wording for a scale whose midpoint is "normal for you" — an absolute grading
 * would call a perfectly ordinary day a failure.
 */
export function scoreGrade(s: number): { label: string; color: string; emoji: string } {
  if (s >= 75) return { label: "Well above your usual", color: "text-emerald-400", emoji: "🌟" }
  if (s >= 60) return { label: "Better than usual", color: "text-green-400", emoji: "✨" }
  if (s >= 41) return { label: "About your usual", color: "text-sky-400", emoji: "🌤️" }
  if (s >= 26) return { label: "Below your usual", color: "text-amber-400", emoji: "🌥️" }
  return { label: "Well below your usual", color: "text-rose-400", emoji: "⚠️" }
}
