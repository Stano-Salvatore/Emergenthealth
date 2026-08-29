import { describe, it, expect } from "vitest"
import {
  estimateHome, summariseDays, fillMissingDays, detectTrips, awayVsHome, agreementBetween, AWAY_KM,
  type DatedPoint,
} from "../day-location"
import { zonedDateTime } from "../local-date"

const TZ = "Europe/Bratislava"
const HOME = { lat: 48.175422, lng: 17.126069 }
const CAFE = { lat: 48.149042, lng: 17.117173 } // ~3 km from home: out, but in town
const PRAGUE = { lat: 50.0755, lng: 14.4378 }   // ~290 km
const ATHENS = { lat: 37.9838, lng: 23.7275 }

/** A fix at a local wall-clock time, which is the only clock that matters here. */
function at(p: { lat: number; lng: number }, date: string, hhmm: string): DatedPoint {
  const when = zonedDateTime(TZ, `${date}T${hhmm}`)
  if (!when) throw new Error(`bad time ${date}T${hhmm}`)
  return { lat: p.lat, lng: p.lng, at: when }
}

/** Same place, every night, for n nights running from `from`. */
function nights(p: { lat: number; lng: number }, from: string, n: number, perNight = 1): DatedPoint[] {
  const out: DatedPoint[] = []
  for (let i = 0; i < n; i++) {
    const [y, m, d] = from.split("-").map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d + i))
    const date = dt.toISOString().slice(0, 10)
    for (let k = 0; k < perNight; k++) out.push(at(p, date, `0${1 + k}:30`))
  }
  return out
}

describe("estimateHome", () => {
  it("counts nights, not fixes — a busy hotel weekend loses to a quiet bedroom", () => {
    const home = estimateHome(
      [...nights(HOME, "2026-08-01", 20), ...nights(PRAGUE, "2026-08-21", 2, 4)],
      TZ,
    )
    expect(home).not.toBeNull()
    expect(home!.nights).toBe(20)
    expect(home!.lat).toBeCloseTo(HOME.lat, 4)
    expect(home!.share).toBeCloseTo(20 / 22, 2)
  })

  it("has no opinion when nothing was ever recorded at night", () => {
    expect(estimateHome([at(CAFE, "2026-08-04", "14:00")], TZ)).toBeNull()
  })
})

describe("summariseDays", () => {
  it("separates a day in from a day out from a day away", () => {
    const days = summariseDays([
      at(HOME, "2026-08-04", "09:00"), at(HOME, "2026-08-04", "20:00"),
      at(HOME, "2026-08-05", "09:00"), at(CAFE, "2026-08-05", "16:00"),
      at(PRAGUE, "2026-08-06", "13:00"),
    ], TZ, HOME)

    expect(days.map(d => d.presence)).toEqual(["home", "local", "away"])
    expect(days[1].maxKmFromHome).toBeGreaterThan(2)
    expect(days[2].maxKmFromHome).toBeGreaterThan(AWAY_KM)
  })

  it("reads the night fixes as where you slept, and the rest as where you were", () => {
    const days = summariseDays([
      at(PRAGUE, "2026-08-06", "02:00"),  // woke up in Prague
      at(HOME, "2026-08-06", "19:00"),    // home by the evening
    ], TZ, HOME)
    expect(days).toHaveLength(1)
    expect(days[0].slept).toBe("away")
    expect(days[0].presence).toBe("away")
  })

  it("says it does not know where a day with no night fixes was slept", () => {
    const days = summariseDays([at(HOME, "2026-08-04", "13:00")], TZ, HOME)
    expect(days[0].slept).toBe("unknown")
  })

  it("never invents a day the phone recorded nothing on", () => {
    const days = summariseDays([
      at(HOME, "2026-08-04", "13:00"), at(HOME, "2026-08-07", "13:00"),
    ], TZ, HOME)
    expect(days.map(d => d.date)).toEqual(["2026-08-04", "2026-08-07"])
    // And filling the calendar marks the hole as unknown rather than as home.
    const filled = fillMissingDays(days)
    expect(filled).toHaveLength(4)
    expect(filled.map(d => d.presence)).toEqual(["home", "unknown", "unknown", "home"])
  })
})

