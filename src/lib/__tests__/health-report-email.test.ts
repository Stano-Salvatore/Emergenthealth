import { describe, it, expect } from "vitest"
import { renderReportEmail, reportSubject } from "@/lib/health-report-email"
import type { HealthReport } from "@/lib/health-report"

// This renderer only ever runs inside a cron-less POST that needs a signed-in
// user and a mail provider, so nothing exercises it by accident. A report with
// nothing in it is the common case for a section — no blood pressure logged, no
// labs uploaded — and printing an empty table to a doctor is worse than
// printing nothing.

const EMPTY: HealthReport = {
  generatedAt: "2026-08-20T18:00:00.000Z",
  periodDays: 90,
  from: "2026-05-22",
  to: "2026-08-20",
  user: { name: null, email: null },
  coverage: { daysWithWearable: 0, longestGapDays: 0 },
  metrics: [],
  meds: [],
  otherDoses: [],
  symptoms: [],
  labs: [],
  bloodPressure: null,
  body: { weightKg: null, prevWeightKg: null, bodyFatPct: null, bodyFatDate: null, date: null },
  weightTrend: null,
  patterns: [],
  patternsAsOf: null,
  narrative: "",
}

const FULL: HealthReport = {
  ...EMPTY,
  user: { name: "Sam Reyes", email: "sam@example.com" },
  coverage: { daysWithWearable: 71, longestGapDays: 4 },
  metrics: [{
    key: "sleep", label: "Sleep", unit: "h", avg: 7.2, prevAvg: 6.8, prevDays: 80,
    min: 4.1, max: 9.3, days: 71, decimals: 1, higherIsBetter: true,
  }],
  meds: [{
    name: "Atarax", dose: "25 mg", times: ["22:00"], daysOfWeek: [],
    note: null, expectedDoses: 90, loggedDoses: 76, lastTaken: "2026-08-19",
    typicalDose: "12.5 mg",
  }],
  symptoms: [{ name: "Headache", occurrences: 6, avgSeverity: 4.5, worstSeverity: 5, lastSeen: "2026-08-14" }],
  labs: [{
    marker: "Ferritin", value: 42, unit: "µg/L", referenceMin: 30, referenceMax: 400,
    date: "2026-08-01", flag: "normal", previous: {
      value: 28, unit: "µg/L", date: "2026-02-03", valueInLatestUnit: 28, direction: "up", unitMismatch: false,
    },
  }],
  bloodPressure: {
    readings: 24, avgSystolic: 126, avgDiastolic: 81, maxSystolic: 148, maxDiastolic: 94,
    avgPulse: 64, last: { systolic: 122, diastolic: 78, date: "2026-08-18" }, band: "high-normal",
  },
  weightTrend: { first: 78.4, last: 76.1, changeKg: -2.3, readings: 31, firstDate: "2026-05-23", lastDate: "2026-08-19" },
  patterns: [{ finding: "Sleep is 42 min shorter after alcohol", confidence: "solid" }],
  narrative: "First paragraph.\n\nSecond paragraph.",
}

describe("reportSubject", () => {
  it("names the period rather than the send date", () => {
    expect(reportSubject(FULL)).toBe("Health report — 22 May 2026 to 20 Aug 2026")
  })
})

