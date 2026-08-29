import { describe, it, expect } from "vitest"
import { monthGrid, dayGlyph, addMonths, shortDate } from "../day-glyphs"
import { moodStatus } from "../score-color"

const bare = { mood: null, sleepScore: null, habitsDone: 0, habitsTotal: 0, symptoms: 0 }

describe("dayGlyph", () => {
  it("a day with nothing on it is not a bad day, it is an unknown one", () => {
    const g = dayGlyph({ date: "2026-04-24", ...bare })
    expect(g.recorded).toBe(false)
    expect(g.habitRatio).toBeNull()
    expect(g.summary).toBe("24 Apr — nothing recorded")
  })

  it("counts as recorded on any single trace of the day", () => {
    expect(dayGlyph({ date: "2026-04-24", ...bare, mood: 3 }).recorded).toBe(true)
    expect(dayGlyph({ date: "2026-04-24", ...bare, sleepScore: 70 }).recorded).toBe(true)
    expect(dayGlyph({ date: "2026-04-24", ...bare, habitsDone: 1 }).recorded).toBe(true)
    expect(dayGlyph({ date: "2026-04-24", ...bare, symptoms: 1 }).recorded).toBe(true)
  })

  it("habits that existed but went undone are 0/4, not unknown", () => {
    const g = dayGlyph({ date: "2026-04-24", ...bare, habitsTotal: 4 })
    expect(g.habitRatio).toBe(0)
    // …but four untouched habits alone are not evidence the day happened.
    expect(g.recorded).toBe(false)
    expect(g.summary).toBe("24 Apr · 0/4 habits")
  })

  it("says the day in one line", () => {
    const g = dayGlyph({
      date: "2026-04-24", mood: 4, sleepScore: 82,
      habitsDone: 3, habitsTotal: 4, symptoms: 1,
    })
    expect(g.summary).toBe("24 Apr · felt good · slept 82 · 3/4 habits · 1 symptom")
  })
})

describe("monthGrid", () => {
  it("pads to whole weeks from Monday", () => {
    // 1 April 2026 is a Wednesday, so Monday the 30th of March leads.
    const cells = monthGrid("2026-04")
    expect(cells.length % 7).toBe(0)
    expect(cells[0]).toEqual({ date: "2026-03-30", inMonth: false })
    expect(cells[2]).toEqual({ date: "2026-04-01", inMonth: true })
    expect(cells.filter(c => c.inMonth)).toHaveLength(30)
    expect(cells[cells.length - 1].inMonth).toBe(false)
  })

  it("starts flush when the first falls on a Monday", () => {
    // 1 June 2026 is a Monday.
    const cells = monthGrid("2026-06")
    expect(cells[0]).toEqual({ date: "2026-06-01", inMonth: true })
  })

  it("knows February, leap year and not", () => {
    expect(monthGrid("2026-02").filter(c => c.inMonth)).toHaveLength(28)
    expect(monthGrid("2028-02").filter(c => c.inMonth)).toHaveLength(29)
  })

  it("crosses the year at both ends", () => {
    const jan = monthGrid("2026-01")
    expect(jan[0].date.startsWith("2025-12")).toBe(true)
    const dec = monthGrid("2026-12")
    expect(dec[dec.length - 1].date.startsWith("2027-01")).toBe(true)
  })

  it("returns nothing for a month that is not one", () => {
    expect(monthGrid("2026-13")).toEqual([])
    expect(monthGrid("nonsense")).toEqual([])
  })
})

describe("addMonths", () => {
  it("moves forward and back across years", () => {
    expect(addMonths("2026-04", 1)).toBe("2026-05")
    expect(addMonths("2026-12", 1)).toBe("2027-01")
    expect(addMonths("2026-01", -1)).toBe("2025-12")
    expect(addMonths("2026-04", -12)).toBe("2025-04")
  })
})

describe("moodStatus", () => {
  it("collapses five steps onto the three the design system has", () => {
    expect([1, 2].map(moodStatus)).toEqual(["off", "off"])
    expect(moodStatus(3)).toBe("watch")
    expect([4, 5].map(moodStatus)).toEqual(["on", "on"])
  })
})

describe("shortDate", () => {
  it("drops the leading zero", () => {
    expect(shortDate("2026-04-01")).toBe("1 Apr")
  })
})

describe("days that have not happened", () => {
  it("are not days you failed", () => {
    const g = dayGlyph({
      date: "2026-08-30", mood: null, sleepScore: null,
      habitsDone: 0, habitsTotal: 4, symptoms: 0, future: true,
    })
    expect(g.recorded).toBe(false)
    expect(g.habitsTotal).toBe(0)
    expect(g.habitRatio).toBeNull()
    expect(g.summary).toBe("30 Aug — not yet")
  })

  it("and nothing leaks through from the query", () => {
    // Whatever the database says about a future date, the glyph reports none
    // of it: a habit ticked ahead of time is still not a day that happened.
    const g = dayGlyph({
      date: "2026-08-30", mood: 5, sleepScore: 90,
      habitsDone: 4, habitsTotal: 4, symptoms: 2, future: true,
    })
    expect([g.mood, g.sleepScore, g.symptoms, g.habitsDone]).toEqual([null, null, 0, 0])
  })
})
