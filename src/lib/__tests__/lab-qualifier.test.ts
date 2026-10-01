import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { labValueText, parseLabFlag, parseLabQualifier } from "@/lib/lab-flags"
import { computeLabTrends, previousReading, rangeStatus, type LabReading } from "@/lib/lab-trends"
import { normalizeReport, type ParsedLabReport } from "@/lib/lab-analyze"

// "CRP < 5" is a limit, not a 5. Stored as a bare number it read as an exact
// 5 everywhere downstream: two draws under the detection limit became "CRP
// holding steady at 5", and a drop from 12 to "< 5" became a precise -58%.
// The lab's own H/L is the other thing the report prints that the range alone
// can't give back — a row with no printed range was "unknown" even when the
// lab had marked it high.

const crp = (over: Partial<LabReading> = {}): LabReading => ({
  marker: "CRP", value: 5, unit: "mg/l", date: "2026-03-01",
  referenceMin: null, referenceMax: null, ...over,
})

describe("parsing the stored mark and sign", () => {
  it("accepts only the values the column is defined for", () => {
    expect(parseLabFlag("high")).toBe("high")
    expect(parseLabFlag("low")).toBe("low")
    expect(parseLabFlag("normal")).toBe("normal")
    expect(parseLabFlag("H")).toBeNull()
    expect(parseLabFlag("none")).toBeNull()
    expect(parseLabFlag(undefined)).toBeNull()
    expect(parseLabQualifier("<")).toBe("<")
    expect(parseLabQualifier(">")).toBe(">")
    expect(parseLabQualifier("<=")).toBeNull()
    expect(parseLabQualifier("none")).toBeNull()
    expect(parseLabQualifier(5)).toBeNull()
  })

  it("prints the sign with the number", () => {
    expect(labValueText(5, "<")).toBe("<5")
    expect(labValueText(90, ">")).toBe(">90")
    expect(labValueText(4.2, null)).toBe("4.2")
    expect(labValueText(4.2)).toBe("4.2")
  })
})

describe("trends across a printed limit", () => {
  it("claims no change when both draws were under the detection limit", () => {
    const [t] = computeLabTrends([
      crp({ date: "2026-03-01", qualifier: "<" }),
      crp({ date: "2026-09-01", qualifier: "<" }),
    ])
    expect(t.changePct).toBeNull()
    expect(t.significant).toBeNull()
    expect(t.direction).toBeNull()
    expect(t.limit).toBe("below the detection limit both times")
    expect(t.summary).toContain("<5 mg/l")
    expect(t.summary).not.toMatch(/steady|%/)
  })

  it("says a value is now measurable rather than computing a rise from a limit", () => {
    const [t] = computeLabTrends([
      crp({ date: "2026-03-01", qualifier: "<" }),
      crp({ value: 12, date: "2026-09-01" }),
    ])
    expect(t.changePct).toBeNull()
    expect(t.significant).toBeNull()
    expect(t.limit).toBe("now measurable")
    // Under 5 then 12 is certainly up, even though by how much isn't known.
    expect(t.direction).toBe("up")
    expect(t.summary).toContain("was <5 mg/l")
  })

  it("says a value is now under the limit rather than computing a fall to it", () => {
    const [t] = computeLabTrends([
      crp({ value: 12, date: "2026-03-01" }),
      crp({ date: "2026-09-01", qualifier: "<" }),
    ])
    expect(t.changePct).toBeNull()
    expect(t.limit).toBe("now below the detection limit")
    expect(t.direction).toBe("down")
    expect(t.summary).not.toMatch(/-\d+%/)
  })

  it("gives no direction when the limit doesn't settle one", () => {
    // Under 5 before, 3 now: the earlier value could have been 1 or 4.9.
    const [t] = computeLabTrends([
      crp({ date: "2026-03-01", qualifier: "<" }),
      crp({ value: 3, date: "2026-09-01" }),
    ])
    expect(t.direction).toBeNull()
    expect(t.changePct).toBeNull()
  })

  it("is never notable for a size of change it doesn't know", () => {
    const [t] = computeLabTrends([
      crp({ value: 40, date: "2026-03-01" }),
      crp({ date: "2026-09-01", qualifier: "<" }),
    ])
    expect(t.significant).not.toBe(true)
  })

  it("prints the sign on the earlier reading too", () => {
    const [t] = computeLabTrends([
      crp({ date: "2026-03-01", qualifier: "<" }),
      crp({ value: 12, date: "2026-09-01" }),
    ])
    expect(previousReading(t)).toBe("<5 mg/l")
  })
})

