import { describe, it, expect } from "vitest"
import { latestDayIn, daysBetween, dayLabel, agoShort, freshnessTone } from "@/lib/status-rows"

describe("status rows", () => {
  it("finds the latest day in any stored shape", () => {
    expect(latestDayIn('{"date":"2026-09-01","ids":["a"]}')).toBe("2026-09-01")
    expect(latestDayIn("2026-08-30")).toBe("2026-08-30")
    expect(latestDayIn('[{"at":"2026-08-29T10:00:00Z"},{"at":"2026-09-02T07:00:00Z"}]')).toBe("2026-09-02")
    expect(latestDayIn("nothing here")).toBeNull()
    expect(latestDayIn(null)).toBeNull()
  })
  it("labels days the way a person says them", () => {
    expect(dayLabel("2026-09-02", "2026-09-02")).toBe("today")
    expect(dayLabel("2026-09-01", "2026-09-02")).toBe("yesterday")
    expect(dayLabel("2026-08-30", "2026-09-02")).toBe("3 days ago")
    expect(dayLabel("2026-07-01", "2026-09-02")).toBe("on 2026-07-01")
    expect(dayLabel(null, "2026-09-02")).toBe("never")
    expect(daysBetween("2026-09-03", "2026-09-02")).toBe(0)
  })
  it("turns instants into short ago labels", () => {
    const now = Date.parse("2026-09-02T12:00:00Z")
    expect(agoShort("2026-09-02T11:59:30Z", now)).toBe("just now")
    expect(agoShort("2026-09-02T11:20:00Z", now)).toBe("40 min ago")
    expect(agoShort("2026-09-02T06:00:00Z", now)).toBe("6 h ago")
    expect(agoShort("2026-08-28T12:00:00Z", now)).toBe("5 days ago")
    expect(agoShort(null, now)).toBe("never")
  })
  it("colours freshness against a per-source allowance", () => {
    expect(freshnessTone("2026-09-02", "2026-09-02", 1)).toBe("ok")
    expect(freshnessTone("2026-08-31", "2026-09-02", 1)).toBe("warn")
    expect(freshnessTone(null, "2026-09-02", 1)).toBe("off")
  })
})
