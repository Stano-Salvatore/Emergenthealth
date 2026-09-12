import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { alcoholAtHour, alcoholHoursToClear, alcoholClearanceGPerHour } from "@/lib/body-load"

// Alcohol clears at a flat rate; caffeine halves. The two charts sit one above
// the other on the same screen, and the obvious way to build the second is to
// copy the first — which would put caffeine's pharmacology on an alcohol card
// and quietly move the finishing time to never.

describe("alcohol leaves at a flat rate", () => {
  it("loses the same grams in the first hour as in the last", () => {
    // The property that makes it a ramp. An exponential would fail this: it
    // sheds most of its grams early and approaches zero without arriving.
    const first = alcoholAtHour(40, 8, 0) - alcoholAtHour(40, 8, 1)
    const last = alcoholAtHour(40, 8, 4) - alcoholAtHour(40, 8, 5)
    expect(first).toBeCloseTo(8, 6)
    expect(last).toBeCloseTo(8, 6)
    expect(first).toBeCloseTo(last, 6)
  })

  it("actually reaches zero, and stays there", () => {
    expect(alcoholAtHour(40, 8, 5)).toBe(0)
    expect(alcoholAtHour(40, 8, 9)).toBe(0)
    // Never negative: the chart's floor is the axis, not a line below it.
    expect(alcoholAtHour(40, 8, 100)).toBe(0)
  })

  it("is NOT a half-life curve", () => {
    // At one half-life's worth of time an exponential still has half left.
    // A flat rate has none — that difference is the whole card.
    const gramsNow = 40
    const rate = 8
    const halfway = alcoholHoursToClear(gramsNow, rate) / 2
    expect(alcoholAtHour(gramsNow, rate, halfway)).toBeCloseTo(20, 6)
    expect(alcoholAtHour(gramsNow, rate, halfway * 2)).toBe(0)
    // The exponential the caffeine card draws would be well above zero here.
    expect(gramsNow * Math.pow(0.5, 2)).toBeGreaterThan(0)
  })

  it("gives a finishing time you can put on a screen", () => {
    expect(alcoholHoursToClear(41, 4.4)).toBeCloseTo(9.318, 2)
    expect(alcoholHoursToClear(0, 4.4)).toBe(0)
    // A clearance of zero would divide by zero and render "Infinity:NaN".
    expect(alcoholHoursToClear(41, 0)).toBe(0)
  })

  it("clears faster for a heavier body", () => {
    expect(alcoholClearanceGPerHour(95, "male")).toBeGreaterThan(alcoholClearanceGPerHour(60, "male"))
  })
})

describe("the alcohol card draws what the model says", () => {
  const card = readFileSync("src/components/intake/AlcoholCurveCard.tsx", "utf8")
  // Comments are allowed to name the mistake they prevent; the code is not.
  const code = card.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

  it("never reaches for a half-life", () => {
    expect(code, "alcohol does not halve — see alcoholAtHour").not.toMatch(/Math\.pow\(\s*0\.5/)
    expect(code).not.toMatch(/halfLife/i)
  })

  it("plots through the shared model rather than its own arithmetic", () => {
    // Inlining `gramsLeft - rate * h` here would work today and drift the
    // moment the model gains a wrinkle the chart never hears about.
    expect(code).toContain("alcoholAtHour(")
  })

  it("says why it looks different from the curve above it", () => {
    expect(card).toMatch(/straight line, not a curve/i)
  })
})
