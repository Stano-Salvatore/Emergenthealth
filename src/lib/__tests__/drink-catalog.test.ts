import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { estimateCaffeine } from "@/lib/caffeine"
import { drinkCalories } from "@/lib/drink-calories"
import { ethanolGrams } from "@/lib/body-load"
import { resolveDrinkType } from "@/lib/drink-catalog"

// The drink side knew eight kinds. A Kofola tagged in Oura was "other" and
// never reached the intake log; "Nealko pivo" was a 5% beer in the alcohol
// curve; radler was a medicine; a latte cost 0 kcal; chamomile tea carried
// black tea's caffeine. One catalog now names the drinks people actually
// have, and every reader of a drink label asks it.

describe("Oura tags reach the intake log as the drink they are", () => {
  it.each([
    ["Kofola 500ml", "soda", 500],
    ["Red Bull", "soda", 250],
    ["Monster", "soda", 500],
    ["Club-Mate", "mate", 500],
    ["Yerba mate", "mate", 500],
    ["Orange juice", "juice", 250],
    ["Džús", "juice", 250],
    ["Kefir", "milk", 250],
    ["Horúca čokoláda", "milk", 250],
    ["Milk 200ml", "milk", 200],
    ["Nealko pivo", "soda", 500],
    ["Birell", "soda", 500],
    ["Radler", "beer", 500],
    ["Prosecco", "wine", 150],
    ["Tatratea", "spirits", 40],
    ["Becherovka", "spirits", 40],
    ["Aperol spritz", "alcohol", 250],
  ])("%s", (label, kind, ml) => {
    expect(classifyOuraTag(label)).toEqual({ kind, ml })
  })

  it("does not let the catalog outrank what already read correctly", () => {
    expect(classifyOuraTag("rum and coke").kind).toBe("spirits")
    expect(classifyOuraTag("Latte").kind).toBe("coffee")
    expect(classifyOuraTag("Matcha latte").kind).toBe("matcha")
    expect(classifyOuraTag("Syrup water 350ml")).toEqual({ kind: "water", ml: 350 })
    expect(classifyOuraTag("Ferrum").kind).toBe("med")
  })
})

describe("caffeine reads the drink, not only its type", () => {
  it("prices sodas and energy drinks", () => {
    expect(estimateCaffeine("soda", "Kofola", 500)?.mg).toBe(75)
    expect(estimateCaffeine("soda", "Coca-Cola", 330)?.mg).toBe(33)
    expect(estimateCaffeine("soda", "Red Bull", 250)?.mg).toBe(80)
    expect(estimateCaffeine("mate", "Club-Mate", 500)?.mg).toBe(100)
  })

  it("tells teas apart", () => {
    expect(estimateCaffeine("tea", "Green tea", 250)?.mg).toBe(30)
    expect(estimateCaffeine("tea", "Chamomile tea", 250)).toBeNull()
    expect(estimateCaffeine("tea", "Mätový čaj", 250)).toBeNull()
    expect(estimateCaffeine("tea", "Tea", 250)?.mg).toBe(50)
  })

  it("leaves decaf nearly empty and plain coffee as it was", () => {
    expect(estimateCaffeine("coffee", "Decaf latte", 300)?.mg).toBe(3)
    expect(estimateCaffeine("coffee", "Latte", 300)?.mg).toBe(63)
    expect(estimateCaffeine("coffee", "Batch brew", 250)?.mg).toBe(100)
  })

  it("does not invent caffeine for a caffeine-free soda", () => {
    expect(estimateCaffeine("soda", "Sprite", 330)).toBeNull()
    expect(estimateCaffeine("juice", "Orange juice", 250)).toBeNull()
  })
})

describe("calories read the drink too", () => {
  it("prices the milk in a milk coffee", () => {
    expect(drinkCalories("coffee", 300, "Latte")).toBe(135)
    expect(drinkCalories("coffee", 30, "Espresso")).toBe(0)
  })

  it("prices sweet water and sugar-free soda honestly", () => {
    expect(drinkCalories("water", 500, "Syrup water")).toBe(125)
    expect(drinkCalories("soda", 330, "Coke Zero")).toBe(0)
    expect(drinkCalories("soda", 500, "Kofola")).toBe(150)
    expect(drinkCalories("water", 500, "Water")).toBe(0)
  })
})

describe("alcohol reads the drink's usual strength", () => {
  it("counts no ethanol in alcohol-free beer, however it was typed", () => {
    expect(ethanolGrams("beer", 500, "Birell")).toBe(0)
    expect(ethanolGrams("beer", 500, "Nealko pivo (Oura)")).toBe(0)
  })

  it("counts a radler at radler strength, and a stated ABV still wins", () => {
    expect(Math.round(ethanolGrams("beer", 500, "Radler"))).toBe(10)
    expect(Math.round(ethanolGrams("beer", 500, "Radler 4%"))).toBe(16)
    expect(Math.round(ethanolGrams("beer", 500, "Pilsner"))).toBe(20)
  })
})

describe("Emergy's drink type", () => {
  it("files an alcohol-free beer as a soft drink even when told it's beer", () => {
    expect(resolveDrinkType("beer", "Nealko pivo")).toBe("soda")
  })

  it("fills in a type the model left as other", () => {
    expect(resolveDrinkType("other", "Kofola")).toBe("soda")
    expect(resolveDrinkType("other", "mystery drink")).toBe("other")
  })

  it("otherwise keeps what the model said", () => {
    expect(resolveDrinkType("coffee", "Latte")).toBe("coffee")
    expect(resolveDrinkType("beer", "Pilsner Urquell")).toBe("beer")
  })
})

describe("medicines that name a drink stay medicines", () => {
  it.each(["Stoptussin sirup", "cough syrup", "Milk thistle", "Magnesium 400 mg drink", "Paralen sirup 5 ml"])("%s", label => {
    expect(classifyOuraTag(label).kind).toBe("med")
  })

  it("an energy drink tagged with its caffeine is still a drink", () => {
    expect(classifyOuraTag("Red Bull 80 mg").kind).toBe("soda")
    expect(classifyOuraTag("Monster 160mg").kind).toBe("soda")
  })

  it("syrup in water is still a drink with calories", () => {
    expect(drinkCalories("water", 500, "Sirup s vodou")).toBe(125)
    expect(drinkCalories("water", 500, "Syrup water")).toBe(125)
  })

  it("a café's usual can be yerba mate", () => {
    const src = readFileSync("src/app/api/saved-places/route.ts", "utf8")
    expect(src).toMatch(/USUAL_TYPES = new Set\(\[[^\]]*"mate"/)
  })
})
