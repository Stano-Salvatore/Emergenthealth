import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { hoursToBedtime } from "@/lib/caffeine"
import { alcoholAtHour } from "@/lib/body-load"

// Three beers at 20:00, 21:15 and 22:30. At 23:30 there is ≈35 g still on
// board, clearing towards 04:30 — and the alcohol card said a muted "Gone
// before 23:00". A fixed 23:00 that has just passed was read as *tomorrow's*
// 23:00, 23.5 hours away, by which time anything is gone. So on exactly the
// evening the card exists for, it went quiet, the "still with you at bedtime"
// banner disappeared, and the bedtime marker left the chart.
//
// It also ignored the bedtime the caffeine card right above it was using —
// the median from the ring, 00:30 for this user — so one screen quoted two
// different bedtimes.

// Built from local parts: the helper reads the device clock, and so does this.
const at = (h: number, m = 0) => new Date(2026, 8, 26, h, m, 0)

describe("hoursToBedtime", () => {
  it("counts to the user's own bedtime when there is one", () => {
    expect(hoursToBedtime(at(21, 0), 30)).toBeCloseTo(3.5, 6)   // 21:00 → 00:30
    expect(hoursToBedtime(at(21, 0), null)).toBeCloseTo(2, 6)   // 21:00 → 23:00
  })

  it("a bedtime that has just passed is tonight's, not tomorrow's", () => {
    expect(hoursToBedtime(at(23, 30))).toBe(0)
    expect(hoursToBedtime(at(1, 0), 30)).toBe(0)
  })

  it("is tomorrow's once the night is well over", () => {
    expect(hoursToBedtime(at(9, 0))).toBeCloseTo(14, 6)
    expect(hoursToBedtime(at(9, 0), 30)).toBeCloseTo(15.5, 6)
  })

  it("so the alcohol still on board is what the card reports", () => {
    expect(alcoholAtHour(34.7, 6.98, hoursToBedtime(at(23, 30)))).toBeCloseTo(34.7, 6)
  })
})

const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")

describe("one bedtime on the 'In my body' screen", () => {
  it("the tab uses the ring's bedtime the caffeine card uses, and prints it", () => {
    const tab = code("src/components/intake/BodyLoadTab.tsx")
    expect(tab).toMatch(/hoursToBedtime\(new Date\(\), caf\.data\.bedtimeMin\)/)
    // 23:00 survives only as the fallback for a ring without enough nights.
    expect(tab).toMatch(/const bedLabel = caf\.data\.bedtime \?\? "23:00"/)
    expect(tab.match(/23:00/g)).toHaveLength(1)
  })

  it("the caffeine card uses the same rule rather than its own", () => {
    const page = code("src/app/dashboard/caffeine/page.tsx")
    expect(page).not.toMatch(/function hoursUntilClock/)
    expect(page).toMatch(/hoursToBedtime\(new Date\(\), bedtimeMin\)/)
  })
})
