import { describe, it, expect } from "vitest"
import { addDaysISO } from "@/lib/local-date"
import {
  periodsFrom, cycleStats, cycleToday, ovulationFromTemps, phaseAverages, parseCycleSettings, dayMarks,
  DEFAULT_CYCLE_SETTINGS, type CycleDayLog, type CycleSettings, type Flow,
} from "@/lib/cycle"

const S: CycleSettings = { ...DEFAULT_CYCLE_SETTINGS, enabled: true }

/** n bleeding days from start, heaviest on day 2 the way most periods run. */
function period(start: string, n = 5, flow: Flow = "medium"): CycleDayLog[] {
  return Array.from({ length: n }, (_, i) => ({ day: addDaysISO(start, i), flow: i === 1 ? "heavy" : flow }))
}
const log = (day: string, flow: Flow | null, extra: Partial<CycleDayLog> = {}): CycleDayLog => ({ day, flow, ...extra })

// Four logged periods: 29, 28 and 30 days apart.
const HISTORY = [
  ...period("2026-07-01"),
  ...period("2026-07-30"),
  ...period("2026-08-27"),
  ...period("2026-09-26"),
]

describe("periodsFrom", () => {
  it("a run of bleeding days is one period, starting on the first real flow", () => {
    const { periods } = periodsFrom([log("2026-09-25", "spotting"), ...period("2026-09-26", 5)])
    expect(periods).toEqual([{ start: "2026-09-26", end: "2026-09-30", days: 5 }])
  })

  it("an unlogged day or two in the middle does not split it", () => {
    const logs = [log("2026-09-26", "medium"), log("2026-09-27", "heavy"), log("2026-09-29", "light")]
    expect(periodsFrom(logs).periods).toEqual([{ start: "2026-09-26", end: "2026-09-29", days: 4 }])
  })

  it("spotting on its own never starts a period", () => {
    expect(periodsFrom([log("2026-09-10", "spotting"), log("2026-09-11", "spotting")]).periods).toEqual([])
  })

  it("bleeding a week after a period started is between-period bleeding, not a new cycle", () => {
    const { periods, between } = periodsFrom([...period("2026-09-01", 5), log("2026-09-12", "light")])
    expect(periods.map(p => p.start)).toEqual(["2026-09-01"])
    expect(between).toEqual(["2026-09-12"])
  })
})

describe("cycleStats", () => {
  it("learns the cycle from the logged periods: median, range, period length", () => {
    const st = cycleStats(periodsFrom(HISTORY).periods, S)
    expect(st.cycleLength).toBe(29)
    expect(st.basis).toBe("personal")
    expect(st.cycles).toBe(3)
    expect(st.range).toEqual([28, 30])
    expect(st.periodLength).toBe(5)
  })

  it("a months-long gap is a gap in logging, not a 90-day cycle", () => {
    const st = cycleStats(periodsFrom([...period("2026-04-01"), ...HISTORY]).periods, S)
    expect(st.cycleLength).toBe(29)
    expect(st.lengths).not.toContain(91)
  })

  it("with too little history it says so and uses the length entered, else 28", () => {
    const one = periodsFrom(period("2026-09-26")).periods
    expect(cycleStats(one, { ...S, cycleLength: 31 })).toMatchObject({ cycleLength: 31, basis: "entered" })
    expect(cycleStats(one, S)).toMatchObject({ cycleLength: 28, basis: "default" })
  })

  it("notes cycles that vary a lot, as a plain fact", () => {
    const irregular = [...period("2026-05-01"), ...period("2026-05-24"), ...period("2026-07-01"), ...period("2026-07-25")]
    expect(cycleStats(periodsFrom(irregular).periods, S).variesBy).toBe(15)
  })
})

