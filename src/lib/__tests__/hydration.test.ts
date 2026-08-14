import { describe, it, expect } from "vitest"
import { hydrationMl, sumHydration, hydrationBreakdown, HYDRATING_TYPES } from "@/lib/hydration"

describe("hydrationMl", () => {
  it("counts caffeinated drinks as fluid — the bug this fixes", () => {
    // A litre of mate used to count as zero, and Emergy would still shout
    // about drinking water
    expect(hydrationMl("mate", 1000)).toBe(1000)
    expect(hydrationMl("coffee", 250)).toBe(250)
    expect(hydrationMl("tea", 300)).toBe(300)
    expect(hydrationMl("matcha", 200)).toBe(200)
  })

  it("discounts alcohol rather than counting or ignoring it", () => {
    expect(hydrationMl("beer", 500)).toBe(400)
    expect(hydrationMl("wine", 200)).toBe(80)
    expect(hydrationMl("spirits", 50)).toBe(0)
    // …and beer still beats spirits per ml, which is the only claim being made
    expect(hydrationMl("beer", 100)).toBeGreaterThan(hydrationMl("spirits", 100))
  })

  it("counts an unrecognised drink fully", () => {
    // Scoring an unknown drink zero is exactly the failure being fixed —
    // it should not come back through the unknown-type path
    expect(hydrationMl("kombucha", 330)).toBe(330)
    expect(hydrationMl("", 250)).toBe(250)
    expect(hydrationMl(null, 250)).toBe(250)
  })

  it("is case-insensitive about the type", () => {
    expect(hydrationMl("Coffee", 200)).toBe(200)
    expect(hydrationMl("BEER", 500)).toBe(400)
  })

  it("ignores nonsense volumes", () => {
    expect(hydrationMl("water", 0)).toBe(0)
    expect(hydrationMl("water", -500)).toBe(0)
    expect(hydrationMl("water", NaN)).toBe(0)
  })
})

describe("sumHydration", () => {
  it("adds a realistic day", () => {
    // 500ml mate + 2 coffees + 750ml water + a beer
    const day = [
      { type: "mate", amountMl: 500 },
      { type: "coffee", amountMl: 200 },
      { type: "coffee", amountMl: 200 },
      { type: "water", amountMl: 750 },
      { type: "beer", amountMl: 500 },
    ]
    expect(sumHydration(day)).toBe(2050)
    // Under the old water-only rule this same day scored 750 — enough to
    // trigger the "please drink water" push
    expect(day.filter(d => d.type === "water").reduce((s, d) => s + d.amountMl, 0)).toBe(750)
  })

  it("is zero for an empty day", () => {
    expect(sumHydration([])).toBe(0)
  })
})

describe("hydrationBreakdown", () => {
  it("keeps plain water visible inside the total", () => {
    const b = hydrationBreakdown([
      { type: "water", amountMl: 500 },
      { type: "coffee", amountMl: 400 },
      { type: "mate", amountMl: 500 },
    ])
    expect(b).toEqual({ total: 1400, water: 500, other: 900 })
  })
})

describe("HYDRATING_TYPES", () => {
  it("covers the drink types the app logs, minus the zero-factor ones", () => {
    for (const t of ["water", "coffee", "tea", "mate", "beer", "juice"]) {
      expect(HYDRATING_TYPES).toContain(t)
    }
    expect(HYDRATING_TYPES).not.toContain("spirits")
  })
})