describe("rangeStatus with the lab's own mark", () => {
  it("uses the stored flag when the report printed no range", () => {
    expect(rangeStatus(crp({ flag: "high" }))).toBe("above")
    expect(rangeStatus(crp({ flag: "low" }))).toBe("below")
    expect(rangeStatus(crp({ flag: "normal" }))).toBe("in-range")
    expect(rangeStatus(crp({ flag: null }))).toBe("unknown")
  })

  it("still reads a printed range first", () => {
    expect(rangeStatus(crp({ value: 3, referenceMax: 5, flag: "high" }))).toBe("in-range")
  })

  it("reads a limit against the range only where the limit settles it", () => {
    // <5 against a 0–10 range is in range; <5 against a 3–10 range could be
    // either side of 3.
    expect(rangeStatus(crp({ qualifier: "<", referenceMin: null, referenceMax: 10 }))).toBe("in-range")
    expect(rangeStatus(crp({ qualifier: "<", referenceMin: 6, referenceMax: 10 }))).toBe("below")
    expect(rangeStatus(crp({ qualifier: "<", referenceMin: 3, referenceMax: 10 }))).toBe("unknown")
    expect(rangeStatus(crp({ qualifier: "<", referenceMin: 3, referenceMax: 10, flag: "low" }))).toBe("below")
    // <5 with a top of 3 is not "above": the value may well be 1.
    expect(rangeStatus(crp({ qualifier: "<", referenceMax: 3 }))).toBe("unknown")
    expect(rangeStatus(crp({ value: 90, qualifier: ">", referenceMin: 60 }))).toBe("in-range")
    expect(rangeStatus(crp({ value: 90, qualifier: ">", referenceMax: 50 }))).toBe("above")
  })
})

describe("the import card's limit rows", () => {
  const report = (over: Partial<ParsedLabReport> = {}): ParsedLabReport => ({
    isLabReport: true, date: "2026-08-01", lab: "Unilabs", results: [], unreadable: [], note: null, ...over,
  })

  it("no longer warns that a limit will be saved as an exact number", () => {
    const r = normalizeReport(report({
      results: [{ marker: "CRP", value: 5, unit: "mg/l", referenceMin: null, referenceMax: 5, qualifier: "<", flag: "none" } as never],
    }))
    const text = r.results[0].checks.map(c => c.text).join(" ")
    expect(text).toMatch(/<5/)
    expect(text).not.toMatch(/exactly/)
  })
})

describe("every write path carries the mark and the sign", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("the schema adds them as nullable columns", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8")
    const model = schema.slice(schema.indexOf("model LabResult {"), schema.indexOf("}", schema.indexOf("model LabResult {")))
    expect(model).toMatch(/\n\s+flag\s+String\?/)
    expect(model).toMatch(/\n\s+qualifier\s+String\?/)
  })

  it("the chat tool offers both, as enums, and validates what comes back", () => {
    const chat = stripped("src/lib/claude.ts")
    const schema = chat.slice(chat.indexOf('name: "log_lab_results"'), chat.indexOf('name: "create_med_schedule"'))
    expect(schema).toMatch(/flag: \{ type: "string", enum: \["low", "high", "normal"\]/)
    expect(schema).toMatch(/qualifier: \{ type: "string", enum: \["<", ">"\]/)
    const tool = chat.slice(chat.indexOf('name === "log_lab_results"'), chat.indexOf('name === "create_med_schedule"'))
    expect(tool).toMatch(/flag: parseLabFlag\(/)
    expect(tool).toMatch(/qualifier: parseLabQualifier\(/)
  })

  it("the bulk and single POST validate and pass them on", () => {
    const route = stripped("src/app/api/labs/route.ts")
    expect(route.match(/parseLabFlag\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(route.match(/parseLabQualifier\(/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it("the import card sends both, ticks limit rows, and stops writing the limit into notes", () => {
    const card = stripped("src/components/labs/LabImportCard.tsx")
    const save = card.slice(card.indexOf("async function save"), card.indexOf("const chosenCount"))
    expect(save).toMatch(/flag: r\.flag/)
    expect(save).toMatch(/qualifier: r\.qualifier/)
    expect(save).not.toMatch(/Printed as/)
    expect(card).not.toMatch(/setKeep\([^)]*!r\.qualifier/)
  })
})

describe("every place a lab value is printed prints its sign", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it.each([
    "src/app/dashboard/labs/page.tsx",
    "src/app/dashboard/report/page.tsx",
    "src/lib/health-report.ts",
    "src/lib/health-report-email.ts",
    "src/components/stats/LongView.tsx",
    "src/components/intake/NutrientGapsCard.tsx",
  ])("%s", f => {
    const src = stripped(f)
    expect(src).toMatch(/labValueText\(/)
    // A bare `{x.value} {x.unit}` beside a lab is the pattern that dropped the sign.
    expect(src).not.toMatch(/\{(?:l|e|lab|latest|l\.latest)\.value\}\s*\{(?:l|e|lab|latest|l)\.unit\}/)
    expect(src).not.toMatch(/\$\{(?:l|e|lab|l\.latest|t\.latest)\.value\} \$\{/)
  })

  it("Emergy's lab lines and the tool's read-back", () => {
    const chat = stripped("src/lib/claude.ts")
    const labsKind = chat.slice(chat.indexOf('kind === "labs"'), chat.indexOf('kind === "nutrients"'))
    expect(labsKind).toMatch(/labValueText\(/)
    const context = chat.slice(chat.indexOf("const latestLabByMarker"), chat.indexOf("const latestLabByMarker") + 1500)
    expect(context).toMatch(/labValueText\(/)
    const tool = chat.slice(chat.indexOf('name === "log_lab_results"'), chat.indexOf('name === "create_med_schedule"'))
    expect(tool).toMatch(/labValueText\(/)
  })
})
