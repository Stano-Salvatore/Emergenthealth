import { describe, it, expect } from "vitest"
import {
  ethanolGrams, alcoholClearanceGPerHour, alcoholRemainingG, standardDrinks,
  hoursUntilBelow, decayFraction,
} from "@/lib/body-load"

describe("ethanolGrams", () => {
  it("converts typical drinks to grams of ethanol", () => {
    expect(Math.round(ethanolGrams("beer", 500))).toBe(20)      // 500ml @5%
    expect(Math.round(ethanolGrams("wine", 150))).toBe(14)      // 150ml @12%
    expect(Math.round(ethanolGrams("spirits", 40))).toBe(13)    // 40ml @40%
  })

  it("prefers an ABV written in the note", () => {
    expect(Math.round(ethanolGrams("beer", 500, "12° special 6,5%"))).toBe(26)
  })

  it("returns zero for anything non-alcoholic", () => {
    expect(ethanolGrams("water", 500)).toBe(0)
    expect(ethanolGrams("coffee", 250)).toBe(0)
    expect(ethanolGrams("beer", 0)).toBe(0)
  })
})

describe("alcoholClearanceGPerHour", () => {
  it("scales with body mass and sex, with a sane default", () => {
    const male80 = alcoholClearanceGPerHour(80, "male")
    const female80 = alcoholClearanceGPerHour(80, "female")
    expect(male80).toBeCloseTo(8.16, 2)
    expect(female80).toBeLessThan(male80)
    // implausible input falls back to the 75kg average
    expect(alcoholClearanceGPerHour(5, "male")).toBeCloseTo(alcoholClearanceGPerHour(75, "male"), 5)
  })
})

describe("alcoholRemainingG", () => {
  const rate = 10 // round numbers: 10 g/hour

  it("clears at a flat rate, not exponentially", () => {
    const at = new Date("2026-01-01T20:00:00Z")
    const now = new Date("2026-01-01T21:00:00Z")
    const { remainingG } = alcoholRemainingG([{ grams: 30, at }], now, rate)
    expect(remainingG).toBeCloseTo(20, 5) // 30 - 10, not 30 × 0.5
  })

  it("stacks drinks taken faster than they clear", () => {
    const base = new Date("2026-01-01T20:00:00Z").getTime()
    const drinks = [0, 1, 2].map(h => ({ grams: 20, at: new Date(base + h * 3_600_000) }))
    const now = new Date(base + 2 * 3_600_000)
    // 20, -10 +20 = 30, -10 +20 = 40
    expect(alcoholRemainingG(drinks, now, rate).remainingG).toBeCloseTo(40, 5)
  })

  it("doesn't let a long gap create negative credit for later drinks", () => {
    const evening = new Date("2026-01-01T18:00:00Z")
    const nightcap = new Date("2026-01-01T23:00:00Z")
    // the 18:00 beer is long gone by 23:00 — only the nightcap counts
    const { remainingG } = alcoholRemainingG(
      [{ grams: 20, at: evening }, { grams: 20, at: nightcap }],
      nightcap, rate,
    )
    expect(remainingG).toBeCloseTo(20, 5)
  })

  it("reports a real finishing time and ignores future drinks", () => {
    const at = new Date("2026-01-01T22:00:00Z")
    const now = new Date("2026-01-01T22:00:00Z")
    const { remainingG, clearsAt } = alcoholRemainingG([{ grams: 25, at }], now, rate)
    expect(remainingG).toBeCloseTo(25, 5)
    expect(clearsAt!.toISOString()).toBe("2026-01-02T00:30:00.000Z") // 2.5 h later

    const later = alcoholRemainingG(
      [{ grams: 25, at: new Date("2026-01-02T02:00:00Z") }], now, rate,
    )
    expect(later.remainingG).toBe(0)
  })

  it("is empty once everything is processed", () => {
    const at = new Date("2026-01-01T18:00:00Z")
    const now = new Date("2026-01-02T06:00:00Z")
    expect(alcoholRemainingG([{ grams: 20, at }], now, rate).remainingG).toBe(0)
  })
})

describe("standardDrinks", () => {
  it("counts 10 g units", () => {
    expect(standardDrinks(20)).toBe(2)
    expect(standardDrinks(14.2)).toBe(1.4)
  })
})

describe("first-order decay", () => {
  it("halves at one half-life", () => {
    expect(decayFraction(5, 5)).toBeCloseTo(0.5, 6)
    expect(decayFraction(0, 5)).toBe(1)
  })

  it("computes when a dose falls under a threshold", () => {
    expect(hoursUntilBelow(120, 30, 5)).toBeCloseTo(10, 6) // two half-lives
    expect(hoursUntilBelow(20, 30, 5)).toBe(0)             // already below
  })
})
