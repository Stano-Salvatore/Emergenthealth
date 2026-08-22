import { describe, it, expect } from "vitest"
import { pickNightlySessions } from "@/lib/oura"

// The real pair from 2026-08-22: a 41-minute evening nap and a five-hour
// night, both filed by Oura under the same day. The app showed the nap.
const nap = { day: "2026-08-22", type: "late_nap", total_sleep_duration: 1440 }
const night = { day: "2026-08-22", type: "sleep", total_sleep_duration: 18240 }
const longNight = { day: "2026-08-22", type: "long_sleep", total_sleep_duration: 18240 }

describe("pickNightlySessions", () => {
  it("picks the night over a nap whichever order they arrive in", () => {
    // The bug: a longer session only won when the types matched, so late_nap
    // vs sleep was never compared and array order decided it.
    expect(pickNightlySessions([nap, night])["2026-08-22"]).toBe(night)
    expect(pickNightlySessions([night, nap])["2026-08-22"]).toBe(night)
  })

  it("prefers a long_sleep even when something else ran longer", () => {
    // Oura's own classification beats raw duration: a long "rest" period is
    // not a night, and it says so.
    const longRest = { day: "2026-08-22", type: "rest", total_sleep_duration: 30000 }
    expect(pickNightlySessions([longRest, longNight])["2026-08-22"]).toBe(longNight)
    expect(pickNightlySessions([longNight, longRest])["2026-08-22"]).toBe(longNight)
  })

  it("takes the longest when nothing is a long_sleep", () => {
    expect(pickNightlySessions([nap, night])["2026-08-22"]).toBe(night)
  })

  it("keeps days apart", () => {
    const other = { day: "2026-08-21", type: "long_sleep", total_sleep_duration: 25000 }
    const picked = pickNightlySessions([nap, night, other])
    expect(picked["2026-08-22"]).toBe(night)
    expect(picked["2026-08-21"]).toBe(other)
  })

  it("survives sessions with no duration or no day", () => {
    const noDur = { day: "2026-08-22", type: "sleep" }
    expect(pickNightlySessions([noDur, night])["2026-08-22"]).toBe(night)
    expect(pickNightlySessions([night, noDur])["2026-08-22"]).toBe(night)
    expect(Object.keys(pickNightlySessions([{ type: "sleep", total_sleep_duration: 1 }]))).toEqual([])
  })
})

import { withinDays } from "@/lib/oura"

// Oura's /sleep filters on when a session *started*, with an exclusive
// end_date — so asking for one day (start === end) is an empty window and
// returns nothing at all. getDailySummary called exactly that, which is why a
// daily snapshot never carried sleep. The fetch now pads a day either side and
// trims back, which also catches the night that begins the evening before.
describe("withinDays", () => {
  const byDay = {
    "2026-08-20": "pad-before",
    "2026-08-21": "wanted",
    "2026-08-22": "wanted",
    "2026-08-23": "pad-after",
  }

  it("keeps only the days that were asked for", () => {
    expect(withinDays(byDay, "2026-08-21", "2026-08-22")).toEqual({
      "2026-08-21": "wanted",
      "2026-08-22": "wanted",
    })
  })

  it("makes a single-day request return that day", () => {
    // The whole point: start === end used to yield nothing.
    expect(withinDays(byDay, "2026-08-21", "2026-08-21")).toEqual({ "2026-08-21": "wanted" })
  })

  it("is inclusive at both ends", () => {
    expect(Object.keys(withinDays(byDay, "2026-08-20", "2026-08-23")).sort())
      .toEqual(["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"])
  })

  it("returns nothing when the range misses everything", () => {
    expect(withinDays(byDay, "2026-09-01", "2026-09-02")).toEqual({})
  })
})
