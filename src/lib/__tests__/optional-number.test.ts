import { describe, it, expect } from "vitest"
import { optionalNumber } from "@/lib/optional-number"

describe("optionalNumber", () => {
  // The bug this exists to prevent: it shipped in the Timeline importer, where
  // `Number.isFinite(Number(p.altitudeM))` was true for null.
  it("keeps a missing reading missing rather than making it zero", () => {
    expect(optionalNumber(null)).toBeNull()
    expect(optionalNumber(undefined)).toBeNull()
  })

  it("does not turn a missing accuracy into a perfect fix", () => {
    expect(optionalNumber(null, Math.round)).not.toBe(0)
    expect(optionalNumber(null, Math.round)).toBeNull()
  })

  it("passes a real reading through, rounding when asked", () => {
    expect(optionalNumber(12.6, Math.round)).toBe(13)
    expect(optionalNumber(12.6)).toBe(12.6)
    expect(optionalNumber("41.5")).toBe(41.5)
  })

  // A genuine zero is a reading, not an absence — sea level and a stationary
  // phone both report it.
  it("keeps a real zero", () => {
    expect(optionalNumber(0)).toBe(0)
    expect(optionalNumber("0")).toBe(0)
  })

  it("drops anything that is not a number at all", () => {
    expect(optionalNumber("abc")).toBeNull()
    expect(optionalNumber(NaN)).toBeNull()
    expect(optionalNumber(Infinity)).toBeNull()
    expect(optionalNumber({})).toBeNull()
  })
})
