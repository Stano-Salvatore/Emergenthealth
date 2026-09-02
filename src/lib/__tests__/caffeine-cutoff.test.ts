import { describe, it, expect } from "vitest"
import { medianBedtimeMin, lastCoffeeBy, hhmm } from "@/lib/caffeine-cutoff"

const at = (iso: string) => new Date(iso)

describe("medianBedtimeMin", () => {
  it("reads bedtimes in the user's zone and treats after-midnight as late", () => {
    // 23:00, 23:30, 00:30 Prague (UTC+2 in summer) → median 23:30
    const nights = [at("2026-07-01T21:00:00Z"), at("2026-07-02T21:30:00Z"), at("2026-07-03T22:30:00Z"), at("2026-07-04T21:10:00Z"), at("2026-07-05T21:50:00Z")]
    expect(hhmm(medianBedtimeMin(nights, "Europe/Prague")!)).toBe("23:30")
  })
  it("needs five nights", () => {
    expect(medianBedtimeMin([at("2026-07-01T21:00:00Z")], "Europe/Prague")).toBeNull()
  })
})

describe("lastCoffeeBy", () => {
  it("counts back from bedtime by the hours a coffee needs to clear", () => {
    // 100 mg → 30 mg takes log2(100/30) ≈ 1.74 half-lives; at 5 h that is ≈ 8.7 h before 23:00
    const { cutoffMin, hoursBefore } = lastCoffeeBy(23 * 60, 5)
    expect(hoursBefore).toBeCloseTo(8.7, 1)
    expect(hhmm(cutoffMin)).toBe("14:18")
  })
  it("moves earlier for a slow metaboliser", () => {
    expect(lastCoffeeBy(23 * 60, 7).cutoffMin).toBeLessThan(lastCoffeeBy(23 * 60, 5).cutoffMin)
  })
})
