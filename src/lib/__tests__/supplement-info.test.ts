import { describe, it, expect } from "vitest"
import { supplementInfoFor, fractionRemaining } from "@/lib/supplement-info"

describe("supplementInfoFor", () => {
  it("resolves prescription meds by their local brand names", () => {
    // Slovak/CZ brands the user actually types into Oura tags
    expect(supplementInfoFor("Atarax")?.halfLifeH).toBe(20)          // hydroxyzine
    expect(supplementInfoFor("Elicea 10mg")?.halfLifeH).toBe(30)     // escitalopram
    expect(supplementInfoFor("Mirzaten")?.halfLifeH).toBe(26)        // mirtazapine
    expect(supplementInfoFor("Frontin")?.halfLifeH).toBe(12)         // alprazolam
    expect(supplementInfoFor("Ibalgin 400")?.halfLifeH).toBe(2)
  })

  it("matches generic names and ignores diacritics and dosage text", () => {
    expect(supplementInfoFor("mirtazapín 15 mg")?.halfLifeH).toBe(26)
    expect(supplementInfoFor("alprazolam")?.halfLifeH).toBe(12)
    expect(supplementInfoFor("escitalopram")?.halfLifeH).toBe(30)
  })

  it("keeps brand-specific entries ahead of the generic SSRI fallback", () => {
    // Elicea must not fall through to the generic entry, which has no half-life
    expect(supplementInfoFor("Elicea")?.halfLifeH).toBe(30)
    expect(supplementInfoFor("Sertralin")?.halfLifeH).toBeUndefined()
  })

  it("still resolves supplements through the normalizer", () => {
    expect(supplementInfoFor("vitamín D3 2000IU")?.soluble).toBe("fat")
    expect(supplementInfoFor("horčík")?.timing).toContain("Evening")
    expect(supplementInfoFor("Melatonin 1mg")?.halfLifeH).toBe(0.9)
  })

  it("returns null for things it doesn't know", () => {
    expect(supplementInfoFor("mystery powder")).toBeNull()
  })
})

describe("fractionRemaining", () => {
  it("models the overnight carry-over that explains morning grogginess", () => {
    const atarax = supplementInfoFor("Atarax")!
    // 22:00 dose, checked at 08:00 — ten hours later, still most of it
    const left = fractionRemaining(atarax, 10)!
    expect(Math.round(left * 100)).toBe(71)
  })

  it("halves at exactly one half-life and gives up on stored substances", () => {
    const frontin = supplementInfoFor("Frontin")!
    expect(fractionRemaining(frontin, 12)).toBeCloseTo(0.5, 5)
    // vitamin D has no single honest half-life — no decay estimate offered
    expect(fractionRemaining(supplementInfoFor("Vitamin D")!, 24)).toBeNull()
  })
})
