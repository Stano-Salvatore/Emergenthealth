import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { vitalsPanel } from "@/lib/anomaly-scan"

// Samsung's best-received 7.0 feature is five overnight signals against your
// own baseline. The scanner here already computed the deviations and then
// reported only the outliers — a card needs the normal readings too, because
// "all five inside your usual band" is information, not absence of it.

const days = (key: string, values: (number | null)[], startDay = 1) =>
  values.map((v, i) => ({ date: `2026-09-${String(startDay + i).padStart(2, "0")}`, value: v }))
    .filter((d): d is { date: string; value: number } => d.value !== null)

describe("vitalsPanel", () => {
  it("reports value against the personal baseline, flagged only past two sigma", () => {
    const series = {
      restingHR: days("restingHR", [54, 55, 53, 54, 56, 54, 55, 53, 54, 55, 54, 53, 54, 55, 62]),
      hrv: days("hrv", [55, 56, 54, 57, 55, 54, 56, 55, 54, 56, 55, 54, 56, 55, 55]),
    }
    const panel = vitalsPanel(series, "2026-09-15")
    const hr = panel.find(v => v.key === "restingHR")
    expect(hr?.value).toBe(62)
    expect(hr?.baseline).toBe(54)
    expect(hr?.flagged).toBe(true)
    const hrv = panel.find(v => v.key === "hrv")
    expect(hrv?.flagged).toBe(false)
  })

  it("a signal with no reading on the latest night is listed as absent, not zero", () => {
    const series = {
      restingHR: days("restingHR", [54, 55, 53, 54, 56, 54, 55, 53, 54, 55, 54, 53, 54, 55]),
    }
    const panel = vitalsPanel(series, "2026-09-15")
    const hr = panel.find(v => v.key === "restingHR")
    expect(hr?.value).toBeNull()
    expect(hr?.baseline).toBe(54)
  })

  it("a signal without enough history is left out rather than judged", () => {
    const series = { skinTemp: days("skinTemp", [36.5, 36.6, 36.4]) }
    expect(vitalsPanel(series, "2026-09-03")).toHaveLength(0)
  })
})

describe("the card exists and the scan feeds it", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("the scan reads SpO2 too, and returns the panel", () => {
    const scan = stripped("src/lib/anomaly-scan.ts")
    expect(scan).toMatch(/spo2/)
    expect(scan).toMatch(/vitals/)
  })

  it("the dashboard mounts the vitals card", () => {
    const page = stripped("src/app/dashboard/page.tsx")
    expect(page).toMatch(/VitalsCard/)
  })
})
