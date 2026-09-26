import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { drinkCalories, drinkCaloriesTotal } from "../drink-calories"
import { permilleFromGrams } from "../body-load"

// Drinks carried no calories anywhere: a day of two beers and a juice read
// as a lighter day than it was, in the one total the Overview ring holds
// against a personal target. And the alcohol card said grams, which nobody
// outside a chemistry lab thinks in — the number people actually know is ‰.

describe("drinkCalories", () => {
  it("prices wine from its ethanol plus residual sugar", () => {
    // 100ml × 12% × 0.789 = 9.47g ethanol × 7 ≈ 66 kcal, + 10 carb kcal
    expect(drinkCalories("wine", 100)).toBeGreaterThanOrEqual(70)
    expect(drinkCalories("wine", 100)).toBeLessThanOrEqual(82)
  })

  it("a stated ABV reprices the drink — a radler is not a lager", () => {
    const lager = drinkCalories("beer", 500)
    const radler = drinkCalories("beer", 500, "Radler 2%")
    const ipa = drinkCalories("beer", 500, "IPA 8%")
    expect(radler).toBeLessThan(lager)
    expect(ipa).toBeGreaterThan(lager)
  })

  it("spirits are almost pure ethanol calories", () => {
    // 40ml × 40% × 0.789 = 12.6g × 7 ≈ 88 kcal
    const shot = drinkCalories("spirits", 40)
    expect(shot).toBeGreaterThanOrEqual(80)
    expect(shot).toBeLessThanOrEqual(95)
  })

  it("caloric soft drinks count; water and coffee do not", () => {
    expect(drinkCalories("juice", 200)).toBeGreaterThan(70)
    expect(drinkCalories("soda", 330)).toBeGreaterThan(100)
    expect(drinkCalories("water", 500)).toBe(0)
    expect(drinkCalories("coffee", 200)).toBe(0)
    expect(drinkCalories("sparkling", 500)).toBe(0)
  })

  it("sums a day and survives junk rows", () => {
    const total = drinkCaloriesTotal([
      { type: "wine", amountMl: 100 },
      { type: "water", amountMl: 500 },
      { type: "juice", amountMl: 200, note: null },
      { type: "nonsense", amountMl: 300 },
      { type: "beer", amountMl: 0 },
    ])
    expect(total).toBe(drinkCalories("wine", 100) + drinkCalories("juice", 200))
  })
})

describe("permilleFromGrams", () => {
  it("Widmark: grams over distribution mass, in ‰", () => {
    // 9.5g in a 75kg male: 9.5 / (0.68 × 75) = 0.19‰
    expect(permilleFromGrams(9.5, 75, "male")).toBeCloseTo(0.19, 2)
  })
  it("a smaller body reads higher from the same drink", () => {
    expect(permilleFromGrams(9.5, 60, "female")).toBeGreaterThan(permilleFromGrams(9.5, 90, "male"))
  })
  it("zero grams is zero, not NaN", () => {
    expect(permilleFromGrams(0, null, null)).toBe(0)
  })
})

// The numbers must be *reachable*, not just computable.
const read = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("the calories and the ‰ reach their surfaces", () => {
  it("the Overview ring counts drink calories in the daily total", () => {
    const s = read("src/components/intake/OverviewTab.tsx")
    expect(s).toMatch(/drinkCaloriesTotal\(/)
    expect(s).toMatch(/from drinks/)
  })
  it("Emergy's day context carries the drink calories", () => {
    expect(read("src/lib/claude.ts")).toMatch(/drinkCaloriesTotal\(/)
  })
  it("logging a caloric drink in chat answers with its calories", () => {
    expect(read("src/lib/claude.ts")).toMatch(/drinkCalories\(/)
  })
  it("the body-load endpoint sends ‰ alongside the grams", () => {
    expect(read("src/app/api/body-load/route.ts")).toMatch(/permilleFromGrams\(/)
  })
  it("the alcohol card shows ‰ and refuses to be a breathalyzer", () => {
    const s = read("src/components/intake/AlcoholCurveCard.tsx")
    expect(s).toMatch(/‰/)
    expect(s).toMatch(/[Nn]ot a breathalyzer/)
    expect(s).toMatch(/driv/i)
  })
})
