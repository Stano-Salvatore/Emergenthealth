import { describe, it, expect } from "vitest"
import { mergeDayEvents, eventInstant } from "@/lib/day-events"

const ev = (id: string, title: string, start: string | null, isAllDay = false) => ({ id, title, start, isAllDay })

describe("mergeDayEvents", () => {
  // The Home card cuts this list to the first few, so an event landing after a
  // later one is not a cosmetic problem: it is an event that disappears.
  it("orders across sources, not within them", () => {
    const merged = mergeDayEvents(
      [ev("g1", "Zubár", "2026-09-24T15:00:00.000Z")],
      [ev("a1", "Coffee with Mia", "2026-09-18T09:30:00.000Z")],
    )
    expect(merged.map(e => e.title)).toEqual(["Coffee with Mia", "Zubár"])
  })

  it("puts an all-day entry at the head of its own day", () => {
    const merged = mergeDayEvents(
      [ev("g1", "Standup", "2026-09-18T09:30:00.000Z")],
      [ev("a1", "Tramp", "2026-09-18", true)],
    )
    expect(merged.map(e => e.title)).toEqual(["Tramp", "Standup"])
  })

  it("counts an app event mirrored into the phone's calendar once", () => {
    const merged = mergeDayEvents(
      [ev("dev1", "Slavo 50", "2026-09-20T18:00:00.000Z")],
      [ev("app1", "  slavo 50 ", "2026-09-20T18:00:30.000Z")],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe("dev1")
  })

  it("keeps an event with no start, and sorts it last rather than to 1970", () => {
    const merged = mergeDayEvents([ev("g1", "Unknown", null)], [ev("a1", "Later", "2026-09-18T09:00:00.000Z")])
    expect(merged.map(e => e.title)).toEqual(["Later", "Unknown"])
    expect(eventInstant(ev("x", "x", null))).toBe(Number.MAX_SAFE_INTEGER)
  })
})
