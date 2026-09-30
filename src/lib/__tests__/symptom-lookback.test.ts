import { describe, it, expect } from "vitest"
import {
  symptomLookback, differsFromUsual, lookbackSince, MIN_EPISODES, BASELINE_DAYS, LOOKBACK_HOURS,
  type LookbackData, type SymptomRow,
} from "@/lib/symptom-lookback"
import { zonedDateTime, addDaysISO } from "@/lib/local-date"
import { lintSentence } from "./insight-lint"

// The owner's own clock: Bratislava is UTC+2 in September, which is what makes
// the local-day cases below differ from the UTC ones.
const TZ = "Europe/Bratislava"
const at = (dayTime: string) => zonedDateTime(TZ, dayTime)!

const EPISODE_DAY = "2026-09-29"

/**
 * Sixty ordinary days before `lastDay` (inclusive of the day before it): a
 * 7.2h night, coffee at 09:00 and 11:30, ~9,800 steps, flat pressure, a daily
 * magnesium. The wobble cycles so the median stays on the centre value.
 */
function ordinaryLife(lastDay = EPISODE_DAY, days = 60): LookbackData {
  const data: LookbackData = {
    timezone: TZ, nights: [], stepDays: [], drinks: [], caffeine: [], diary: [], pressure: [], doses: [],
  }
  const wobble = [0.2, -0.2, 0]
  for (let k = days; k >= 1; k--) {
    const day = addDaysISO(lastDay, -k)
    const w = wobble[k % 3]
    data.nights.push({ morning: day, end: at(`${day}T07:00`), minutes: Math.round((7.2 + w) * 60) })
    data.stepDays.push({ day, steps: 9800 + w * 1500 })
    data.caffeine.push({ at: at(`${day}T09:00`), mg: 100 }, { at: at(`${day}T11:30`), mg: 100 })
    data.diary.push(at(`${day}T09:00`), at(`${day}T11:30`))
    for (const hh of ["00", "03", "06", "09", "12", "15", "18", "21"]) {
      data.pressure.push({ at: at(`${day}T${hh}:00`), hPa: 1013 + w * 5 })
    }
    data.doses.push({ at: at(`${day}T08:00`), name: "Magnesium" })
  }
  return data
}

const headache = (id: string, dayTime: string): SymptomRow => ({ id, name: "Headache", loggedAt: at(dayTime) })

describe("differsFromUsual", () => {
  it("compares against the median, and ignores a wobble inside the usual spread", () => {
    const history = Array.from({ length: 30 }, (_, i) => 7 + [0.3, -0.3, 0][i % 3])
    expect(differsFromUsual(6.9, history, 0.8)).toBeNull()
    const d = differsFromUsual(5.1, history, 0.8)
    expect(d).not.toBeNull()
    expect(d!.usual).toBe(7)
    expect(d!.direction).toBe("below")
  })

  it("needs a real history before calling anything unusual", () => {
    expect(differsFromUsual(5, [7, 7, 7, 7, 7], 0.8)).toBeNull()
  })

  it("still speaks when every usual day was the same — a first drink after a dry month", () => {
    // MAD is zero for a series of zeros; anomalies.ts stays silent there, but
    // "3 drinks against none" is exactly what this look-back is for.
    const d = differsFromUsual(3, Array(30).fill(0), 1)
    expect(d).toEqual({ usual: 0, direction: "above" })
    expect(differsFromUsual(0.5, Array(30).fill(0), 1)).toBeNull()
  })
})

