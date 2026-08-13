import { describe, it, expect } from "vitest"
import { canonicalMarker } from "@/lib/lab-markers"

describe("canonicalMarker", () => {
  it("folds the same marker across languages and spellings onto one series", () => {
    for (const raw of ["Cholesterol celkový", "Total cholesterol", "CHOLESTEROL", "chol"]) {
      expect(canonicalMarker(raw)).toBe("Cholesterol")
    }
    expect(canonicalMarker("Vitamín D")).toBe("Vitamin D")
    expect(canonicalMarker("25(OH)D")).toBe("Vitamin D")
    expect(canonicalMarker("Kreatinín")).toBe("Creatinine")
    expect(canonicalMarker("Glykovaný hemoglobín")).toBe("HbA1c")
  })

  it("strips the decoration labs print around a name", () => {
    expect(canonicalMarker("S-Kreatinín (sérum)")).toBe("Creatinine")
    expect(canonicalMarker("LDL cholesterol - vypočítaný")).toBe("LDL")
  })

  it("keeps LDL and HDL apart from plain cholesterol", () => {
    expect(canonicalMarker("HDL cholesterol")).toBe("HDL")
    expect(canonicalMarker("LDL-C")).toBe("LDL")
    expect(canonicalMarker("Cholesterol")).toBe("Cholesterol")
  })

  it("records an unknown marker as printed rather than inventing a mapping", () => {
    expect(canonicalMarker("NT-proBNP")).toBe("NT-proBNP")
    expect(canonicalMarker("SOME OBSCURE ASSAY")).toBe("Some obscure assay")
    expect(canonicalMarker("   ")).toBe("")
  })
})
