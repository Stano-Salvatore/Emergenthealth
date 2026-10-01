import { describe, it, expect } from "vitest"
import {
  correctionProblem, describeBp, describeFood, describeMetricLog, describeSymptom,
  formatBpLog, formatFoodLog, formatMetricLog, formatSymptomLog, isLogKind,
  matchMetrics, resolveLogRange, scaleFoodMacros, MAX_RANGE_DAYS,
} from "@/lib/log-readback"

// Emergy could write a meal, a blood pressure reading or a tracker value and
// then never see it again: "what was my blood pressure last week?" had no tool
// behind it, so he said he couldn't see it or guessed. These are the pure
// halves of the read-back and the fix-up — the database stays in claude.ts.

const TZ = "Europe/Bratislava"
// 29 Sep 2026 00:30 in Bratislava is still 28 Sep in UTC.
const JUST_AFTER_MIDNIGHT = new Date("2026-09-28T22:30:00Z")

describe("the range asked about", () => {
  it("defaults to the last seven local days", () => {
    expect(resolveLogRange("2026-09-30")).toEqual({ from: "2026-09-24", to: "2026-09-30", clipped: false })
  })

  it("reads a bare `from` as from-then-until-today", () => {
    expect(resolveLogRange("2026-09-30", "2026-09-01")).toEqual({ from: "2026-09-01", to: "2026-09-30", clipped: false })
  })

  it("reads a single day when from and to agree", () => {
    expect(resolveLogRange("2026-09-30", "2026-09-29", "2026-09-29")).toEqual({ from: "2026-09-29", to: "2026-09-29", clipped: false })
  })

  it("puts a reversed range the right way round", () => {
    expect(resolveLogRange("2026-09-30", "2026-09-29", "2026-09-20")).toEqual({ from: "2026-09-20", to: "2026-09-29", clipped: false })
  })

  it("clips a very long range and says so", () => {
    const r = resolveLogRange("2026-09-30", "2025-01-01", "2026-09-30")
    expect(r).toMatchObject({ to: "2026-09-30", clipped: true })
    if ("error" in r) throw new Error("unexpected")
    const days = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1
    expect(days).toBe(MAX_RANGE_DAYS)
  })

  it("refuses a date it cannot read rather than guessing one", () => {
    expect(resolveLogRange("2026-09-30", "last tuesday")).toHaveProperty("error")
    expect(resolveLogRange("2026-09-30", undefined, "2026-13-40")).toHaveProperty("error")
  })
})

describe("food", () => {
  const rows = [
    { name: "Oats", calories: 350, mealType: "breakfast", loggedAt: new Date("2026-09-29T06:10:00Z") },
    { name: "Pizza", calories: 2400, mealType: "dinner", loggedAt: new Date("2026-09-29T17:30:00Z") },
    { name: "Late toast", calories: 200, mealType: "snack", loggedAt: JUST_AFTER_MIDNIGHT },
    { name: "Salad", calories: 420, mealType: "lunch", loggedAt: new Date("2026-09-27T10:00:00Z") },
  ]
  const out = formatFoodLog(rows, TZ, { from: "2026-09-27", to: "2026-09-29" })

  it("totals kcal per LOCAL day", () => {
    // The toast at 00:30 local belongs to the 29th with the oats and the pizza.
    expect(out).toMatch(/Tue 29 Sep — 2,950 kcal/)
    expect(out).toMatch(/Sun 27 Sep — 420 kcal/)
  })

  it("prints times in the user's clock", () => {
    expect(out).toContain("00:30 Late toast 200")
    expect(out).toContain("08:10 Oats 350")
  })

  it("never turns a day with nothing logged into a zero", () => {
    expect(out).not.toMatch(/28 Sep — 0 kcal/)
    expect(out).toMatch(/nothing logged on 1 of 3 days/i)
    // The average is over the days that have food, and says so.
    expect(out).toMatch(/average 1,685 kcal over the 2 days with food logged/i)
  })

  it("says plainly when there is nothing at all", () => {
    expect(formatFoodLog([], TZ, { from: "2026-09-27", to: "2026-09-29" })).toMatch(/No food logged/)
  })
})

