import { describe, it, expect } from "vitest"
import { isMeasuredNight } from "@/lib/sleep-quality"

// Every case below is a real record from the account this was found on.

describe("isMeasuredNight", () => {
  it("rejects the night the ring died — minutes long, no physiology at all", () => {
    // 2026-08-09: 570s of "sleep", efficiency 36, and null HRV, breathing rate
    // and resting HR. Stored as a real night, it is a 9-minute night.
    expect(isMeasuredNight({ totalSleepSeconds: 570, hrv: null, breathRate: null })).toBe(false)
    // 2026-06-04: 990s, same shape.
    expect(isMeasuredNight({ totalSleepSeconds: 990, hrv: null, breathRate: null })).toBe(false)
  })

  it("keeps a genuinely short night that was fully measured", () => {
    // 2026-05-30: 2.1h, HRV 54, breathing 16.25. A bad night is data, and
    // throwing it away to tidy the averages would be the same lie in reverse.
    expect(isMeasuredNight({ totalSleepSeconds: 7620, hrv: 54, breathRate: 16.25 })).toBe(true)
  })

  it("keeps a short night as long as either channel was gathering", () => {
    expect(isMeasuredNight({ totalSleepSeconds: 3600, hrv: 60, breathRate: null })).toBe(true)
    expect(isMeasuredNight({ totalSleepSeconds: 3600, hrv: null, breathRate: 14 })).toBe(true)
  })

  it("never rejects a full-length night, whatever else is missing", () => {
    // Physiology can drop out of a real night; length alone vouches for it.
    expect(isMeasuredNight({ totalSleepSeconds: 25200, hrv: null, breathRate: null })).toBe(true)
  })

  it("treats no session as absent, not as zero sleep", () => {
    expect(isMeasuredNight({ totalSleepSeconds: null, hrv: null, breathRate: null })).toBe(false)
  })
})
