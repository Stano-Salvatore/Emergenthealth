import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { vitalsPanel, scanUserAnomalies } from "@/lib/anomaly-scan"
import { detectAnomaly, TRACKED_METRICS } from "@/lib/anomalies"

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

describe("the card and the anomaly scan judge a night the same way", () => {
  // The panel took its median and spread over a series that INCLUDED the
  // night being judged, then multiplied mad() — already scaled by 1.4826 —
  // by 1.4826 again. So the card's band was about half again as wide as the
  // scan's: HRV 42 against a steady 50 was a concerning anomaly in the brief
  // above the card, and a green dot under "all in your usual band" in it.
  it("an HRV night the scan flags is flagged on the card too, with the same z", () => {
    const values = [50, 52, 48, 55, 45, 50, 53, 47, 51, 49, 54, 46, 50, 52, 42]
    const hrv = days("hrv", values)
    const spec = TRACKED_METRICS.find(m => m.key === "hrv")!
    const anomaly = detectAnomaly(spec, hrv)
    expect(anomaly?.concerning).toBe(true)

    const card = vitalsPanel({ hrv }, "2026-09-15").find(v => v.key === "hrv")!
    expect(card.flagged).toBe(true)
    expect(card.z).toBe(Math.round(anomaly!.z * 10) / 10)
    expect(card.baseline).toBe(anomaly!.baseline)
  })
})

const db = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock("@/lib/prisma", () => ({ prisma: { healthLog: { findMany: async () => db.rows } } }))

describe("the panel's night is the newest night with vitals, not the newest row", () => {
  // A Health Connect or Oura activity sync creates today's row with steps
  // before the ring has sent last night — or the ring spent the night on its
  // charger. The panel read vitals off that row: five dashes under "all in
  // your usual band".
  afterEach(() => { vi.useRealTimers() })

  it("skips a steps-only row and names the night it did use", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-27T06:00:00Z"))
    const rows: unknown[] = []
    for (let d = 12; d <= 26; d++) {
      rows.push({ date: new Date(`2026-09-${d}T00:00:00Z`), hrv: 50 + (d % 3), restingHR: 54 + (d % 2), steps: 8000 })
    }
    rows.push({ date: new Date("2026-09-27T00:00:00Z"), steps: 900 })
    db.rows = rows
    const scan = await scanUserAnomalies("u1")
    expect(scan.latestDate).toBe("2026-09-27")
    expect(scan.vitalsDate).toBe("2026-09-26")
    expect(scan.vitals.find(v => v.key === "hrv")?.value).not.toBeNull()
  })
})

describe("the card counts only what was measured", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  const card = stripped("src/components/dashboard/VitalsCard.tsx")

  it("does not count a vital with no reading as inside the usual band", () => {
    expect(card, "the header counts vitals with no reading as 'in your usual band'")
      .toMatch(/\.filter\(\s*v\s*=>\s*v\.value\s*!=\s*null\s*\)/)
  })

  it("dates a night that is not last night instead of calling it last night", () => {
    expect(card).toMatch(/vitalsDate/)
    expect(card).toMatch(/userToday\(/)
  })
})
