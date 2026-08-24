import { describe, it, expect } from "vitest"
import { mapSleepSession } from "@/lib/oura"

// Every field of an Oura sleep document, checked against a real one.
//
// `awakeTimeSeconds` read `awake_duration` for as long as this app has
// existed. Oura's field is `awake_time` — it sits in the same document as
// `time_in_bed` and `total_sleep_duration`, both read correctly two lines
// away. The result was null on every night ever synced: the timeline drew
// awake time as zero, and the health page's tile, which renders only when the
// value is present, never appeared at all.
//
// Nothing could have caught it. The document is Record<string, unknown>, so
// there is no type to check a key against, and a wrong name is
// indistinguishable from a night Oura had no figure for. The only defence is
// a real payload with every field populated, asserting each one arrives.
//
// This is one night's actual response shape, values from the Oura docs'
// example, so a rename on their side fails here rather than in the graphs.
const SESSION: Record<string, unknown> = {
  day: "2026-08-24",
  type: "long_sleep",
  total_sleep_duration: 29220,
  deep_sleep_duration: 5190,
  rem_sleep_duration: 6720,
  light_sleep_duration: 17310,
  awake_time: 2888,
  time_in_bed: 32108,
  restless_periods: 166,
  average_heart_rate: 52.125,
  average_breath: 15.25,
  average_hrv: 96,
  efficiency: 91,
  latency: 1770,
  bedtime_start: "2026-08-23T23:19:00.000+02:00",
  bedtime_end: "2026-08-24T08:14:08.000+02:00",
}

describe("mapSleepSession", () => {
  it("reads awake time, the field that was silently missing", () => {
    expect(mapSleepSession(SESSION).awakeTimeSeconds).toBe(2888)
  })

  it("maps every field of a complete session", () => {
    expect(mapSleepSession(SESSION)).toEqual({
      date: "2026-08-24",
      type: "long_sleep",
      totalSleepSeconds: 29220,
      deepSleepSeconds: 5190,
      remSleepSeconds: 6720,
      lightSleepSeconds: 17310,
      awakeTimeSeconds: 2888,
      timeInBedSeconds: 32108,
      restlessPeriods: 166,
      avgRestingHR: 52.125,
      breathRate: 15.25,
      hrv: 96,
      efficiency: 91,
      latencySeconds: 1770,
      bedtimeStart: "2026-08-23T23:19:00.000+02:00",
      bedtimeEnd: "2026-08-24T08:14:08.000+02:00",
    })
  })

  it("leaves a genuinely absent figure null rather than inventing one", () => {
    // Not derived from time_in_bed − total_sleep_duration: that difference is
    // awake time plus latency, so it would read high, and a plausible wrong
    // number is worse than an honest gap.
    const { awake_time: _omitted, ...withoutAwake } = SESSION
    expect(mapSleepSession(withoutAwake).awakeTimeSeconds).toBeNull()
  })

  it("survives a sparse session without inventing zeros", () => {
    const sparse = mapSleepSession({ day: "2026-08-24", type: "sleep" })
    expect(sparse.totalSleepSeconds).toBeNull()
    expect(sparse.hrv).toBeNull()
    expect(sparse.date).toBe("2026-08-24")
  })
})
