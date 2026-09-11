import { describe, it, expect, vi } from "vitest"

// A 60-day fixture built for the two families that don't work on single days:
// body measurements (which compare the stretches BETWEEN weigh-ins) and the
// two-way interactions (which compare two differences, not two groups).
//
// Weigh-ins land every 4th day; the weight climbs a kilo on seven stretches
// and falls a kilo on the other seven, in an IRREGULAR order. The stretches
// where the number climbed were 2800 kcal a day, the ones where it fell were
// 1800 — an association the engine should find without ever comparing one
// day's weight against another's.
//
// Irregular on purpose. This fixture used to alternate up/down/up/down, and
// a perfect period-2 oscillation is itself maximally autocorrelated — the
// block permutation test rightly refuses to call two lockstep oscillations
// significant, because their alignment survives most rearrangements of
// adjacent runs. The claim being planted is "climbing stretches ate more",
// not "everything oscillates together", so the plant has to be aperiodic
// for the assertion to mean what it says.
//
// Alcohol and workouts cross to plant a real interaction: after a drinking
// day HRV is barely touched if there was a workout (60 vs 62), and falls off
// a cliff if there wasn't (40 vs 60). The moderator changes the effect from
// -2 to -20, which is what an interaction card is for.

const { DAYS, healthLogs, bodyRows, foodLogs, alcoholLogs, stravaRows, isAlcoholQuery } = vi.hoisted(() => {
  // The engine asks for every alcohol type now (`type: { in: [...] }`), not for
  // the one literally spelled "alcohol". A mock that still matches the old
  // shape silently hands back nothing — which is exactly how the real query
  // hid 22 beers for months.
  const isAlcoholQuery = (t: unknown) => {
    // The hydration query is ALSO a `{ in: [...] }` — it asks for every drink
    // that counts as fluid, beer and wine included. The alcohol set is the one
    // without water in it.
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

  // Which way each of the 14 stretches goes: 7 up, 7 down, no period.
  const UP = [1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0]
  const WEIGHTS = [80]
  for (const u of UP) WEIGHTS.push(WEIGHTS[WEIGHTS.length - 1] + (u ? 1 : -1))
  // Day i sits in the stretch that began at the weigh-in before it.
  const spanOf = (i: number) => Math.min(Math.max(Math.floor((i - 1) / 4), 0), UP.length - 1)

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
    isAlcoholQuery,
    healthLogs: dates.map((ds, i) => ({
      date: new Date(ds + "T00:00:00Z"),
      sleepScore: null, sleepDuration: 420, readinessScore: null,
      restingHR: null, stressHigh: null,
      hrv: hrvFor(i),
      steps: 8000, activityScore: null, deepSleep: null, remSleep: null,
    })),

    // A weigh-in every 4th day, walking up or down a kilo per UP.
    bodyRows: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => i % 4 === 0)
      .map(({ ds, i }) => ({
        date: new Date(ds + "T00:00:00Z"),
        weightKg: WEIGHTS[i / 4],
        waistCm: null,
      })),

    // The days inside a climbing stretch ate 2800; inside a falling one, 1800.
    foodLogs: dates.map((ds, i) => ({
      loggedAt: at(ds),
      calories: UP[spanOf(i)] ? 2800 : 1800,
      proteinG: 100,
      sugarG: null,
    })),

    alcoholLogs: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => drank(i))
      .map(({ ds }) => ({ loggedAt: at(ds), amountMl: 500, type: "beer", note: null })),

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
        Promise.resolve(isAlcoholQuery(args?.where?.type) ? alcoholLogs : [])),
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
import { lintSentence, describeProblems } from "./insight-lint"

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

  // Every sentence this fixture produces, held to the lint. The guard in
  // insight-language.test.ts proves the rule; this is where the rule meets the
  // engine's real output across the body and interaction families at once. A template edited
  // without reading it aloud fails here, and the failure names the card.
  it("every card it produces reads", async () => {
    const { insights } = await computeCorrelations("user_body", 60)
    expect(insights.length).toBeGreaterThan(0)
    for (const ins of insights) {
      for (const [field, text] of [
        ["finding", ins.finding],
        ["title", ins.title],
        ["coverage", ins.coverage],
        ["confounded", ins.confounded],
      ] as const) {
        if (!text) continue
        const problems = lintSentence(text)
        expect(problems, describeProblems(`${ins.id} ${field}`, text, problems)).toEqual([])
      }
    }
  })
})
