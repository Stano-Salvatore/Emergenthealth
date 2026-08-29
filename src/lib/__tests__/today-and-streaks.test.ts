import { describe, it, expect } from "vitest"
import { todayLocalISO } from "../local-date"
import { currentDayStreak } from "../xp"

describe("todayLocalISO", () => {
  it("reads the device's own calendar, where toISOString would read UTC's", () => {
    // 00:30 on the 5th in a UTC+2 device is 22:30 on the 4th in UTC. Built
    // from local parts, so the assertion holds whatever the runner's zone is.
    const at = new Date(2026, 7, 5, 0, 30, 0)
    expect(todayLocalISO(at)).toBe("2026-08-05")
    expect(at.toISOString().slice(0, 10) === "2026-08-05").toBe(
      at.getTimezoneOffset() === 0,
    )
  })

  it("pads single-digit months and days", () => {
    expect(todayLocalISO(new Date(2026, 0, 9, 12, 0, 0))).toBe("2026-01-09")
  })
})

describe("currentDayStreak", () => {
  it("counts back from today", () => {
    expect(currentDayStreak(
      ["2026-08-27", "2026-08-28", "2026-08-29"], "2026-08-29",
    )).toBe(3)
  })

  it("still counts when today is not done yet but yesterday was", () => {
    expect(currentDayStreak(["2026-08-27", "2026-08-28"], "2026-08-29")).toBe(2)
  })

  it("is broken by a two-day gap", () => {
    expect(currentDayStreak(["2026-08-25", "2026-08-26"], "2026-08-29")).toBe(0)
  })

  it("depends on which day you call today — the whole reason it is a parameter", () => {
    const dates = ["2026-08-28"]
    // A user at UTC+2 at 00:30 on the 29th: their today is the 29th, and the
    // streak from the 28th still stands. Told the server's UTC day (the 28th),
    // it also stands — but on the 30th local it would wrongly still count.
    expect(currentDayStreak(dates, "2026-08-29")).toBe(1)
    expect(currentDayStreak(dates, "2026-08-30")).toBe(0)
  })

  it("crosses a month boundary", () => {
    expect(currentDayStreak(["2026-07-31", "2026-08-01"], "2026-08-01")).toBe(2)
  })
})
