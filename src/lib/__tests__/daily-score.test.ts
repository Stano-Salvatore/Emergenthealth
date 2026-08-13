import { describe, it, expect } from "vitest"
import { computeDailyScore, relativeScore, scoreGrade, MIN_BASIS_DAYS, type ScoreDay } from "@/lib/daily-score"

/** A typical fortnight: everything steady, with a small three-phase wobble. */
function typicalHistory(days = 20, over: Partial<ScoreDay> = {}): ScoreDay[] {
  const w = [1, -1, 0]
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    sleepScore: 80 + w[i % 3] * 4,
    sleepDuration: 450 + w[i % 3] * 20,
    deepSleep: 70 + w[i % 3] * 8,
    readinessScore: 78 + w[i % 3] * 5,
    hrv: 55 + w[i % 3] * 5,
    restingHR: 54 + w[i % 3] * 2,
    steps: 9000 + w[i % 3] * 1500,
    activeMinutes: 45 + w[i % 3] * 10,
    ...over,
  }))
}

const typicalDay: ScoreDay = {
  date: "2026-02-01",
  sleepScore: 80, sleepDuration: 450, deepSleep: 70,
  readinessScore: 78, hrv: 55, restingHR: 54,
  steps: 9000, activeMinutes: 45,
}

describe("relativeScore", () => {
  it("puts a typical reading at 50 and a good one above it", () => {
    const history = Array.from({ length: 20 }, (_, i) => 50 + (i % 3 === 0 ? 5 : i % 3 === 1 ? -5 : 0))
    expect(relativeScore(50, history, true)!.score).toBe(50)
    expect(relativeScore(65, history, true)!.score).toBeGreaterThan(50)
    expect(relativeScore(35, history, true)!.score).toBeLessThan(50)
  })

  it("inverts for metrics where lower is better", () => {
    const history = Array.from({ length: 20 }, (_, i) => 54 + (i % 3 === 0 ? 2 : i % 3 === 1 ? -2 : 0))
    expect(relativeScore(60, history, false)!.score).toBeLessThan(50) // higher resting HR is worse
    expect(relativeScore(48, history, false)!.score).toBeGreaterThan(50)
  })

  it("stays silent without a baseline or without spread", () => {
    expect(relativeScore(50, [50, 51, 52], true)).toBeNull()
    expect(relativeScore(51, Array(20).fill(50), true)).toBeNull()
  })

  it("can't run off the ends of the scale", () => {
    const history = Array.from({ length: 20 }, (_, i) => 50 + (i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0))
    expect(relativeScore(500, history, true)!.score).toBe(100)
    expect(relativeScore(-500, history, true)!.score).toBe(0)
  })
})

describe("computeDailyScore", () => {
  it("scores an ordinary day at about 50", () => {
    const r = computeDailyScore(typicalDay, typicalHistory())
    expect(r.score).toBeGreaterThanOrEqual(45)
    expect(r.score).toBeLessThanOrEqual(55)
    expect(r.driver).toBeNull() // nothing stood out
    expect(scoreGrade(r.score!).label).toBe("About your usual")
  })

  it("a bad night drags the score down and names sleep as the reason", () => {
    const r = computeDailyScore(
      { ...typicalDay, sleepScore: 55, sleepDuration: 300, deepSleep: 30 },
      typicalHistory(),
    )
    expect(r.score).toBeLessThan(45)
    expect(r.driver?.label).toBe("Sleep")
    expect(r.driver?.direction).toBe("down")
  })

  it("does not punish a metric that simply didn't sync", () => {
    const withAll = computeDailyScore(typicalDay, typicalHistory())
    // Same day, but the ring recorded no movement at all
    const noSteps = computeDailyScore(
      { ...typicalDay, steps: null, activeMinutes: null },
      typicalHistory(),
    )
    // The old scorer gave a missing metric zero points; here it is simply absent
    expect(noSteps.score).toBe(withAll.score)
    expect(noSteps.coverage).toBeLessThan(withAll.coverage)
    expect(noSteps.components.find(c => c.key === "activity")!.score).toBeNull()
  })

  it("refuses to produce a number when barely anything is known", () => {
    const r = computeDailyScore({ date: "2026-02-01", steps: 9000 }, typicalHistory())
    expect(r.score).toBeNull()
    expect(r.reason).toContain("Too little")
  })

  it("refuses to produce a number before there is a baseline", () => {
    const r = computeDailyScore(typicalDay, typicalHistory(MIN_BASIS_DAYS - 1))
    expect(r.score).toBeNull()
    expect(r.reason).toContain("history")
  })

  it("shows every component's parts with today's value and the baseline", () => {
    const r = computeDailyScore(typicalDay, typicalHistory())
    const sleep = r.components.find(c => c.key === "sleep")!
    expect(sleep.parts.map(p => p.label)).toEqual(["Sleep score", "Duration", "Deep sleep"])
    const duration = sleep.parts.find(p => p.label === "Duration")!
    expect(duration.value).toBe("7.5h")
    expect(duration.baseline).toBe("7.5h")
  })

  it("reads a raised resting heart rate as worse, not better", () => {
    const r = computeDailyScore({ ...typicalDay, restingHR: 62 }, typicalHistory())
    const recovery = r.components.find(c => c.key === "recovery")!
    expect(recovery.parts.find(p => p.label === "Resting HR")!.score!).toBeLessThan(50)
  })
})

describe("scoreGrade", () => {
  it("calls the midpoint normal rather than a failure", () => {
    expect(scoreGrade(50).label).toBe("About your usual")
    expect(scoreGrade(80).label).toBe("Well above your usual")
    expect(scoreGrade(20).label).toBe("Well below your usual")
  })
})
