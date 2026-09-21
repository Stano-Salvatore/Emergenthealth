import { describe, it, expect, vi } from "vitest"

// The two signals added in 3.3.1's second pass, planted end to end:
//
//   Falling barometric pressure → symptoms. WeatherLog carries a day-mean MSL
//   pressure now (the cron asks Open-Meteo for one more field), and a
//   `pressure_drop` suspect joined the symptom list — so every symptom the
//   user logs gets tested against frontal passages, headaches first among
//   them. Until this, the app had no pressure at all to ask the question with.
//
//   Alcohol → the night's breathing. Oura has written `breathingDisturbance`
//   on every ring night since the v2 sync and NOTHING in this repo read the
//   column — its first reader is the alcohol_breathing family. Alcohol
//   relaxing the upper airway is among the better-evidenced effects in sleep
//   medicine, which is what qualified it for family budget.
//
// Both plants are aperiodic, because the engine's block permutation test
// rightly refuses periodic ones — see correlations-unread-sources.test.ts,
// which learned this the honest way.

const { healthLogs, weatherRows, symptomRows, alcoholLogs, moodRows, isAlcoholQuery } = vi.hoisted(() => {
  const isAlcoholQuery = (t: unknown) => {
    const list = (t as { in?: unknown } | undefined)?.in
    return Array.isArray(list) && list.includes("beer") && !list.includes("water")
  }

  const DAYS = 60
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 1; i--) {
    dates.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10))
  }
  const at = (ds: string) => new Date(ds + "T12:00:00.000Z")

  // Isolated drop days at irregular gaps. Isolated matters as much as
  // irregular: on the second of two consecutive low days the pressure has
  // already fallen, the suspect rightly answers "no drop today", and a
  // headache planted there would sit in the wrong group blurring the very
  // effect being planted.
  const DROP = "001000001000001000001000100010000010001001000001000010001000"
  // Drinking in irregular runs, a different rhythm from the drops.
  const DRINK = "001011100110011100100010011010001101011100110111000111001101"

  return {
    isAlcoholQuery,
    // Breathing disturbance lands on the NIGHT AFTER drinking — Oura writes
    // it on the morning row, so day i+1 carries day i's consequence.
    healthLogs: dates.map((ds, i) => ({
      date: new Date(ds + "T00:00:00Z"),
      sleepScore: null, sleepDuration: 420, readinessScore: null,
      restingHR: null, stressHigh: null, hrv: null,
      breathingDisturbance: i > 0 && DRINK[i - 1] === "1" ? 12 : 4,
      steps: 8000, activityScore: null, deepSleep: null, remSleep: null,
    })),

    // 1020 hPa flat, dipping to 1012 on isolated days: an 8 hPa fall into the
    // day, well past the 4 hPa cut, and back up the day after.
    weatherRows: dates.map((ds, i) => ({
      date: ds,
      precipMm: null, tempMaxC: null, weatherCode: null, uvIndex: null,
      pressureMslHpa: DROP[i] === "1" ? 1012 : 1020,
    })),

    // A headache logged on every drop day and no other. Days without a row
    // count as severity 0, which is the shape real symptom logging has.
    symptomRows: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => DROP[i] === "1")
      .map(({ ds }) => ({ day: ds, name: "Headache", severity: 4 })),

    alcoholLogs: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => DRINK[i] === "1")
      .map(({ ds }) => ({ loggedAt: at(ds), amountMl: 500, type: "beer", note: null })),

    // A flat mood on every day. It is here for `logged`: drankDay() answers
    // null on a day nobody logged anything, and a constant value cannot fire
    // a mood family of its own.
    moodRows: dates.map(ds => ({ date: new Date(ds + "T00:00:00Z"), mood: 5 })),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn().mockResolvedValue(healthLogs) },
    bodyMeasurement: { findMany: vi.fn().mockResolvedValue([]) },
    bodyMeasurementLog: { findMany: vi.fn().mockResolvedValue([]) },
    foodLog: { findMany: vi.fn().mockResolvedValue([]) },
    stravaActivity: { findMany: vi.fn().mockResolvedValue([]) },
    intakeLog: {
      findMany: vi.fn((args: { where?: { type?: unknown } }) =>
        Promise.resolve(isAlcoholQuery(args?.where?.type) ? alcoholLogs : [])),
    },
    habitCompletion: { findMany: vi.fn().mockResolvedValue([]) },
    weatherLog: { findMany: vi.fn().mockResolvedValue(weatherRows) },
    screenTimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    deviceCalendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
    caffeineLog: { findMany: vi.fn().mockResolvedValue([]) },
    ouraTag: { findMany: vi.fn().mockResolvedValue([]) },
    moodLog: { findMany: vi.fn().mockResolvedValue(moodRows) },
    symptomLog: { findMany: vi.fn().mockResolvedValue(symptomRows) },
    focusSession: { findMany: vi.fn().mockResolvedValue([]) },
    activitySpan: { findMany: vi.fn().mockResolvedValue([]) },
    rescuetimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    bloodPressureLog: { findMany: vi.fn().mockResolvedValue([]) },
    userPreference: { findUnique: vi.fn().mockResolvedValue({ value: "UTC" }) },
    $queryRaw: vi.fn(() => Promise.resolve([])),
  },
}))

