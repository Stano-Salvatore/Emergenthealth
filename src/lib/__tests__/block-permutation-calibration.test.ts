import { describe, it, expect } from "vitest"
import { blockPermutationP, permutationP, Split } from "@/lib/correlations"

// Calibration, not correctness-by-example. A hypothesis test has one promise
// to keep: reject about 5% of TRUE nulls at p<0.05. The day-shuffle test
// breaks that promise exactly where this app lives — days that carry
// yesterday inside them. Measured here on AR(1) pairs at the autocorrelation
// daily weather and physiology show (phi 0.5–0.7), the day-shuffle rejected
// 9–17% of true nulls; the block test 5–8%. This file keeps the block test
// honest on both sides: calibrated under an autocorrelated null, and still
// powerful on a genuinely planted effect.

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}
function gauss(rnd: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
}
/** Stationary AR(1), unit variance: today = phi * yesterday + noise. */
function ar1(n: number, phi: number, rnd: () => number): number[] {
  const out = [gauss(rnd)]
  const s = Math.sqrt(1 - phi * phi)
  for (let t = 1; t < n; t++) out.push(phi * out[t - 1] + s * gauss(rnd))
  return out
}

/** A null "family": autocorrelated exposure, INDEPENDENT autocorrelated outcome. */
function nullSim(n: number, phi: number, rnd: () => number, shift = 0): Split {
  const x = ar1(n, phi, rnd)
  const y = ar1(n, phi, rnd)
  const split = new Split()
  for (let i = 0; i < n; i++) split.add(x[i] > 0, y[i] + (x[i] > 0 ? shift : 0))
  return split
}

const SIMS = 400
const N = 90
const PHI = 0.7

describe("blockPermutationP", () => {
  it("stays calibrated where the day-shuffle does not", () => {
    const rnd = lcg(97)
    let blockFP = 0, naiveFP = 0, ran = 0
    for (let s = 0; s < SIMS; s++) {
      const split = nullSim(N, PHI, rnd)
      if (split.high.length < 5 || split.low.length < 5) continue
      ran++
      if (blockPermutationP(split.obs, `cal-${s}`) < 0.05) blockFP++
      if (permutationP(split.high, split.low, `cal-${s}`) < 0.05) naiveFP++
    }
    // A calibrated test sits near 5%. Measured across 2,400 independent
    // sims at this phi: 4.8–7.3%. Monte Carlo sd at 400 sims is ~1.2
    // points, so 10% is a four-sigma bound — this fails on a broken test,
    // not on an unlucky seed.
    expect(blockFP / ran).toBeLessThan(0.10)
    // And the reason this function exists: on the same data the day-shuffle
    // must be visibly worse. If this ever fails, the two tests have converged
    // and the extra machinery should be questioned.
    expect(naiveFP).toBeGreaterThan(blockFP)
  }, 120_000)

  it("keeps its power on a genuinely planted effect", () => {
    const rnd = lcg(731)
    let found = 0, ran = 0
    for (let s = 0; s < SIMS; s++) {
      const split = nullSim(N, 0.5, rnd, 1.0) // 1 SD shift on exposure days
      if (split.high.length < 5 || split.low.length < 5) continue
      ran++
      if (blockPermutationP(split.obs, `pow-${s}`) < 0.05) found++
    }
    // Measured at ~98% for both tests — honesty costs nothing on effects
    // that are actually there.
    expect(found / ran).toBeGreaterThan(0.9)
  }, 120_000)

  it("is deterministic for a given seed key", () => {
    const rnd = lcg(5)
    const split = nullSim(60, 0.5, rnd)
    expect(blockPermutationP(split.obs, "same")).toBe(blockPermutationP(split.obs, "same"))
  })

  it("preserves group counts, so a permutation can never empty a side", () => {
    const split = new Split()
    for (let i = 0; i < 20; i++) split.add(i < 3, i)
    // 3 vs 17 — extreme imbalance; must return a valid probability, not NaN.
    const p = blockPermutationP(split.obs, "imbalanced")
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})
