import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stackedDoses, hoursUntilBelow, decayFraction, MED_FLOOR_FRACTION } from "@/lib/body-load"

// Escitalopram every morning, half-life ≈30 h. "In my body" counted only the
// most recent dose, so an hour after today's tablet it read ≈98% of one dose
// — when yesterday's and the day before's were still there too, and the real
// level is over twice that. Its "negligible by" time came more than a day
// early, and three days into a taper the medicine vanished from the tab while
// a clinically relevant level remained: the query only looked back 72 h.

const H = 30
const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000)

describe("stackedDoses", () => {
  const now = new Date("2026-09-26T09:00:00Z")

  it("adds up every dose still decaying, not just the last", () => {
    const daily = [1, 25, 49, 73, 97, 121, 145].map(h => hoursAgo(now, h))
    const sum = stackedDoses(daily, now, H)
    expect(sum).toBeGreaterThan(2)
    expect(sum).toBeCloseTo(daily.reduce((s, t) => s + decayFraction((now.getTime() - t.getTime()) / 3_600_000, H), 0), 10)
    expect(sum).toBeGreaterThan(decayFraction(1, H) * 2)
  })

  it("clears later than the last dose alone would say", () => {
    const daily = [1, 25, 49, 73].map(h => hoursAgo(now, h))
    const stacked = hoursUntilBelow(stackedDoses(daily, now, H), MED_FLOOR_FRACTION, H)!
    const single = hoursUntilBelow(decayFraction(1, H), MED_FLOOR_FRACTION, H)!
    expect(stacked - single).toBeGreaterThan(24)
  })

  it("a single dose is exactly what it was", () => {
    expect(stackedDoses([hoursAgo(now, 30)], now, H)).toBeCloseTo(0.5, 10)
    expect(stackedDoses([], now, H)).toBe(0)
  })
})

describe("the body-load endpoint uses the stacked total", () => {
  const src = readFileSync("src/lib/body-load-now.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

  it("sums a medicine's doses", () => {
    expect(src).toMatch(/stackedDoses\(/)
    expect(src).not.toMatch(/show the most recent one/)
  })

  it("looks back far enough for a 30 h half-life to fade (five half-lives)", () => {
    const m = /sinceMeds\s*=\s*new Date\(now\.getTime\(\)\s*-\s*(\d+)\s*\*\s*3_600_000\)/.exec(src)
    expect(m, "a sinceMeds lookback in hours").not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(150)
  })
})
