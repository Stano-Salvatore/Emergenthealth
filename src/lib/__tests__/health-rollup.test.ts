import { describe, it, expect } from "vitest"
import { isoWeekStart, renderWeek, rollupWeeks, type DailyMetrics } from "@/lib/health-rollup"

const day = (date: string, over: Partial<DailyMetrics> = {}): DailyMetrics => ({
  date, sleepH: null, restingHR: null, hrv: null, readiness: null, steps: null, mood: null, ...over,
})

describe("isoWeekStart", () => {
  it("puts a Monday on itself", () => {
    expect(isoWeekStart("2026-08-24")).toBe("2026-08-24")
  })

  it("puts a Sunday at the START of the week it ends, not the one it begins", () => {
    // getUTCDay() is 0 for Sunday, which is six days INTO a Monday-start week.
    // Treating it as day zero would file every Sunday with the week after it.
    expect(isoWeekStart("2026-08-30")).toBe("2026-08-24")
  })

  it("crosses a month and a year boundary", () => {
    expect(isoWeekStart("2026-09-01")).toBe("2026-08-31")
    expect(isoWeekStart("2027-01-01")).toBe("2026-12-28")
  })

  it("hands back nonsense rather than inventing a week for it", () => {
    expect(isoWeekStart("not-a-date")).toBe("not-a-date")
  })
})

describe("rollupWeeks", () => {
  it("averages each metric over the days that have it, not the days in the week", () => {
    // A ring worn two nights out of three gives a two-night average. Counting
    // the third as a zero would report a week of five hours' sleep.
    const weeks = rollupWeeks([
      day("2026-08-24", { sleepH: 8, mood: 4 }),
      day("2026-08-25", { sleepH: 6 }),
      day("2026-08-26", { mood: 2 }),
    ])
    expect(weeks).toHaveLength(1)
    expect(weeks[0].sleepH).toBe(7)
    expect(weeks[0].mood).toBe(3)
    expect(weeks[0].days).toBe(3)
  })

  it("is null for a metric with nothing behind it, not zero", () => {
    const [w] = rollupWeeks([day("2026-08-24", { sleepH: 7 })])
    expect(w.hrv).toBeNull()
    expect(w.steps).toBeNull()
  })

  it("splits days across the weeks they belong to, oldest first", () => {
    const weeks = rollupWeeks([
      day("2026-09-01", { sleepH: 7 }),
      day("2026-08-30", { sleepH: 5 }),
      day("2026-08-24", { sleepH: 6 }),
    ])
    expect(weeks.map(w => w.weekStart)).toEqual(["2026-08-24", "2026-08-31"])
    expect(weeks[0].days).toBe(2)  // Mon 24th and Sun 30th are one week
    expect(weeks[1].days).toBe(1)
  })

  it("has nothing to roll up from nothing", () => {
    expect(rollupWeeks([])).toEqual([])
  })
})

describe("renderWeek", () => {
  it("leaves out the metrics with nothing to say", () => {
    const [w] = rollupWeeks([day("2026-08-24", { sleepH: 7.25, mood: 4 })])
    expect(renderWeek(w)).toBe("week of 2026-08-24 (1d): sleep 7.3h, mood 4.0/5")
  })

  it("says so when a week recorded nothing at all", () => {
    const [w] = rollupWeeks([day("2026-08-24")])
    expect(renderWeek(w)).toBe("week of 2026-08-24 (1d): nothing recorded")
  })
})
