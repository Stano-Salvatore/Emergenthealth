import { describe, it, expect } from "vitest"
import { describeCadence, cadenceLabel } from "@/lib/dose-cadence"

/** Dose days every `every` days, `count` times, starting at `start`. */
function every(start: string, count: number, gap: number): string[] {
  const out: string[] = []
  const d = new Date(start + "T00:00:00Z")
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + gap)
  }
  return out
}

describe("describeCadence", () => {
  it("recognises a daily habit", () => {
    const p = describeCadence(every("2026-03-01", 150, 1), 150)
    expect(p.cadence).toBe("daily")
    expect(p.regular).toBe(true)
    expect(p.consistent).toBe(true)
  })

  it("recognises a weekly dose the old coverage rule threw away", () => {
    // 21 doses over 150 days is 14% coverage — under any 50% cutoff, and
    // obviously relevant to a vitamin D result
    const p = describeCadence(every("2026-03-01", 21, 7), 150)
    expect(p.cadence).toBe("weekly")
    expect(p.regular).toBe(true)
    expect(p.consistent).toBe(true)
    expect(p.coverage).toBeLessThan(0.2)
  })

  it("recognises every-other-day and an odd but steady rhythm", () => {
    expect(describeCadence(every("2026-03-01", 70, 2), 150).cadence).toBe("every other day")
    const four = describeCadence(every("2026-03-01", 35, 4), 150)
    expect(four.cadence).toBe("regular")
    expect(cadenceLabel(four)).toBe("every ~4 days")
  })

  it("rejects a short course that didn't run the window", () => {
    // Two solid weeks of ibuprofen in the middle of five months
    const p = describeCadence(every("2026-05-01", 14, 1), 150)
    expect(p.regular).toBe(false)
    expect(p.consistent).toBe(false)
  })

  it("rejects a couple of scattered doses", () => {
    const p = describeCadence(["2026-04-01", "2026-05-14"], 150)
    expect(p.consistent).toBe(false)
    expect(p.cadence).toBe("irregular")
  })

  it("keeps something frequent but sloppy, since the rhythm stops mattering", () => {
    // Every day for the first 80 of 150 days, then patchy — 60% coverage
    const days = [...every("2026-03-01", 80, 1), ...every("2026-06-01", 10, 7)]
    const p = describeCadence(days, 150)
    expect(p.coverage).toBeGreaterThan(0.5)
    expect(p.consistent).toBe(true)
  })

  it("tolerates a dose taken a day late without losing the rhythm", () => {
    const days = ["2026-03-01", "2026-03-08", "2026-03-16", "2026-03-22", "2026-03-29",
      "2026-04-05", "2026-04-12", "2026-04-19", "2026-04-26", "2026-05-03"]
    const p = describeCadence(days, 66)
    expect(p.cadence).toBe("weekly")
    expect(p.regular).toBe(true)
  })

  it("counts each day once however many times it was logged", () => {
    const p = describeCadence(["2026-03-01", "2026-03-01", "2026-03-02"], 10)
    expect(p.daysTaken).toBe(2)
  })
})
