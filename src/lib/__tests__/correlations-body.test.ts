import { describe, it, expect, vi } from "vitest"

// A 60-day fixture built for the two families that don't work on single days:
// body measurements (which compare the stretches BETWEEN weigh-ins) and the
// two-way interactions (which compare two differences, not two groups).
//
// Weigh-ins land every 4th day and alternate: up a kilo, down a kilo, up a
// kilo. The stretches where the number climbed were 2800 kcal a day, the ones
// where it fell were 1800 — an association the engine should find without
// ever comparing one day's weight against another's.
//
// Alcohol and workouts cross to plant a real interaction: after a drinking
// day HRV is barely touched if there was a workout (60 vs 62), and falls off
// a cliff if there wasn't (40 vs 60). The moderator changes the effect from
// -2 to -20, which is what an interaction card is for.

const { DAYS, healthLogs, bodyRows, foodLogs, alcoholLogs, stravaRows } = vi.hoisted(() => {
  const DAYS = 60
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 1; i--) {
    dates.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10))
  }
  const at = (ds: string) => new Date(ds + "T12:00:00.000Z")

  // Day i: drinking on even days, a workout when i % 4 is 0 or 1.
  const drank = (i: number) => i % 2 === 0
  const worked = (i: number) => i % 4 === 0 || i % 4 === 1
  // HRV on day j reflects the night after day j-1.
  const hrvFor = (j: number) => {
    const d = j - 1
    if (d < 0) return null
    return d % 4 === 0 ? 60 : d % 4 === 1 ? 62 : d % 4 === 2 ? 40 : 60
  }

  return {
    DAYS,
    healthLogs: dates.map((ds, i) => ({
      date: new Date(ds + "T00:00:00Z"),
      sleepScore: null, sleepDuration: 420, readinessScore: null,
      restingHR: null, stressHigh: null,
      hrv: hrvFor(i),
      steps: 8000, activityScore: null, deepSleep: null, remSleep: null,
    })),

    // A weigh-in every 4th day; 80 kg on even marks, 81 on odd ones, so each
    // span is a clean kilo up or a clean kilo down.
    bodyRows: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => i % 4 === 0)
      .map(({ ds, i }) => ({
        date: new Date(ds + "T00:00:00Z"),
        weightKg: 80 + ((i / 4) % 2),
        waistCm: null,
      })),

    // The days inside a climbing stretch ate 2800; inside a falling one, 1800.
    foodLogs: dates.map((ds, i) => ({
      loggedAt: at(ds),
      calories: Math.floor((i - 1) / 4) % 2 === 0 ? 2800 : 1800,
      proteinG: 100,
      sugarG: null,
    })),

    alcoholLogs: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => drank(i))
      .map(({ ds }) => ({ loggedAt: at(ds), amountMl: 50 })),

    stravaRows: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => worked(i))
      .map(({ ds }) => ({ day: ds, movingTimeSec: 45 * 60 })),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn().mockResolvedValue(healthLogs) },
    bodyMeasurement: { findMany: vi.fn().mockResolvedValue(bodyRows) },
    foodLog: { findMany: vi.fn().mockResolvedValue(foodLogs) },
    stravaActivity: { findMany: vi.fn().mockResolvedValue(stravaRows) },
    intakeLog: {
      findMany: vi.fn((args: { where?: { type?: unknown } }) =>
        Promise.resolve(args?.where?.type === "alcohol" ? alcoholLogs : [])),
    },
    habitCompletion: { findMany: vi.fn().mockResolvedValue([]) },
    weatherLog: { findMany: vi.fn().mockResolvedValue([]) },
    screenTimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    deviceCalendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
    caffeineLog: { findMany: vi.fn().mockResolvedValue([]) },
    ouraTag: { findMany: vi.fn().mockResolvedValue([]) },
    moodLog: { findMany: vi.fn().mockResolvedValue([]) },
    symptomLog: { findMany: vi.fn().mockResolvedValue([]) },
    focusSession: { findMany: vi.fn().mockResolvedValue([]) },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    activitySpan: { findMany: vi.fn().mockResolvedValue([]) },
    rescuetimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    bloodPressureLog: { findMany: vi.fn().mockResolvedValue([]) },
    userPreference: { findUnique: vi.fn().mockResolvedValue({ value: "UTC" }) },
    $queryRaw: vi.fn(() => Promise.resolve([])),
  },
}))

import { computeCorrelations } from "@/lib/correlations"

describe("body measurements", () => {
  it("compares the stretches between weigh-ins, not the weights themselves", async () => {
    const { insights, totalDays } = await computeCorrelations("user_body", 60)
    expect(totalDays).toBe(DAYS)

    const card = insights.find(i => i.id === "body_weight_calories")
    expect(card).toBeDefined()
    expect(card!.category).toBe("body")
    expect(card!.highGroupAvg).toBe(2800)  // stretches the weight climbed
    expect(card!.lowGroupAvg).toBe(1800)   // stretches it fell
    // 14 spans of four days, alternating up and down.
    expect(card!.highGroupN).toBe(7)
    expect(card!.lowGroupN).toBe(7)
    // A clean split of 7 against 7 is not something shuffling reproduces.
    expect(card!.tier).toBe("strong")
  })

  it("never emits a weight card for a measurement nobody took", async () => {
    // Waist is null on every row in this fixture.
    const { insights } = await computeCorrelations("user_body", 60)
    expect(insights.some(i => i.id.startsWith("body_waist_"))).toBe(false)
  })
})

describe("two-way interactions", () => {
  it("gives an interaction card a real permutation p-value", async () => {
    const { insights } = await computeCorrelations("user_body", 60)
    const card = insights.find(i => i.id === "interaction_alcohol_hrv_by_workout")
    expect(card).toBeDefined()
    // The whole point of this change: these used to ship with pValue 1 and
    // could never be anything but "could be chance".
    expect(card!.pValue).toBeLessThan(0.05)
    expect(card!.tier).not.toBe("noise")
  })
})
