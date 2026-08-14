import { describe, it, expect } from "vitest"
import {
  assessCoverage, nutrientGaps, normalizeNutrient, toMicrograms, NRV,
  type LoggedMicro, type DayCalories,
} from "@/lib/nutrients"

const days = (n: number, kcal = 2000): DayCalories[] =>
  Array.from({ length: n }, (_, i) => ({ day: `2026-08-${String(i + 1).padStart(2, "0")}`, calories: kcal }))

/** `n` days each carrying `amount` of one nutrient. */
const micros = (name: string, amount: number, unit: string, n: number): LoggedMicro[] =>
  Array.from({ length: n }, (_, i) => ({
    day: `2026-08-${String(i + 1).padStart(2, "0")}`, name, amount, unit,
  }))

describe("assessCoverage — refuses rather than guesses", () => {
  it("passes a well-logged fortnight", () => {
    const v = assessCoverage(days(14), 14)
    expect(v.ok).toBe(true)
  })

  it("refuses when too few days carry any food", () => {
    // 5 of 14 days — every nutrient would look deficient
    const v = assessCoverage([...days(5), ...Array.from({ length: 9 }, (_, i) => ({ day: `x${i}`, calories: 0 }))], 14)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain("5 of the last 14")
  })

  it("refuses when the days logged are obviously partial", () => {
    // Logging lunch every day scores full day-coverage on a third of the food,
    // which day-coverage alone cannot detect
    const v = assessCoverage(days(14, 600), 14)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain("missed")
  })

  it("reports the numbers either way, so the user can see why", () => {
    const v = assessCoverage(days(14, 600), 14)
    expect(v.daysLogged).toBe(14)
    expect(v.avgCalories).toBe(600)
  })
})

describe("nutrientGaps", () => {
  it("flags a nutrient running well under the reference value", () => {
    // 100mg magnesium a day against an NRV of 375mg
    const gaps = nutrientGaps(micros("Magnesium", 100, "mg", 14), 14)
    const mg = gaps.find(g => g.nutrient === "Magnesium")
    expect(mg).toBeDefined()
    expect(mg!.pctOfNrv).toBe(27)
    expect(mg!.unit).toBe("mg")
    expect(mg!.avgPerDay).toBeCloseTo(100, 0)
  })

  it("stays quiet about a nutrient that's fine", () => {
    const gaps = nutrientGaps(micros("Vitamin C", 90, "mg", 14), 14)
    expect(gaps.find(g => g.nutrient === "Vitamin C")).toBeUndefined()
  })

  it("averages over the window, not over the days it appeared", () => {
    // One day at full NRV out of 14 is not "a full day's intake" — it's one
    // day and thirteen at zero
    const gaps = nutrientGaps(micros("Magnesium", 375, "mg", 5), 14)
    const mg = gaps.find(g => g.nutrient === "Magnesium")!
    expect(mg.pctOfNrv).toBe(36) // 5/14 of the NRV, not 100
  })

  it("won't average a nutrient it has barely seen", () => {
    // 3 readings is not a fortnight's habit
    expect(nutrientGaps(micros("Magnesium", 10, "mg", 3), 14)).toHaveLength(0)
  })

  it("sorts worst-first", () => {
    const gaps = nutrientGaps([
      ...micros("Magnesium", 200, "mg", 14),   // 53%
      ...micros("Zinc", 2, "mg", 14),          // 20%
    ], 14)
    expect(gaps.map(g => g.nutrient)).toEqual(["Zinc", "Magnesium"])
  })

  it("points at the lab marker that would actually measure it", () => {
    const gaps = nutrientGaps(micros("Vitamin D", 1, "ug", 14), 14)
    expect(gaps[0].labMarker).toBe("Vitamin D")
    // Magnesium has no useful serum measure, so it claims none
    const mg = nutrientGaps(micros("Magnesium", 50, "mg", 14), 14)
    expect(mg[0].labMarker).toBeNull()
  })

  it("names foods without prescribing anything", () => {
    const gaps = nutrientGaps(micros("Iron", 4, "mg", 14), 14)
    expect(gaps[0].foods).toContain("lentils")
    expect(gaps[0].foods.toLowerCase()).not.toContain("supplement")
  })

  it("ignores a nutrient it has no reference for", () => {
    expect(nutrientGaps(micros("Unobtainium", 1, "mg", 14), 14)).toHaveLength(0)
  })
})

describe("unit handling", () => {
  it("converts the mass units", () => {
    expect(toMicrograms(1, "g", "Magnesium")).toBe(1_000_000)
    expect(toMicrograms(1, "mg", "Magnesium")).toBe(1000)
    expect(toMicrograms(1, "µg", "Folate")).toBe(1)
    expect(toMicrograms(1, "mcg", "Folate")).toBe(1)
  })

  it("takes IU only where it means something", () => {
    // 1000 IU vitamin D = 25 µg
    expect(toMicrograms(1000, "IU", "Vitamin D")).toBeCloseTo(25, 1)
    // An IU is biological activity, not mass — meaningless for a mineral
    expect(toMicrograms(1000, "IU", "Magnesium")).toBeNull()
  })

  it("refuses a unit it doesn't understand rather than assuming", () => {
    expect(toMicrograms(1, "handfuls", "Magnesium")).toBeNull()
    expect(toMicrograms(-5, "mg", "Magnesium")).toBeNull()
  })

  it("mixed units in one window still add up", () => {
    const gaps = nutrientGaps([
      ...micros("Vitamin D", 400, "IU", 7),   // 10 µg/day on those days
      ...micros("Vitamin D", 5, "ug", 7),
    ], 14)
    const d = gaps.find(g => g.nutrient === "Vitamin D")!
    // (7*10 + 7*5) / 14 = 7.5 µg/day against an NRV of 5 → over, so not a gap…
    expect(d).toBeUndefined()
  })
})

describe("normalizeNutrient", () => {
  it("folds the names a meal analysis actually produces", () => {
    expect(normalizeNutrient("vitamin b12")).toBe("Vitamin B12")
    expect(normalizeNutrient("Cobalamin")).toBe("Vitamin B12")
    expect(normalizeNutrient("folic acid")).toBe("Folate")
    expect(normalizeNutrient("Ascorbic acid")).toBe("Vitamin C")
    expect(normalizeNutrient("MAGNESIUM")).toBe("Magnesium")
  })

  it("returns null for anything it can't place", () => {
    expect(normalizeNutrient("vibes")).toBeNull()
    expect(normalizeNutrient("")).toBeNull()
  })
})

describe("NRV table", () => {
  it("matches the EU labelling reference values", () => {
    expect(NRV["Magnesium"]).toEqual({ amount: 375, unit: "mg" })
    expect(NRV["Vitamin C"]).toEqual({ amount: 80, unit: "mg" })
    expect(NRV["Vitamin B12"]).toEqual({ amount: 2.5, unit: "ug" })
    expect(NRV["Iron"]).toEqual({ amount: 14, unit: "mg" })
  })
})
