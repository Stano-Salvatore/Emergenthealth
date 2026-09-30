import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { backfillAt, atFromChoice, BACKFILL_MAX_DAYS } from "@/lib/backfill-time"

// A lunch remembered at 22:00 was stamped 22:00, and a coffee drunk at 08:00
// but logged at 14:00 put six extra hours of caffeine into body load and the
// bedtime cutoff. A forgotten beer from last night couldn't be added from the
// screen showing last night at all. Both logs now take a time.

const now = new Date("2026-09-30T20:00:00Z")

describe("backfillAt — what the server accepts", () => {
  it("treats no time as now", () => {
    expect(backfillAt(undefined, now)).toBeNull()
    expect(backfillAt(null, now)).toBeNull()
  })

  it("accepts a time earlier today or in the last week", () => {
    expect(backfillAt("2026-09-30T11:00:00Z", now)).toEqual({ at: new Date("2026-09-30T11:00:00Z") })
    expect(backfillAt("2026-09-24T19:00:00Z", now)).toEqual({ at: new Date("2026-09-24T19:00:00Z") })
  })

  it("refuses the future, anything older than a week, and nonsense", () => {
    expect(backfillAt("2026-09-30T21:00:00Z", now)).toHaveProperty("error")
    expect(backfillAt(`2026-09-${30 - BACKFILL_MAX_DAYS - 1}T19:00:00Z`, now)).toHaveProperty("error")
    expect(backfillAt("yesterday-ish", now)).toHaveProperty("error")
    expect(backfillAt(12345, now)).toHaveProperty("error")
  })

  it("allows a couple of minutes of clock drift between phone and server", () => {
    expect(backfillAt("2026-09-30T20:01:00Z", now)).toEqual({ at: new Date("2026-09-30T20:01:00Z") })
  })
})

describe("atFromChoice — what the screen sends", () => {
  it("sends nothing for 'now'", () => {
    expect(atFromChoice("2026-09-30", null)).toBeUndefined()
  })

  it("reads a picked time on the viewed day in the device's own clock", () => {
    // 13:05 on a Bratislava phone in September is 11:05 UTC.
    expect(atFromChoice("2026-09-29", "13:05", "Europe/Bratislava")).toBe("2026-09-29T11:05:00.000Z")
    expect(atFromChoice("2026-09-29", "13:05", "UTC")).toBe("2026-09-29T13:05:00.000Z")
  })
})

describe("the log routes and screens", () => {
  const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("the drink route files the drink and its caffeine at the chosen time", () => {
    const src = strip("src/app/api/intake/route.ts")
    expect(src).toMatch(/backfillAt\(/)
    expect(src).toMatch(/recordDrink\(\{[^}]*\bat\b/)
  })

  it("the meal route files the meal and its mirrored drinks at the chosen time, without today's location", () => {
    const src = strip("src/app/api/food/route.ts")
    expect(src).toMatch(/backfillAt\(/)
    expect(src).toMatch(/loggedAt:\s*when/)
    expect(src).toMatch(/recordDrink\(\{[\s\S]*?\bat: when/)
    expect(src).toMatch(/backfilled\s*\?\s*null/)
  })

  it("the Log tab's quick add is no longer today-only", () => {
    const src = strip("src/app/dashboard/intake/page.tsx")
    expect(src).not.toMatch(/\{isToday && \(\s*<div className="space-y-3">\s*\{QUICK_GROUPS/)
    expect(src).toMatch(/<WhenRow/)
  })
})
