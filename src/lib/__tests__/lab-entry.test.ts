import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { implausibleJump, suggestedUnit } from "@/lib/lab-entry"

// The manual Add Result form pre-filled US units for a user whose reports are
// Slovak and Czech. An unnoticed "mg/dL" beside a typed 5.4 glucose became
// "Glucose down from 91.9 to 5.4 mg/dL (-94%). That's a real move."

const history = {
  Glucose: [
    { value: 5.0, unit: "mmol/l", date: "2026-02-01" },
    { value: 5.1, unit: "mmol/l", date: "2026-08-01" },
  ],
  "Vitamin D": [{ value: 30, unit: "ng/mL", date: "2026-05-01" }],
}

describe("suggestedUnit", () => {
  it("prefers the unit this marker was last recorded in", () => {
    expect(suggestedUnit("Vitamin D", history)).toBe("ng/mL")
    expect(suggestedUnit("Glukóza", history)).toBe("mmol/l")
  })

  it("falls back to the SI unit a Central-European lab prints", () => {
    expect(suggestedUnit("Cholesterol", {})).toBe("mmol/l")
    expect(suggestedUnit("Glucose", {})).toBe("mmol/l")
    expect(suggestedUnit("Creatinine", {})).toBe("µmol/l")
    expect(suggestedUnit("Vitamin D", {})).toBe("nmol/l")
    expect(suggestedUnit("HbA1c", {})).toBe("mmol/mol")
    expect(suggestedUnit("B12", {})).toBe("pmol/l")
  })

  it("suggests nothing for a marker it has no reason to guess at", () => {
    expect(suggestedUnit("NT-proBNP", {})).toBeNull()
  })
})

describe("implausibleJump", () => {
  it("catches a value in the wrong unit against the last reading", () => {
    const j = implausibleJump("Glucose", 5.4, "mg/dL", history)
    expect(j).not.toBeNull()
    expect(j!.factor).toBeGreaterThan(5)
    expect(j!.previous.value).toBe(5.1)
  })

  it("says nothing about an ordinary change in the same unit", () => {
    expect(implausibleJump("Glucose", 5.4, "mmol/l", history)).toBeNull()
    expect(implausibleJump("Glucose", 5.4, "mg/dL", {})).toBeNull()
  })

  it("compares across units where they convert", () => {
    // 30 ng/mL is 74.9 nmol/l; 60 nmol/l is a fall, not a 2x jump
    expect(implausibleJump("Vitamin D", 60, "nmol/l", history)).toBeNull()
  })
})

describe("the Add Result form", () => {
  const page = readFileSync("src/app/dashboard/labs/page.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("takes its unit and its warning from lab-entry, with no US defaults of its own", () => {
    expect(page).toMatch(/suggestedUnit\(/)
    expect(page).toMatch(/implausibleJump\(/)
    expect(page).not.toMatch(/UNIT_DEFAULTS/)
  })
})
