import { describe, it, expect } from "vitest"
import { searchFood, nutrientsForGrams, notableMicros, DAILY_VALUES, type DbNutrients } from "@/lib/nutrient-db"

describe("searchFood", () => {
  it("finds roasted chicken breast with USDA-accurate values", () => {
    const m = searchFood("chicken breast meat only roasted")
    expect(m).not.toBeNull()
    expect(m!.desc.toLowerCase()).toContain("chicken")
    expect(m!.desc.toLowerCase()).toContain("breast")
    // USDA: ~165 kcal / 31 g protein per 100 g
    expect(m!.per100.kcal).toBeGreaterThan(150)
    expect(m!.per100.kcal).toBeLessThan(180)
    expect(m!.per100.protein).toBeGreaterThan(28)
  })

  it("finds raw banana", () => {
    const m = searchFood("banana raw")
    expect(m?.desc).toBe("Bananas, raw")
    expect(m!.per100.kcal).toBeCloseTo(89, 0)
    expect(m!.per100.k).toBeCloseTo(358, 0) // potassium mg
  })

  it("finds orange juice with its vitamin C", () => {
    const m = searchFood("orange juice raw")
    expect(m).not.toBeNull()
    expect(m!.desc.toLowerCase()).toContain("orange juice")
    expect(m!.per100.vitC).toBeGreaterThan(30)
  })

  it("returns null for nonsense", () => {
    expect(searchFood("xzqv blorptastic widget")).toBeNull()
    expect(searchFood("")).toBeNull()
  })
})

describe("nutrientsForGrams", () => {
  it("scales per-100g values linearly", () => {
    const banana = searchFood("banana raw")!
    const n = nutrientsForGrams(banana.per100, 120)
    expect(n.kcal).toBeCloseTo(banana.per100.kcal * 1.2, 1)
    expect(n.protein).toBeCloseTo(banana.per100.protein * 1.2, 2)
  })
})

describe("notableMicros", () => {
  const empty = Object.fromEntries(Object.keys(DAILY_VALUES).concat(["kcal", "protein", "fat", "carb", "sugar"]).map(k => [k, 0])) as unknown as DbNutrients

  it("computes % daily value against FDA DVs", () => {
    const totals = { ...empty, vitC: 90, fe: 9 } // 100% DV vit C, 50% DV iron
    const micros = notableMicros(totals)
    const vitC = micros.find(m => m.name === "Vitamin C")
    const iron = micros.find(m => m.name === "Iron")
    expect(vitC?.dailyPct).toBe(100)
    expect(iron?.dailyPct).toBe(50)
    // sorted by coverage
    expect(micros[0].name).toBe("Vitamin C")
  })

  it("drops nutrients under 5% DV and low sodium", () => {
    const totals = { ...empty, vitC: 1, na: 230 } // ~1% DV vit C, 10% DV sodium
    expect(notableMicros(totals)).toEqual([])
  })

  it("reports sodium only when high", () => {
    const totals = { ...empty, na: 700 } // ~30% DV
    const micros = notableMicros(totals)
    expect(micros.find(m => m.name === "Sodium")?.dailyPct).toBe(30)
  })
})
