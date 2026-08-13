import { describe, it, expect } from "vitest"
import {
  activeOn, dosesForDay, dueByNow, adherenceOver, matchKey, sortedTimes,
  type ScheduleLike,
} from "@/lib/med-schedule"

const mk = (over: Partial<ScheduleLike> = {}): ScheduleLike => ({
  id: "s1", name: "Elicea 10 mg", times: ["08:00", "21:00"], daysOfWeek: [],
  active: true, ...over,
})

// 2026-08-10 is a Monday, 2026-08-15 a Saturday.
const MON = "2026-08-10"
const SAT = "2026-08-15"

describe("matchKey", () => {
  it("collapses dosage, casing and diacritics onto one substance", () => {
    expect(matchKey("Elicea 10 mg")).toBe(matchKey("elicea"))
    expect(matchKey("Horčík")).toBe(matchKey("Magnesium"))
  })
})

describe("activeOn", () => {
  it("respects weekday restrictions, date range and the active flag", () => {
    expect(activeOn(mk(), MON)).toBe(true)
    expect(activeOn(mk({ active: false }), MON)).toBe(false)
    expect(activeOn(mk({ daysOfWeek: [1, 2, 3, 4, 5] }), MON)).toBe(true)
    expect(activeOn(mk({ daysOfWeek: [1, 2, 3, 4, 5] }), SAT)).toBe(false)
    expect(activeOn(mk({ startDate: "2026-08-12" }), MON)).toBe(false)
    expect(activeOn(mk({ endDate: "2026-08-09" }), MON)).toBe(false)
  })

  it("is inactive with no usable times", () => {
    expect(activeOn(mk({ times: [] }), MON)).toBe(false)
    expect(activeOn(mk({ times: ["nonsense", "25:00"] }), MON)).toBe(false)
  })
})

describe("sortedTimes", () => {
  it("orders by clock and drops malformed entries", () => {
    expect(sortedTimes(mk({ times: ["21:00", "8:00", "oops"] }))).toEqual(["8:00", "21:00"])
  })
})

describe("dosesForDay", () => {
  it("marks a late-taken morning dose as taken, not the evening one", () => {
    // 11:00, one dose logged: the morning pill happened late — it did happen.
    const doses = dosesForDay(mk(), 1, 11 * 60)
    expect(doses.map(d => d.status)).toEqual(["taken", "upcoming"])
  })

  it("only calls a dose missed once the grace period has passed", () => {
    expect(dosesForDay(mk(), 0, 9 * 60)[0].status).toBe("upcoming") // 60 min late
    expect(dosesForDay(mk(), 0, 10 * 60)[0].status).toBe("missed")  // 120 min late
  })

  it("shows a fully taken day as taken throughout", () => {
    expect(dosesForDay(mk(), 2, 23 * 60).every(d => d.status === "taken")).toBe(true)
  })
})

describe("dueByNow", () => {
  it("counts the times that have already come round", () => {
    const s = mk()
    expect(dueByNow(s, 7 * 60)).toBe(0)
    expect(dueByNow(s, 8 * 60)).toBe(1)
    expect(dueByNow(s, 22 * 60)).toBe(2)
    expect(dueByNow(s, 8 * 60 + 30, 60)).toBe(0) // not yet, with an hour of grace
  })
})

describe("adherenceOver", () => {
  const days = ["2026-08-10", "2026-08-11", "2026-08-12"]

  it("scores against what the schedule actually asked for", () => {
    const doses = [
      { day: "2026-08-10", name: "Elicea 10 mg" },
      { day: "2026-08-10", name: "elicea" },     // both doses, logged differently
      { day: "2026-08-11", name: "Elicea" },     // only one
      // 12th: nothing
    ]
    const [a] = adherenceOver([mk()], doses, days)
    expect(a.expected).toBe(6)
    expect(a.taken).toBe(3)
    expect(a.pct).toBe(50)
    expect(a.missedDays).toEqual(["2026-08-11", "2026-08-12"])
  })

  it("doesn't let extra doses inflate the score above the plan", () => {
    const doses = Array.from({ length: 5 }, () => ({ day: "2026-08-10", name: "Elicea" }))
    const [a] = adherenceOver([mk()], doses, ["2026-08-10"])
    expect(a.taken).toBe(2)
    expect(a.pct).toBe(100)
  })

  it("ignores days the schedule doesn't run on", () => {
    const weekdaysOnly = mk({ daysOfWeek: [1, 2, 3, 4, 5], times: ["08:00"] })
    const [a] = adherenceOver([weekdaysOnly], [], ["2026-08-15", "2026-08-16"]) // Sat, Sun
    expect(a.expected).toBe(0)
    expect(a.pct).toBeNull()
  })

  it("keeps a different medication's doses out of the count", () => {
    const doses = [{ day: "2026-08-10", name: "Frontin 0,5 mg" }]
    const [a] = adherenceOver([mk()], doses, ["2026-08-10"])
    expect(a.taken).toBe(0)
  })
})