describe("detectTrips", () => {
  const homeDay = (date: string) => at(HOME, date, "13:00")

  it("finds the trip and counts the nights slept away", () => {
    const trips = detectTrips(summariseDays([
      homeDay("2026-08-03"),
      at(PRAGUE, "2026-08-04", "18:00"),
      at(PRAGUE, "2026-08-05", "02:00"), at(PRAGUE, "2026-08-05", "14:00"),
      at(PRAGUE, "2026-08-06", "02:00"), at(PRAGUE, "2026-08-06", "14:00"),
      homeDay("2026-08-07"),
    ], TZ, HOME))

    expect(trips).toHaveLength(1)
    expect(trips[0].start).toBe("2026-08-04")
    expect(trips[0].end).toBe("2026-08-06")
    expect(trips[0].nights).toBe(2)
    expect(trips[0].lat).toBeCloseTo(PRAGUE.lat, 3)
    expect(trips[0].maxKmFromHome).toBeGreaterThan(250)
  })

  it("a dead phone mid-trip does not send you home for the day", () => {
    const trips = detectTrips(summariseDays([
      homeDay("2026-08-03"),
      at(ATHENS, "2026-08-04", "18:00"),
      // nothing at all on the 5th
      at(ATHENS, "2026-08-06", "14:00"),
      homeDay("2026-08-07"),
    ], TZ, HOME))

    expect(trips).toHaveLength(1)
    expect(trips[0].days).toEqual(["2026-08-04", "2026-08-05", "2026-08-06"])
    expect(trips[0].gapDays).toBe(1)
  })

  it("does not extend a trip into a gap it cannot see the far side of", () => {
    const trips = detectTrips(summariseDays([
      homeDay("2026-08-03"),
      at(ATHENS, "2026-08-04", "18:00"), at(ATHENS, "2026-08-05", "18:00"),
      // then nothing — the trip ends where the evidence does
    ], TZ, HOME))
    expect(trips[0].end).toBe("2026-08-05")
  })

  it("a day out and back again is not a trip", () => {
    const trips = detectTrips(summariseDays([
      homeDay("2026-08-03"),
      at(PRAGUE, "2026-08-04", "13:00"), at(HOME, "2026-08-04", "23:00"),
      homeDay("2026-08-05"),
    ], TZ, HOME))
    expect(trips).toEqual([])
  })
})

describe("awayVsHome", () => {
  const days = summariseDays([
    at(HOME, "2026-08-03", "02:00"), at(HOME, "2026-08-03", "13:00"),
    at(PRAGUE, "2026-08-04", "02:00"), at(PRAGUE, "2026-08-04", "13:00"),
    at(HOME, "2026-08-05", "13:00"), // no night fix: slept unknown
  ], TZ, HOME)

  const metrics = new Map([
    ["2026-08-03", { sleepHours: 8, readiness: 80, hrv: 60, mood: 4 }],
    ["2026-08-04", { sleepHours: 6, readiness: 60, hrv: 40, mood: 3 }],
    ["2026-08-05", { sleepHours: 7, readiness: 70, hrv: 50, mood: 5 }],
  ])

  it("files the night metrics by where the night was spent", () => {
    const { nights } = awayVsHome(days, metrics)
    expect(nights.away.n).toBe(1)
    expect(nights.away.sleepHours).toBe(6)
    // The 5th has no night fix, so it counts for neither side.
    expect(nights.home.n).toBe(1)
    expect(nights.home.sleepHours).toBe(8)
  })

  it("files mood by where the day was spent, which is not the same split", () => {
    const { days: byDay } = awayVsHome(days, metrics)
    expect(byDay.away.mood).toBe(3)
    expect(byDay.home.n).toBe(2)      // the 3rd and the 5th
    expect(byDay.home.mood).toBe(4.5)
  })

  it("reports nothing rather than zero when a side has no data", () => {
    const { nights } = awayVsHome(days, new Map())
    expect(nights.away.n).toBe(0)
    expect(nights.away.sleepHours).toBeNull()
  })
})

