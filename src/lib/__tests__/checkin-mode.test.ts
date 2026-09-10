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

describe("intentionQuestion", () => {
  it("quotes the intention and asks", async () => {
    const { intentionQuestion } = await import("@/lib/checkin-mode")
    expect(intentionQuestion("go for a run before work")).toBe('This morning you set out to "go for a run before work" — how did it go?')
  })
  it("trims a long intention on a word boundary so the push stays one line", async () => {
    const { intentionQuestion } = await import("@/lib/checkin-mode")
    const long = "finish the quarterly report, call the dentist, and finally sort out the boxes in the hallway before anyone visits"
    const q = intentionQuestion(long, 40)
    expect(q).toContain('call the…"')  // cut on a word, not mid-word
    expect(q.length).toBeLessThan(90)
  })
})
