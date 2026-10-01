import { describe, it, expect } from "vitest"
import { addDaysISO } from "@/lib/local-date"
import { cycleToday, DEFAULT_CYCLE_SETTINGS, type CycleDayLog, type CycleSettings } from "@/lib/cycle"
import { cycleHeadline, homeCycleNote, lutealNote } from "@/lib/cycle-text"
import { lintSentence, describeProblems } from "./insight-lint"

const S: CycleSettings = { ...DEFAULT_CYCLE_SETTINGS, enabled: true }
const period = (start: string, n = 5): CycleDayLog[] => Array.from({ length: n }, (_, i) => ({ day: addDaysISO(start, i), flow: "medium" as const }))
const HISTORY = [...period("2026-07-01"), ...period("2026-07-30"), ...period("2026-08-27"), ...period("2026-09-26")]
const at = (day: string, logs = HISTORY, s = S) => cycleToday(day, logs.filter(l => l.day <= day), s)

describe("cycleHeadline", () => {
  it("a period day says which day", () => {
    expect(cycleHeadline(at("2026-09-27"), S).title).toBe("Period · day 2")
  })

  it("the days before say how many", () => {
    expect(cycleHeadline(at("2026-10-23"), S).title).toBe("Period likely in 2 days")
    expect(cycleHeadline(at("2026-10-24"), S).title).toBe("Period likely tomorrow")
    expect(cycleHeadline(at("2026-10-25"), S).title).toBe("Period expected today")
  })

  it("late is a count of days, not a conclusion", () => {
    const h = cycleHeadline(at("2026-10-28"), S)
    expect(h.title).toBe("Period 3 days later than expected")
  })

  it("names the phase and the cycle day otherwise", () => {
    expect(cycleHeadline(at("2026-10-01"), S).title).toBe("Follicular · day 6")
    expect(cycleHeadline(at("2026-10-10"), S).title).toBe("Ovulation window · day 15")
    expect(cycleHeadline(at("2026-10-15"), S).title).toBe("Luteal · day 20")
    expect(cycleHeadline(at("2026-10-21"), S).title).toBe("Premenstrual days · day 26")
  })

  it("with nothing logged it asks for the first period instead of guessing", () => {
    expect(cycleHeadline(cycleToday("2026-10-01", [], S), S).title).toBe("Log a period to start")
  })

  it("on the pill it talks about the pack", () => {
    const pill: CycleSettings = { ...S, contraception: "combined_pill", pack: { kind: "21_7", start: "2026-09-10" } }
    expect(cycleHeadline(cycleToday("2026-09-20", [], pill), pill).title).toBe("Pill day 11 of 28")
    expect(cycleHeadline(cycleToday("2026-10-01", [], pill), pill).title).toBe("Break week · day 1")
  })

  it("every detail line reads as an observation", () => {
    for (const day of ["2026-09-27", "2026-10-01", "2026-10-10", "2026-10-15", "2026-10-21", "2026-10-23", "2026-10-28"]) {
      const h = cycleHeadline(at(day), S)
      for (const text of [h.title, h.detail].filter((x): x is string => !!x)) {
        const problems = lintSentence(text)
        expect(problems, describeProblems(day, text, problems)).toEqual([])
      }
    }
  })
})

describe("homeCycleNote", () => {
  it("shows on period days, with a line for that day", () => {
    const n = homeCycleNote(at("2026-09-27"), S)
    expect(n?.title).toBe("Period · day 2")
    expect(n?.tip).toBeTruthy()
  })

  it("shows two days out and on the day", () => {
    expect(homeCycleNote(at("2026-10-23"), S)?.title).toBe("Period likely in 2 days")
    expect(homeCycleNote(at("2026-10-25"), S)?.title).toBe("Period expected today")
  })

  it("stays off the home page on ordinary days", () => {
    expect(homeCycleNote(at("2026-10-01"), S)).toBeNull()
    expect(homeCycleNote(at("2026-10-15"), S)).toBeNull()
  })

  it("shows a late period, but not forever — after a fortnight it is a logging gap", () => {
    expect(homeCycleNote(at("2026-10-28"), S)?.title).toMatch(/later than expected/)
    expect(homeCycleNote(at("2026-11-20"), S)).toBeNull()
  })

  it("is nothing at all when tracking is off", () => {
    expect(homeCycleNote(at("2026-09-27"), { ...S, enabled: false })).toBeNull()
  })
})

describe("lutealNote", () => {
  it("says the luteal phase explains a warmer, faster-hearted night", () => {
    expect(lutealNote(at("2026-10-15"), ["skinTemp", "restingHR"])).toMatch(/luteal/i)
  })

  it("is silent outside the luteal phase, or when the signs are not the ones it moves", () => {
    expect(lutealNote(at("2026-10-01"), ["skinTemp"])).toBeNull()
    expect(lutealNote(at("2026-10-15"), ["spo2", "sleepLatency"])).toBeNull()
  })

  it("reads as an observation", () => {
    const n = lutealNote(at("2026-10-15"), ["hrv"])!
    expect(lintSentence(n)).toEqual([])
  })
})