describe("cycleToday", () => {
  it("day 2 of a period", () => {
    const t = cycleToday("2026-09-27", HISTORY.filter(l => l.day <= "2026-09-27"), S)
    expect(t).toMatchObject({ phase: "menstrual", cycleDay: 2, periodDay: 2, periodOngoing: true, currentStart: "2026-09-26" })
  })

  it("an unlogged day 3 is still the period while it is within the usual length", () => {
    const logs = [...period("2026-07-01"), ...period("2026-07-30"), ...period("2026-08-27"), ...period("2026-09-26", 2)]
    expect(cycleToday("2026-09-28", logs, S)).toMatchObject({ phase: "menstrual", periodDay: 3, periodOngoing: true })
  })

  it("but a day logged with no flow ends it", () => {
    const logs = [...HISTORY.filter(l => l.day < "2026-09-28"), log("2026-09-28", "none")]
    expect(cycleToday("2026-09-29", logs, S)).toMatchObject({ phase: "follicular", periodOngoing: false })
  })

  it("predicts the next period and ovulation from the logged cycles", () => {
    const t = cycleToday("2026-10-01", HISTORY, S)
    expect(t.nextStart).toBe("2026-10-25") // 26 Sep + 29
    expect(t.daysUntilNext).toBe(24)
    expect(t.ovulation).toBe("2026-10-10") // 14 luteal days before 25 Oct
    expect(t.ovulationConfirmed).toBe(false)
    expect(t.fertile).toEqual(["2026-10-05", "2026-10-11"])
    expect(t.phase).toBe("follicular")
  })

  it("a 28-day cycle puts ovulation on day 14, the textbook way", () => {
    const t = cycleToday("2026-10-01", [], { ...S, lastStart: "2026-10-01", cycleLength: 28 })
    expect(t.ovulation).toBe("2026-10-14")
  })

  it("names the ovulation phase around the estimate, and the last days as premenstrual", () => {
    expect(cycleToday("2026-10-10", HISTORY, S).phase).toBe("ovulation")
    expect(cycleToday("2026-10-13", HISTORY, S).phase).toBe("luteal")
    const late = cycleToday("2026-10-22", HISTORY, S)
    expect(late).toMatchObject({ phase: "luteal", premenstrual: true, daysUntilNext: 3 })
  })

  it("a heads-up two days out", () => {
    expect(cycleToday("2026-10-23", HISTORY, S).daysUntilNext).toBe(2)
  })

  it("says how late, without guessing why", () => {
    const t = cycleToday("2026-10-29", HISTORY, S)
    expect(t.lateBy).toBe(4)
    expect(t.phase).toBe("luteal")
  })

  it("nothing logged and no start entered: no phase, no prediction — absent is not day 1", () => {
    expect(cycleToday("2026-10-01", [], S)).toMatchObject({ cycleDay: null, phase: null, nextStart: null })
  })

  it("an entered start stands in until a period is logged", () => {
    const t = cycleToday("2026-10-01", [], { ...S, lastStart: "2026-09-20", cycleLength: 30 })
    expect(t).toMatchObject({ cycleDay: 12, currentStart: "2026-09-20", nextStart: "2026-10-20" })
  })

  it("on the combined pill there is no ovulation to predict — the pack decides", () => {
    const pill: CycleSettings = { ...S, contraception: "combined_pill", pack: { kind: "21_7", start: "2026-09-10" } }
    const t = cycleToday("2026-10-01", HISTORY, pill)
    expect(t.mode).toBe("pack")
    expect(t.phase).toBeNull()
    expect(t.ovulation).toBeNull()
    expect(t.pack).toEqual({ day: 22, length: 28, active: false, breakStartsIn: null, nextBreak: "2026-10-29" })
  })

  it("a 24/4 pack's break starts on day 25", () => {
    const pill: CycleSettings = { ...S, contraception: "combined_pill", pack: { kind: "24_4", start: "2026-09-10" } }
    expect(cycleToday("2026-09-20", [], pill).pack).toMatchObject({ day: 11, active: true, breakStartsIn: 14 })
  })
})

