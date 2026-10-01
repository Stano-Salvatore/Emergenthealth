import { describe, it, expect } from "vitest"
import { addDaysISO } from "@/lib/local-date"
import { cycleToday, DEFAULT_CYCLE_SETTINGS, type CycleDayLog, type CycleSettings } from "@/lib/cycle"
import { headsUpDue, HEADS_UP_PUSH } from "@/lib/cycle-heads-up"

const S: CycleSettings = { ...DEFAULT_CYCLE_SETTINGS, enabled: true, headsUp: true }
const period = (start: string): CycleDayLog[] => Array.from({ length: 5 }, (_, i) => ({ day: addDaysISO(start, i), flow: "medium" as const }))
const HISTORY = [...period("2026-07-01"), ...period("2026-07-30"), ...period("2026-08-27"), ...period("2026-09-26")]
const at = (day: string, s = S) => cycleToday(day, HISTORY.filter(l => l.day <= day), s)
const NINE = 9 * 60

describe("headsUpDue", () => {
  it("two days before the predicted period, once", () => {
    const due = headsUpDue(at("2026-10-23"), S, null, NINE)
    expect(due?.key).toBe("period:2026-10-25")
    expect(due?.chat).toMatch(/likely in 2 days/)
    expect(headsUpDue(at("2026-10-24"), S, due!.key, NINE)).toBeNull()
  })

  it("not at night, and not on ordinary days", () => {
    expect(headsUpDue(at("2026-10-23"), S, null, 6 * 60)).toBeNull()
    expect(headsUpDue(at("2026-10-23"), S, null, 22 * 60)).toBeNull()
    expect(headsUpDue(at("2026-10-15"), S, null, NINE)).toBeNull()
  })

  it("only when switched on", () => {
    expect(headsUpDue(at("2026-10-23"), { ...S, headsUp: false }, null, NINE)).toBeNull()
  })

  it("on the pill, two days before the break", () => {
    const pill: CycleSettings = { ...S, contraception: "combined_pill", pack: { kind: "21_7", start: "2026-09-10" } }
    const due = headsUpDue(cycleToday("2026-09-29", [], pill), pill, null, NINE)
    expect(due?.key).toBe("break:2026-10-01")
  })

  it("the lock screen sees nothing private: the push itself names no period", () => {
    expect(HEADS_UP_PUSH.title).toBe("🌸 Cycle heads-up")
    expect(HEADS_UP_PUSH.body).not.toMatch(/period|bleed|pill/i)
  })
})
