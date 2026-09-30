import { describe, it, expect } from "vitest"
import { convertLabValue, normalizeUnit, sameQuantity, unitDimension } from "@/lib/lab-units"

/** Within a tenth of a percent of the published conversion factor. */
const close = (a: number, b: number) => expect(Math.abs(a - b) / b).toBeLessThan(0.001)

describe("normalizeUnit", () => {
  it("folds the many ways a lab prints one unit", () => {
    for (const raw of ["mmol/L", "mmol/l", " MMOL / L ", "mmol per litre"]) {
      expect(normalizeUnit(raw)).toBe("mmol/l")
    }
    expect(normalizeUnit("µmol/L")).toBe("umol/l")
    expect(normalizeUnit("μmol/L")).toBe("umol/l") // the other micro sign
    expect(normalizeUnit("mcg/L")).toBe("ug/l")
    expect(normalizeUnit("x10^9/L")).toBe("10^9/l")
    expect(normalizeUnit("10*9/L")).toBe("10^9/l")
  })

  it("keeps the European cell-count shorthand apart from grams per litre", () => {
    expect(normalizeUnit("G/L")).toBe("10^9/l")   // giga-cells
    expect(normalizeUnit("g/L")).toBe("g/l")      // grams
    expect(unitDimension("G/L")).toBe("count")
    expect(unitDimension("g/L")).toBe("mass")
  })
})

describe("convertLabValue — reproduces the published factors", () => {
  it("cholesterol mg/dL → mmol/L (×0.02586)", () => {
    close(convertLabValue(200, "mg/dL", "mmol/L", "Cholesterol")!, 5.172)
  })

  it("glucose mg/dL → mmol/L (×0.05551)", () => {
    close(convertLabValue(100, "mg/dL", "mmol/L", "Glucose")!, 5.551)
  })

  it("creatinine mg/dL → µmol/L (×88.4)", () => {
    close(convertLabValue(1.0, "mg/dL", "µmol/L", "Creatinine")!, 88.4)
  })

  it("vitamin D ng/mL → nmol/L (×2.496)", () => {
    close(convertLabValue(40, "ng/mL", "nmol/L", "Vitamin D")!, 99.84)
  })

  it("B12 pg/mL → pmol/L (×0.7378)", () => {
    close(convertLabValue(500, "pg/mL", "pmol/L", "Vitamin B12")!, 368.9)
  })

  it("bilirubin mg/dL → µmol/L (×17.1)", () => {
    close(convertLabValue(1.0, "mg/dL", "µmol/L", "Bilirubin")!, 17.1)
  })

  it("urea mg/dL → mmol/L (×0.1665, urea 60.06 g/mol)", () => {
    close(convertLabValue(30, "mg/dL", "mmol/L", "Urea")!, 4.995)
  })

  it("BUN mg/dL → mmol/L urea (×0.357, the two nitrogens of one urea: 28.014 g/mol)", () => {
    // 14 mg/dL BUN is 5.0 mmol/L of urea. Read with urea's own molar mass it
    // came out as 2.3 — a 2.14x error that turned "unchanged" into "+114%".
    close(convertLabValue(14, "mg/dL", "mmol/L", "BUN")!, 4.998)
  })

  it("round-trips back to where it started", () => {
    const there = convertLabValue(200, "mg/dL", "mmol/L", "Cholesterol")!
    close(convertLabValue(there, "mmol/L", "mg/dL", "Cholesterol")!, 200)
  })
})

describe("convertLabValue — scale-only conversions need no molar mass", () => {
  it("converts within a dimension for any marker at all", () => {
    expect(convertLabValue(1, "g/dL", "g/L", "Anything")).toBeCloseTo(10)
    expect(convertLabValue(5, "mg/dL", "mg/L", "Whatever")).toBeCloseTo(50)
    expect(convertLabValue(1, "ng/mL", "µg/L", "Ferritin")).toBeCloseTo(1)
    expect(convertLabValue(1, "pg/mL", "ng/L", "Some assay")).toBeCloseTo(1)
    expect(convertLabValue(7, "10^9/L", "10^3/µL", "White blood cells")).toBeCloseTo(7)
    expect(convertLabValue(2, "µIU/mL", "mIU/L", "TSH")).toBeCloseTo(2)
  })
})

