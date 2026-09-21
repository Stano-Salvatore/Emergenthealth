import { describe, it, expect, vi } from "vitest"

// A source that gets CONNECTED starts on the day it was linked. Every day
// before that has no rows — and a predicate written as `(d.workoutMin ?? 0)
// >= 20` reads all of them as rest days. They are not rest days; they are
// days nobody was watching. Worse, they are all OLDER than the covered ones,
// so "workout vs rest" quietly becomes "recently vs back then".
//
// The engine already knew this rule — `calendarFrom` carries a comment
// stating it exactly — and applied it to one family out of all of them.
//
// Two histories with the SAME workouts and a different connection date:
//
//   user_long   Strava linked before the window (a stray activity on day 0)
//   user_late   Strava linked 20 days ago, nothing before it
//
// Every workout in the last 20 days is identical between them. So any card
// about workouts may use up to 60 days of evidence for user_long, and at most
// 20 for user_late. Before the fix both read 60, because `?? 0` cannot tell a
// rest day from a day before the account existed.

const { longRows, lateRows, health } = vi.hoisted(() => {
  const DAYS = 61
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 0; i--) dates.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10))

  // Workouts on alternate days inside the last 20 only, for both users.
  const covered = dates.slice(-20)
  const worked = (ds: string) => covered.includes(ds) && covered.indexOf(ds) % 2 === 0

  const health = dates.map(ds => ({
    date: new Date(ds + "T00:00:00Z"),
    // The night after a workout is the good one, so there is an effect to find.
    hrv: worked(dates[Math.max(0, dates.indexOf(ds) - 1)]) ? 85 : 60,
    readinessScore: worked(dates[Math.max(0, dates.indexOf(ds) - 1)]) ? 85 : 60,
    sleepScore: 80, sleepDuration: 450, restingHR: 55, stressHigh: null,
    steps: 8000, activityScore: 80, deepSleep: null, remSleep: null,
    sleepLatency: null, sleepEfficiency: null, sleepStart: null, restlessPeriods: null,
  }))

  const workouts = dates.filter(worked).map(day => ({ day, movingTimeSec: 45 * 60 }))
  return {
    // A one-second activity on the very first day: Strava was connected all
    // along, that day simply had nothing worth calling a workout.
    longRows: [{ day: dates[0], movingTimeSec: 1 }, ...workouts],
    lateRows: workouts,
    health,
  }
})

vi.mock("@/lib/prisma", () => {
  const empty = { findMany: vi.fn().mockResolvedValue([]) }
  return {
    prisma: {
      healthLog: { findMany: vi.fn().mockResolvedValue(health) },
      stravaActivity: {
        findMany: vi.fn((args: { where?: { userId?: string } }) =>
          Promise.resolve(args?.where?.userId === "user_late" ? lateRows : longRows)),
      },
      habitCompletion: empty, weatherLog: empty, screenTimeLog: empty, deviceCalendarEvent: empty,
      intakeLog: empty, caffeineLog: empty, foodLog: empty, ouraTag: empty, moodLog: empty,
      symptomLog: empty, focusSession: empty, transaction: empty, activitySpan: empty,
      rescuetimeLog: empty, bloodPressureLog: empty, bodyMeasurement: empty,
      bodyMeasurementLog: empty,
      userPreference: { findUnique: vi.fn().mockResolvedValue({ value: "UTC" }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    },
  }
})

import { computeCorrelations, type InsightResult } from "@/lib/correlations"

const mentionsWorkout = (i: InsightResult) =>
  /workout|training/i.test(i.id) || /workout|training/i.test(String(i.highGroupLabel))

const evidence = (i: InsightResult) => i.highGroupN + i.lowGroupN

describe("a source speaks only for the days it existed", () => {
  it("never counts a day from before the source was connected", async () => {
    const { insights } = await computeCorrelations("user_late", 90)
    const workoutCards = insights.filter(mentionsWorkout)
    expect(workoutCards.length, "the fixture should still produce workout cards").toBeGreaterThan(0)
    for (const card of workoutCards) {
      // 20 covered days; a card pairing a day with the next morning can use 19
      // of them at the very most.
      expect(evidence(card), `${card.id} used ${evidence(card)} days of a 20-day source`)
        .toBeLessThanOrEqual(20)
    }
  })

  it("uses the whole window when the source was there for it", async () => {
    const { insights } = await computeCorrelations("user_long", 90)
    const workoutCards = insights.filter(mentionsWorkout)
    expect(workoutCards.length).toBeGreaterThan(0)
    // Same workouts, longer reach — which is the point: the guard costs
    // nothing when the source really was connected.
    expect(Math.max(...workoutCards.map(evidence))).toBeGreaterThan(20)
  })

  it("is the difference between the two, and not a change in the workouts", async () => {
    const [late, long] = await Promise.all([
      computeCorrelations("user_late", 90),
      computeCorrelations("user_long", 90),
    ])
    const byId = (r: { insights: InsightResult[] }) =>
      Object.fromEntries(r.insights.filter(mentionsWorkout).map(i => [i.id, i]))
    const a = byId(late), b = byId(long)
    const shared = Object.keys(a).filter(k => k in b)
    expect(shared.length, "the two histories should produce comparable cards").toBeGreaterThan(0)
    for (const id of shared) {
      expect(evidence(a[id]), `${id} should rest on less evidence for the late connection`)
        .toBeLessThan(evidence(b[id]))
    }
  })
})
