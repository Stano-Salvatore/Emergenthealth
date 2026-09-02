import { describe, it, expect } from "vitest"
import { detectAnomaly, detectAll, illnessSignal, median, mad, TRACKED_METRICS, type Anomaly, type DayValue } from "@/lib/anomalies"

const spec = (key: string) => TRACKED_METRICS.find(m => m.key === key)!

/**
 * Steady series with a little wobble, oldest first. The wobble cycles
 * high/low/centre rather than alternating, so the median of the series is the
 * centre value even after a few unusual days are appended — an alternating
 * pair would let two extra low days drag the median onto the low rung.
 */
function steady(days: number, value: number, wobble = 1): DayValue[] {
  const offset = [wobble, -wobble, 0]
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    value: value + offset[i % 3],
  }))
}

describe("median and mad", () => {
  it("are unmoved by a single wild outlier", () => {
    const clean = [50, 51, 52, 53, 54]
    const withOutlier = [...clean, 200]
    expect(median(clean)).toBe(52)
    expect(median(withOutlier)).toBe(52.5)
    // a mean-based spread would explode here; MAD barely moves
    expect(mad(withOutlier)).toBeLessThan(4)
  })
})

describe("detectAnomaly", () => {
  it("flags a resting heart rate well above the personal baseline", () => {
    const history = [...steady(20, 54), { date: "2026-02-01", value: 63 }]
    const a = detectAnomaly(spec("restingHR"), history)
    expect(a).not.toBeNull()
    expect(a!.direction).toBe("above")
    expect(a!.concerning).toBe(true) // higher resting HR is the bad direction
    expect(a!.baseline).toBe(54)
    expect(a!.summary).toContain("Resting heart rate")
  })

  it("flags an HRV drop as concerning but a rise as not", () => {
    const drop = detectAnomaly(spec("hrv"), [...steady(20, 60, 2), { date: "2026-02-01", value: 38 }])
    expect(drop!.concerning).toBe(true)
    const rise = detectAnomaly(spec("hrv"), [...steady(20, 60, 2), { date: "2026-02-01", value: 82 }])
    expect(rise!.concerning).toBe(false)
  })

  it("catches a slow drift that never spikes", () => {
    // Sleep scores wobble by several points normally, so none of these three
    // days is a spike on its own — it's the run that makes it a signal.
    const history = [
      ...steady(21, 80, 6),
      { date: "2026-02-01", value: 70 },
      { date: "2026-02-02", value: 69 },
      { date: "2026-02-03", value: 70 },
    ]
    const a = detectAnomaly(spec("sleepScore"), history)
    expect(a).not.toBeNull()
    expect(a!.runLength).toBeGreaterThanOrEqual(3)
    expect(a!.summary).toContain("for 3 days")
  })

  it("stays quiet on an ordinary day", () => {
    expect(detectAnomaly(spec("restingHR"), [...steady(20, 54), { date: "2026-02-01", value: 55 }])).toBeNull()
  })

  it("ignores a statistically large but clinically trivial shift", () => {
    // A metronomic series makes tiny deviations look enormous in z terms
    const history = [...steady(20, 54, 0.1), { date: "2026-02-01", value: 55 }]
    const a = detectAnomaly(spec("restingHR"), history)
    expect(a).toBeNull() // 1 bpm is under the metric's minimum shift
  })

  it("needs enough history before claiming to know what's normal", () => {
    expect(detectAnomaly(spec("restingHR"), [...steady(5, 54), { date: "2026-02-01", value: 70 }])).toBeNull()
  })

  it("doesn't divide by a zero spread", () => {
    const flat = Array.from({ length: 20 }, (_, i) => ({ date: `2026-01-${i + 1}`, value: 54 }))
    expect(detectAnomaly(spec("restingHR"), [...flat, { date: "2026-02-01", value: 54 }])).toBeNull()
  })
})

describe("detectAll", () => {
  it("returns concerning anomalies before reassuring ones", () => {
    const found = detectAll({
      hrv: [...steady(20, 60, 2), { date: "2026-02-01", value: 90 }],       // good direction
      restingHR: [...steady(20, 54), { date: "2026-02-01", value: 64 }],    // bad direction
      steps: [...steady(20, 9000, 200), { date: "2026-02-01", value: 9100 }], // nothing
    })
    expect(found).toHaveLength(2)
    expect(found[0].metric).toBe("restingHR")
    expect(found[0].concerning).toBe(true)
    expect(found[1].concerning).toBe(false)
  })
})

describe("illnessSignal", () => {
  const mk = (metric: string, direction: "above" | "below", date = "2026-02-01"): Anomaly => ({
    metric, label: TRACKED_METRICS.find(m => m.key === metric)!.label, emoji: "x", unit: "",
    value: 1, baseline: 0, z: 2.5, direction, concerning: true, runLength: 1, date, summary: metric,
  })

  it("fires when three of the four infection signs move together on one night", () => {
    const composite = illnessSignal([mk("skinTemp", "above"), mk("restingHR", "above"), mk("hrv", "below")])
    expect(composite).not.toBeNull()
    expect(composite!.metric).toBe("illness")
    expect(composite!.parts).toEqual(["skinTemp", "restingHR", "hrv"])
    expect(composite!.summary).toContain("not a diagnosis")
  })

  it("stays quiet for two signs (a hard workout looks like that) or the wrong direction", () => {
    expect(illnessSignal([mk("skinTemp", "above"), mk("restingHR", "above")])).toBeNull()
    expect(illnessSignal([mk("skinTemp", "above"), mk("restingHR", "above"), mk("hrv", "above")])).toBeNull()
  })

  it("does not join signs from different nights into one story", () => {
    expect(illnessSignal([mk("skinTemp", "above"), mk("restingHR", "above"), mk("hrv", "below", "2026-01-30")])).toBeNull()
  })

  it("stands in for its parts in detectAll", () => {
    const series = {
      skinTemp: [...steady(20, 33.5, 0.1), { date: "2026-02-01", value: 34.6 }],
      breathingRate: [...steady(20, 14, 0.2), { date: "2026-02-01", value: 16.5 }],
      restingHR: [...steady(20, 54), { date: "2026-02-01", value: 63 }],
      hrv: [...steady(20, 60, 2), { date: "2026-02-01", value: 38 }],
    }
    const all = detectAll(series)
    expect(all[0].metric).toBe("illness")
    expect(all.some(a => a.metric === "restingHR")).toBe(false)
  })
})
