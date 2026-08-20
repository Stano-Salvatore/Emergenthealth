import { describe, it, expect } from "vitest"
import { zonedDateTime } from "@/lib/local-date"

// The bug this exists to stop: a moment logged at 00:02 about the evening just
// gone was stamped now(), so it landed on the next day — while the journal
// entry from the same message correctly went to the evening's date. One story,
// two days.

describe("zonedDateTime", () => {
  it("reads a wall-clock time as the user's, not the server's", () => {
    // Bratislava is UTC+2 in August, so 23:40 local is 21:40 UTC.
    expect(zonedDateTime("Europe/Bratislava", "2026-08-20T23:40")?.toISOString())
      .toBe("2026-08-20T21:40:00.000Z")
  })

  it("keeps a backdated evening on its own side of midnight", () => {
    const when = zonedDateTime("Europe/Bratislava", "2026-08-20T23:40")!
    const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava" }).format(when)
    expect(localDay).toBe("2026-08-20")
  })

  it("puts a bare date at midday, so it cannot fall across a boundary", () => {
    // Midnight would be one offset away from the previous day in any zone
    // ahead of UTC — the exact failure this helper exists to avoid.
    const when = zonedDateTime("Europe/Bratislava", "2026-08-20")!
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava" }).format(when))
      .toBe("2026-08-20")
    expect(when.toISOString()).toBe("2026-08-20T10:00:00.000Z")
  })

  it("handles a zone behind UTC", () => {
    expect(zonedDateTime("America/New_York", "2026-08-20T23:40")?.toISOString())
      .toBe("2026-08-21T03:40:00.000Z") // EDT, UTC-4
  })

  it("is exact across a DST change", () => {
    // Central Europe leaves DST on 2026-10-25. The same wall-clock hour sits at
    // a different UTC instant either side, which the two-pass resolution gets
    // right and a single fixed offset would not.
    expect(zonedDateTime("Europe/Bratislava", "2026-10-24T12:00")?.toISOString())
      .toBe("2026-10-24T10:00:00.000Z") // CEST, +2
    expect(zonedDateTime("Europe/Bratislava", "2026-10-26T12:00")?.toISOString())
      .toBe("2026-10-26T11:00:00.000Z") // CET, +1
  })

  it("returns null rather than guessing", () => {
    for (const bad of ["", "yesterday", "2026-13-01", "2026-08-20T24:00",
                       "2026-08-20T12:60", "20-08-2026", "2026-08-20T12"]) {
      expect(zonedDateTime("Europe/Bratislava", bad)).toBeNull()
    }
  })
})
