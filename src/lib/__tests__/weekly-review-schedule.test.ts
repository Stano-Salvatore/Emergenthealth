import { describe, it, expect } from "vitest"
import {
  DEFAULT_SCHEDULE, formatSchedule, isReviewWindow, parseSchedule,
} from "@/lib/weekly-review-schedule"

describe("parseSchedule", () => {
  it("keeps Sunday evening for anyone who never chose", () => {
    // The whole reason this is a preference and not the old User columns: a
    // column with a default can't tell "never set" from "set to that value",
    // and every existing account would have silently moved off Sunday.
    expect(parseSchedule(null)).toEqual(DEFAULT_SCHEDULE)
    expect(parseSchedule(undefined)).toEqual(DEFAULT_SCHEDULE)
    expect(parseSchedule("")).toEqual(DEFAULT_SCHEDULE)
  })

  it("reads a stored choice", () => {
    expect(parseSchedule("3:7")).toEqual({ day: 3, hour: 7 })
    expect(parseSchedule("6:23")).toEqual({ day: 6, hour: 23 })
    expect(parseSchedule("0:0")).toEqual({ day: 0, hour: 0 })
  })

  it("falls back rather than scheduling an impossible time", () => {
    for (const bad of ["7:9", "-1:9", "2:24", "2:-1", "garbage", "2", "2:", ":9", "1.5:9"]) {
      expect(parseSchedule(bad)).toEqual(DEFAULT_SCHEDULE)
    }
  })

  it("round-trips", () => {
    expect(parseSchedule(formatSchedule({ day: 4, hour: 21 }))).toEqual({ day: 4, hour: 21 })
  })
})

describe("isReviewWindow", () => {
  const s = { day: 0, hour: 18 }

  it("opens on the chosen hour and the one after it", () => {
    // Two hours wide: the cron ticks every ten minutes and one generation can
    // outlive a tick, so the second hour is the retry. The sent log stops it
    // from being a second email.
    expect(isReviewWindow(s, 0, 18)).toBe(true)
    expect(isReviewWindow(s, 0, 19)).toBe(true)
  })

  it("stays shut the rest of the week", () => {
    expect(isReviewWindow(s, 0, 17)).toBe(false)
    expect(isReviewWindow(s, 0, 20)).toBe(false)
    expect(isReviewWindow(s, 1, 18)).toBe(false)
    expect(isReviewWindow(s, 6, 18)).toBe(false)
  })

  it("does not wrap past midnight into the next day", () => {
    // 23:00 chosen: the retry hour would be 24, which is not an hour. Better to
    // lose the retry than to send Monday's review on Sunday's schedule.
    const late = { day: 2, hour: 23 }
    expect(isReviewWindow(late, 2, 23)).toBe(true)
    expect(isReviewWindow(late, 3, 0)).toBe(false)
    expect(isReviewWindow(late, 2, 0)).toBe(false)
  })
})
