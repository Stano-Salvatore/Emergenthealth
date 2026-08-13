import { describe, it, expect } from "vitest"
import { estimatePersonalHalfLife, residualAt, cutoffHoursBeforeBed, type CaffeineNight } from "@/lib/caffeine-personal"

// Deterministic pseudo-random so the synthetic history is identical every run.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Build a synthetic history where sleep quality really is driven by the
 * caffeine still circulating at bedtime under `trueHalfLife` — a person whose
 * body we know the answer for. The estimator should recover it.
 */
function syntheticNights(count: number, trueHalfLife: number, seed = 42): CaffeineNight[] {
  const rnd = lcg(seed)
  const nights: CaffeineNight[] = []
  for (let i = 0; i < count; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i))
    const bedtime = new Date(day.getTime() + 23 * 3_600_000)
    // 1–3 doses at varied hours (7:00–19:00) — the timing spread is what makes
    // different half-lives distinguishable at all.
    const doseCount = 1 + Math.floor(rnd() * 3)
    const doses = Array.from({ length: doseCount }, () => ({
      caffeineMg: 60 + Math.round(rnd() * 100),
      loggedAt: new Date(day.getTime() + (7 + rnd() * 12) * 3_600_000),
    }))
    const residual = residualAt(doses, bedtime, trueHalfLife)
    // worse sleep the more caffeine is left, plus a little noise
    const sleepScore = Math.max(30, Math.min(100,
      Math.round(92 - residual * 0.22 + (rnd() - 0.5) * 6)))
    nights.push({ bedtime, sleepScore, doses })
  }
  return nights
}

describe("estimatePersonalHalfLife", () => {
  it("recovers a slow metabolizer's half-life from their own nights", () => {
    const est = estimatePersonalHalfLife(syntheticNights(60, 8))
    expect(est.usedDefault).toBe(false)
    expect(est.halfLifeH).toBeGreaterThan(6.5)
    expect(est.halfLifeH).toBeLessThan(9.5)
    expect(est.correlation).toBeLessThan(-0.3)
    expect(est.summary).toContain("slower than average")
  })

  it("recovers a fast metabolizer's half-life too", () => {
    const est = estimatePersonalHalfLife(syntheticNights(60, 3, 7))
    expect(est.usedDefault).toBe(false)
    expect(est.halfLifeH).toBeLessThan(4.5)
    expect(est.summary).toContain("faster than average")
  })

  it("reports an honest range and confidence rather than false precision", () => {
    const est = estimatePersonalHalfLife(syntheticNights(60, 8))
    expect(est.range).not.toBeNull()
    expect(est.range!.low).toBeLessThanOrEqual(est.halfLifeH)
    expect(est.range!.high).toBeGreaterThanOrEqual(est.halfLifeH)
    expect(["medium", "high"]).toContain(est.confidence)
  })

  it("keeps the 5h default when there aren't enough nights", () => {
    const est = estimatePersonalHalfLife(syntheticNights(6, 8))
    expect(est.usedDefault).toBe(true)
    expect(est.halfLifeH).toBe(5)
    expect(est.summary).toContain("6/14 nights")
  })

  it("keeps the default when caffeine and sleep simply aren't linked", () => {
    // same doses, but sleep scores unrelated to them
    const rnd = lcg(99)
    const nights = syntheticNights(60, 5).map(n => ({ ...n, sleepScore: 70 + Math.round(rnd() * 20) }))
    const est = estimatePersonalHalfLife(nights)
    expect(est.usedDefault).toBe(true)
    expect(est.halfLifeH).toBe(5)
  })

  it("ignores doses taken after bedtime instead of counting them backwards", () => {
    const bedtime = new Date("2026-01-01T23:00:00Z")
    const after = residualAt([{ caffeineMg: 100, loggedAt: new Date("2026-01-02T01:00:00Z") }], bedtime, 5)
    expect(after).toBe(0)
  })
})

describe("cutoffHoursBeforeBed", () => {
  it("scales the cutoff with the personal half-life", () => {
    // 120mg down to 30mg is two half-lives
    expect(cutoffHoursBeforeBed(120, 5)).toBe(10)
    expect(cutoffHoursBeforeBed(120, 8)).toBe(16)
    expect(cutoffHoursBeforeBed(20, 5)).toBe(0) // already under the target
  })
})
