import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { stepsLine, habitWeekRows } from "@/lib/weekly-review"

// The weekly review hands the model numbers already aggregated, and the model
// believes them. Three of those numbers were wrong in the direction that
// writes a worse week than the one that happened.

describe("steps are a daily average over the days that were tracked", () => {
  // Four tracked days at ~10k (40k) against a full previous week at 9k/day
  // (63k) read "40,000 total (last week 63,000)", and the review said he
  // moved a third less — while his daily average went up. The three untracked
  // days were summed in as zeros.
  it("compares averages and says how many days each covers", () => {
    const line = stepsLine([10_000, 10_000, null, 10_000, null, 10_000, null], Array(7).fill(9_000))
    expect(line).toMatch(/avg 10,000\/day over 4 tracked days/)
    expect(line).toMatch(/last week 9,000\/day over 7 days/)
    expect(line).not.toMatch(/40,000/)
  })

  it("says there is no data rather than a zero", () => {
    expect(stepsLine([null, null], [])).toMatch(/no data/)
  })
})

describe("a habit's rate is against the days it was due", () => {
  const week = "2026-09-21" // a Monday
  const done = (...days: string[]) => days.map(d => ({ date: new Date(d + "T00:00:00Z") }))

  it("a Mon/Wed/Fri habit done all three times is 3/3, not 3/7", () => {
    const [row] = habitWeekRows(
      [{ name: "Gym", scheduleDays: [1, 3, 5], timesPerWeek: null, completions: done("2026-09-21", "2026-09-23", "2026-09-25") }],
      week, 7,
    )
    expect(row.due).toBe(3)
    expect(row.pct).toBe(100)
    expect(row.line).toMatch(/Gym \(Mon · Wed · Fri\): 3\/3/)
  })

  it("a 3x-a-week habit is measured against three", () => {
    const [row] = habitWeekRows(
      [{ name: "Run", scheduleDays: [], timesPerWeek: 3, completions: done("2026-09-22", "2026-09-24") }],
      week, 7,
    )
    expect(row.due).toBe(3)
    expect(row.pct).toBe(67)
  })

  it("a daily habit is still out of the days so far", () => {
    const [row] = habitWeekRows(
      [{ name: "Read", scheduleDays: [], timesPerWeek: null, completions: done("2026-09-21") }],
      week, 3,
    )
    expect(row.due).toBe(3)
    expect(row.line).toMatch(/Read \(daily\): 1\/3/)
  })

  it("a habit not yet due this week has no rate rather than 0%", () => {
    const [row] = habitWeekRows(
      [{ name: "Sauna", scheduleDays: [0], timesPerWeek: null, completions: [] }],
      week, 3,
    )
    expect(row.pct).toBeNull()
  })
})

describe("the review's fluid and its time windows", () => {
  const src = readFileSync("src/lib/weekly-review.ts", "utf8")
  it("counts every hydrating drink, not rows typed water", () => {
    // A week of tea and sparkling water read "Water: 0.3L logged".
    expect(src).toMatch(/sumHydration\(/)
    expect(src).not.toMatch(/type:\s*"water"/)
  })
  it("bounds timestamp columns by the user's local days, not UTC midnight", () => {
    expect(src).toMatch(/zonedDayRange\(tz, weekStartStr\)/)
  })
  it("the digest counts fluid the same way", () => {
    const digest = readFileSync("src/lib/digest.ts", "utf8")
    expect(digest).toMatch(/sumHydration\(/)
    expect(digest).not.toMatch(/type:\s*"water"/)
  })
})