describe("blood pressure", () => {
  const rows = [
    { systolic: 122, diastolic: 78, pulse: 70, notes: "after coffee", loggedAt: new Date("2026-09-29T06:10:00Z") },
    { systolic: 131, diastolic: 85, pulse: null, notes: null, loggedAt: new Date("2026-09-27T18:00:00Z") },
  ]
  const out = formatBpLog(rows, TZ, { from: "2026-09-24", to: "2026-09-30" })

  it("lists every reading, oldest first, in local time", () => {
    expect(out.indexOf("131/85")).toBeLessThan(out.indexOf("122/78"))
    expect(out).toContain("Sun 27 Sep 20:00 — 131/85")
    expect(out).toContain("Tue 29 Sep 08:10 — 122/78, pulse 70 (after coffee)")
  })

  it("averages the period, and the pulse only over readings that had one", () => {
    expect(out).toMatch(/Average 127\/82 over 2 readings/)
    expect(out).toMatch(/pulse 70 \(1 reading with pulse\)/)
  })

  it("has no average to give when there are no readings", () => {
    const empty = formatBpLog([], TZ, { from: "2026-09-24", to: "2026-09-30" })
    expect(empty).toMatch(/No blood pressure readings/)
    expect(empty).not.toMatch(/Average/)
  })
})

describe("custom metrics", () => {
  const metrics = [
    { id: "m1", name: "Stress", emoji: "😣", unit: "/10", type: "number" },
    { id: "m2", name: "Meditation", emoji: "🧘", unit: null, type: "boolean" },
    { id: "m3", name: "Back pain", emoji: "🦴", unit: null, type: "number" },
  ]
  const logs = [
    { metricId: "m1", date: "2026-09-29", value: 6, note: "deadline" },
    { metricId: "m1", date: "2026-09-27", value: 4, note: null },
    { metricId: "m2", date: "2026-09-27", value: 1, note: null },
    { metricId: "m2", date: "2026-09-28", value: 0, note: null },
  ]
  const out = formatMetricLog(metrics, logs, { from: "2026-09-24", to: "2026-09-30" })

  it("gives each value with its unit, oldest first", () => {
    expect(out).toContain("Sun 27 Sep 4/10 · Tue 29 Sep 6/10 (deadline)")
    expect(out).toMatch(/2 days logged, average 5\/10, range 4–6/)
  })

  it("reads a yes/no tracker as yes and no, not as an average", () => {
    expect(out).toContain("Sun 27 Sep yes · Mon 28 Sep no")
    expect(out).toMatch(/yes on 1 of 2 logged days/)
  })

  it("says a tracker had nothing logged instead of reporting zero", () => {
    expect(out).toMatch(/Back pain: nothing logged/)
  })

  it("matches a tracker by exact name first, then by part of it", () => {
    expect(matchMetrics(metrics, "stress").map(m => m.id)).toEqual(["m1"])
    expect(matchMetrics(metrics, "PAIN").map(m => m.id)).toEqual(["m3"])
    expect(matchMetrics(metrics, "")).toHaveLength(3)
    expect(matchMetrics(metrics, "sleep")).toEqual([])
  })
})

describe("symptoms", () => {
  const rows = [
    { name: "Headache", severity: 3, note: "after lunch", day: "2026-09-29" },
    { name: "Headache", severity: 4, note: null, day: "2026-09-27" },
    { name: "Sore throat", severity: 2, note: null, day: "2026-09-29" },
  ]
  const out = formatSymptomLog(rows, { from: "2026-09-24", to: "2026-09-30" })

  it("groups by the day the symptom was filed under", () => {
    expect(out).toContain("Tue 29 Sep — Headache 3/5 (after lunch) · Sore throat 2/5")
    expect(out).toContain("Sun 27 Sep — Headache 4/5")
  })

  it("summarises each symptom across the period", () => {
    expect(out).toMatch(/Headache on 2 days, worst 4\/5/)
  })
})

