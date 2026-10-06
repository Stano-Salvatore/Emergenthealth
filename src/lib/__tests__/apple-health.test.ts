import { describe, it, expect } from "vitest"
import { readAppleHealthDay, numbersIn, instantsIn, mergedSleep } from "@/lib/apple-health"

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

describe("one day, as stored", () => {
  const today = "2026-10-06"

  it("reads the fields the guide sets up", () => {
    const r = readAppleHealthDay({
      steps: 8123, restingHR: "58", hrv: "41,2",
      sleepStarts: "2026-10-05T23:10:00+02:00", sleepEnds: "2026-10-06T06:40:00+02:00",
      weight: "72,4 kg",
    }, today)
    expect(r.date).toBe(today)
    expect(r.fields).toMatchObject({ steps: 8123, restingHR: 58, hrv: 41.2, sleepDuration: 450, weight: 72.4 })
    expect(r.ignored).toEqual([])
  })

  it("steps from many samples are summed; heart readings averaged; weight is the last", () => {
    const r = readAppleHealthDay({ steps: "1000\n2000\n500", restingHR: "56\n60", weight: "73\n72" }, today)
    expect(r.fields).toMatchObject({ steps: 3500, restingHR: 58, weight: 72 })
  })

  it("a zero is a missing reading, not a measurement", () => {
    const r = readAppleHealthDay({ steps: 0, restingHR: 0, hrv: 0 }, today)
    expect(r.fields).toEqual({})
  })

  it("an impossible value is left out and named", () => {
    const r = readAppleHealthDay({ steps: -40, restingHR: 400, weight: 9000 }, today)
    expect(r.fields).toEqual({})
    expect(r.ignored).toEqual(expect.arrayContaining(["steps", "restingHR", "weight"]))
  })

  it("pounds become kilograms", () => {
    expect(readAppleHealthDay({ weight: "160 lb" }, today).fields.weight).toBeCloseTo(72.57, 1)
    expect(readAppleHealthDay({ weight: 160, weightUnit: "lb" }, today).fields.weight).toBeCloseTo(72.57, 1)
  })

  it("sleep times that aren't ISO are named, so the guide can say what to change", () => {
    const r = readAppleHealthDay({ sleepStarts: "6. 10. 2026 o 23:14", sleepEnds: "7. 10. 2026 o 06:14" }, today)
    expect(r.fields.sleepDuration).toBeUndefined()
    expect(r.ignored).toContain("sleep")
  })

  it("a date sent in the body is used when it is one", () => {
    expect(readAppleHealthDay({ date: "2026-10-05", steps: 10 }, today).date).toBe("2026-10-05")
    expect(readAppleHealthDay({ date: "2026-13-45", steps: 10 }, today).date).toBe(today)
  })

  it("sleep minutes can also be sent as a plain number", () => {
    expect(readAppleHealthDay({ sleepMinutes: "432" }, today).fields.sleepDuration).toBe(432)
    expect(readAppleHealthDay({ sleepHours: "7,5" }, today).fields.sleepDuration).toBe(450)
  })
})