describe("ovulationFromTemps", () => {
  const temps = (start: string, values: (number | null)[]) =>
    values.flatMap((v, i) => v == null ? [] : [{ date: addDaysISO(start, i), value: v }])
  const low = [0.0, -0.05, 0.05, 0.0, -0.02, 0.03, 0.0, -0.04, 0.02, 0.01, -0.03, 0.0, 0.04, -0.01, 0.0]

  it("a sustained rise after day 15 puts ovulation on the day before it", () => {
    const t = temps("2026-09-26", [...low, 0.35, 0.4, 0.38, 0.42, 0.4])
    expect(ovulationFromTemps(t, "2026-09-26", "2026-10-20")).toBe("2026-10-10")
  })

  it("one warm night is not a shift", () => {
    const t = temps("2026-09-26", [...low, 0.4, 0.0, 0.02, -0.01])
    expect(ovulationFromTemps(t, "2026-09-26", "2026-10-20")).toBeNull()
  })

  it("a missing night inside the three breaks the run rather than being assumed", () => {
    const t = temps("2026-09-26", [...low, 0.35, null, 0.38, 0.42])
    expect(ovulationFromTemps(t, "2026-09-26", "2026-10-20")).toBeNull()
  })

  it("a confirmed shift replaces the estimate in today's view", () => {
    const t = temps("2026-09-26", [...low, 0.35, 0.4, 0.38])
    const today = cycleToday("2026-10-14", HISTORY, S, t)
    expect(today).toMatchObject({ ovulation: "2026-10-10", ovulationConfirmed: true, phase: "luteal" })
  })
})

describe("dayMarks", () => {
  it("marks logged bleeding, the predicted period, the fertile window and ovulation", () => {
    const t = cycleToday("2026-10-01", HISTORY, S)
    const marks = dayMarks(["2026-09-27", "2026-10-10", "2026-10-07", "2026-10-25", "2026-10-02"], HISTORY, t, S)
    expect(marks["2026-09-27"]).toBe("period")
    expect(marks["2026-10-10"]).toBe("ovulation")
    expect(marks["2026-10-07"]).toBe("fertile")
    expect(marks["2026-10-25"]).toBe("predicted")
    expect(marks["2026-10-02"]).toBeUndefined()
  })
})

describe("phaseAverages", () => {
  it("averages each metric by phase over complete cycles, and only says so with enough days", () => {
    const hrv: { date: string; value: number }[] = []
    // HRV 60 before ovulation, 50 after, across the three complete cycles.
    const starts = ["2026-07-01", "2026-07-30", "2026-08-27", "2026-09-26"]
    for (let c = 0; c < 3; c++) {
      const len = (Date.parse(starts[c + 1]) - Date.parse(starts[c])) / 86400000
      for (let i = 0; i < len; i++) hrv.push({ date: addDaysISO(starts[c], i), value: i < len - 14 ? 60 : 50 })
    }
    const avg = phaseAverages(periodsFrom(HISTORY).periods, { hrv }, S)
    expect(avg.cycles).toBe(3)
    expect(avg.byPhase.follicular.hrv?.mean).toBe(60)
    expect(avg.byPhase.luteal.hrv?.mean).toBe(50)
  })

  it("three cycles logged but readings from only one of them is still one cycle of data", () => {
    const hrv = Array.from({ length: 30 }, (_, i) => ({ date: addDaysISO("2026-08-27", i), value: 55 }))
    const avg = phaseAverages(periodsFrom(HISTORY).periods, { hrv }, S)
    expect(avg.cycles).toBe(1)
    expect(avg.byPhase.luteal.hrv).toBeUndefined()
  })

  it("one cycle is not a pattern", () => {
    const hrv = Array.from({ length: 30 }, (_, i) => ({ date: addDaysISO("2026-08-27", i), value: 55 }))
    const avg = phaseAverages(periodsFrom([...period("2026-08-27"), ...period("2026-09-26")]).periods, { hrv }, S)
    expect(avg.cycles).toBe(1)
    expect(avg.byPhase.luteal.hrv).toBeUndefined()
  })
})

describe("parseCycleSettings", () => {
  it("is off and empty by default and survives junk", () => {
    expect(parseCycleSettings(null)).toEqual(DEFAULT_CYCLE_SETTINGS)
    expect(parseCycleSettings("{not json")).toEqual(DEFAULT_CYCLE_SETTINGS)
  })

  it("keeps sane values and drops the rest", () => {
    const s = parseCycleSettings(JSON.stringify({
      enabled: true, cycleLength: 300, periodLength: 5, contraception: "magic",
      pack: { kind: "21_7", start: "2026-09-10" }, lastStart: "nope", headsUp: true,
    }))
    expect(s).toMatchObject({ enabled: true, cycleLength: null, periodLength: 5, contraception: "none", lastStart: null, headsUp: true })
    expect(s.pack).toEqual({ kind: "21_7", start: "2026-09-10" })
  })
})
