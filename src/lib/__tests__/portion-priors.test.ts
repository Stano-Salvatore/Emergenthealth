import { describe, it, expect } from "vitest"
import { unitWeightFor, servingCapFor, applyPortionPriors } from "@/lib/portion-priors"

describe("unitWeightFor", () => {
  it("resolves common units", () => {
    expect(unitWeightFor("large egg", "Scrambled eggs")).toBe(50)
    expect(unitWeightFor("egg white", "Egg white omelet")).toBe(33)
    expect(unitWeightFor("slice of bread", "Rye bread")).toBe(32)
    expect(unitWeightFor("pancake", "Pancakes with jam")).toBe(77)
    expect(unitWeightFor("piece", "Pierogi")).toBe(35) // matched via item name
    expect(unitWeightFor("", "Banana")).toBe(118)
  })

  it("returns null for unknown units", () => {
    expect(unitWeightFor("bowl", "Goulash")).toBeNull()
  })
})

describe("servingCapFor", () => {
  it("finds dish ceilings from the name or search query", () => {
    expect(servingCapFor("Scrambled eggs with peppers", "")?.maxG).toBe(400)
    expect(servingCapFor("Fried tvorog-filled pastry", "")?.maxG).toBe(250)
    expect(servingCapFor("Kurací vývar", "chicken soup")?.maxG).toBe(650)
    expect(servingCapFor("Grilled salmon", "salmon atlantic cooked")).toBeNull()
  })
})

describe("applyPortionPriors", () => {
  it("computes grams from count × unit weight", () => {
    const r = applyPortionPriors({ name: "Scrambled eggs", grams: 600, count: 4, unitName: "large egg" })
    expect(r).toEqual({ grams: 200, adjusted: "count" })
  })

  it("doesn't report an adjustment when the model's weight already agrees", () => {
    const r = applyPortionPriors({ name: "Scrambled eggs", grams: 210, count: 4, unitName: "large egg" })
    expect(r.grams).toBe(200)
    expect(r.adjusted).toBeNull()
  })

  it("clamps single servings above the ceiling", () => {
    const r = applyPortionPriors({ name: "Cheese omelette", grams: 700, count: 0, unitName: "" })
    expect(r).toEqual({ grams: 400, adjusted: "cap" })
  })

  it("leaves plausible portions and drinks alone", () => {
    expect(applyPortionPriors({ name: "Goulash soup", grams: 400 })).toEqual({ grams: 400, adjusted: null })
    expect(applyPortionPriors({ name: "Beer", grams: 500, kind: "drink" })).toEqual({ grams: 500, adjusted: null })
  })
})
