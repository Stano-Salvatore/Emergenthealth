import { describe, it, expect } from "vitest"
import { normalizeReport, parseDocumentDataUrl, type ParsedLabReport } from "@/lib/lab-analyze"

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
