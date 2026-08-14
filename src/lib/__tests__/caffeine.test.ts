import { describe, it, expect } from "vitest"
import { estimateCaffeine, COMPOUNDS } from "@/lib/caffeine"

describe("yerba mate", () => {
  it("is no longer estimated as coffee", () => {
    // It used to fall through to the generic coffee default at 0.4 mg/ml, so a
    // 500ml gourd logged as ~200mg — about 2.5x the truth — and that number
    // fed body-load and every caffeine pattern downstream.
    const mate = estimateCaffeine("", "Maté by Mana Roots", 500)
    expect(mate?.compound).toBe("mate")
    expect(mate!.mg).toBeGreaterThan(50)
    expect(mate!.mg).toBeLessThan(110)

    const coffee = estimateCaffeine("coffee", "filter coffee", 500)
    expect(mate!.mg).toBeLessThan(coffee!.mg)
  })

  it("recognises the spellings people actually use", () => {
    for (const label of ["yerba mate", "Maté", "mate", "Club-Mate", "guayusa"]) {
      expect(estimateCaffeine("", label, 330)?.compound).toBe("mate")
    }
  })

  it("does not mistake words that merely contain 'mate'", () => {
    expect(estimateCaffeine("coffee", "tomato juice", 250)?.compound).not.toBe("mate")
  })

  it("has a preset so it can be picked from the UI too", () => {
    expect(COMPOUNDS.mate).toBeDefined()
    expect(COMPOUNDS.mate.mg).toBeGreaterThan(0)
    expect(COMPOUNDS.mate.mg).toBeLessThan(COMPOUNDS.filter_coffee.mg)
  })
})

describe("estimateCaffeine — existing drinks still resolve", () => {
  it("keeps coffee shapes intact", () => {
    expect(estimateCaffeine("coffee", "espresso", 30)?.compound).toBe("espresso")
    expect(estimateCaffeine("coffee", "flat white", 200)?.compound).toBe("flat_white")
    expect(estimateCaffeine("coffee", "cold brew", 300)?.compound).toBe("cold_brew")
  })
})
