import { describe, it, expect } from "vitest"
import { checkInModeFor, localDayOf, tomorrowOf } from "@/lib/checkin-mode"

describe("checkInModeFor", () => {
  it("opens on the morning check-in through the day", () => {
    expect(checkInModeFor(6)).toBe("morning")
    expect(checkInModeFor(12)).toBe("morning")
    expect(checkInModeFor(16)).toBe("morning")
  })
  it("switches to the evening one from 17:00", () => {
    expect(checkInModeFor(17)).toBe("evening")
    expect(checkInModeFor(22)).toBe("evening")
  })
  it("treats the small hours as morning, since that day is beginning", () => {
    expect(checkInModeFor(0)).toBe("morning")
    expect(checkInModeFor(3)).toBe("morning")
  })
})

describe("localDayOf / tomorrowOf", () => {
  it("formats the local day without a UTC round trip", () => {
    // 00:30 local on the 2nd is the 2nd, even where that is still the 1st in UTC.
    expect(localDayOf(new Date(2026, 8, 2, 0, 30))).toBe("2026-09-02")
  })
  it("rolls over a month end", () => {
    expect(tomorrowOf(new Date(2026, 8, 30, 21, 0))).toBe("2026-10-01")
  })
  it("rolls over a year end", () => {
    expect(tomorrowOf(new Date(2026, 11, 31, 23, 0))).toBe("2027-01-01")
  })
})
