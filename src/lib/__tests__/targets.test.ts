import { describe, it, expect } from "vitest"
import { computeTargets } from "@/lib/targets"

describe("computeTargets", () => {
  it("scales water, caffeine, protein and calories by weight", () => {
    const t = computeTargets({ weightKg: 80, heightCm: 180 })
    expect(t.waterMl).toBe(2800)          // 35 ml/kg
    expect(t.caffeineMaxMg).toBe(400)     // 5.7*80=456 → capped at 400
    expect(t.proteinG).toBe(96)           // 1.2 g/kg
    expect(t.calories).toBe(2400)         // 30 kcal/kg
    expect(t.bmi).toBeCloseTo(24.7, 1)
    expect(t.personalized).toBe(true)
  })

  it("keeps the caffeine ceiling weight-scaled for lighter users", () => {
    const t = computeTargets({ weightKg: 55 })
    expect(t.caffeineMaxMg).toBe(310)     // 5.7*55=313.5 → 310, under the 400 cap
    expect(t.bmi).toBeNull()              // no height
  })

  it("falls back to standard defaults without body data", () => {
    const t = computeTargets({})
    expect(t).toMatchObject({ waterMl: 2000, caffeineMaxMg: 400, calories: 2200, proteinG: 80, personalized: false })
    expect(t.sugarMaxG).toBe(55)          // 50 g scaled to 2200 kcal
  })

  it("rejects implausible values instead of producing absurd targets", () => {
    const t = computeTargets({ weightKg: 8, heightCm: 500 })
    expect(t.personalized).toBe(false)
    expect(t.waterMl).toBe(2000)
    expect(t.bmi).toBeNull()
  })
})
