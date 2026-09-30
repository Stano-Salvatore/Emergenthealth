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

// A different test that happens to start with a known marker's name must not
// join that marker's series: "Cholesterol HDL" filed as Cholesterol made a
// same-day 5.2 → 1.4 read as a 73% fall in the morning brief.
describe("canonicalMarker — a longer name is a different test unless the extra words are neutral", () => {
  it("keeps HDL and LDL out of total cholesterol however the lab orders the words", () => {
    expect(canonicalMarker("Cholesterol HDL")).toBe("HDL")
    expect(canonicalMarker("S-Cholesterol HDL")).toBe("HDL")
    expect(canonicalMarker("Cholesterol LDL")).toBe("LDL")
    expect(canonicalMarker("Cholesterol - HDL")).toBe("HDL")
    expect(canonicalMarker("Cholesterol v LDL")).toBe("LDL")
    expect(canonicalMarker("Non-HDL cholesterol")).not.toBe("HDL")
  })

  it("does not fold a fraction or a related assay into the parent marker", () => {
    expect(canonicalMarker("Bilirubín konjugovaný")).not.toBe("Bilirubin")
    expect(canonicalMarker("Bilirubin přímý")).not.toBe("Bilirubin")
    expect(canonicalMarker("Direct bilirubin")).not.toBe("Bilirubin")
    expect(canonicalMarker("Testosteron volný")).not.toBe("Testosterone")
    expect(canonicalMarker("Vápník ionizovaný")).not.toBe("Calcium")
    expect(canonicalMarker("CA 19-9")).not.toBe("Calcium")
    expect(canonicalMarker("PSA volný")).not.toBe("PSA")
    expect(canonicalMarker("Transferrin saturation")).not.toBe("Transferrin")
  })

  it("files HbA1c as HbA1c, not as haemoglobin", () => {
    expect(canonicalMarker("Hb A1c")).toBe("HbA1c")
    expect(canonicalMarker("Hemoglobin A1c")).toBe("HbA1c")
    expect(canonicalMarker("HbA1c IFCC")).toBe("HbA1c")
  })

  it("still accepts the qualifiers that don't change what was measured", () => {
    expect(canonicalMarker("Bilirubin celkový")).toBe("Bilirubin")
    expect(canonicalMarker("Vápník celkový")).toBe("Calcium")
    expect(canonicalMarker("Glukóza v plazme")).toBe("Glucose")
    expect(canonicalMarker("Železo sérum")).toBe("Iron")
    expect(canonicalMarker("HDL cholesterol - vypočítaný")).toBe("HDL")
  })

  it("keeps a urine measurement apart from the blood one", () => {
    expect(canonicalMarker("U-Kreatinin")).toBe("Creatinine (urine)")
    expect(canonicalMarker("Kreatinín v moči")).toBe("Creatinine (urine)")
    expect(canonicalMarker("Urine creatinine")).toBe("Creatinine (urine)")
    expect(canonicalMarker("S-Kreatinín")).toBe("Creatinine")
    // "moč" inside a word is not urine
    expect(canonicalMarker("Kyselina močová")).toBe("Uric acid")
    expect(canonicalMarker("Močovina")).toBe("Urea")
  })

  it("gives the same answer when handed its own answer", () => {
    // Every write path canonicalises on the server, so a name the importer
    // already canonicalised passes through a second time.
    for (const raw of ["U-Kreatinin", "Cholesterol HDL", "PSA volný", "Vitamín B12", "LDL-cholesterol", "NT-proBNP", "25(OH)D", "Bilirubín konjugovaný"]) {
      const once = canonicalMarker(raw)
      expect(canonicalMarker(once)).toBe(once)
    }
  })

  it("leaves a vitamin's number attached to the vitamin", () => {
    expect(canonicalMarker("Vitamin B-12")).toBe("Vitamin B12")
    expect(canonicalMarker("B-12")).toBe("Vitamin B12")
  })
})

// "LDL-cholesterol" from a Czech lab next to "LDL cholesterol" from a Slovak
// one was two cards with one reading each, and no trend at all.
describe("canonicalMarker — hyphens, underscores and slashes separate words", () => {
  it("collapses the hyphenated CZ/SK spellings onto the same series", () => {
    expect(canonicalMarker("LDL-cholesterol")).toBe("LDL")
    expect(canonicalMarker("HDL-cholesterol")).toBe("HDL")
    expect(canonicalMarker("Gama-GT")).toBe("GGT")
    expect(canonicalMarker("S_LDL-cholesterol")).toBe("LDL")
    expect(canonicalMarker("LDL-C")).toBe("LDL")
  })
})

// BUN reports the nitrogen in urea, not urea itself: 14 mg/dL BUN is 5.0
// mmol/L urea, where the same number read as urea would be 2.3.
describe("canonicalMarker — BUN is not urea", () => {
  it("files blood urea nitrogen under its own name", () => {
    expect(canonicalMarker("BUN")).toBe("BUN")
    expect(canonicalMarker("Blood urea nitrogen")).toBe("BUN")
    expect(canonicalMarker("Močovina")).toBe("Urea")
    expect(canonicalMarker("Urea")).toBe("Urea")
  })
})

describe("a B- that is part of the name is not a sample prefix", () => {
  it("keeps B-12 as vitamin B12 whatever follows it", async () => {
    const { canonicalMarker } = await import("@/lib/lab-markers")
    expect(canonicalMarker("B-12 v sére")).toBe("Vitamin B12")
    expect(canonicalMarker("B-12 (serum)")).toBe("Vitamin B12")
    expect(canonicalMarker("B-Glukóza")).toBe(canonicalMarker("Glukóza"))
  })

  it("still strips a serum prefix before a name that starts with a digit", async () => {
    const { canonicalMarker } = await import("@/lib/lab-markers")
    expect(canonicalMarker("S-25-OH vitamín D")).toBe(canonicalMarker("25-OH vitamín D"))
  })
})