describe("symptomLookback — what differed before this one", () => {
  it("reports the factors that moved and only those, in the owner's own words", () => {
    const data = ordinaryLife()
    // The night before: short. The evening before: three drinks and a late coffee.
    data.nights.push({ morning: EPISODE_DAY, end: at(`${EPISODE_DAY}T07:00`), minutes: 306 })
    data.drinks.push(
      { at: at("2026-09-28T20:00"), grams: 10 },
      { at: at("2026-09-28T21:00"), grams: 10 },
      { at: at("2026-09-28T22:15"), grams: 10 },
    )
    data.caffeine.push({ at: at("2026-09-28T16:40"), mg: 100 })
    data.stepDays.push({ day: "2026-09-28", steps: 9700 })
    // The 28th sat at 1012 hPa; by the morning of the episode it was 1003.
    data.pressure.push({ at: at(`${EPISODE_DAY}T08:00`), hPa: 1003 }, { at: at(`${EPISODE_DAY}T09:30`), hPa: 1003 })
    data.doses.push({ at: at(`${EPISODE_DAY}T08:00`), name: "Magnesium" })

    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    const texts = r.factors.map(f => f.text)
    expect(texts).toContain("5.1h sleep (your usual 7.2h)")
    expect(texts).toContain("3 drinks last night (usually none)")
    expect(texts).toContain("last caffeine 16:40 the day before (usually 11:30)")
    expect(texts.some(t => /^pressure fell 9 hPa/.test(t))).toBe(true)
    // Steps and the daily magnesium were ordinary, so they are not news.
    expect(texts.join(" ")).not.toMatch(/steps|Magnesium/)
    expect(r.steady).toContain("steps")
  })

  it("says nothing moved when nothing did, and says what it looked at", () => {
    const data = ordinaryLife()
    data.nights.push({ morning: EPISODE_DAY, end: at(`${EPISODE_DAY}T07:00`), minutes: 432 })
    data.stepDays.push({ day: "2026-09-28", steps: 9800 })
    data.caffeine.push({ at: at(`${EPISODE_DAY}T09:00`), mg: 100 })
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors).toEqual([])
    expect(r.steady).toEqual(expect.arrayContaining(["sleep", "caffeine", "steps"]))
  })
})

describe("absent is not zero", () => {
  it("a night the ring did not record is missing, never a 0h night", () => {
    const data = ordinaryLife()
    // No row for the episode's night at all, and a zero-minute row the day before.
    data.nights = data.nights.filter(n => n.morning !== "2026-09-28")
    data.nights.push({ morning: "2026-09-28", end: at("2026-09-28T07:00"), minutes: 0 })
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors.map(f => f.key)).not.toContain("sleep")
    expect(r.unmeasured).toContain("sleep")
    expect(r.factors.map(f => f.text).join(" ")).not.toMatch(/\b0(\.0)?h\b/)
  })

  it("an unlogged stretch has unknown caffeine and drinks, not none", () => {
    // The ordinary days stop on the 26th: nothing at all was logged in the
    // 24h before this one, so the diary was shut rather than the cup empty.
    const data = ordinaryLife("2026-09-27")
    const r = symptomLookback(data, headache("h1", "2026-09-28T20:00"), [])
    expect(r.factors.map(f => f.key)).not.toContain("caffeine")
    expect(r.factors.map(f => f.text).join(" ")).not.toMatch(/no caffeine|0mg|0 drinks/)
    expect(r.unmeasured).toEqual(expect.arrayContaining(["caffeine", "drinks"]))
  })

  it("a logged day with no coffee is a known zero, and says so plainly", () => {
    const data = ordinaryLife()
    // Water logged, no caffeine: the diary was open, so none is a real answer.
    data.diary.push(at("2026-09-28T14:00"), at(`${EPISODE_DAY}T08:00`))
    data.caffeine = data.caffeine.filter(c => c.at < at("2026-09-28T00:00"))
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors.map(f => f.text)).toContain("no caffeine in the 24h before (usually 200mg)")
    // The *time* of the last caffeine does not exist on a day without any —
    // it must not become 00:00.
    expect(r.factors.map(f => f.key)).not.toContain("lastCaffeine")
    expect(r.factors.map(f => f.text).join(" ")).not.toMatch(/00:00/)
  })

  it("a day the phone sat in a drawer has no step count, not a sedentary one", () => {
    const data = ordinaryLife()
    data.stepDays.push({ day: "2026-09-28", steps: 140 })
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors.map(f => f.key)).not.toContain("steps")
    expect(r.unmeasured).toContain("steps")
  })

  it("no barometer readings means no pressure line", () => {
    const data = ordinaryLife()
    data.pressure = []
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors.map(f => f.key)).not.toContain("pressure")
    expect(r.unmeasured).toContain("pressure")
  })

  it("a regular medication not logged before this one is never reported as missed", () => {
    const data = ordinaryLife()
    data.doses = data.doses.filter(d => d.at < at("2026-09-28T00:00"))
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors.map(f => f.text).join(" ")).not.toMatch(/Magnesium/)
  })

  it("an unusual dose is worth mentioning", () => {
    const data = ordinaryLife()
    data.doses.push({ at: at(`${EPISODE_DAY}T08:10`), name: "Ibuprofen" })
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors.map(f => f.text)).toContain("Ibuprofen at 08:10 (not a usual one)")
  })

  it("too little history is unmeasured, not usual", () => {
    const data = ordinaryLife(EPISODE_DAY, 6)
    data.nights.push({ morning: EPISODE_DAY, end: at(`${EPISODE_DAY}T07:00`), minutes: 200 })
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors).toEqual([])
    expect(r.steady).not.toContain("sleep")
    expect(r.unmeasured).toContain("sleep")
  })
})

