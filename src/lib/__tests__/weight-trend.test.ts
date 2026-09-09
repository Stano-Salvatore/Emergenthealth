import { describe, it, expect } from "vitest"
import { mergeWeightSeries, weightTrend, weightSlopeKgWk, weightGoalProgress } from "@/lib/weight-trend"

function days(start: string, n: number, f: (i: number) => number) {
  const out = []
  const t0 = Date.parse(start + "T00:00:00Z")
  for (let i = 0; i < n; i++) {
    out.push({ date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10), kg: f(i) })
  }
  return out
}

describe("mergeWeightSeries", () => {
  it("dedupes by day with the later source winning, drops junk, sorts", () => {
    const a = [{ date: "2026-09-02", kg: 80 }, { date: "2026-09-01", kg: 81 }]
    const b = [{ date: "2026-09-02", kg: 79.5 }, { date: "bad", kg: 80 }, { date: "2026-09-03", kg: 900 }]
    expect(mergeWeightSeries(a, b)).toEqual([
      { date: "2026-09-01", kg: 81 },
      { date: "2026-09-02", kg: 79.5 },
    ])
  })
})

describe("weightTrend", () => {
  it("smooths a noisy scale over the trailing week by calendar, not by count", () => {
    const series = [
      { date: "2026-09-01", kg: 80 },
      { date: "2026-09-02", kg: 82 },
      { date: "2026-09-20", kg: 78 }, // far away: window resets
    ]
    const t = weightTrend(series)
    expect(t[1].trendKg).toBe(81)
    expect(t[2].trendKg).toBe(78)
  })
})

describe("weightSlopeKgWk", () => {
  it("returns the fitted weekly slope and refuses to extrapolate two close points", () => {
    const t = weightTrend(days("2026-09-01", 14, i => 80 - i * 0.05)) // −0.35 kg/wk raw
    const s = weightSlopeKgWk(t)
    expect(s).not.toBeNull()
    expect(s!).toBeLessThan(-0.2)
    expect(s!).toBeGreaterThan(-0.5)
    expect(weightSlopeKgWk(weightTrend([{ date: "2026-09-01", kg: 80 }, { date: "2026-09-02", kg: 79 }]))).toBeNull()
  })
})

describe("weightGoalProgress", () => {
  it("reports on-pace losing with an ETA", () => {
    const series = days("2026-08-01", 28, i => 85 - i * (0.5 / 7))
    const p = weightGoalProgress(series, { mode: "lose", targetKg: 80, paceKgWk: 0.5, startKg: 85 })
    expect(p.status).toBe("on_pace")
    expect(p.etaDays).toBeGreaterThan(0)
    expect(p.fraction).toBeGreaterThan(0.2)
    expect(p.summary).toMatch(/On pace/)
  })

  it("flags losing too fast and moving the wrong way", () => {
    const fast = days("2026-08-01", 21, i => 85 - i * (1.2 / 7))
    expect(weightGoalProgress(fast, { mode: "lose", targetKg: 75, paceKgWk: 0.5, startKg: 85 }).status).toBe("ahead")
    const wrong = days("2026-08-01", 21, i => 85 + i * (0.4 / 7))
    expect(weightGoalProgress(wrong, { mode: "lose", targetKg: 75, paceKgWk: 0.5, startKg: 85 }).status).toBe("reversing")
  })

  it("calls a flat fortnight a stall and a passed target reached", () => {
    const flat = days("2026-08-01", 21, i => 80 + (i % 2 ? 0.05 : -0.05))
    expect(weightGoalProgress(flat, { mode: "lose", targetKg: 75, paceKgWk: 0.5, startKg: 85 }).status).toBe("stalled")
    const done = days("2026-08-01", 10, () => 74.5)
    expect(weightGoalProgress(done, { mode: "lose", targetKg: 75, paceKgWk: 0.5, startKg: 85 }).status).toBe("reached")
  })

  it("judges a maintain goal by the band around the anchor", () => {
    const hold = days("2026-08-01", 14, i => 70 + (i % 3) * 0.2)
    expect(weightGoalProgress(hold, { mode: "maintain", targetKg: 70, paceKgWk: null, startKg: 70 }).status).toBe("holding")
    const drift = days("2026-08-01", 14, () => 72.5)
    expect(weightGoalProgress(drift, { mode: "maintain", targetKg: 70, paceKgWk: null, startKg: 70 }).status).toBe("drifting")
  })

  it("has nothing to say without readings", () => {
    expect(weightGoalProgress([], { mode: "gain", targetKg: 75, paceKgWk: 0.25, startKg: 70 }).status).toBe("no_data")
  })
})