describe("describing one entry, for find/correct/delete", () => {
  it("food", () => {
    expect(describeFood({ name: "Pizza", calories: 2400, mealType: "dinner", loggedAt: new Date("2026-09-29T17:30:00Z") }, TZ))
      .toBe("Pizza ≈2,400 kcal (dinner) logged at Tue 29 Sep 19:30")
  })
  it("blood pressure", () => {
    expect(describeBp({ systolic: 122, diastolic: 78, pulse: null, notes: null, loggedAt: new Date("2026-09-29T06:10:00Z") }, TZ))
      .toBe("blood pressure 122/78 at Tue 29 Sep 08:10")
  })
  it("a tracker value", () => {
    expect(describeMetricLog({ name: "Meditation", emoji: "🧘", unit: null, type: "boolean" }, "2026-09-28", 0, null))
      .toBe("🧘 Meditation = no on Mon 28 Sep")
  })
  it("a symptom", () => {
    expect(describeSymptom({ name: "Headache", severity: 3, note: null, day: "2026-09-29" }))
      .toBe("Headache 3/5 on Tue 29 Sep")
  })
})

describe("a corrected calorie estimate", () => {
  it("scales the macros with it, since they were estimated for the old portion", () => {
    expect(scaleFoodMacros({ calories: 2400, proteinG: 90, carbsG: 300, fatG: 96, sugarG: null }, 800))
      .toEqual({ proteinG: 30, carbsG: 100, fatG: 32, sugarG: null })
  })
  it("leaves them alone when there is nothing to scale from", () => {
    expect(scaleFoodMacros({ calories: 0, proteinG: 5, carbsG: null, fatG: null, sugarG: null }, 300)).toEqual({})
  })
})

describe("what a correction may change", () => {
  const none = { at: false, amount: null, label: "", systolic: null, diastolic: null }

  it("lets a tracker go to zero — a 'no' is a real value", () => {
    expect(correctionProblem("metric", { ...none, amount: 0 })).toBeNull()
  })
  it("keeps doses and drinks positive", () => {
    expect(correctionProblem("dose", { ...none, amount: 0 })).toMatch(/positive/)
    expect(correctionProblem("intake", { ...none, amount: -5 })).toMatch(/positive/)
  })
  it("keeps a symptom on its 1–5 scale", () => {
    expect(correctionProblem("symptom", { ...none, amount: 7 })).toMatch(/1.*5/)
    expect(correctionProblem("symptom", { ...none, amount: 2 })).toBeNull()
  })
  it("takes a blood pressure as two numbers, not an amount", () => {
    expect(correctionProblem("bp", { ...none, amount: 120 })).toMatch(/systolic/)
    expect(correctionProblem("bp", { ...none, systolic: 400 })).toMatch(/systolic/)
    expect(correctionProblem("bp", { ...none, systolic: 124, diastolic: 80 })).toBeNull()
  })
  it("refuses a field that kind does not have instead of reporting a change that never happened", () => {
    expect(correctionProblem("bp", { ...none, label: "left arm" })).toMatch(/no label.*Nothing was changed/)
    expect(correctionProblem("dose", { ...none, at: true, systolic: 120 })).toMatch(/no systolic.*Nothing was changed/)
    expect(correctionProblem("moment", none)).toMatch(/Nothing to change/)
  })
  it("renames a meal", () => {
    expect(correctionProblem("food", { ...none, label: "Half a pizza" })).toBeNull()
  })
})

describe("kinds", () => {
  it("knows the four it reads and nothing else", () => {
    for (const k of ["food", "bp", "metric", "symptom"]) expect(isLogKind(k)).toBe(true)
    for (const k of ["dose", "user", "healthlog", ""]) expect(isLogKind(k)).toBe(false)
  })
})
