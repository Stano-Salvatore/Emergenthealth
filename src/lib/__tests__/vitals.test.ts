import { describe, it, expect } from "vitest"
import { plausibleBreathRate, plausibleHeartRate, plausibleHrv, plausibleSpo2 } from "@/lib/vitals"

// Two days in this database hold an SpO₂ of 0%.
//
// Every guard between the sensor and the row was a `!= null` check, and 0
// passes all of them. That is the same "absent is not zero" mistake this
// codebase names in a dozen comments — except a zero that has already been
// invented upstream reads as a measurement, and nothing downstream can tell
// the difference. It drags averages, flattens charts, and is precisely the
// shape of reading the anomaly watch exists to shout about.
//
// The bounds are deliberately generous. Rejecting a real but unusual reading
// is its own kind of wrong, so these tests pin both ends: the impossible is
// refused, and the merely remarkable is kept.

describe("plausibleSpo2", () => {
  it("refuses the zero that was actually stored", () => {
    expect(plausibleSpo2(0)).toBeNull()
  })

  it("keeps a real reading, including a poor one", () => {
    expect(plausibleSpo2(97.171)).toBe(97.171)
    expect(plausibleSpo2(88)).toBe(88)   // low, but a night worth seeing
  })

  it("refuses what no oximeter could mean", () => {
    expect(plausibleSpo2(101)).toBeNull()
    expect(plausibleSpo2(-3)).toBeNull()
    expect(plausibleSpo2(NaN)).toBeNull()
  })

  it("passes absence through unchanged", () => {
    expect(plausibleSpo2(null)).toBeNull()
    expect(plausibleSpo2(undefined)).toBeNull()
  })
})

describe("plausibleHeartRate", () => {
  it("refuses a stopped heart", () => {
    expect(plausibleHeartRate(0)).toBeNull()
  })

  it("keeps an endurance athlete's resting rate", () => {
    // The floor is 25 on purpose: people genuinely sleep at 28bpm, and
    // throwing away a real reading would be its own kind of wrong.
    expect(plausibleHeartRate(28)).toBe(28)
    expect(plausibleHeartRate(52.125)).toBe(52.125)
  })

  it("refuses the impossible high end", () => {
    expect(plausibleHeartRate(260)).toBeNull()
  })
})

describe("plausibleHrv", () => {
  it("refuses zero, which means the sensor had nothing", () => {
    expect(plausibleHrv(0)).toBeNull()
  })

  it("keeps a real spread, high and low", () => {
    expect(plausibleHrv(113)).toBe(113)
    expect(plausibleHrv(9)).toBe(9)
  })
})

describe("plausibleBreathRate", () => {
  it("refuses zero and keeps a real rate", () => {
    expect(plausibleBreathRate(0)).toBeNull()
    expect(plausibleBreathRate(15.25)).toBe(15.25)
  })
})