describe("the owner's local days, not the server's", () => {
  it("prints clock times on the owner's clock", () => {
    const data = ordinaryLife()
    // 14:40 UTC is 16:40 in Bratislava.
    data.caffeine.push({ at: new Date("2026-09-28T14:40:00Z"), mg: 100 })
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors.map(f => f.text)).toContain("last caffeine 16:40 the day before (usually 11:30)")
  })

  it("'the day before' is the local day before, even when the UTC date disagrees", () => {
    const data = ordinaryLife("2026-09-30")
    // 01:30 on 30 Sept in Bratislava is still 29 Sept in UTC. The day before
    // it is the 29th — the UTC reading would pick the 28th.
    data.stepDays = data.stepDays.filter(s => s.day !== "2026-09-29" && s.day !== "2026-09-28")
    data.stepDays.push({ day: "2026-09-29", steps: 3000 }, { day: "2026-09-28", steps: 9800 })
    const r = symptomLookback(data, { id: "h1", name: "Headache", loggedAt: new Date("2026-09-29T23:30:00Z") }, [])
    expect(r.factors.map(f => f.text)).toContain("3,000 steps the day before (usually 9,800)")
  })

  it("a drink at half past midnight belongs to last night", () => {
    const data = ordinaryLife()
    // 22:30 UTC on the 28th is 00:30 on the 29th locally.
    data.drinks.push({ at: new Date("2026-09-28T21:30:00Z"), grams: 10 }, { at: new Date("2026-09-28T22:30:00Z"), grams: 10 })
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), [])
    expect(r.factors.map(f => f.text)).toContain("2 drinks last night (usually none)")
  })

  it("keeps other episodes' days out of the usual", () => {
    const data = ordinaryLife()
    // Headaches every third day, each after a 5h night: had those nights
    // counted, a 5h night would have been dragged towards "usual".
    const rows: SymptomRow[] = []
    for (let k = 3; k <= 45; k += 3) {
      const day = addDaysISO(EPISODE_DAY, -k)
      data.nights = data.nights.filter(n => n.morning !== day)
      data.nights.push({ morning: day, end: at(`${day}T07:00`), minutes: 300 })
      rows.push(headache(`p${k}`, `${day}T10:00`))
    }
    data.nights.push({ morning: EPISODE_DAY, end: at(`${EPISODE_DAY}T07:00`), minutes: 300 })
    const r = symptomLookback(data, headache("h1", `${EPISODE_DAY}T10:00`), rows)
    const sleep = r.factors.find(f => f.key === "sleep")
    expect(sleep?.value).toBe(5)
    expect(sleep!.usual).toBeGreaterThanOrEqual(7)
  })
})

