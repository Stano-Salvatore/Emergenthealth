import { describe, it, expect } from "vitest"
import { computeLabTrends, notableTrends, rangeStatus, type DayTags, type LabReading } from "@/lib/lab-trends"

const reading = (over: Partial<LabReading> = {}): LabReading => ({
  marker: "Vitamin D", value: 42, unit: "ng/mL", date: "2026-03-01",
  referenceMin: 30, referenceMax: 100, ...over,
})

/** A dose logged on every day in [from, to). */
function daily(name: string, from: string, days: number): DayTags[] {
  const out: DayTags[] = []
  const d = new Date(from + "T00:00:00Z")
  for (let i = 0; i < days; i++) {
    out.push({ day: d.toISOString().slice(0, 10), name })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

describe("rangeStatus", () => {
  it("reads against the range the report printed", () => {
    expect(rangeStatus(reading({ value: 42 }))).toBe("in-range")
    expect(rangeStatus(reading({ value: 12 }))).toBe("below")
    expect(rangeStatus(reading({ value: 140 }))).toBe("above")
    expect(rangeStatus(reading({ referenceMin: null, referenceMax: null }))).toBe("unknown")
  })
})

describe("computeLabTrends", () => {
  it("reports the change between the two most recent draws", () => {
    const [t] = computeLabTrends([
      reading({ value: 42, date: "2026-03-01" }),
      reading({ value: 68, date: "2026-08-01" }),
    ])
    expect(t.latest.value).toBe(68)
    expect(t.previous!.value).toBe(42)
    expect(Math.round(t.changePct!)).toBe(62)
    expect(t.direction).toBe("up")
    expect(t.summary).toContain("up from 42 ng/mL to 68 ng/mL")
    expect(t.summary).toContain("5 months")
  })

  it("calls assay-level wobble steady rather than a change", () => {
    const [t] = computeLabTrends([
      reading({ value: 42, date: "2026-03-01" }),
      reading({ value: 43, date: "2026-08-01" }),
    ])
    expect(t.direction).toBe("flat")
    expect(t.summary).toContain("steady")
  })

  it("refuses to compare readings printed in different units", () => {
    const [t] = computeLabTrends([
      reading({ marker: "Cholesterol", value: 200, unit: "mg/dL", date: "2026-03-01" }),
      reading({ marker: "Cholesterol", value: 5.2, unit: "mmol/l", date: "2026-08-01" }),
    ])
    expect(t.unitMismatch).toBe(true)
    expect(t.changePct).toBeNull()
    expect(t.summary).toContain("different units")
  })

  it("says when a marker crossed into the printed range", () => {
    const [t] = computeLabTrends([
      reading({ value: 18, date: "2026-03-01" }),
      reading({ value: 55, date: "2026-08-01" }),
    ])
    expect(t.previousStatus).toBe("below")
    expect(t.status).toBe("in-range")
    expect(t.crossed).toBe("into range")
    expect(t.summary).toContain("inside the report's reference range")
  })

  it("handles a single reading without inventing a comparison", () => {
    const [t] = computeLabTrends([reading({ value: 12 })])
    expect(t.previous).toBeNull()
    expect(t.changePct).toBeNull()
    expect(t.summary).toContain("First reading")
    expect(t.summary).toContain("below the range")
  })

  it("names what was newly started in the window, without claiming it caused anything", () => {
    const [t] = computeLabTrends(
      [reading({ value: 42, date: "2026-03-01" }), reading({ value: 68, date: "2026-08-01" })],
      daily("Vitamin D3 2000 IU", "2026-03-02", 150),
    )
    const d3 = t.taken.find(h => h.name.toLowerCase().includes("vitamin d"))
    expect(d3).toBeDefined()
    expect(d3!.newSince).toBe(true)
    expect(d3!.coverage).toBeGreaterThan(0.9)
    expect(t.summary).toContain("You started logging")
    // The line reports co-occurrence and stops there
    expect(t.summary.toLowerCase()).not.toContain("because")
    expect(t.summary.toLowerCase()).not.toContain("caused")
  })

  it("distinguishes something long-standing from something newly started", () => {
    // Taken solidly through the previous window too — not new
    const [t] = computeLabTrends(
      [reading({ value: 42, date: "2026-03-01" }), reading({ value: 68, date: "2026-08-01" })],
      daily("Magnesium", "2025-09-01", 400),
    )
    expect(t.taken[0].newSince).toBe(false)
    expect(t.summary).toContain("Through that window you logged")
  })

  it("ignores something taken only occasionally", () => {
    const sparse: DayTags[] = [
      { day: "2026-04-01", name: "Ibalgin" },
      { day: "2026-05-14", name: "Ibalgin" },
    ]
    const [t] = computeLabTrends(
      [reading({ value: 42, date: "2026-03-01" }), reading({ value: 68, date: "2026-08-01" })],
      sparse,
    )
    expect(t.taken).toHaveLength(0)
  })

  it("groups a substance logged under different dosage text as one thing", () => {
    const tags = [
      ...daily("Vitamin D3 2000 IU", "2026-03-02", 75),
      ...daily("vitamin d3", "2026-05-16", 75),
    ]
    const [t] = computeLabTrends(
      [reading({ value: 42, date: "2026-03-01" }), reading({ value: 68, date: "2026-08-01" })],
      tags,
    )
    expect(t.taken).toHaveLength(1)
    expect(t.taken[0].coverage).toBeGreaterThan(0.9)
  })

  it("keeps markers apart and puts the most recent draw first", () => {
    const trends = computeLabTrends([
      reading({ marker: "Ferritin", value: 30, unit: "ng/mL", date: "2026-01-01" }),
      reading({ marker: "Vitamin D", value: 68, date: "2026-08-01" }),
    ])
    expect(trends.map(t => t.marker)).toEqual(["Vitamin D", "Ferritin"])
  })
})

describe("notableTrends", () => {
  it("surfaces out-of-range and boundary-crossing markers, and nothing else", () => {
    const trends = computeLabTrends([
      reading({ marker: "Vitamin D", value: 55, date: "2026-08-01" }),                        // fine
      reading({ marker: "Ferritin", value: 8, unit: "ng/mL", referenceMin: 30, referenceMax: 400, date: "2026-08-01" }), // low
      reading({ marker: "CRP", value: 2, unit: "mg/L", referenceMin: 0, referenceMax: 5, date: "2026-03-01" }),
      reading({ marker: "CRP", value: 9, unit: "mg/L", referenceMin: 0, referenceMax: 5, date: "2026-08-01" }),          // just went high
    ])
    const notable = notableTrends(trends)
    expect(notable.map(t => t.marker)).toEqual(["CRP", "Ferritin"])
    expect(notable[0].crossed).toBe("out of range")
  })
})
