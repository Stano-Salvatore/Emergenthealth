import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  parseCsv, combinedFields, importFieldsOverExisting, moodByDay,
} from "@/lib/samsung-health-import"

// The Samsung import is a history backfill into the rows the ring and the
// quick weight box already write. It fills gaps; it never replaces a value,
// and it tells the user only what it actually wrote.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const ROUTE = "src/app/api/import/samsung-health/route.ts"
const IMPORTER = "src/components/settings/SamsungHealthImporter.tsx"

describe("combinedFields", () => {
  const row = (over: Record<string, string>) => ({
    date: "2025-03-04", sleep_score: "", sleep_efficiency: "", sleep_duration_min: "",
    steps: "", distance_m: "", calories: "", avg_hr: "", min_hr: "", max_hr: "", weight_kg: "",
    ...over,
  })

  it("never stores the day's average heart rate as resting HR", () => {
    // Oura's restingHR is the average during sleep (~55); an all-day mean is
    // ~76, and a year of it reads as a 20 bpm drop the day the ring arrived.
    const f = combinedFields(row({ avg_hr: "76", min_hr: "52", steps: "8000" }))
    expect(f).not.toHaveProperty("restingHR")
    expect(f).toEqual({ steps: 8000 })
  })

  it("does not take a zero sleep score or efficiency as a reading", () => {
    expect(combinedFields(row({ sleep_score: "0", sleep_efficiency: "0", steps: "4000" }))).toEqual({ steps: 4000 })
    expect(combinedFields(row({ sleep_score: "78", sleep_efficiency: "91" })))
      .toEqual({ sleepScore: 78, sleepEfficiency: 91 })
  })

  it("returns nothing for a row that carries no value", () => {
    expect(combinedFields(row({}))).toEqual({})
  })
})

describe("importFieldsOverExisting", () => {
  const samsung = { sleepScore: 81, sleepEfficiency: 90, sleepDuration: 430, steps: 7100, distanceKm: 5.1, caloriesBurned: 400, weight: 82.4 }

  it("writes everything on a day with no row", () => {
    expect(importFieldsOverExisting(null, samsung)).toEqual(samsung)
  })

  it("on a ring row, takes nothing the ring measured and none of a different night", () => {
    const ring = {
      ringAt: new Date(), sleepDuration: 410, sleepScore: null, sleepEfficiency: null,
      steps: 9800, sedentaryTime: 510, caloriesBurned: 380, distanceKm: 7.2, weight: null,
    }
    // The ring's night stands whole: Samsung's score of another session
    // would be compared against the Oura-scale cut as if it were the ring's.
    expect(importFieldsOverExisting(ring, samsung)).toEqual({ weight: 82.4 })
  })

  it("never replaces a weight typed into the quick box", () => {
    const typed = { ringAt: null, weight: 80.9, steps: null }
    expect(importFieldsOverExisting(typed, { weight: 82.4, steps: 7100 })).toEqual({ steps: 7100 })
  })

  it("fills a night the ring did not measure, as one night", () => {
    const charger = { ringAt: new Date(), sleepDuration: null, sleepScore: null, sleepEfficiency: null, steps: 9800, sedentaryTime: 510 }
    expect(importFieldsOverExisting(charger, { sleepScore: 81, sleepEfficiency: 90, sleepDuration: 430, steps: 7100 }))
      .toEqual({ sleepScore: 81, sleepEfficiency: 90, sleepDuration: 430 })
  })

  it("does not overwrite a phone-only row either", () => {
    const hc = { ringAt: null, steps: 6400, sleepDuration: null }
    expect(importFieldsOverExisting(hc, { steps: 7100, sleepDuration: 430 })).toEqual({ sleepDuration: 430 })
  })
})

describe("moodByDay", () => {
  it("takes only ISO dates, and the day's last entry", () => {
    const rows = parseCsv([
      "date,time,mood_type,emotions",
      "2025-03-05,21:40,2,",
      "2025-03-05,08:12,4,",
      "2025-03-06 08:12:00.000,08:12,3,",
      "2025-03-07,09:00,0,",
      "2025-03-08,10:00,5,",
    ].join("\n"))
    expect([...moodByDay(rows)]).toEqual([["2025-03-05", 2], ["2025-03-08", 5]])
  })

  it("finds nothing in Samsung's own per-type export", () => {
    // Its first line is metadata and its headers are namespaced.
    const rows = parseCsv([
      "com.samsung.shealth.mood,6315001,4",
      "com.samsung.health.mood.start_time,com.samsung.health.mood.mood_type,time_offset",
      "2025-03-05 07:12:00.000,4,UTC+0100",
    ].join("\n"))
    expect(moodByDay(rows).size).toBe(0)
  })
})

describe("the route and the card say only what was written", () => {
  it("reads the ring's columns and writes only what the rule allows", () => {
    const route = strip(ROUTE)
    const read = route.search(/select: (\{[^}]*\.\.\.)?IMPORT_SELECT\b/)
    const allow = route.indexOf("importFieldsOverExisting(")
    const upsert = route.indexOf("healthLog.upsert(")
    expect(read, "the route no longer reads the ring's columns").toBeGreaterThan(-1)
    expect(allow > -1 && allow < upsert, "the precedence check must come before the upsert").toBe(true)
    expect(route).toMatch(/update: \{\s*\.\.\.allowed/)
    const lib = strip("src/lib/samsung-health-import.ts")
    expect(lib, "IMPORT_SELECT must carry every column the ring's rule reads").toMatch(/IMPORT_SELECT = \{\s*\.\.\.PRECEDENCE_SELECT/)
    expect(lib).toContain("phoneFieldsRespectingRing(")
  })

  it("counts no write it did not make", () => {
    const route = strip(ROUTE)
    expect(route, "a swallowed failure must not be counted as imported").not.toMatch(/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/)
    expect(route, "one failed row must not fail the rest, or hide how many landed").not.toMatch(/Promise\.all\(/)
  })

  it("rejects a file with no usable row instead of reporting 0 imported", () => {
    const route = strip(ROUTE)
    expect(route).toMatch(/status: 400/)
    expect(route.match(/usable\.length === 0|\.size === 0/g)?.length ?? 0, "both branches must refuse an unreadable file").toBeGreaterThanOrEqual(2)
  })

  it("the card shows no green tick for nothing written, and does not send the user to Samsung's own export", () => {
    const card = strip(IMPORTER)
    expect(card).not.toMatch(/Export as CSV and upload the files below/)
    expect(card, "the tick must depend on something having been written").toMatch(/imported > 0/)
    expect(card).toMatch(/unchanged/)
    expect(card).toMatch(/failed/)
  })
})