describe("renderReportEmail", () => {
  it("omits every section it has no data for", () => {
    const html = renderReportEmail(EMPTY)
    for (const heading of ["Blood pressure", "Medications", "Symptoms", "Laboratory results", "Weight", "Summary"]) {
      expect(html).not.toContain(heading)
    }
    // Still a valid document with the period on it.
    expect(html).toContain("22 May 2026")
    expect(html).toContain("</html>")
  })

  it("renders each section it does have data for", () => {
    const html = renderReportEmail(FULL)
    for (const heading of ["Blood pressure", "Medications", "Symptoms", "Laboratory results", "Weight", "Self-tracked patterns"]) {
      expect(html).toContain(heading)
    }
    expect(html).toContain("126/81")
    expect(html).toContain("high-normal")
    expect(html).toContain("76 / 90")          // doses taken vs expected
    expect(html).toContain("12.5 mg")          // the dose actually taken, not the prescribed one
    expect(html).toContain("↑ 28")             // lab direction against the previous result
    expect(html).toContain("-2.3 kg")
  })

  it("splits the narrative into paragraphs instead of one wall", () => {
    const html = renderReportEmail(FULL)
    expect(html).toContain("First paragraph.")
    expect(html).toContain("Second paragraph.")
    expect((html.match(/First paragraph\.|Second paragraph\./g) ?? []).length).toBe(2)
  })

  it("says how many days actually carry data, not just the period length", () => {
    // A 90-day report over 71 measured days is a different document, and the
    // doctor is the one person who needs to know which.
    const html = renderReportEmail(FULL)
    expect(html).toContain("90 days")
    expect(html).toContain("wearable data on 71")
    expect(html).toContain("longest gap 4 days")
  })

  it("escapes text that came from the user", () => {
    const html = renderReportEmail({
      ...FULL,
      user: { name: "<script>alert(1)</script>", email: null },
      symptoms: [{ name: "Pain <b>bad</b>", occurrences: 1, avgSeverity: 5, worstSeverity: 5, lastSeen: "2026-08-14" }],
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("Pain &lt;b&gt;bad&lt;/b&gt;")
  })

  it("keeps the limits of the data on the page", () => {
    const html = renderReportEmail(FULL)
    expect(html).toContain("consumer-device estimates")
    expect(html).toContain("does not contain a diagnosis")
    expect(html).toContain("Associations, not causes")
  })

  // On Android the email is the only export that works, and it had dropped
  // the page's caveats: a column headed "Taken" over doses the patient merely
  // logged, no note that adherence is a lower bound, and a severity of 4.5
  // with no scale, which reads as mild on a 0–10 one.
  it("carries the page's caveats, not a bare 'Taken' column", () => {
    const html = renderReportEmail(FULL)
    expect(html).not.toMatch(/>Taken</)
    expect(html).toContain("Logged in app")
    expect(html).toContain("About this report.")
    expect(html).toContain("is a lower bound")
    expect(html).toContain("4.5/5")
    expect(html).toContain("5/5")
  })

  it("prints the latest weight even when the period has fewer than two weigh-ins", () => {
    const html = renderReportEmail({
      ...EMPTY,
      body: { weightKg: 78.4, prevWeightKg: 79.0, bodyFatPct: null, bodyFatDate: null, date: "2026-08-10" },
    })
    expect(html).toContain("78.4 kg")
    expect(html).toContain("10 Aug 2026")
  })

  it("compares a lab in the latest unit and says when a move is within normal variation", () => {
    const html = renderReportEmail({
      ...FULL,
      labs: [
        {
          marker: "Cholesterol", value: 5.2, unit: "mmol/L", referenceMin: 3, referenceMax: 5.2, date: "2026-08-01", flag: "normal",
          previous: { value: 200, unit: "mg/dL", date: "2026-03-10", valueInLatestUnit: 5.17, direction: "flat", unitMismatch: false },
        },
        {
          marker: "Mystery", value: 4, unit: "zorps", referenceMin: null, referenceMax: null, date: "2026-08-01", flag: "unknown",
          previous: { value: 3, unit: "blips", date: "2026-03-10", valueInLatestUnit: null, direction: null, unitMismatch: true },
        },
      ],
    })
    expect(html).not.toContain("↓ 200")
    expect(html).toContain("≈ 5.17 mmol/L")
    expect(html).toContain("different unit")
  })

  it("keeps a pattern's confound and the day it was computed", () => {
    const html = renderReportEmail({
      ...FULL,
      patternsAsOf: "2026-08-15",
      patterns: [{
        finding: "With magnesium, sleep score averages 82; without, 76", confidence: "tentative",
        confounded: "Bedtime does not hold still here", coverage: "caffeine unknown on 6 days",
        days: { with: 21, without: 40 },
      }],
    })
    expect(html).toContain("Bedtime does not hold still here")
    expect(html).toContain("caffeine unknown on 6 days")
    expect(html).toContain("21 days with, 40 without")
    expect(html).toContain("15 Aug 2026")
  })
})
