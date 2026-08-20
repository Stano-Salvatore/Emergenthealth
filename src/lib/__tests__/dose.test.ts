import { describe, it, expect } from "vitest"
import { parseDose, formatDose, sumDoses } from "@/lib/dose"

describe("parseDose", () => {
  it("reads absolute amounts, normalising to mg", () => {
    expect(parseDose("Atarax 25 mg")).toEqual({ amount: 25, unit: "mg" })
    expect(parseDose("Elicea 12,5mg")).toEqual({ amount: 12.5, unit: "mg" })
    expect(parseDose("Vitamin D 50 mcg")).toEqual({ amount: 0.05, unit: "mg" })
    expect(parseDose("Magnesium 1 g")).toEqual({ amount: 1000, unit: "mg" })
  })

  it("reads tablet fractions written as words, symbols or slashes", () => {
    expect(parseDose("Atarax - half")).toEqual({ amount: 0.5, unit: "tablet" })
    expect(parseDose("Atarax ½")).toEqual({ amount: 0.5, unit: "tablet" })
    expect(parseDose("Atarax 1/2")).toEqual({ amount: 0.5, unit: "tablet" })
    expect(parseDose("Frontin pol")).toEqual({ amount: 0.5, unit: "tablet" })
    expect(parseDose("Atarax štvrtina")).toEqual({ amount: 0.25, unit: "tablet" })
    expect(parseDose("Atarax 2 tablets")).toEqual({ amount: 2, unit: "tablet" })
  })

  it("prefers an absolute amount when the label has both", () => {
    // "12.5mg" says everything "half" does and more.
    expect(parseDose("Atarax 12.5 mg (half)")).toEqual({ amount: 12.5, unit: "mg" })
  })

  it("says nothing rather than guessing when the label has no dose", () => {
    expect(parseDose("Atarax")).toBeNull()
    expect(parseDose("Vitamin D")).toBeNull()
    expect(parseDose("")).toBeNull()
  })

  it("is not fooled by a date", () => {
    expect(parseDose("Atarax 3/4/2026")).toBeNull()
  })
})

describe("formatDose", () => {
  it("renders both units readably", () => {
    expect(formatDose(12.5, "mg")).toBe("12.5mg")
    expect(formatDose(0.5, "tablet")).toBe("½ tablet")
    expect(formatDose(2, "tablet")).toBe("2 tablets")
  })

  it("shows nothing for an absent or nonsense dose", () => {
    expect(formatDose(null, "mg")).toBeNull()
    expect(formatDose(0, "mg")).toBeNull()
    expect(formatDose(5, null)).toBeNull()
  })
})

describe("sumDoses", () => {
  it("keeps milligrams and tablet fractions apart", () => {
    const out = sumDoses([
      { amount: 12.5, unit: "mg" },
      { amount: 0.5, unit: "tablet" },
      { amount: 12.5, unit: "mg" },
    ])
    // Adding half a tablet of unknown strength to 25mg would be an invention.
    expect(out).toEqual({ mg: 25, tablets: 0.5 })
  })
})
