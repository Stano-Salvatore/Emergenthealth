import { describe, it, expect } from "vitest"
import { computeBestStreak, computeCompletionRate, makeIsFrozen } from "@/lib/streak"

const set = (...days: string[]) => new Set(days)

describe("computeBestStreak", () => {
  it("is 0 with no completions", () => {
    expect(computeBestStreak(set())).toBe(0)
  })

  it("counts the longest run, not the current one", () => {
    // Five in a row a fortnight ago, one yesterday. The current streak is 1;
    // the record is 5. This is the case the Habits page got wrong: it showed
    // the current streak of every habit and called the largest "Best streak",
    // so a single missed day reported 0 under a heatmap full of squares.
    const days = set(
      "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
      "2026-08-30",
    )
    expect(computeBestStreak(days)).toBe(5)
  })

  it("does not join runs separated by a missed day", () => {
    expect(computeBestStreak(set("2026-08-01", "2026-08-02", "2026-08-04"))).toBe(2)
  })

  it("bridges a gap that is entirely vacation", () => {
    const frozen = makeIsFrozen({ from: "2026-08-03", until: "2026-08-05" })
    const days = set("2026-08-01", "2026-08-02", "2026-08-06", "2026-08-07")
    // Four kept days either side of three frozen ones: one record of 4, and
    // the frozen days add nothing to its length.
    expect(computeBestStreak(days, frozen)).toBe(4)
  })

  it("still breaks when only part of the gap is frozen", () => {
    const frozen = makeIsFrozen({ from: "2026-08-03", until: "2026-08-03" })
    const days = set("2026-08-01", "2026-08-02", "2026-08-06")
    expect(computeBestStreak(days, frozen)).toBe(2)
  })

  it("is unaffected by the order dates arrive in", () => {
    expect(computeBestStreak(set("2026-08-03", "2026-08-01", "2026-08-02"))).toBe(3)
  })
})

describe("computeCompletionRate", () => {
  it("is null when nothing is due yet", () => {
    expect(computeCompletionRate([], "2026-09-02")).toBeNull()
  })

  it("ignores today, which is still in progress", () => {
    // Created yesterday, kept yesterday, nothing today: one day due, one kept.
    const habit = { completionDays: set("2026-09-01"), createdAt: "2026-09-01" }
    expect(computeCompletionRate([habit], "2026-09-02")).toBe(1)
  })

  it("does not blame a habit for days before it existed", () => {
    // Ten days old, kept five of the nine days that count. Were the full 30-day
    // window charged to it, this would read 17% rather than 56%.
    const days = set("2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28")
    const habit = { completionDays: days, createdAt: "2026-08-24" }
    expect(computeCompletionRate([habit], "2026-09-02")).toBeCloseTo(5 / 9, 5)
  })

  it("averages across habits by total days due", () => {
    const a = { completionDays: set("2026-09-01"), createdAt: "2026-09-01" }
    const b = { completionDays: set(), createdAt: "2026-09-01" }
    expect(computeCompletionRate([a, b], "2026-09-02")).toBe(0.5)
  })
})
