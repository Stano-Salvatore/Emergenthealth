import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { dateStr } from "@/lib/health-connect-service"

// Health Connect sync runs on the phone, so the day a record belongs to is the
// day the phone is showing. Slicing the ISO string gives the UTC day instead,
// which for anyone ahead of Greenwich moves the first hours of every morning
// onto the day before: steps walked home after midnight added to yesterday,
// and then read against the wrong night's sleep.
//
// The timezone is set here rather than assumed, because CI runs in UTC — where
// the bug is invisible and a test that does not set one passes on the broken
// code.

const ORIGINAL_TZ = process.env.TZ

describe("Health Connect days are the phone's days", () => {
  beforeAll(() => { process.env.TZ = "Europe/Bratislava" })
  afterAll(() => { process.env.TZ = ORIGINAL_TZ })

  it("files 00:30 local under today, not yesterday", () => {
    // 2026-07-15 00:30 in CEST is 2026-07-14 22:30 UTC.
    expect(dateStr(new Date("2026-07-14T22:30:00.000Z"))).toBe("2026-07-15")
  })

  it("files 23:30 local under today, not tomorrow", () => {
    expect(dateStr(new Date("2026-07-15T21:30:00.000Z"))).toBe("2026-07-15")
  })

  it("holds across the winter offset too", () => {
    // 2026-01-15 00:30 in CET is 2026-01-14 23:30 UTC.
    expect(dateStr(new Date("2026-01-14T23:30:00.000Z"))).toBe("2026-01-15")
  })
})
