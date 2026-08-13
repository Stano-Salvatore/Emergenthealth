// Personal caffeine half-life — estimated from the user's own data instead of
// assuming the textbook 5 hours.
//
// Caffeine clearance is famously individual: CYP1A2 genetics, smoking, oral
// contraceptives, pregnancy and liver load push the adult half-life anywhere
// from ~2 h (fast metabolizers) to ~10 h (slow ones). Everyone gets the same
// 5 h in most apps, which is wrong for most people.
//
// The estimate here is behavioural, not biochemical: for each candidate
// half-life we compute how much caffeine would still be circulating at
// bedtime, then ask which candidate's residual best tracks the nights that
// actually slept badly. The half-life that best explains the user's own sleep
// disruption is the one their body behaves like.
//
// This can't work when there's nothing to learn from (too few nights, no
// variation in timing, or no visible caffeine-sleep link at all) — in those
// cases it says so and keeps the 5 h default rather than inventing precision.

import { HALF_LIFE_H } from "@/lib/caffeine"

export interface CaffeineNight {
  /** When sleep started that night. */
  bedtime: Date
  /** Sleep quality for that night (Oura sleep score, 0-100). */
  sleepScore: number
  /** Caffeine doses taken in the ~24 h before bedtime. */
  doses: { caffeineMg: number; loggedAt: Date }[]
}

export interface HalfLifeEstimate {
  /** Best-fitting half-life in hours (the default when it can't be identified). */
  halfLifeH: number
  /** Nights that carried both caffeine and a sleep score. */
  nights: number
  /** Correlation between bedtime residual caffeine and sleep score at the winning half-life. */
  correlation: number
  /** Range of half-lives that fit nearly as well — the honest error bar. */
  range: { low: number; high: number } | null
  /**
   * Permutation p-value for the whole grid search: how often shuffled sleep
   * scores produce a best-fit this good. Scanning 33 candidates and keeping
   * the winner finds "a half-life" in pure noise, so the fit has to beat its
   * own null distribution before we believe it.
   */
  pValue: number
  confidence: "none" | "low" | "medium" | "high"
  /** True when the data couldn't identify a personal value and the default stands. */
  usedDefault: boolean
  /** Short human sentence for the UI. */
  summary: string
}

const CANDIDATES: number[] = []
for (let h = 2; h <= 10.0001; h += 0.25) CANDIDATES.push(Math.round(h * 100) / 100)

const MIN_NIGHTS = 14
/** Below this the caffeine-sleep link is too weak to read a half-life out of. */
const MIN_ABS_CORRELATION = 0.15
const PERMUTATIONS = 300
const MAX_P = 0.05

// Deterministic RNG (mulberry32) so the same history always yields the same
// verdict — an estimate that flickers between page loads is worse than none.
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 3) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  if (dx2 === 0 || dy2 === 0) return 0
  return num / Math.sqrt(dx2 * dy2)
}

/** Caffeine still circulating at `at`, given doses and a half-life. */
export function residualAt(doses: { caffeineMg: number; loggedAt: Date }[], at: Date, halfLifeH: number): number {
  return doses.reduce((sum, d) => {
    const hours = (at.getTime() - d.loggedAt.getTime()) / 3_600_000
    if (hours < 0) return sum // dose after bedtime — not in play for that night
    return sum + d.caffeineMg * Math.pow(0.5, hours / halfLifeH)
  }, 0)
}

export function estimatePersonalHalfLife(nights: CaffeineNight[]): HalfLifeEstimate {
  const usable = nights.filter(n =>
    Number.isFinite(n.sleepScore) && n.sleepScore > 0 && n.doses.length > 0)

  const fallback = (summary: string, confidence: HalfLifeEstimate["confidence"] = "none"): HalfLifeEstimate => ({
    halfLifeH: HALF_LIFE_H,
    nights: usable.length,
    correlation: 0,
    range: null,
    pValue: 1,
    confidence,
    usedDefault: true,
    summary,
  })

  if (usable.length < MIN_NIGHTS) {
    return fallback(
      `Using the standard 5 h half-life — ${usable.length}/${MIN_NIGHTS} nights of caffeine + sleep data so far.`)
  }

  const scores = usable.map(n => n.sleepScore)

  // Score every candidate by how strongly its implied bedtime residual tracks
  // worse sleep. Correlation is scale-invariant, so what distinguishes the
  // candidates is the *shape* of the decay across differently-timed doses.
  const residualsByCandidate = CANDIDATES.map(h => usable.map(n => residualAt(n.doses, n.bedtime, h)))
  const scored = CANDIDATES.map((h, i) => ({ h, r: pearson(residualsByCandidate[i], scores) }))

  const best = scored.reduce((a, b) => (b.r < a.r ? b : a)) // most negative r wins

  if (best.r > -MIN_ABS_CORRELATION) {
    return fallback(
      "Using the standard 5 h half-life — your caffeine timing doesn't visibly track your sleep scores yet, which is itself good news.",
      "none")
  }

  // Null distribution of the *whole search*: shuffle the sleep scores, re-run
  // the grid, keep its best fit. Without this, picking the winner of 33
  // candidates reliably "discovers" a personal half-life in random data.
  const rng = seededRng(usable.length * 7919 + Math.round(Math.abs(best.r) * 1000))
  const shuffled = [...scores]
  let atLeastAsGood = 0
  for (let p = 0; p < PERMUTATIONS; p++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    let nullBest = 0
    for (const residuals of residualsByCandidate) {
      const r = pearson(residuals, shuffled)
      if (r < nullBest) nullBest = r
    }
    if (nullBest <= best.r) atLeastAsGood++
  }
  const pValue = Math.round(((atLeastAsGood + 1) / (PERMUTATIONS + 1)) * 1000) / 1000

  if (pValue > MAX_P) {
    return fallback(
      "Using the standard 5 h half-life — the caffeine-sleep pattern in your data is still within what chance produces.",
      "none")
  }

  // Everything within 10% of the best fit is statistically indistinguishable
  const threshold = best.r * 0.9
  const fitting = scored.filter(s => s.r <= threshold).map(s => s.h)
  const range = fitting.length > 0
    ? { low: Math.min(...fitting), high: Math.max(...fitting) }
    : null

  const strength = Math.abs(best.r)
  const confidence: HalfLifeEstimate["confidence"] =
    usable.length >= 40 && strength >= 0.35 ? "high"
    : usable.length >= 25 && strength >= 0.25 ? "medium"
    : "low"

  const vsAverage =
    best.h >= HALF_LIFE_H + 1 ? "slower than average — caffeine lingers longer for you"
    : best.h <= HALF_LIFE_H - 1 ? "faster than average — you clear caffeine quickly"
    : "close to the textbook average"

  return {
    halfLifeH: best.h,
    nights: usable.length,
    correlation: Math.round(best.r * 100) / 100,
    range,
    pValue,
    confidence,
    usedDefault: false,
    summary: `≈${best.h} h, ${vsAverage} (from ${usable.length} nights, ${confidence} confidence).`,
  }
}

/**
 * Latest hour of the day a dose can be taken and still fall under `targetMg`
 * of residual caffeine at bedtime, at the given half-life. Returns hours
 * before bedtime, e.g. 8.5 → "stop 8.5 h before bed".
 */
export function cutoffHoursBeforeBed(doseMg: number, halfLifeH: number, targetMg = 30): number {
  if (doseMg <= targetMg) return 0
  return Math.round((halfLifeH * Math.log2(doseMg / targetMg)) * 10) / 10
}
