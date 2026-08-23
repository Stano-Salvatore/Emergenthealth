import { describe, it, expect } from "vitest"

// The bug: the correlation engine bucketed timestamps into days by slicing the
// ISO string, which is the UTC day. For anyone ahead of UTC, everything logged
// between local midnight and their offset was filed under the previous day.
//
// That is worse than losing the number. The engine joins sources by day and
// then tests whether one moves another — a drink at 00:30 landing on the day
// before is a real number attached to the wrong night, which is how a pattern
// nobody lived gets published as a finding.

const localDay = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(d)

const utcDay = (d: Date) => d.toISOString().slice(0, 10)

describe("bucketing a timestamp into a day", () => {
  const TZ = "Europe/Bratislava" // UTC+2 in August

  it("keeps a late-night log on the day it was lived", () => {
    // 00:30 local on the 23rd is 22:30 UTC on the 22nd.
    const drinkAt = new Date("2026-08-22T22:30:00.000Z")
    expect(utcDay(drinkAt)).toBe("2026-08-22")     // what the engine used to do
    expect(localDay(drinkAt, TZ)).toBe("2026-08-23") // the day it actually was
  })

  it("agrees with UTC during the middle of the day", () => {
    // Most logs are unaffected, which is exactly why this stayed hidden.
    const noon = new Date("2026-08-23T10:00:00.000Z")
    expect(utcDay(noon)).toBe("2026-08-23")
    expect(localDay(noon, TZ)).toBe("2026-08-23")
  })

  it("holds for a zone behind UTC, in the other direction", () => {
    // 21:00 local on the 22nd in New York is 01:00 UTC on the 23rd.
    const evening = new Date("2026-08-23T01:00:00.000Z")
    expect(utcDay(evening)).toBe("2026-08-23")
    expect(localDay(evening, "America/New_York")).toBe("2026-08-22")
  })

  it("is right on both sides of a DST change", () => {
    // Central Europe leaves DST on 2026-10-25; a fixed offset would drift.
    expect(localDay(new Date("2026-10-24T22:30:00.000Z"), TZ)).toBe("2026-10-25") // +2
    expect(localDay(new Date("2026-10-26T22:30:00.000Z"), TZ)).toBe("2026-10-26") // +1
  })
})
