import { describe, it, expect, vi } from "vitest"

// Two sources the app was already collecting under permissions it already
// held, and the engine never read. Both are planted here the way they
// actually arrive, and the point of each fixture is that BEFORE the fix it
// finds nothing:
//
//   Waist lands in BodyMeasurementLog — the raw-SQL table behind the Body
//   page's measurement form — while the engine read only BodyMeasurement.
//   A person could tape-measure themselves for a year and the waist family
//   would keep saying there was not enough to go on (audit A2).
//
//   Drive and transit spans were LOADED by the engine, in the same query as
//   walking, and then thrown away: only `mode === "walk"` was folded into
//   the day series. The comment on that query says all modes are loaded so
//   that a tracked day reads as a real zero — and then two of the modes
//   went nowhere.

const { healthLogs, bodyLogRows, foodLogs, travelSpans, moodRows } = vi.hoisted(() => {
  const DAYS = 60
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 1; i--) {
    dates.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10))
  }
  const at = (ds: string, hhmm = "12:00") => new Date(`${ds}T${hhmm}:00.000Z`)

  // ── Waist, in the log table only ─────────────────────────────────────────
  // Same irregular up/down pattern as the weight fixture in
  // correlations-body.test.ts, and for the same reason: a perfect period-2
  // oscillation is maximally autocorrelated and the block permutation test
  // rightly distrusts it. Climbing stretches ate 2800 kcal, falling ones 1800.
  const UP = [1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0]
  const WAISTS = [90]
  for (const u of UP) WAISTS.push(WAISTS[WAISTS.length - 1] + (u ? 2 : -2))
  const spanOf = (i: number) => Math.min(Math.max(Math.floor((i - 1) / 4), 0), UP.length - 1)

  // ── Vehicle time, in irregular runs ──────────────────────────────────────
  // Heavy-transit days (150 min drive) fall in runs of one to four days with
  // no period — the first draft used i%4, and the engine's own block
  // permutation test rightly refused it, exactly as the weight fixture's
  // comment says it will: a periodic plant is maximally autocorrelated and
  // its alignment survives most rearrangements of adjacent runs. Light days
  // keep a token 10-minute span so every day counts as movement-tracked and
  // the light group is real near-zeros, not untracked silence. Mood is 3 on
  // heavy days, 7 on light — a big planted effect, because this fixture is
  // about plumbing, not sensitivity.
  const HEAVY = "111001111010111011010000111101101111010010000100100111000011"
  const heavy = (i: number) => HEAVY[i] === "1"

  return {
    healthLogs: dates.map(ds => ({
      date: new Date(ds + "T00:00:00Z"),
      sleepScore: null, sleepDuration: 420, readinessScore: null,
      restingHR: null, stressHigh: null, hrv: null,
      steps: 8000, activityScore: null, deepSleep: null, remSleep: null,
    })),

    // Every 4th day, ONLY in the measurement-form table. loggedAt is a real
    // timestamp, because that is what the form writes.
    bodyLogRows: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => i % 4 === 0)
      .map(({ ds, i }) => ({ loggedAt: at(ds, "08:00"), waistCm: WAISTS[i / 4] })),

    foodLogs: dates.map((ds, i) => ({
      loggedAt: at(ds),
      calories: UP[spanOf(i)] ? 2800 : 1800,
      proteinG: 100,
      sugarG: null,
    })),

    travelSpans: dates.flatMap((ds, i) => {
      const minutes = heavy(i) ? 150 : 10
      return [{
        start: at(ds, "17:00"),
        end: new Date(at(ds, "17:00").getTime() + minutes * 60_000),
        mode: "drive",
      }]
    }),

    moodRows: dates.map((ds, i) => ({
      date: new Date(ds + "T00:00:00Z"),
      mood: heavy(i) ? 3 : 7,
    })),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn().mockResolvedValue(healthLogs) },
    // Empty ON PURPOSE: if the waist card below appears, it can only have
    // come from the log table.
    bodyMeasurement: { findMany: vi.fn().mockResolvedValue([]) },
    bodyMeasurementLog: { findMany: vi.fn().mockResolvedValue(bodyLogRows) },
    foodLog: { findMany: vi.fn().mockResolvedValue(foodLogs) },
    stravaActivity: { findMany: vi.fn().mockResolvedValue([]) },
    intakeLog: { findMany: vi.fn().mockResolvedValue([]) },
    habitCompletion: { findMany: vi.fn().mockResolvedValue([]) },
    weatherLog: { findMany: vi.fn().mockResolvedValue([]) },
    screenTimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    deviceCalendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
    caffeineLog: { findMany: vi.fn().mockResolvedValue([]) },
    ouraTag: { findMany: vi.fn().mockResolvedValue([]) },
    moodLog: { findMany: vi.fn().mockResolvedValue(moodRows) },
    symptomLog: { findMany: vi.fn().mockResolvedValue([]) },
    focusSession: { findMany: vi.fn().mockResolvedValue([]) },
    activitySpan: { findMany: vi.fn().mockResolvedValue(travelSpans) },
    rescuetimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    bloodPressureLog: { findMany: vi.fn().mockResolvedValue([]) },
    userPreference: { findUnique: vi.fn().mockResolvedValue({ value: "UTC" }) },
    $queryRaw: vi.fn(() => Promise.resolve([])),
  },
}))

import { computeCorrelations } from "@/lib/correlations"
import { lintSentence, describeProblems } from "./insight-lint"

describe("waist logged through the measurement form (audit A2)", () => {
  it("reaches the body family from BodyMeasurementLog alone", async () => {
    const { insights } = await computeCorrelations("user_a2", 60)
    const card = insights.find(i => i.id === "body_waist_calories")
    expect(
      card,
      "No waist card. The only waist rows in this fixture live in BodyMeasurementLog — the table the " +
        "Body page's form writes — so if the engine lost them it has gone back to reading only " +
        "BodyMeasurement, which is audit finding A2 again.",
    ).toBeDefined()
    // Climbing stretches were the 2800-kcal ones.
    expect(card!.finding).toMatch(/calories|kcal/i)
  })
})

describe("time in a vehicle", () => {
  it("folds drive spans into the day series and finds the planted mood gap", async () => {
    const { insights } = await computeCorrelations("user_vehicle", 60)
    const card = insights.find(i => i.id === "vehicle_mood")
    expect(
      card,
      "No transit-and-mood card. Drive spans are planted on every one of 60 days with a 3-vs-7 mood " +
        "split — if that is not found, drive minutes are being loaded and discarded again, the way " +
        "they were before 23c existed.",
    ).toBeDefined()
    // Heavy-transit days were the miserable ones; the direction must survive.
    expect(card!.finding).toMatch(/3(\.\d)?\b/)
    const problems = lintSentence(card!.finding)
    expect(problems, describeProblems("vehicle_mood finding", card!.finding, problems)).toEqual([])
  })

  it("does not fire for someone whose tracked days never leave foot", async () => {
    // The gate is vehicleVals.some(v => v > 0): a person who never drives
    // must not get a card comparing their zero days against their zero days.
    const spans = travelSpans.map(s => ({ ...s, mode: "walk" }))
    const { prisma } = await import("@/lib/prisma")
    ;(prisma.activitySpan.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(spans)
    const { insights } = await computeCorrelations("user_on_foot", 60)
    expect(insights.find(i => i.id === "vehicle_mood")).toBeUndefined()
  })
})
