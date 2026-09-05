import { describe, it, expect } from "vitest"
import { balancedCut } from "@/lib/correlations"

// The cases that decide whether a borrowed threshold keeps its meaning or
// quietly deletes a family. A Slovak year against "25°C+" is the second one.

const rep = (value: number, times: number) => Array<number>(times).fill(value)

describe("balancedCut", () => {
  it("keeps the borrowed number while the days fall on both sides of it", () => {
    // 40 days, evenly split by the fixed cut. Nothing to fix.
    const vals = [...rep(10, 20), ...rep(30, 20)]
    expect(balancedCut(vals, 25)).toEqual({ at: 25, personal: false })
  })

  it("falls back to a personal median when the borrowed number barely splits", () => {
    // The Central European summer: 7 hot days against 57 cool ones. Seven days
    // cannot clear a permutation test however real the effect, so the cut has
    // to come from the data.
    const cool = Array.from({ length: 57 }, (_, i) => 5 + (i % 15))
    const hot = rep(28, 7)
    const cut = balancedCut([...cool, ...hot], 25)
    expect(cut.personal).toBe(true)
    expect(cut.at).toBeLessThan(25)
    const high = [...cool, ...hot].filter(v => v >= cut.at).length
    expect(Math.min(high, 64 - high)).toBeGreaterThanOrEqual(20)
  })

  it("steps past a median sitting on the floor of the distribution", () => {
    // Most days carry no caffeine at all, so the median is 0 and ">= 0" is
    // every day. The cut has to move to the next distinct value to split
    // anything.
    const vals = [...rep(0, 22), ...rep(80, 18)]
    const cut = balancedCut(vals, 200)
    expect(cut).toEqual({ at: 80, personal: true })
  })

  it("keeps the borrowed number when the personal one is no better", () => {
    // 38 zero days and 2 heavy ones: neither 200mg nor the stepped-up median
    // gives two groups worth comparing, so nothing is gained by dropping the
    // number that at least means something.
    const vals = [...rep(0, 38), ...rep(400, 2)]
    expect(balancedCut(vals, 200)).toEqual({ at: 200, personal: false })
  })

  it("keeps the borrowed number until there are enough days to have a median", () => {
    // 19 days, all cool. Too thin to claim a personal centre — and on a
    // fortnight of data a made-up "hot day" would be worse than no card.
    expect(balancedCut(rep(10, 19), 25)).toEqual({ at: 25, personal: false })
  })

  it("ignores the days a source wasn't recorded on", () => {
    const unrecorded = Array<number | undefined>(100).fill(undefined)
    const vals = [...rep(10, 20), ...rep(30, 20), ...unrecorded]
    expect(balancedCut(vals, 25)).toEqual({ at: 25, personal: false })
  })
})
