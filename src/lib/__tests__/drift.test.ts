import { describe, it, expect } from "vitest"
import { DRIFT_METRICS, judgeFactors, judgeMetric, renderDrift, type DayValue, type DriftReport } from "../drift"
import { calendarWindows, rollingWindows } from "../drift-load"

const prior = { from: "2026-07-01", to: "2026-07-31" }
const recent = { from: "2026-08-01", to: "2026-08-31" }
const metric = (key: string) => DRIFT_METRICS.find(m => m.key === key)!

/** Deterministic wobble so the windows are not flat lines. */
function series(from: string, days: number, base: number, wobble: number): DayValue[] {
  const out: DayValue[] = []
  const start = Date.parse(from + "T00:00:00Z")
  for (let i = 0; i < days; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ day, value: base + wobble * Math.sin(i * 1.7) })
  }
  return out
}

describe("judgeMetric", () => {
  it("reports a real shift with both means, the counts and a direction", () => {
    const vals = [...series("2026-07-01", 31, 72, 3), ...series("2026-08-01", 31, 80, 3)]
    const s = judgeMetric(metric("sleepScore"), vals, prior, recent, "t")!
    expect(s).not.toBeNull()
    expect(s.verdict).toBe("better")
    expect(s.priorMean).toBeCloseTo(72, 0)
    expect(s.recentMean).toBeCloseTo(80, 0)
    expect(s.recentN).toBe(31)
    expect(s.p).toBeLessThan(0.05)
  })

  it("a higher resting heart rate is worse", () => {
    const vals = [...series("2026-07-01", 31, 52, 1), ...series("2026-08-01", 31, 57, 1)]
    expect(judgeMetric(metric("restingHR"), vals, prior, recent, "t")?.verdict).toBe("worse")
  })

  it("says nothing when the months are the same", () => {
    const vals = [...series("2026-07-01", 31, 75, 4), ...series("2026-08-01", 31, 75, 4)]
    expect(judgeMetric(metric("sleepScore"), vals, prior, recent, "t")).toBeNull()
  })

  it("a gap under the relevance floor is not news however clean it is", () => {
    const vals = [...series("2026-07-01", 31, 75, 0.5), ...series("2026-08-01", 31, 78, 0.5)]
    expect(judgeMetric(metric("sleepScore"), vals, prior, recent, "t")).toBeNull()
  })

  it("a thin window is not judged at all", () => {
    const vals = [...series("2026-07-25", 7, 60, 2), ...series("2026-08-01", 31, 80, 2)]
    expect(judgeMetric(metric("sleepScore"), vals, prior, recent, "t")).toBeNull()
  })
})

describe("judgeFactors", () => {
  it("names what moved, scaled to the recent window, biggest movers first", () => {
    const days = (from: string, n: number) => series(from, n, 0, 0).map(v => v.day)
    const daysByLabel = new Map<string, Set<string>>([
      ["Magnesium", new Set([...days("2026-07-01", 4), ...days("2026-08-01", 24)])],
      ["Coffee", new Set([...days("2026-07-01", 28), ...days("2026-08-01", 27)])], // unchanged
      ["Gym (habit)", new Set([...days("2026-07-01", 2), ...days("2026-08-01", 2)])],  // too rare
    ])
    const out = judgeFactors({ daysByLabel, workoutDays: [...days("2026-07-01", 3), ...days("2026-08-01", 12)], waterByDay: new Map() }, prior, recent)
    expect(out.map(f => f.label)).toEqual(["Magnesium", "Workouts"])
    expect(out[0]).toMatchObject({ recent: 24, prior: 4, unit: "days" })
    expect(out[1]).toMatchObject({ recent: 12, prior: 3, unit: "sessions" })
  })

  it("water is compared as a daily average", () => {
    const water = new Map<string, number>()
    for (const v of series("2026-07-01", 20, 700, 0)) water.set(v.day, v.value)
    for (const v of series("2026-08-01", 20, 1500, 0)) water.set(v.day, v.value)
    const out = judgeFactors({ daysByLabel: new Map(), workoutDays: [], waterByDay: water }, prior, recent)
    expect(out).toEqual([{ label: "Water", unit: "ml/day", recent: 1500, prior: 700 }])
  })
})

describe("renderDrift", () => {
  const shift = { key: "sleepScore", label: "Sleep score", unit: "", recentMean: 78, priorMean: 74, recentN: 27, priorN: 29, delta: 4, p: 0.01, verdict: "better" as const }
  const base: DriftReport = { recent, prior, judged: 6, shifts: [shift], factors: [] }

  it("asks the open question when nothing logged explains the shift", () => {
    const t = renderDrift(base, { calendarMonths: true })!
    expect(t.headline).toContain("August vs July")
    expect(t.headline).toContain("Sleep score 78 vs 74")
    expect(t.headline).toMatch(/did something change that isn't in the app\?$/)
    expect(t.headline.length).toBeLessThanOrEqual(300)
  })

  it("offers the candidates when there are some", () => {
    const t = renderDrift({ ...base, factors: [{ label: "Magnesium", unit: "days", recent: 24, prior: 4 }] })!
    expect(t.headline).toContain("last 30 days vs the 30 before")
    expect(t.headline).toContain("magnesium 24 vs 4 days")
    expect(t.headline).toMatch(/ring true/)
    expect(t.detail).toContain("candidates, not causes")
  })

  it("is silent when nothing moved", () => {
    expect(renderDrift({ ...base, shifts: [] })).toBeNull()
  })

  it("never exceeds one notification even with many factors", () => {
    const factors = Array.from({ length: 6 }, (_, i) => ({ label: `A very long supplement name number ${i}`, unit: "days" as const, recent: 20, prior: 2 }))
    const t = renderDrift({ ...base, shifts: [shift, { ...shift, key: "hrv", label: "HRV", unit: "ms" }], factors })!
    expect(t.headline.length).toBeLessThanOrEqual(300)
  })
})

describe("windows", () => {
  it("rolling: the last 30 days against the 30 before", () => {
    expect(rollingWindows("2026-09-10")).toEqual({
      recent: { from: "2026-08-12", to: "2026-09-10" },
      prior: { from: "2026-07-13", to: "2026-08-11" },
    })
  })
  it("calendar: last month against the one before, across a year end", () => {
    expect(calendarWindows("2026-09-01")).toEqual({
      recent: { from: "2026-08-01", to: "2026-08-31" },
      prior: { from: "2026-07-01", to: "2026-07-31" },
    })
    expect(calendarWindows("2027-01-01")).toEqual({
      recent: { from: "2026-12-01", to: "2026-12-31" },
      prior: { from: "2026-11-01", to: "2026-11-30" },
    })
    expect(calendarWindows("2026-03-01").recent).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
})
