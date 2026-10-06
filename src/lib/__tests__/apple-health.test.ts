import { describe, it, expect } from "vitest"
import { readAppleHealthDay, numbersIn, instantsIn, mergedSleep } from "@/lib/apple-health"
import { readFileSync } from "node:fs"

// What an iPhone Shortcut sends, read into one day. The shortcut is built by
// hand on someone's phone, in their language: a number can arrive as a JSON
// number, as "7,5" or "12 345" text, as "72,4 kg", or as a list joined by
// newlines (what Shortcuts makes of a list dropped into a text field). Dates
// arrive as ISO 8601 when the variable is formatted that way. Anything that
// can't be read is left out and named — absent is not zero.

describe("numbers as Shortcuts writes them", () => {
  it("a JSON number, a decimal comma, a thousands space, a unit", () => {
    expect(numbersIn(8123)).toEqual([8123])
    expect(numbersIn("7,5")).toEqual([7.5])
    expect(numbersIn("12 345")).toEqual([12345])
    expect(numbersIn("12 345")).toEqual([12345])
    expect(numbersIn("1,234")).toEqual([1234])
    expect(numbersIn("72,4 kg")).toEqual([72.4])
    expect(numbersIn("1.234,5")).toEqual([1234.5])
  })

  it("a list joined by newlines is every number in it", () => {
    expect(numbersIn("120\n340\n\n55")).toEqual([120, 340, 55])
  })

  it("nothing readable is nothing", () => {
    expect(numbersIn("")).toEqual([])
    expect(numbersIn(null)).toEqual([])
    expect(numbersIn("lots")).toEqual([])
  })
})

describe("sleep from the samples' start and end times", () => {
  const starts = "2026-10-05T23:10:00+02:00\n2026-10-06T01:00:00+02:00\n2026-10-06T00:30:00+02:00"
  const ends = "2026-10-06T00:40:00+02:00\n2026-10-06T06:50:00+02:00\n2026-10-06T01:10:00+02:00"

  it("overlapping samples — the watch and the phone both — count once", () => {
    const s = mergedSleep(instantsIn(starts), instantsIn(ends))!
    // 23:10 → 06:50 with no gap = 460 min
    expect(s.minutes).toBe(460)
    expect(s.start.toISOString()).toBe("2026-10-05T21:10:00.000Z")
    expect(s.end.toISOString()).toBe("2026-10-06T04:50:00.000Z")
  })

  it("a gap awake is not counted", () => {
    const s = mergedSleep(
      instantsIn("2026-10-05T23:00:00Z\n2026-10-06T03:00:00Z"),
      instantsIn("2026-10-06T02:00:00Z\n2026-10-06T06:00:00Z"),
    )!
    expect(s.minutes).toBe(360)
  })

  it("times in a format that isn't ISO are not guessed at", () => {
    expect(instantsIn("6. 10. 2026 o 23:14")).toEqual([])
    expect(mergedSleep([], [])).toBeNull()
  })
})

const TZ = "Europe/Bratislava"

describe("one day, as stored", () => {
  const today = "2026-10-06"

  it("reads the fields the guide sets up", () => {
    const r = readAppleHealthDay({
      steps: 8123, restingHR: "58", hrv: "41,2",
      sleepStarts: "2026-10-05T23:10:00+02:00", sleepEnds: "2026-10-06T06:40:00+02:00",
      weight: "72,4 kg",
    }, today, TZ)
    expect(r.date).toBe(today)
    expect(r.fields).toMatchObject({ steps: 8123, restingHR: 58, hrv: 41.2, sleepDuration: 450, weight: 72.4 })
    expect(r.ignored).toEqual([])
  })

  it("steps from many samples are summed; heart readings averaged; weight is the last", () => {
    const r = readAppleHealthDay({ steps: "1000\n2000\n500", restingHR: "56\n60", weight: "73\n72" }, today, TZ)
    expect(r.fields).toMatchObject({ steps: 3500, restingHR: 58, weight: 72 })
  })

  it("a zero is a missing reading, not a measurement", () => {
    const r = readAppleHealthDay({ steps: 0, restingHR: 0, hrv: 0 }, today, TZ)
    expect(r.fields).toEqual({})
  })

  it("an impossible value is left out and named", () => {
    const r = readAppleHealthDay({ steps: -40, restingHR: 400, weight: 9000 }, today, TZ)
    expect(r.fields).toEqual({})
    expect(r.ignored).toEqual(expect.arrayContaining(["steps", "restingHR", "weight"]))
  })

  it("pounds become kilograms", () => {
    expect(readAppleHealthDay({ weight: "160 lb" }, today, TZ).fields.weight).toBeCloseTo(72.57, 1)
    expect(readAppleHealthDay({ weight: 160, weightUnit: "lb" }, today, TZ).fields.weight).toBeCloseTo(72.57, 1)
  })

  it("sleep times that aren't ISO are named, so the guide can say what to change", () => {
    const r = readAppleHealthDay({ sleepStarts: "6. 10. 2026 o 23:14", sleepEnds: "7. 10. 2026 o 06:14" }, today, TZ)
    expect(r.fields.sleepDuration).toBeUndefined()
    expect(r.ignored).toContain("sleep")
  })

  it("a date sent in the body is used when it is one", () => {
    expect(readAppleHealthDay({ date: "2026-10-05", steps: 10 }, today, TZ).date).toBe("2026-10-05")
    expect(readAppleHealthDay({ date: "2026-13-45", steps: 10 }, today, TZ).date).toBe(today)
  })

  it("sleep minutes can also be sent as a plain number", () => {
    expect(readAppleHealthDay({ sleepMinutes: "432" }, today, TZ).fields.sleepDuration).toBe(432)
    expect(readAppleHealthDay({ sleepHours: "7,5" }, today, TZ).fields.sleepDuration).toBe(450)
  })
})

