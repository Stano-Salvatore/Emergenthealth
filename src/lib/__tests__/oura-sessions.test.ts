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
