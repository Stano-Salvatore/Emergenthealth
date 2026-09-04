import { describe, it, expect } from "vitest"
import { interactionPermutationP } from "@/lib/correlations"

// The interaction test asks a narrower question than the two-group one: not
// "does anything here matter" but "does the moderator change the predictor's
// effect". The cases below are the two that pull in opposite directions — a
// real interaction, and a table where both variables matter a great deal but
// neither touches the other's effect.

describe("interactionPermutationP", () => {
  it("finds an effect that flips sign with the moderator", () => {
    // With the moderator on, the predictor lifts the outcome by ~10; with it
    // off, it drops it by ~10. Nothing about shuffling the labels produces a
    // 20-point swing.
    const onYes = [10, 11, 9, 10, 12, 8, 10, 11]
    const onNo = [0, 1, -1, 0, 2, -2, 0, 1]
    const offYes = [0, 1, -1, 0, 2, -2, 0, 1]
    const offNo = [10, 11, 9, 10, 12, 8, 10, 11]

    const p = interactionPermutationP(onYes, onNo, offYes, offNo, "flip")
    expect(p).toBeLessThan(0.01)
  })

  it("is not fooled by two strong main effects and no interaction", () => {
    // The moderator is worth +20 wherever it appears and the predictor +10,
    // so every cell mean differs — but the predictor's effect is +10 on both
    // sides, which is the definition of no interaction. A test that shuffled
    // labels across the whole table would call this significant; this one
    // must not.
    const spread = [-2, -1, 0, 1, 2, -1, 0, 1]
    const onYes = spread.map(s => 30 + s)
    const onNo = spread.map(s => 20 + s)
    const offYes = spread.map(s => 10 + s)
    const offNo = spread.map(s => 0 + s)

    const p = interactionPermutationP(onYes, onNo, offYes, offNo, "main_effects_only")
    expect(p).toBeGreaterThan(0.10)
  })

  it("does not call a small shift in noisy cells significant", () => {
    // Four cells of five days where the effect changes by about a third —
    // enough to clear the card's effect-change threshold, nowhere near enough
    // to clear chance. This is the case the family used to ship as a finding.
    const onYes = [12, 8, 14, 6, 10]
    const onNo = [4, 0, 6, -2, 2]
    const offYes = [9, 5, 11, 3, 7]
    const offNo = [4, 0, 6, -2, 2]

    const p = interactionPermutationP(onYes, onNo, offYes, offNo, "small_shift")
    expect(p).toBeGreaterThan(0.10)
  })

  it("is deterministic for the same inputs and seed", () => {
    const a = [5, 6, 7, 8], b = [1, 2, 3, 4], c = [4, 3, 2, 1], d = [8, 7, 6, 5]
    expect(interactionPermutationP(a, b, c, d, "seed_x"))
      .toBe(interactionPermutationP(a, b, c, d, "seed_x"))
  })

  it("never returns exactly zero", () => {
    const onYes = [100, 101, 99, 100], onNo = [0, 1, -1, 0]
    const offYes = [0, 1, -1, 0], offNo = [100, 101, 99, 100]
    const p = interactionPermutationP(onYes, onNo, offYes, offNo, "extreme")
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})
