import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { checkInModeFor, eveningDayOf, localDayOf, tomorrowOf, DAY_TURNS_AT_HOUR } from "@/lib/checkin-mode"

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
  it("keeps the evening one through the small hours — that day has not ended", () => {
    // This used to assert the opposite ("the small hours are morning, since
    // that day is beginning"), and a screenshot at 00:30 is what overturned
    // it: the tab opened on "How did you sleep?" for a night not yet slept.
    // /api/emergy had already decided that before 05:00 the day being lived
    // is yesterday's; the check-in tab now agrees, from the same constant.
    expect(checkInModeFor(0)).toBe("evening")
    expect(checkInModeFor(3)).toBe("evening")
    expect(checkInModeFor(DAY_TURNS_AT_HOUR)).toBe("morning")
  })
})

describe("eveningDayOf", () => {
  it("is the calendar day through the evening", () => {
    expect(eveningDayOf(new Date(2026, 8, 21, 22, 15))).toBe("2026-09-21")
  })
  it("is still yesterday at 00:30, and across a month end", () => {
    expect(eveningDayOf(new Date(2026, 8, 22, 0, 30))).toBe("2026-09-21")
    expect(eveningDayOf(new Date(2026, 9, 1, 3, 59))).toBe("2026-09-30")
  })
  it("turns over at the shared hour", () => {
    expect(eveningDayOf(new Date(2026, 8, 22, DAY_TURNS_AT_HOUR, 0))).toBe("2026-09-22")
  })
})

describe("one rule for when the day turns", () => {
  // Two surfaces answer "which day is this?" in the small hours: the avatar's
  // scores and the check-in tab. They agree only while they read one number.
  const strip = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  it("/api/emergy reads the constant rather than its own literal", () => {
    const route = strip("src/app/api/emergy/route.ts")
    expect(route).toMatch(/hourNow < DAY_TURNS_AT_HOUR/)
    expect(route, "the avatar route has grown its own small-hours literal back").not.toMatch(/hourNow < \d/)
  })
  it("the evening check-in files under the evening's day, not the calendar's", () => {
    const evening = strip("src/components/checkin/EveningCheckIn.tsx")
    expect(evening).toMatch(/const today = eveningDayOf\(\)/)
    expect(evening, "the evening check-in is back on localDayOf(), so at 00:30 it files under the new date")
      .not.toMatch(/localDayOf\(\)/)
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
