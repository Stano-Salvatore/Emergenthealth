import { describe, it, expect, vi } from "vitest"

// A 90-day fixture for the combination search — the family that asks what
// two or three things do TOGETHER.
//
// Three conditions are dealt independently, each on about half the days:
// alcohol, a late meal, a short night before. Each alone costs the next
// morning's readiness four points; all three on the same day cost a further
// twenty-five. That is a genuine three-way combination — no pair predicts
// it, no single predicts it — and the engine should find exactly that
// triple, not restate its pairs alongside it.
//
// The second scenario is the guard: alcohol alone costs twenty-five and the
// other two conditions do nothing. Every pair containing alcohol then moves
// readiness about as much as alcohol does, and the engine must emit no
// combination card at all — a combination that merely repeats a main effect
// is the fishing trip this family is built not to be.

const state = vi.hoisted(() => {
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

  const DAYS = 90
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 1; i--) {
    dates.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10))
  }
  // Deterministic coin flips and a little noise, so nothing is a tie.
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const A = dates.map(() => rnd() < 0.5) // alcohol
  const B = dates.map(() => rnd() < 0.5) // late meal
  const C = dates.map(() => rnd() < 0.5) // short night before
  const noise = dates.map(() => Math.round((rnd() - 0.5) * 4))

  const build = (scenario: "triple" | "single") => {
    const readinessFor = (j: number): number | null => {
      const d = j - 1
      if (d < 0) return null
      const singles = (A[d] ? 1 : 0) + (B[d] ? 1 : 0) + (C[d] ? 1 : 0)
      const value = scenario === "triple"
        ? 75 - 4 * singles - (A[d] && B[d] && C[d] ? 25 : 0)
        : 75 - (A[d] ? 25 : 0)
      return value + noise[j]
    }
    return {
      healthLogs: dates.map((ds, i) => ({
        date: new Date(ds + "T00:00:00Z"),
        sleepScore: null, sleepDuration: C[i] ? 360 : 480, readinessScore: readinessFor(i),
        restingHR: null, stressHigh: null, hrv: null,
        steps: 8000, activityScore: null, deepSleep: null, remSleep: null,
      })),
      foodLogs: dates.map((ds, i) => ({
        loggedAt: new Date(ds + (B[i] ? "T21:30:00.000Z" : "T12:00:00.000Z")),
        calories: 2000, proteinG: 100, sugarG: null,
      })),
      alcoholLogs: dates
        .map((ds, i) => ({ ds, i }))
        .filter(({ i }) => A[i])
        .map(({ ds }) => ({ loggedAt: new Date(ds + "T18:00:00.000Z"), amountMl: 500, type: "beer", note: null })),
    }
  }

  // The last day has no morning after it yet, so its combination is not an
  // observation — the same rule the engine applies.
  const tripleDays = dates.filter((_, i) => i < dates.length - 1 && A[i] && B[i] && C[i]).length
  return { DAYS, tripleDays, isAlcoholQuery, current: build("triple"), build }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn(() => Promise.resolve(state.current.healthLogs)) },
    foodLog: { findMany: vi.fn(() => Promise.resolve(state.current.foodLogs)) },
    intakeLog: {
      findMany: vi.fn((args: { where?: { type?: unknown } }) =>
        Promise.resolve(state.isAlcoholQuery(args?.where?.type) ? state.current.alcoholLogs : [])),
    },
    bodyMeasurement: { findMany: vi.fn().mockResolvedValue([]) },
    stravaActivity: { findMany: vi.fn().mockResolvedValue([]) },
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

const TRIPLE = "combo_readiness_alcohol_late_meal_short_night"

describe("combinations", () => {
  it("plants enough triple days for the claim to be testable", () => {
    expect(state.tripleDays).toBeGreaterThanOrEqual(8)
  })

  it("finds a three-way combination that none of its pairs explains", async () => {
    state.current = state.build("triple")
    const { insights, totalDays } = await computeCorrelations("user_combo", 90)
    expect(totalDays).toBe(state.DAYS)

    const card = insights.find(i => i.id === TRIPLE)
    expect(card).toBeDefined()
    expect(card!.category).toBe("interactions")
    expect(card!.highGroupN).toBe(state.tripleDays)
    // Readiness falls on the mornings after all three, and by a lot.
    expect(card!.delta).toBeLessThan(-30)
    // A dozen mornings thirty points below the rest is not something
    // shuffling runs of days reproduces.
    expect(card!.tier).not.toBe("noise")
    expect(card!.finding).toContain("together")

    // The triple tells its pairs' story better than they do: none of the
    // three pairs inside it gets a card of its own.
    for (const pair of ["alcohol_late_meal", "alcohol_short_night", "late_meal_short_night"]) {
      expect(insights.some(i => i.id === `combo_readiness_${pair}`)).toBe(false)
    }
  })

  it("emits no combination when a single ingredient explains the whole effect", async () => {
    state.current = state.build("single")
    const { insights } = await computeCorrelations("user_combo_single", 90)
    // Every pair with alcohol in it moves readiness about as much as alcohol
    // alone does — none of them earns a card, and neither does any triple.
    expect(insights.filter(i => i.id.startsWith("combo_")).map(i => i.id)).toEqual([])
  })

  // Every sentence this fixture produces, held to the lint. The guard in
  // insight-language.test.ts proves the rule; this is where the rule meets the
  // engine's real output across the combination families at once. A template edited
  // without reading it aloud fails here, and the failure names the card.
  it("every card it produces reads", async () => {
    const { insights } = await computeCorrelations("user_combo", 90)
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
