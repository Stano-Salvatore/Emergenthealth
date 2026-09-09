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

  it("uses Mifflin-St Jeor when age and sex are known", () => {
    const year = new Date().getFullYear()
    // 80 kg, 180 cm, 30 years, male: BMR = 800 + 1125 - 150 + 5 = 1780 → ×1.4 = 2492 → 2500
    const m = computeTargets({ weightKg: 80, heightCm: 180, birthYear: year - 30, sex: "male" })
    expect(m.calorieBasis).toBe("bmr")
    expect(m.calories).toBe(2500)
    // same body, female: BMR = 1780 - 166 = 1614 → ×1.4 = 2259.6 → 2250
    const f = computeTargets({ weightKg: 80, heightCm: 180, birthYear: year - 30, sex: "female" })
    expect(f.calories).toBe(2250)
    expect(f.sugarMaxG).toBe(Math.round(50 * (2250 / 2000)))
  })

  it("moves calories by the weight-goal pace and lifts protein", () => {
    const year = new Date().getFullYear()
    const base = { weightKg: 80, heightCm: 180, birthYear: year - 30, sex: "male" as const }
    const none = computeTargets(base)
    expect(none.goalAdjustmentKcal).toBe(0)
    // 0.5 kg/wk = 550 kcal/day → 2500 − 550 = 1950
    const lose = computeTargets({ ...base, weightGoal: { mode: "lose", paceKgWk: 0.5 } })
    expect(lose.calories).toBe(1950)
    expect(lose.goalAdjustmentKcal).toBe(-550)
    expect(lose.proteinG).toBe(128)       // 1.6 g/kg
    const gain = computeTargets({ ...base, weightGoal: { mode: "gain", paceKgWk: 0.25 } })
    expect(gain.calories).toBe(2800)       // 2500 + 275, rounded to 50
    expect(gain.goalAdjustmentKcal).toBe(300)
    const keep = computeTargets({ ...base, weightGoal: { mode: "maintain" } })
    expect(keep.calories).toBe(2500)
    expect(keep.proteinG).toBe(96)
  })

  it("never cuts calories under the BMR or 1200 kcal", () => {
    const year = new Date().getFullYear()
    // 55 kg, 160 cm, 40 y, female: BMR = 550 + 1000 − 200 − 161 = 1189 → maintenance 1650
    const t = computeTargets({ weightKg: 55, heightCm: 160, birthYear: year - 40, sex: "female", weightGoal: { mode: "lose", paceKgWk: 1.0 } })
    expect(t.calories).toBe(1200)        // 1650 − 1000 would be 650
    // rough basis, no BMR known: 30×50 = 1500 → 1 kg/wk cap 1000 → floor 1200
    const r = computeTargets({ weightKg: 50, weightGoal: { mode: "lose", paceKgWk: 1.0 } })
    expect(r.calories).toBe(1200)
  })

  it("falls back to the rough estimate when age or sex is missing or absurd", () => {
    const t = computeTargets({ weightKg: 80, heightCm: 180, birthYear: 1600, sex: "male" })
    expect(t.calorieBasis).toBe("rough")
    expect(t.calories).toBe(2400)
    const noSex = computeTargets({ weightKg: 80, heightCm: 180, birthYear: 1995 })
    expect(noSex.calorieBasis).toBe("rough")
  })
})
