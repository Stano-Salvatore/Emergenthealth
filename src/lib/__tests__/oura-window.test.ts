import { describe, it, expect } from "vitest"
import { withinDays } from "@/lib/oura"

// Oura's end_date is exclusive on every endpoint, so asking for a single day
// (start === end) is an empty window that returns nothing at all. Confirmed
// against the live API rather than inferred: a day holding 9,408 steps reported
// zero through get_daily_summary, which asks for exactly one day. The same
// shape hid a whole night of sleep behind an empty /sleep response.
//
// Every caller now asks for one day past what it wants and trims the extra back
// out. These pin the trimming; the widening is one shared helper so it cannot
// drift between the eight endpoints that need it.

describe("single-day requests", () => {
  const fetched = {
    "2026-08-20": { steps: 13518 },
    "2026-08-21": { steps: 9408 },
    "2026-08-22": { steps: 4000 }, // the padding day the widened window pulls in
  }

  it("returns the one day that was asked for", () => {
    // The case that used to come back empty and read as "no data that day".
    expect(withinDays(fetched, "2026-08-21", "2026-08-21")).toEqual({
      "2026-08-21": { steps: 9408 },
    })
  })

  it("drops the padding day rather than handing it back", () => {
    // The widening is an implementation detail; a caller asking for two days
    // must not silently receive three.
    expect(Object.keys(withinDays(fetched, "2026-08-20", "2026-08-21")).sort())
      .toEqual(["2026-08-20", "2026-08-21"])
  })

  it("keeps a range that legitimately spans the padding", () => {
    expect(Object.keys(withinDays(fetched, "2026-08-20", "2026-08-22")).length).toBe(3)
  })
})
