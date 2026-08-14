import { describe, it, expect } from "vitest"
import { referenceChangeValue, isSignificantChange } from "@/lib/lab-variation"

describe("referenceChangeValue", () => {
  it("demands far more of a swingy marker than a tightly held one", () => {
    const sodium = referenceChangeValue("Sodium")!
    const crp = referenceChangeValue("CRP")!
    expect(sodium).toBeLessThan(6)     // sodium barely moves
    expect(crp).toBeGreaterThan(100)   // CRP routinely doubles on its own
    expect(crp).toBeGreaterThan(sodium * 10)
  })

  it("lands where the biological-variation literature puts these", () => {
    // RCV = 2.77 x sqrt(CVa^2 + CVi^2), rounded
    expect(referenceChangeValue("Creatinine")).toBe(19)
    expect(referenceChangeValue("Cholesterol")).toBe(18)
    expect(referenceChangeValue("Vitamin D")).toBe(36)
    expect(referenceChangeValue("Ferritin")).toBe(42)
    expect(referenceChangeValue("TSH")).toBe(55)
  })

  it("says nothing about a marker it holds no data for", () => {
    expect(referenceChangeValue("NT-proBNP")).toBeNull()
    expect(isSignificantChange("NT-proBNP", 400)).toBeNull()
  })
})

describe("isSignificantChange", () => {
  it("would have called both of the old flat threshold's answers wrong", () => {
    // The old rule: anything over 5% is a change, anything under is noise.
    // Sodium moving 5% is a genuine event the old rule sat right on the edge of
    expect(isSignificantChange("Sodium", 6)).toBe(true)
    // ...and CRP moving 60% is completely unremarkable, which the old rule
    // would have shouted about
    expect(isSignificantChange("CRP", 60)).toBe(false)
  })

  it("is blind to direction", () => {
    expect(isSignificantChange("Vitamin D", 50)).toBe(true)
    expect(isSignificantChange("Vitamin D", -50)).toBe(true)
    expect(isSignificantChange("Vitamin D", 10)).toBe(false)
  })
})
