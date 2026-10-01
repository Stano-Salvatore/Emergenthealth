import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { normalizeReport, parseDocumentDataUrl, type ParsedLabReport, type ParsedLabRow } from "@/lib/lab-analyze"

const said = (r: ParsedLabRow) => r.checks.map(c => c.text).join(" ")

const report = (over: Partial<ParsedLabReport> = {}): ParsedLabReport => ({
  isLabReport: true, date: "2026-08-01", lab: "Unilabs", results: [], unreadable: [], note: null, ...over,
})

const row = (over: Record<string, unknown> = {}) => ({
  marker: "Cholesterol celkový", rawMarker: "", value: 5.2, unit: "mmol/l",
  referenceMin: 3.1, referenceMax: 5.2, flag: null, ...over,
} as never)

describe("normalizeReport", () => {
  it("canonicalises the marker but keeps what was printed", () => {
    const r = normalizeReport(report({ results: [row()] }))
    expect(r.results[0].marker).toBe("Cholesterol")
    expect(r.results[0].rawMarker).toBe("Cholesterol celkový")
  })

  it("leaves the unit exactly as printed rather than converting it", () => {
    const r = normalizeReport(report({ results: [row({ unit: "mmol/l" })] }))
    expect(r.results[0].unit).toBe("mmol/l")
  })

  it("rights a reference range that came back the wrong way round", () => {
    const r = normalizeReport(report({ results: [row({ referenceMin: 5.2, referenceMax: 3.1 })] }))
    expect(r.results[0].referenceMin).toBe(3.1)
    expect(r.results[0].referenceMax).toBe(5.2)
  })

  it("drops rows with no marker or no usable number", () => {
    const r = normalizeReport(report({
      results: [row(), row({ marker: "  " }), row({ value: "high" }), row({ value: NaN })],
    }))
    expect(r.results).toHaveLength(1)
  })

  it("keeps only a flag the report actually carried", () => {
    const ok = normalizeReport(report({ results: [row({ flag: "high" })] }))
    expect(ok.results[0].flag).toBe("high")
    const junk = normalizeReport(report({ results: [row({ flag: "elevated" })] }))
    expect(junk.results[0].flag).toBeNull()
  })

  it("says so when two differently printed rows land on the same marker", () => {
    const r = normalizeReport(report({
      results: [
        row({ marker: "Cholesterol celkový", value: 5.2 }),
        row({ marker: "Total cholesterol", value: 4.9 }),
        row({ marker: "HDL cholesterol", value: 1.4 }),
      ],
    }))
    expect(said(r.results[0])).toMatch(/also reads as Cholesterol/)
    expect(said(r.results[1])).toMatch(/also reads as Cholesterol/)
    expect(r.results[2].checks).toEqual([])
  })

  // The range is the one number rangeStatus trusts completely, and a range
  // copied from the report's other unit column made a normal glucose read as
  // "still below the reference range" in the brief.
  it("questions a range that is an order of magnitude away from its value", () => {
    const r = normalizeReport(report({
      results: [row({ marker: "Glukóza", value: 5.4, referenceMin: 70, referenceMax: 99, flag: "none" })],
    }))
    expect(r.results[0].checks.map(c => c.kind)).toContain("range")
    expect(said(r.results[0])).toMatch(/another unit/)
  })

  it("questions a row outside its range that the lab, flagging others, left unmarked", () => {
    const r = normalizeReport(report({
      results: [
        row({ marker: "Ferritin", value: 400, unit: "ug/l", referenceMin: 30, referenceMax: 300, flag: "high" }),
        row({ marker: "Glukóza", value: 5.4, unit: "mmol/l", referenceMin: 5.6, referenceMax: 6.1, flag: "none" }),
      ],
    }))
    expect(r.results[0].checks).toEqual([])
    expect(said(r.results[1])).toMatch(/didn't mark it/)
  })

  it("questions a row the lab called normal or high when the range read for it says otherwise", () => {
    const normal = normalizeReport(report({
      results: [row({ value: 6.1, referenceMin: 3.1, referenceMax: 5.2, flag: "normal" })],
    }))
    expect(said(normal.results[0])).toMatch(/didn't mark it/)
    const high = normalizeReport(report({
      results: [row({ value: 4.0, referenceMin: 3.1, referenceMax: 5.2, flag: "high" })],
    }))
    expect(said(high.results[0])).toMatch(/marks this high/)
  })

  it("stays quiet about an out-of-range row on a report that marks nothing", () => {
    // Plenty of reports carry no H/L column at all; every high value on them
    // would otherwise come with a warning.
    const r = normalizeReport(report({
      results: [row({ value: 6.1, referenceMin: 3.1, referenceMax: 5.2, flag: "none" })],
    }))
    expect(r.results[0].checks).toEqual([])
  })

  // "CRP < 5" stored as 5 reads as an exact 5 in every later trend.
  it("keeps a printed < or > and says the number is a limit", () => {
    const r = normalizeReport(report({
      results: [
        row({ marker: "CRP", value: 5, unit: "mg/l", referenceMin: null, referenceMax: 5, qualifier: "<" }),
        row({ marker: "eGFR", value: 1.5, unit: "ml/s", referenceMin: 1.5, referenceMax: null, qualifier: ">" }),
        row({ qualifier: "none" }),
        row({ marker: "ALT", qualifier: "about" }),
      ],
    }))
    expect(r.results.map(x => x.qualifier)).toEqual(["<", ">", null, null])
    expect(r.results[0].checks.map(c => c.kind)).toContain("limit")
    expect(said(r.results[0])).toMatch(/<5/)
    expect(r.results[2].checks).toEqual([])
  })

  it("asks the model for the sign, as a required field", () => {
    const src = readFileSync("src/lib/lab-analyze.ts", "utf8")
    expect(src).toMatch(/required: \["marker", "value", "qualifier"/)
    expect(src).toMatch(/qualifier: \{ type: "string", enum: \["<", ">", "none"\]/)
  })

  it("refuses a date that isn't a date", () => {
    expect(normalizeReport(report({ date: "August 2026" })).date).toBeNull()
    expect(normalizeReport(report({ date: "2026-08-01" })).date).toBe("2026-08-01")
  })
})

describe("parseDocumentDataUrl", () => {
  it("accepts the formats a lab report actually arrives in", () => {
    expect(parseDocumentDataUrl("data:image/jpeg;base64,AAAA")?.kind).toBe("image")
    expect(parseDocumentDataUrl("data:application/pdf;base64,AAAA")?.kind).toBe("pdf")
  })

  it("rejects anything else", () => {
    expect(parseDocumentDataUrl("data:text/html;base64,AAAA")).toBeNull()
    expect(parseDocumentDataUrl("https://example.com/report.pdf")).toBeNull()
  })
})