import { computeCorrelations } from "@/lib/correlations"
import { lintSentence, describeProblems } from "./insight-lint"

describe("falling pressure as a symptom suspect", () => {
  it("tests every logged symptom against pressure drops", async () => {
    const { insights } = await computeCorrelations("user_pressure", 60)
    const card = insights.find(i => i.id === "symptom_headache_pressure_drop")
    expect(
      card,
      "No headache-and-pressure card. Headaches are planted on exactly the days an 8 hPa fall is " +
        "planted, so either the pressure column stopped reaching the day series or the " +
        "pressure_drop suspect left the SUSPECTS list.",
    ).toBeDefined()
    // Severity 4 on drop days against 0 elsewhere; more symptom is worse, so
    // the delta must be negative.
    expect(card!.delta).toBeLessThan(0)
    const problems = lintSentence(card!.finding)
    expect(problems, describeProblems("symptom_headache_pressure_drop finding", card!.finding, problems)).toEqual([])
  })

  it("stays silent for a person whose weather rows carry no pressure yet", async () => {
    // Every row written before 3.3.1, and every device-sourced row, has a
    // null pressure — those days must be absent from both groups, not zeros.
    const bare = weatherRows.map(w => ({ ...w, pressureMslHpa: null }))
    const { prisma } = await import("@/lib/prisma")
    ;(prisma.weatherLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(bare)
    const { insights } = await computeCorrelations("user_no_pressure", 60)
    expect(insights.find(i => i.id === "symptom_headache_pressure_drop")).toBeUndefined()
  })
})

describe("alcohol and the night's breathing", () => {
  it("reads the breathingDisturbance column for the first time", async () => {
    const { insights } = await computeCorrelations("user_breathing", 60)
    const card = insights.find(i => i.id === "alcohol_breathing")
    expect(
      card,
      "No alcohol-and-breathing card. breathingDisturbance is planted at 12 on every night after a " +
        "drink and 4 otherwise — if that is not found, the column has gone back to being written by " +
        "the Oura sync and read by nothing.",
    ).toBeDefined()
    // A disturbance index is higher-is-worse and the engine is told so:
    // drinking raising it must read as a NEGATIVE delta, not an improvement —
    // the same inversion alcohol_hrv shipped with, in the other direction.
    expect(card!.highGroupAvg).toBeGreaterThan(card!.lowGroupAvg)
    expect(card!.delta).toBeLessThan(0)
    const problems = lintSentence(card!.finding)
    expect(problems, describeProblems("alcohol_breathing finding", card!.finding, problems)).toEqual([])
  })
})
