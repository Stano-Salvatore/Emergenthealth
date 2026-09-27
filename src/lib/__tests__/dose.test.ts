import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { parseDose, parseDoseEdit, formatDose, sumDoses } from "@/lib/dose"

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

  it("will not pick between a tablet's strength and a share of it", () => {
    // "Atarax 25mg half" is 12.5 mg taken from a 25 mg tablet, and was
    // recorded as 25 mg — a doubled dose plausible enough that nobody would
    // catch it. The label alone cannot say which number is the strength, so
    // the dose stays unknown and the label keeps the words.
    expect(parseDose("Atarax 25mg half")).toBeNull()
    expect(parseDose("Atarax 12.5 mg (half)")).toBeNull()
    expect(parseDose("Elicea 10mg 1/2")).toBeNull()
    expect(parseDose("Atarax 25mg ½")).toBeNull()
    expect(parseDose("Mirzaten 15mg 2 tbl")).toBeNull()
    expect(parseDose("Atarax 25mg x2")).toBeNull()
    // One tablet of a stated strength is that strength.
    expect(parseDose("Atarax 25mg 1 tablet")).toEqual({ amount: 25, unit: "mg" })
  })

  it("does not read a frequency or a length of time as a share of a tablet", () => {
    // "2x daily" is how often, not how many; "½ hour before bed" is when.
    expect(parseDose("Magnesium 2x daily")).toBeNull()
    expect(parseDose("Magnesium 2x a day")).toBeNull()
    expect(parseDose("Melatonin 1/2 hour before bed")).toBeNull()
    expect(parseDose("Melatonin ½h before bed")).toBeNull()
    expect(parseDose("Melatonin half an hour before bed")).toBeNull()
    expect(parseDose("Magnesium 400mg 2x daily")).toEqual({ amount: 400, unit: "mg" })
    // The counts these share their shape with still read.
    expect(parseDose("Atarax x2")).toEqual({ amount: 2, unit: "tablet" })
    expect(parseDose("Atarax 2x")).toEqual({ amount: 2, unit: "tablet" })
    expect(parseDose("Atarax ½")).toEqual({ amount: 0.5, unit: "tablet" })
    // A drug whose name begins like a time unit is not a length of time.
    expect(parseDose("½ Minirin")).toEqual({ amount: 0.5, unit: "tablet" })
    expect(parseDose("Atarax ½ hodiny pred spaním")).toBeNull()
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

describe("parseDoseEdit", () => {
  // The "+ dose" box on an entry saved without an amount stored every number
  // as tablets: 400 typed for magnesium became "400 tablets".
  it("will not guess the unit of a bare number on a dose that has none", () => {
    expect(parseDoseEdit("400", null)).toHaveProperty("error")
    expect(parseDoseEdit("1", undefined)).toHaveProperty("error")
  })

  it("reads a unit typed with the number", () => {
    expect(parseDoseEdit("400mg", null)).toEqual({ dose: { amount: 400, unit: "mg" } })
    expect(parseDoseEdit("½", null)).toEqual({ dose: { amount: 0.5, unit: "tablet" } })
    expect(parseDoseEdit("2 tablets", "mg")).toEqual({ dose: { amount: 2, unit: "tablet" } })
  })

  it("keeps the unit the entry already has for a bare number", () => {
    expect(parseDoseEdit("12,5", "mg")).toEqual({ dose: { amount: 12.5, unit: "mg" } })
    expect(parseDoseEdit("1", "tablet")).toEqual({ dose: { amount: 1, unit: "tablet" } })
  })

  it("clears to unknown on an empty box, and refuses zero", () => {
    expect(parseDoseEdit("  ", "mg")).toEqual({ dose: null })
    expect(parseDoseEdit("0", "mg")).toHaveProperty("error")
    expect(parseDoseEdit("lots", "mg")).toHaveProperty("error")
  })
})

describe("no dose surface defaults an amount to tablets", () => {
  const code = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

  it("the entry's dose box goes through parseDoseEdit", () => {
    const page = code("src/app/dashboard/medications/page.tsx")
    expect(page).toMatch(/parseDoseEdit\(/)
    expect(page).not.toMatch(/doseUnit \?\? "tablet"/)
    // parseDoseEdit asks for "400mg" or "½" on a dose with no unit; a number
    // pad cannot type either, so that box must open a text keyboard.
    expect(page).toMatch(/inputMode=\{entry\.doseUnit[^}]*"text"\}/)
  })

  it("Emergy's correct_log takes a unit instead of assuming one", () => {
    const claude = code("src/lib/claude.ts")
    expect(claude).not.toMatch(/COALESCE\("doseUnit", 'tablet'\)/)
    const at = claude.indexOf('name: "correct_log"')
    expect(claude.slice(at, at + 1200)).toMatch(/doseUnit:/)
  })

  it("ticking a scheduled dose records the schedule's amount", () => {
    const card = code("src/components/medications/MedScheduleCard.tsx")
    const at = card.indexOf("async function takeNow")
    expect(card.slice(at, at + 600)).toMatch(/scheduledDose\(s\.dose\)/)
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
