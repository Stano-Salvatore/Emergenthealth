import { describe, it, expect } from "vitest"
import { normalizeSchedule, isScheduledOn, isDueOn, habitStreak, scheduleLabel, weekStart } from "@/lib/habit-schedule"

// 2026-09-09 is a Wednesday; the week runs Mon 7 → Sun 13.
const MWF = { scheduleDays: [1, 3, 5], timesPerWeek: null }
const DAILY = { scheduleDays: [], timesPerWeek: null }
const THRICE = { scheduleDays: [], timesPerWeek: 3 }

describe("normalizeSchedule", () => {
  it("dedupes, sorts, and treats all seven days as daily", () => {
    expect(normalizeSchedule({ scheduleDays: [5, 1, 1, 9, "3"] })).toEqual({ scheduleDays: [1, 3, 5], timesPerWeek: null })
    expect(normalizeSchedule({ scheduleDays: [0, 1, 2, 3, 4, 5, 6] }).scheduleDays).toEqual([])
    expect(normalizeSchedule({ timesPerWeek: "3", scheduleDays: [1] })).toEqual({ scheduleDays: [], timesPerWeek: 3 })
    expect(normalizeSchedule({ timesPerWeek: 9 }).timesPerWeek).toBeNull()
  })
})

describe("isScheduledOn / isDueOn", () => {
  it("follows the weekday list", () => {
    expect(isScheduledOn(MWF, "2026-09-09")).toBe(true)   // Wed
    expect(isScheduledOn(MWF, "2026-09-10")).toBe(false)  // Thu
    expect(weekStart("2026-09-13")).toBe("2026-09-07")
  })

  it("stops asking once a weekly target is met by other days", () => {
    const done = new Set(["2026-09-07", "2026-09-08", "2026-09-09"])
    expect(isDueOn(THRICE, "2026-09-10", done)).toBe(false)
    expect(isDueOn(THRICE, "2026-09-09", done)).toBe(true) // today's own tick doesn't hide today
    expect(isDueOn(THRICE, "2026-09-14", done)).toBe(true) // next week starts fresh
  })
})

describe("habitStreak", () => {
  it("bridges off-days and skips for a weekday habit", () => {
    const done = new Set(["2026-09-02", "2026-09-04", "2026-09-07"]) // Wed, Fri, Mon
    const skips = new Set<string>()
    // Today Wed 9th not done yet: walk from Tue (off) → Mon ✓ → Sun/Sat off → Fri ✓ → Thu off → Wed ✓
    expect(habitStreak(MWF, done, skips, "2026-09-09")).toEqual({ streak: 3, unit: "days" })
    // A skipped due day holds the run without lengthening it
    const skipped = new Set(["2026-09-07"])
    const done2 = new Set(["2026-09-02", "2026-09-04"])
    expect(habitStreak(MWF, done2, skipped, "2026-09-09").streak).toBe(2)
    // A missed due day breaks it
    expect(habitStreak(MWF, done2, new Set(), "2026-09-09").streak).toBe(0)
    expect(habitStreak(DAILY, new Set(["2026-09-08", "2026-09-07"]), new Set(), "2026-09-09").streak).toBe(2)
  })

  it("counts weeks for a times-per-week habit and leaves the current week open", () => {
    const done = new Set([
      "2026-08-24", "2026-08-26", "2026-08-28",   // week of 24 Aug: 3
      "2026-08-31", "2026-09-02", "2026-09-04",   // week of 31 Aug: 3
      "2026-09-08",                               // this week: 1 so far
    ])
    expect(habitStreak(THRICE, done, new Set(), "2026-09-09")).toEqual({ streak: 2, unit: "weeks" })
    const met = new Set([...done, "2026-09-07", "2026-09-09"])
    expect(habitStreak(THRICE, met, new Set(), "2026-09-09").streak).toBe(3)
    // A short week two weeks back breaks the run
    const broken = new Set([...done].filter(d => d !== "2026-08-28"))
    expect(habitStreak(THRICE, broken, new Set(), "2026-09-09").streak).toBe(1)
  })
})

describe("scheduleLabel", () => {
  it("names the common shapes", () => {
    expect(scheduleLabel(DAILY)).toBeNull()
    expect(scheduleLabel({ scheduleDays: [1, 2, 3, 4, 5], timesPerWeek: null })).toBe("Weekdays")
    expect(scheduleLabel({ scheduleDays: [0, 6], timesPerWeek: null })).toBe("Weekends")
    expect(scheduleLabel(MWF)).toBe("Mon · Wed · Fri")
    expect(scheduleLabel(THRICE)).toBe("3× a week")
  })
})