// A watch stores a night as many short stage samples, not one. The first
// guide filtered them by "End Date is today", which threw away every sample
// that ended before midnight: a 22:30–06:30 night was stored as 6½ hours
// starting at midnight, with nothing flagged. The shortcut now sends the last
// two days, and the night is the session that ends on the day being filed.
describe("the night is the one that ends on the day", () => {
  const today = "2026-10-06"
  // 30-minute stage samples, 22:30 → 06:30 Bratislava (UTC+2), the night before
  // that one too, and an afternoon nap.
  const slices = (fromUtc: string, n: number) => Array.from({ length: n }, (_, i) => {
    const a = new Date(Date.parse(fromUtc) + i * 30 * 60_000)
    return [a.toISOString(), new Date(a.getTime() + 30 * 60_000).toISOString()] as const
  })
  const night = slices("2026-10-05T20:30:00Z", 16)        // 22:30 → 06:30 local, 480 min
  const nightBefore = slices("2026-10-04T19:00:00Z", 20)  // a longer night, the day before
  const nap = slices("2026-10-05T12:00:00Z", 2)           // 14:00 → 15:00 local, yesterday
  const all = [...nightBefore, ...nap, ...night]
  const body = { sleepStarts: all.map(x => x[0]).join("\n"), sleepEnds: all.map(x => x[1]).join("\n") }

  it("keeps the samples before midnight", () => {
    const r = readAppleHealthDay(body, today, TZ)
    expect(r.fields.sleepDuration).toBe(480)
    expect(r.fields.sleepStart?.toISOString()).toBe("2026-10-05T20:30:00.000Z")
  })

  it("a run after midnight files nothing for a night that hasn't ended yet", () => {
    const r = readAppleHealthDay(body, "2026-10-07", TZ)
    expect(r.fields.sleepDuration).toBeUndefined()
    expect(r.ignored).not.toContain("sleep")
  })

  it("deep and REM count only inside the night", () => {
    const r = readAppleHealthDay({
      ...body,
      deepStarts: "2026-10-05T12:00:00Z\n2026-10-05T22:00:00Z", deepEnds: "2026-10-05T12:40:00Z\n2026-10-05T22:50:00Z",
    }, today, TZ)
    expect(r.fields.deepSleep).toBe(50)
  })

  it("starts and ends that don't pair up are named, not guessed at", () => {
    const r = readAppleHealthDay({ sleepStarts: "2026-10-05T21:00:00Z\n2026-10-06\n2026-10-06T01:00:00Z", sleepEnds: "2026-10-05T23:00:00Z\n2026-10-06T01:00:00Z\n2026-10-06T04:30:00Z" }, today, TZ)
    expect(r.fields.sleepDuration).toBeUndefined()
    expect(r.ignored).toContain("sleep")
  })
})

describe("separators read by what the field holds", () => {
  const today = "2026-10-06"
  it("a count reads dots and commas in threes as thousands", () => {
    expect(readAppleHealthDay({ steps: "12.345" }, today, TZ).fields.steps).toBe(12345)
    expect(readAppleHealthDay({ steps: "1.000.000" }, today, TZ).ignored).toContain("steps")
  })
  it("a measurement reads a comma as the decimal mark", () => {
    expect(readAppleHealthDay({ hrv: "45,678" }, today, TZ).fields.hrv).toBe(45.7)
  })
  it("a Unicode minus is a minus", () => {
    expect(readAppleHealthDay({ steps: "\u22125" }, today, TZ).ignored).toContain("steps")
  })
  it("unreadable sleep minutes are named", () => {
    expect(readAppleHealthDay({ sleepMinutes: "abc" }, today, TZ).ignored).toContain("sleep")
  })
  it("a date far from today is not trusted", () => {
    expect(readAppleHealthDay({ date: "2099-01-01", steps: 5 }, today, TZ).date).toBe(today)
  })
})

describe("the guide says what makes it work", () => {
  const card = readFileSync("src/components/settings/AppleHealthManager.tsx", "utf8")
  it("sleep times with the time switched on, health access turned on, prompts allowed", () => {
    expect(card).toMatch(/Include ISO 8601 Time/)
    expect(card).toMatch(/Turn On All/)
    expect(card).toMatch(/Always Allow/)
    expect(card).not.toMatch(/End Date is today/)
  })
})
