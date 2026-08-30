import { describe, it, expect } from "vitest"
import { healthyWeightRange, weightChangeVerdict } from "../targets"

// 175 cm → 18.5–24.9 BMI is 56.7–76.3 kg (24.9 × 1.75² = 76.256).
const TALL = 175

describe("healthyWeightRange", () => {
  it("gives both ends of the band, not just the ceiling", () => {
    const r = healthyWeightRange(TALL, 70)!
    expect(r.minKg).toBeCloseTo(56.7, 1)
    expect(r.maxKg).toBeCloseTo(76.3, 1)
    expect(r.position).toBe("inside")
    expect(r.bmi).toBeCloseTo(22.9, 1)
  })

  it("knows when someone is under it", () => {
    const r = healthyWeightRange(TALL, 47)!
    expect(r.position).toBe("under")
    expect(r.bmi).toBeCloseTo(15.3, 1)
  })

  it("and over it", () => {
    expect(healthyWeightRange(TALL, 95)!.position).toBe("over")
  })

  it("refuses to invent a band without a plausible height", () => {
    expect(healthyWeightRange(null, 70)).toBeNull()
    expect(healthyWeightRange(40, 70)).toBeNull()
    expect(healthyWeightRange(TALL, null)).toBeNull()
  })
})

describe("weightChangeVerdict", () => {
  const under = healthyWeightRange(TALL, 47)
  const over = healthyWeightRange(TALL, 95)
  const inside = healthyWeightRange(TALL, 70)

  it("losing weight when underweight is not a win", () => {
    expect(weightChangeVerdict(under, -2)).toBe("worse")
    expect(weightChangeVerdict(under, +2)).toBe("better")
  })

  it("and the same two kilos read the opposite way above the band", () => {
    expect(weightChangeVerdict(over, -2)).toBe("better")
    expect(weightChangeVerdict(over, +2)).toBe("worse")
  })

  it("inside the band, neither direction is a verdict", () => {
    expect(weightChangeVerdict(inside, -2)).toBe("neutral")
    expect(weightChangeVerdict(inside, +2)).toBe("neutral")
  })

  it("says nothing about a change too small to mean anything", () => {
    expect(weightChangeVerdict(under, -0.1)).toBe("neutral")
  })

  it("says nothing at all without a band", () => {
    expect(weightChangeVerdict(null, -2)).toBeNull()
  })
})
