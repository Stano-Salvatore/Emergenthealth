import { describe, it, expect } from "vitest"
import { normalizeSchedule, isScheduledOn, isDueOn, habitStreak, scheduleLabel, weekStart, weekTally } from "@/lib/habit-schedule"

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

describe("weekTally — the Weekly Review's done/due", () => {
  // The Week page divided completions by the number of ring rows so far, not
  // by the days the habit was due. On a Wednesday morning before the sync,
  // with rows for Mon and Tue only, a daily habit done Mon–Wed read "3/2d ·
  // 150%", and a Mon/Wed/Fri gym habit done 3 of 3 read 43% in red — which the
  // Sunday prompt then handed Emergy as "Gym: 3/7 days", a slip.
  const none = new Set<string>()

  it("never goes over 100%: today counts once done, and never before", () => {
    const done = new Set(["2026-09-07", "2026-09-08", "2026-09-09"])
    expect(weekTally(DAILY, done, none, "2026-09-07", "2026-09-09")).toEqual({ done: 3, due: 3 })
    // Wednesday not ticked yet: the day is still in progress, not a miss.
    const twoDone = new Set(["2026-09-07", "2026-09-08"])
    expect(weekTally(DAILY, twoDone, none, "2026-09-07", "2026-09-09")).toEqual({ done: 2, due: 2 })
  })

  it("measures a weekday habit against its own days, not seven", () => {
    // Sunday the 13th: Mon, Wed, Fri all done — a perfect week.
    const done = new Set(["2026-09-07", "2026-09-09", "2026-09-11"])
    expect(weekTally(MWF, done, none, "2026-09-07", "2026-09-13")).toEqual({ done: 3, due: 3 })
    // Friday missed is a miss.
    const two = new Set(["2026-09-07", "2026-09-09"])
    expect(weekTally(MWF, two, none, "2026-09-07", "2026-09-13")).toEqual({ done: 2, due: 3 })
  })

  it("a skipped day is settled — neither done nor due", () => {
    const done = new Set(["2026-09-07"])
    const skipped = new Set(["2026-09-09"])
    expect(weekTally(MWF, done, skipped, "2026-09-07", "2026-09-10")).toEqual({ done: 1, due: 1 })
  })

  it("a weekly-target habit is measured against its target once the week is settled", () => {
    const done = new Set(["2026-09-07", "2026-09-09", "2026-09-10", "2026-09-11"])
    expect(weekTally(THRICE, done, none, "2026-09-07", "2026-09-13")).toEqual({ done: 3, due: 3 })
    // Saturday with one done: the two still owed fit in Saturday and Sunday.
    expect(weekTally(THRICE, new Set(["2026-09-08"]), none, "2026-09-07", "2026-09-12")).toEqual({ done: 1, due: 0 })
    // Sunday with one done: two short and one day left — missed.
    expect(weekTally(THRICE, new Set(["2026-09-08"]), none, "2026-09-07", "2026-09-13")).toEqual({ done: 1, due: 3 })
  })

  it("a weekly-target habit still within reach is not a 0% on Monday", () => {
    // 1 of 3 on a Wednesday is on track; scoring it 33% painted every weekly
    // habit red at the start of each week and dragged the average down.
    expect(weekTally(THRICE, new Set(["2026-09-08"]), none, "2026-09-07", "2026-09-09")).toEqual({ done: 1, due: 0 })
    expect(weekTally(THRICE, none, none, "2026-09-07", "2026-09-07")).toEqual({ done: 0, due: 0 })
  })

  it("a weekly-target week with a skip, a vacation day, or a mid-week start is never failed", () => {
    const one = new Set(["2026-09-08"])
    expect(weekTally(THRICE, one, new Set(["2026-09-10"]), "2026-09-07", "2026-09-13")).toEqual({ done: 1, due: 0 })
    const away = (d: string) => d >= "2026-09-10" && d <= "2026-09-12"
    expect(weekTally(THRICE, one, none, "2026-09-07", "2026-09-13", null, away)).toEqual({ done: 1, due: 0 })
    expect(weekTally(THRICE, none, none, "2026-09-07", "2026-09-13", "2026-09-12")).toEqual({ done: 0, due: 0 })
  })

  it("a vacation day is not a missed day", () => {
    const done = new Set(["2026-09-07", "2026-09-08"])
    const away = (d: string) => d >= "2026-09-09" && d <= "2026-09-11"
    expect(weekTally(DAILY, done, none, "2026-09-07", "2026-09-12", null, away)).toEqual({ done: 2, due: 2 })
  })

  it("a habit created mid-week isn't charged for the days before it existed", () => {
    const done = new Set(["2026-09-10"])
    expect(weekTally(DAILY, done, none, "2026-09-07", "2026-09-11", "2026-09-10")).toEqual({ done: 1, due: 1 })
  })

  it("nothing asked yet is nothing, not zero percent", () => {
    // A Mon/Wed/Fri habit on a Tuesday morning after a Monday skip.
    expect(weekTally(MWF, none, new Set(["2026-09-07"]), "2026-09-07", "2026-09-08")).toEqual({ done: 0, due: 0 })
  })
})