describe("the recurring line", () => {
  /** An episode on `day` at 10:00 after a 5h night. */
  function withShortNights(days: string[]): { data: LookbackData; rows: SymptomRow[] } {
    const data = ordinaryLife(EPISODE_DAY, 120)
    const rows: SymptomRow[] = []
    for (const day of days) {
      data.nights = data.nights.filter(n => n.morning !== day)
      data.nights.push({ morning: day, end: at(`${day}T07:00`), minutes: 300 })
      rows.push(headache(`e-${day}`, `${day}T10:00`))
    }
    return { data, rows }
  }

  it(`waits for ${MIN_EPISODES} episodes of the same symptom`, () => {
    const { data, rows } = withShortNights(["2026-09-10", EPISODE_DAY])
    const current = rows[rows.length - 1]
    const r = symptomLookback(data, current, rows)
    expect(r.episodes).toBe(2)
    expect(r.recurring).toEqual([])
  })

  it("names a factor that showed up before most recent episodes", () => {
    const { data, rows } = withShortNights(["2026-08-20", "2026-09-01", "2026-09-15", EPISODE_DAY])
    const current = rows[rows.length - 1]
    const r = symptomLookback(data, current, rows)
    expect(r.episodes).toBe(4)
    expect(r.recurring).toContain("A short night showed up before 4 of your last 4 headaches")
  })

  it("does not count a second log of the same episode as another episode", () => {
    const { data, rows } = withShortNights(["2026-09-15", EPISODE_DAY])
    // Logged again two hours later as it got worse — one headache, not two.
    rows.push(headache("again", `${EPISODE_DAY}T08:00`))
    const current = rows.find(r => r.id === `e-${EPISODE_DAY}`)!
    const r = symptomLookback(data, current, rows)
    expect(r.episodes).toBe(2)
    expect(r.recurring).toEqual([])
  })

  it("only other symptoms of the same name count", () => {
    const { data, rows } = withShortNights(["2026-09-01", "2026-09-15", EPISODE_DAY])
    rows[0] = { ...rows[0], name: "Nausea" }
    const current = rows[rows.length - 1]
    const r = symptomLookback(data, current, rows)
    expect(r.episodes).toBe(2)
    expect(r.recurring).toEqual([])
  })

  it("counts only the episodes a factor was measured for, and says so", () => {
    const { data, rows } = withShortNights(["2026-09-01", "2026-09-15", "2026-09-22", EPISODE_DAY])
    // The ring was off for one of them.
    data.nights = data.nights.filter(n => n.morning !== "2026-09-22")
    const current = rows[rows.length - 1]
    const r = symptomLookback(data, current, rows)
    expect(r.recurring).toContain("A short night showed up before 3 of the 3 recent headaches with sleep recorded")
  })

  it("names other symptoms as episodes rather than guessing a plural", () => {
    const { data, rows } = withShortNights(["2026-09-01", "2026-09-15", EPISODE_DAY])
    const renamed = rows.map(r => ({ ...r, name: "Brain fog" }))
    const r = symptomLookback(data, renamed[renamed.length - 1], renamed)
    expect(r.recurring).toContain("A short night showed up before 3 of your last 3 brain fog episodes")
  })
})

describe("lookbackSince", () => {
  it("reaches far enough back for the oldest counted episode's own usual", () => {
    const current = headache("h", `${EPISODE_DAY}T10:00`)
    const older = ["2026-06-01", "2026-08-01", "2026-09-01", "2026-09-10", "2026-09-20"].map(d => headache(d, `${d}T10:00`))
    const since = lookbackSince(current, older)
    // Five episodes counted: this one and the four most recent — so 1 Aug is
    // the oldest, and its 45 days of usual plus the look-back come before it.
    const need = at("2026-08-01T10:00").getTime() - (BASELINE_DAYS * 24 + LOOKBACK_HOURS) * 3_600_000
    expect(since.getTime()).toBeLessThanOrEqual(need)
    expect(since.getTime()).toBeGreaterThan(at("2026-06-01T10:00").getTime())
  })
})

describe("observation, never a verdict", () => {
  it("every sentence it writes passes the insight lint and claims no cause", () => {
    const data = ordinaryLife(EPISODE_DAY, 120)
    const rows: SymptomRow[] = []
    for (const day of ["2026-09-01", "2026-09-15", EPISODE_DAY]) {
      data.nights = data.nights.filter(n => n.morning !== day)
      data.nights.push({ morning: day, end: at(`${day}T07:00`), minutes: 300 })
      const prev = addDaysISO(day, -1)
      data.drinks.push({ at: at(`${prev}T21:00`), grams: 30 })
      data.caffeine.push({ at: at(`${prev}T17:30`), mg: 120 })
      data.doses.push({ at: at(`${day}T08:30`), name: "Ibuprofen" })
      rows.push(headache(`e-${day}`, `${day}T10:00`))
    }
    const r = symptomLookback(data, rows[rows.length - 1], rows)
    const all = [...r.factors.map(f => f.text), ...r.recurring]
    expect(r.recurring.length).toBeGreaterThan(0)
    for (const s of all) {
      expect(lintSentence(s), s).toEqual([])
      expect(s, s).not.toMatch(/\b(caus\w*|trigger\w*|because|due to|led to|responsible|blame|avoid)\b/i)
    }
  })
})
