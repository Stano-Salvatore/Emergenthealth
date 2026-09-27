import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { mergeDayEvents, eventInstant, eventKey, isUpcoming } from "@/lib/day-events"

const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

describe("one event, two spellings of its time", () => {
  // Google hands back "…T09:00:00+02:00"; the phone's calendar mirror of the
  // same standup is stored as "…T07:00:00.000Z". The merge compared the first
  // sixteen characters of each, so the two never matched: the standup was
  // listed twice in Up next and Today and got two dots on the mini-month.
  // Sorting the same text put a 10:00 phone dentist ("08:00Z") above the
  // 09:00 Google standup in "Your day".
  it("dedupes the same instant across offsets", () => {
    const merged = mergeDayEvents(
      [ev("g1", "Standup", "2026-09-26T09:00:00+02:00")],
      [ev("dev1", "Standup", "2026-09-26T07:00:00.000Z")],
    )
    expect(merged).toHaveLength(1)
    expect(eventKey(ev("a", "Standup", "2026-09-26T09:00:00+02:00")))
      .toBe(eventKey(ev("b", " standup", "2026-09-26T07:00:00.000Z")))
  })

  it("orders by the instant, not the text", () => {
    const merged = mergeDayEvents(
      [ev("g1", "Standup", "2026-09-26T09:00:00+02:00")],
      [ev("dev1", "Dentist", "2026-09-26T08:00:00.000Z")],
    )
    expect(merged.map(e => e.title)).toEqual(["Standup", "Dentist"])
  })

  it("keeps all-day entries keyed by their date", () => {
    expect(eventKey(ev("a", "Trip", "2026-09-26", true))).toBe(eventKey(ev("b", "Trip", "2026-09-26", true)))
    expect(eventKey(ev("a", "Trip", "2026-09-26", true))).not.toBe(eventKey(ev("b", "Trip", "2026-09-27", true)))
  })

  it("the Google/phone merge uses the same rule, not a copy", () => {
    const src = code("src/lib/google-calendar.ts")
    expect(src, "the old text key").not.toMatch(/slice\(0,\s*16\)/)
    expect(src, "sorting ISO text with mixed offsets").not.toMatch(/localeCompare/)
    expect(src).toMatch(/mergeDayEvents\(/)
  })

  it("the phone timeline doesn't re-sort by text", () => {
    expect(code("src/components/dashboard/MobileToday.tsx")).not.toMatch(/a\.start!\s*<\s*b\.start!/)
  })
})

describe("TodayStrip's next event", () => {
  // It took the first event of the day and printed characters 11–16 of its
  // start: a 14:00 phone event ("12:00Z") read 12:00, and at 21:00 the 09:00
  // standup was still "next".
  it("is the first one still ahead", () => {
    const now = Date.parse("2026-09-26T19:00:00Z")
    expect(isUpcoming({ start: "2026-09-26T09:00:00+02:00", end: "2026-09-26T09:30:00+02:00" }, now)).toBe(false)
    expect(isUpcoming({ start: "2026-09-26T20:00:00Z", end: "" }, now)).toBe(true)
    expect(isUpcoming({ start: "2026-09-26", end: "2026-09-27" }, now)).toBe(true)
  })

  it("and is printed in local time, not sliced from the text", () => {
    const src = code("src/components/dashboard/TodayStrip.tsx")
    expect(src).not.toMatch(/slice\(11,\s*16\)/)
    expect(src).not.toMatch(/calendar\[0\]/)
    expect(src).toMatch(/isUpcoming\(/)
  })
})

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