describe("convertLabValue — refuses what it should", () => {
  it("won't cross mass and molar without a molar mass on file", () => {
    expect(convertLabValue(10, "mg/dL", "mmol/L", "NT-proBNP")).toBeNull()
  })

  it("won't cross incompatible dimensions at all", () => {
    expect(convertLabValue(10, "U/L", "mmol/L", "ALT")).toBeNull()
    expect(convertLabValue(10, "%", "g/L", "HbA1c")).toBeNull()
    expect(convertLabValue(10, "mIU/L", "ng/mL", "TSH")).toBeNull()
  })

  it("won't guess at a unit it doesn't recognise", () => {
    expect(convertLabValue(10, "widgets", "mmol/L", "Cholesterol")).toBeNull()
  })
})

// Each of these came back null, and the trend said the two units "can't be
// reconciled" when they were the same unit written another way.
describe("convertLabValue — the same unit, printed another way", () => {
  it("mU/l and µU/ml are mIU/L", () => {
    expect(convertLabValue(2.1, "mIU/L", "mU/l", "TSH")).toBeCloseTo(2.1)
    expect(convertLabValue(2.1, "µU/ml", "mIU/L", "TSH")).toBeCloseTo(2.1)
  })

  it("a hormone's IU/L or U/L is mIU/mL", () => {
    expect(convertLabValue(6, "IU/L", "mIU/mL", "FSH")).toBeCloseTo(6)
    expect(convertLabValue(6, "U/l", "mIU/mL", "LH")).toBeCloseTo(6)
    // the enzyme scale stays out of it
    expect(convertLabValue(0.5, "µkat/l", "mIU/mL", "ALT")).toBeNull()
  })

  it("×10^9/l and superscript exponents are 10^9/l", () => {
    expect(normalizeUnit("×10^9/l")).toBe("10^9/l")
    expect(normalizeUnit("10⁹/l")).toBe("10^9/l")
    expect(normalizeUnit("×10¹²/l")).toBe("10^12/l")
    expect(normalizeUnit("x 10^9 / L")).toBe("10^9/l")
    expect(convertLabValue(6.1, "10^9/l", "×10⁹/l", "White blood cells")).toBeCloseTo(6.1)
  })

  it("mEq/L is mmol/L for a monovalent ion, and half of it for a divalent one", () => {
    expect(convertLabValue(140, "mEq/L", "mmol/l", "Sodium")).toBeCloseTo(140)
    expect(convertLabValue(4.2, "mEq/L", "mmol/l", "Potassium")).toBeCloseTo(4.2)
    expect(convertLabValue(5, "mEq/L", "mmol/l", "Calcium")).toBeCloseTo(2.5)
    expect(convertLabValue(5, "mEq/L", "mg/dL", "Calcium")).toBeCloseTo(10.02, 1)
    // no valence on file, no conversion
    expect(convertLabValue(1, "mEq/L", "mmol/l", "Cholesterol")).toBeNull()
  })

  it("HbA1c % (NGSP) and mmol/mol (IFCC) through the master equation", () => {
    // NGSP % = 0.09148 × IFCC + 2.152
    expect(convertLabValue(48, "mmol/mol", "%", "HbA1c")).toBeCloseTo(6.54, 2)
    expect(convertLabValue(6.5, "%", "mmol/mol", "HbA1c")).toBeCloseTo(47.5, 1)
    expect(convertLabValue(48, "mmol/mol", "%", "Glucose")).toBeNull()
  })
})

describe("sameQuantity", () => {
  it("knows when two printed units describe the same measurement", () => {
    expect(sameQuantity("mg/dL", "mmol/l", "Cholesterol")).toBe(true)
    expect(sameQuantity("ng/mL", "µg/L", "Ferritin")).toBe(true)
    expect(sameQuantity("mg/dL", "mmol/l", "NT-proBNP")).toBe(false)
  })
})
