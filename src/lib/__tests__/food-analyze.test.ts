import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the Anthropic SDK so no API key or network is needed — the tests drive
// analyzeMealPhoto with canned model responses.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  },
}))

import { analyzeMealPhoto, reconcileWithDb, type FoodItem } from "@/lib/food-analyze"

const PHOTO = "data:image/jpeg;base64,aGVsbG8="

const item = (over: Partial<FoodItem>): FoodItem => ({
  kind: "food",
  name: "Item",
  portion: "1 piece",
  grams: 100,
  count: 0,
  unitName: "",
  searchQuery: "",
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  sugarG: 0,
  drinkType: "none",
  volumeMl: 0,
  ...over,
})

const modelResponse = (parsed: unknown, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text: JSON.stringify(parsed) }],
})

beforeEach(() => {
  mockCreate.mockReset()
})

describe("analyzeMealPhoto", () => {
  it("overrides a matched item with USDA values and sums totals in code", async () => {
    mockCreate.mockResolvedValue(modelResponse({
      isFood: true,
      name: "Banana",
      mealType: "snack",
      items: [item({
        name: "Banana", searchQuery: "banana raw", grams: 120,
        calories: 500, proteinG: 20, carbsG: 5, fatG: 9, // deliberately wrong model guesses
      })],
      micros: [],
      healthNote: "Nice snack!",
    }))

    const a = await analyzeMealPhoto(PHOTO)
    expect(a).not.toBeNull()
    const b = a!.items[0]
    expect(b.source).toBe("db")
    expect(b.dbName).toBe("Bananas, raw")
    // USDA banana: 89 kcal/100g → ~107 for 120 g, not the model's 500
    expect(b.calories).toBeGreaterThan(100)
    expect(b.calories).toBeLessThan(115)
    expect(a!.calories).toBe(b.calories) // totals summed from items
    // measured potassium shows up in micros
    expect(a!.micros.some(m => m.name === "Potassium")).toBe(true)
  })

  it("keeps model estimates when nothing matches, marked as such", async () => {
    mockCreate.mockResolvedValue(modelResponse({
      isFood: true,
      name: "Grandma's dumplings",
      mealType: "dinner",
      items: [item({ name: "Mystery dumplings", searchQuery: "xzqv blorptastic", grams: 200, calories: 350, proteinG: 10, carbsG: 50, fatG: 12 })],
      micros: [{ name: "Vitamin C", amount: 10, unit: "mg", dailyPct: 11 }],
      healthNote: "",
    }))

    const a = await analyzeMealPhoto(PHOTO)
    expect(a!.items[0].source).toBe("est")
    expect(a!.items[0].calories).toBe(350) // untouched
    expect(a!.micros).toEqual([{ name: "Vitamin C", amount: 10, unit: "mg", dailyPct: 11 }])
  })

  it("returns null on a safety refusal", async () => {
    mockCreate.mockResolvedValue({ stop_reason: "refusal", content: [] })
    expect(await analyzeMealPhoto(PHOTO)).toBeNull()
  })

  it("returns null for a malformed data URL without calling the API", async () => {
    expect(await analyzeMealPhoto("data:text/html;base64,xxx")).toBeNull()
    expect(await analyzeMealPhoto("not a data url")).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("runs refine passes at high effort and first passes at low", async () => {
    const parsed = { isFood: true, name: "X", mealType: "other", items: [], micros: [], healthNote: "" }
    mockCreate.mockResolvedValue(modelResponse(parsed))

    await analyzeMealPhoto(PHOTO)
    expect(mockCreate.mock.calls[0][0].output_config.effort).toBe("low")

    await analyzeMealPhoto(PHOTO, { hint: "it was oat milk" })
    expect(mockCreate.mock.calls[1][0].output_config.effort).toBe("high")

    await analyzeMealPhoto(PHOTO, { labelImageDataUrl: PHOTO })
    expect(mockCreate.mock.calls[2][0].output_config.effort).toBe("high")
    // label photo rides along as a second image block
    expect(mockCreate.mock.calls[2][0].messages[0].content.filter((b: { type: string }) => b.type === "image")).toHaveLength(2)
  })
})

describe("reconcileWithDb", () => {
  it("uses drink volume as grams when grams is missing", () => {
    const a = reconcileWithDb({
      isFood: true,
      name: "OJ",
      mealType: "other",
      items: [item({ kind: "drink", name: "Orange juice", searchQuery: "orange juice raw", grams: 0, drinkType: "juice", volumeMl: 250, calories: 999 })],
      micros: [],
      healthNote: "",
    })
    expect(a.items[0].source).toBe("db")
    // USDA OJ ≈ 45 kcal/100g → ~112 for 250 ml
    expect(a.items[0].calories).toBeGreaterThan(100)
    expect(a.items[0].calories).toBeLessThan(125)
    expect(a.micros.some(m => m.name === "Vitamin C")).toBe(true)
  })

  it("trusts the count over an inflated eyeballed weight — the 4-egg case", () => {
    // The model sees 4 eggs but calls the pile 600 g (a 10-egg plate).
    const a = reconcileWithDb({
      isFood: true,
      name: "Scrambled eggs",
      mealType: "dinner",
      items: [item({
        name: "Scrambled eggs", searchQuery: "egg whole cooked scrambled",
        grams: 600, count: 4, unitName: "large egg",
        calories: 900, proteinG: 60, carbsG: 6, fatG: 66,
      })],
      micros: [],
      healthNote: "",
    })
    const eggs = a.items[0]
    expect(eggs.grams).toBe(200) // 4 × 50 g, not 600
    expect(eggs.portionAdjusted).toBe("count")
    expect(eggs.source).toBe("db")
    // USDA scrambled eggs ≈ 149 kcal/100g → ~300 kcal, not 900
    expect(eggs.calories).toBeGreaterThan(250)
    expect(eggs.calories).toBeLessThan(350)
  })

  it("clamps an implausible single serving and rescales an unmatched estimate", () => {
    const a = reconcileWithDb({
      isFood: true,
      name: "Fried pastry",
      mealType: "snack",
      items: [item({
        name: "Fried tvorog-filled pastry", searchQuery: "zzblorp no match",
        grams: 400, // one hand-held pastry is not 400 g
        calories: 960, proteinG: 33, carbsG: 99, fatG: 48,
      })],
      micros: [],
      healthNote: "",
    })
    const pastry = a.items[0]
    expect(pastry.source).toBe("est")
    expect(pastry.portionAdjusted).toBe("cap")
    expect(pastry.grams).toBe(250) // pastry ceiling
    expect(pastry.calories).toBe(600) // 960 × 250/400 — estimate rescaled with the weight
  })

  it("merges model micros only for nutrients the database didn't cover", () => {
    const a = reconcileWithDb({
      isFood: true,
      name: "Mixed plate",
      mealType: "lunch",
      items: [
        item({ name: "Banana", searchQuery: "banana raw", grams: 120 }),
        item({ name: "Mystery sauce", searchQuery: "zzblorp", grams: 50, calories: 80 }),
      ],
      micros: [
        { name: "Potassium", amount: 999, unit: "mg", dailyPct: 99 },  // db already covers → dropped
        { name: "Vitamin E", amount: 3, unit: "mg", dailyPct: 20 },     // db doesn't → kept
      ],
      healthNote: "",
    })
    const potassium = a.micros.filter(m => m.name === "Potassium")
    expect(potassium).toHaveLength(1)
    expect(potassium[0].dailyPct).not.toBe(99) // the measured one, not the model's
    expect(a.micros.some(m => m.name === "Vitamin E")).toBe(true)
  })
})