describe("hoursWithFixes", () => {
  it("counts distinct local hours, not fixes", () => {
    const days = summariseDays([
      at(HOME, "2026-08-04", "09:05"), at(HOME, "2026-08-04", "09:35"),
      at(HOME, "2026-08-04", "21:00"),
    ], TZ, HOME)
    expect(days[0].points).toBe(3)
    expect(days[0].hoursWithFixes).toBe(2)
  })
})

describe("fillMissingDays over an explicit span", () => {
  it("pads both ends so two sources line up day for day", () => {
    const days = summariseDays([at(HOME, "2026-08-05", "13:00")], TZ, HOME)
    const filled = fillMissingDays(days, "2026-08-03", "2026-08-06")
    expect(filled.map(d => d.date)).toEqual([
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
    ])
    expect(filled.filter(d => d.points > 0)).toHaveLength(1)
  })
})

describe("agreementBetween", () => {
  // The app saw the 3rd and 4th; Google saw the 4th and 5th. Only the 4th can
  // be compared at all, and there the two disagree.
  const app = summariseDays([
    at(HOME, "2026-08-03", "13:00"),
    at(HOME, "2026-08-04", "13:00"),
  ], TZ, HOME)
  const google = summariseDays([
    at(PRAGUE, "2026-08-04", "13:00"),
    at(HOME, "2026-08-05", "13:00"),
  ], TZ, HOME)

  it("only compares days both sources actually saw", () => {
    const a = agreementBetween(app, google)
    expect(a.bothDays).toBe(1)
    expect(a.agreeDays).toBe(0)
    expect(a.onlyA).toBe(1)
    expect(a.onlyB).toBe(1)
    expect(a.disagreements).toEqual([{ date: "2026-08-04", a: "home", b: "away" }])
  })

  it("a padded day is not a day the source saw", () => {
    // fillMissingDays adds zero-point rows; those must not count as coverage,
    // or every source would appear to cover the whole window.
    const a = agreementBetween(
      fillMissingDays(app, "2026-08-01", "2026-08-10"),
      fillMissingDays(google, "2026-08-01", "2026-08-10"),
    )
    expect(a.bothDays).toBe(1)
    expect(a.onlyA).toBe(1)
    expect(a.onlyB).toBe(1)
  })
})

describe("naming a trip", () => {
  it("takes its centre from the nights, not the average of the travel days", () => {
    // Drive out on the 4th (half the day's fixes are still near home), sleep in
    // Prague, drive back on the 7th. The mean of every fix sits on the motorway;
    // the mean of the nights sits in Prague, which is what you want to geocode.
    const trips = detectTrips(summariseDays([
      at(HOME, "2026-08-03", "13:00"),
      at(HOME, "2026-08-04", "08:00"), at(HOME, "2026-08-04", "09:00"),
      at(PRAGUE, "2026-08-04", "18:00"),
      at(PRAGUE, "2026-08-05", "02:00"), at(PRAGUE, "2026-08-05", "14:00"),
      at(PRAGUE, "2026-08-06", "02:00"), at(PRAGUE, "2026-08-06", "14:00"),
      at(HOME, "2026-08-07", "13:00"),
    ], TZ, HOME))

    expect(trips).toHaveLength(1)
    expect(trips[0].lat).toBeCloseTo(PRAGUE.lat, 4)
    expect(trips[0].lng).toBeCloseTo(PRAGUE.lng, 4)
  })

  it("falls back to the day centre when a trip has no night fixes at all", () => {
    const trips = detectTrips(summariseDays([
      at(HOME, "2026-08-03", "13:00"),
      at(ATHENS, "2026-08-04", "14:00"),
      at(ATHENS, "2026-08-05", "14:00"),
      at(HOME, "2026-08-06", "13:00"),
    ], TZ, HOME))
    expect(trips).toHaveLength(1)
    expect(trips[0].nights).toBe(1)   // no night fixes: one night per boundary
    expect(trips[0].lat).toBeCloseTo(ATHENS.lat, 4)
  })
})
