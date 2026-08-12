import { describe, it, expect } from "vitest"
import { extractMirrorableDrinks } from "@/lib/drink-mirror"

describe("extractMirrorableDrinks", () => {
  it("mirrors the snapped coffee-and-water case", () => {
    const drinks = extractMirrorableDrinks([
      { kind: "drink", name: "Cold brew coffee", drinkType: "coffee", volumeMl: 300, grams: 300 },
      { kind: "drink", name: "Water", drinkType: "water", volumeMl: 250, grams: 250 },
    ])
    expect(drinks).toEqual([
      { type: "coffee", volumeMl: 300, name: "Cold brew coffee" },
      { type: "water", volumeMl: 250, name: "Water" },
    ])
  })

  it("falls back to grams when volumeMl is missing or zero", () => {
    const drinks = extractMirrorableDrinks([
      { kind: "drink", name: "OJ", drinkType: "juice", volumeMl: 0, grams: 250 },
    ])
    expect(drinks).toEqual([{ type: "juice", volumeMl: 250, name: "OJ" }])
  })

  it("mirrors items missing `kind` when the drink type is unambiguous", () => {
    const drinks = extractMirrorableDrinks([
      { name: "Latte", drinkType: "coffee", volumeMl: 300 }, // older-app payload, no kind field
    ])
    expect(drinks).toHaveLength(1)
  })

  it("skips food, absurd volumes, and malformed items", () => {
    expect(extractMirrorableDrinks([
      { kind: "food", name: "Steak", drinkType: "none", volumeMl: 0, grams: 200 },
      { kind: "drink", name: "Lake", drinkType: "water", volumeMl: 99999 },
      { kind: "drink", name: "Mystery", drinkType: "plutonium", volumeMl: 200 },
      "not an object",
      null,
    ])).toEqual([])
    expect(extractMirrorableDrinks("nope")).toEqual([])
  })
})
