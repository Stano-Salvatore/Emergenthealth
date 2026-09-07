import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// A standing guard, not a unit test.
//
// Four sources in the engine were cut at a number the user's own body never
// got a say in — 200mg of caffeine, 25°C, an hour of high stress, 2L of water.
// Water was the worst of them, because the app already computed the right
// number (35 ml/kg) and showed it on the Intake screen while this engine
// grouped days at a flat 2000. On a Slovak year "25°C+"
// picks out 7 days against 57, and a group of seven cannot clear a
// permutation test however real the effect is. The card was computed, tiered,
// and filed under "could be chance" every single run.
//
// `balancedCut()` now decides: it keeps the borrowed number while the days
// fall on both sides of it, and falls back to the person's median when they
// don't. The failure mode this guards is a new family being written the
// obvious way — `d.caffeineMg >= 200` reads perfectly natural — and silently
// reintroducing a threshold nobody's data matches.

const SOURCE = readFileSync(join(process.cwd(), "src/lib/correlations.ts"), "utf8")

// Any comparison of one of these fields against a bare number, e.g.
// `d.caffeineMg >= 200` or `tempMaxC > 25`. The cut has to come from `cuts.*`.
//
// `> 0` is exempt: that is a presence test ("any caffeine day"), not a split
// into high and low, and it needs no threshold to be defensible.
const HARDCODED = /\b(caffeineMg|tempMaxC|stressHighMin|waterMl)\b\s*(?:\?\?\s*0\s*\)?\s*)?[<>]=?\s*\d+/g
const PRESENCE = /[<>]\s*0$/
// `waterMl < 1500` in the symptom battery is a DEHYDRATION MARKER, not a goal.
// The two water sites that mean "hit your daily target" use cuts.water; this
// one asks whether a day was notably dry, and there is no per-person rule for
// that in the app — scaling it by body mass would invent pharmacology nobody
// wrote down. Exempt on purpose, not by oversight.
const DEHYDRATION_MARKER = /waterMl\s*<\s*1500$/

describe("personal cut points", () => {
  it("cuts water at the target the rest of the app already computes", () => {
    // Not a literal: the number comes from computeTargets(), which scales the
    // daily goal to body mass. A flat 2000 here contradicts the Intake screen.
    expect(SOURCE).toContain("balancedCut(allDays.map(d => d.waterMl), targets.waterMl)")
  })

  it("never compares a cut source against a hardcoded threshold", () => {
    const hits = [...SOURCE.matchAll(HARDCODED)].map(m => m[0]).filter(h => !PRESENCE.test(h) && !DEHYDRATION_MARKER.test(h))
    expect(hits, `use cuts.<source>.at instead: ${hits.join(", ")}`).toEqual([])
  })

  it("still routes all three sources through balancedCut", () => {
    for (const field of ["tempMaxC", "caffeineMg", "stressHighMin", "waterMl"]) {
      expect(SOURCE).toContain(`balancedCut(allDays.map(d => d.${field})`)
    }
  })
})
