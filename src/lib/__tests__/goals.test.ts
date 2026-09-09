import { describe, it, expect } from "vitest"
import { mergeGoals, pinWeightGoalStart, DEFAULT_GOALS } from "../goals"

describe("mergeGoals", () => {
  it("fills every gap from the defaults", () => {
    expect(mergeGoals(DEFAULT_GOALS, {})).toEqual(DEFAULT_GOALS)
    expect(mergeGoals(DEFAULT_GOALS, null).steps).toBe(8000)
    expect(mergeGoals(DEFAULT_GOALS, "nonsense").sleepH).toBe(7.5)
  })

  it("applies a partial patch without disturbing the rest", () => {
    const out = mergeGoals(DEFAULT_GOALS, { steps: 12000 })
    expect(out.steps).toBe(12000)
    expect(out.sleepH).toBe(DEFAULT_GOALS.sleepH)
  })

  it("reads the legacy blob's string numbers", () => {
    // The old JSON blob was written straight from form inputs.
    const out = mergeGoals(DEFAULT_GOALS, { steps: "9500", sleepH: "8" })
    expect(out.steps).toBe(9500)
    expect(out.sleepH).toBe(8)
  })

  it("rounds the fields the schema stores as integers", () => {
    expect(mergeGoals(DEFAULT_GOALS, { steps: 8500.7 }).steps).toBe(8501)
    // …and leaves the ones that are genuinely fractional alone
    expect(mergeGoals(DEFAULT_GOALS, { sleepH: 7.25 }).sleepH).toBe(7.25)
  })

  it("refuses values a goal can't survive", () => {
    // A zero step goal is a divide-by-zero in every progress bar that reads it.
    expect(mergeGoals(DEFAULT_GOALS, { steps: 0 }).steps).toBe(8000)
    expect(mergeGoals(DEFAULT_GOALS, { sleepH: 99 }).sleepH).toBe(7.5)
    expect(mergeGoals(DEFAULT_GOALS, { coffeeMax: -5 }).coffeeMax).toBe(400)
    expect(mergeGoals(DEFAULT_GOALS, { steps: "abc" }).steps).toBe(8000)
  })

  it("ignores keys that aren't goals", () => {
    const out = mergeGoals(DEFAULT_GOALS, { userId: "someone-else", nope: 1 }) as unknown as Record<string, unknown>
    expect(out.userId).toBeUndefined()
    expect(out.nope).toBeUndefined()
  })

  it("allows clearing the optional body fields", () => {
    const withBody = mergeGoals(DEFAULT_GOALS, { weightKg: 80, heightCm: 180, sex: "male" })
    expect(withBody).toMatchObject({ weightKg: 80, heightCm: 180, sex: "male" })
    const cleared = mergeGoals(withBody, { weightKg: null, sex: "" })
    expect(cleared.weightKg).toBeNull()
    expect(cleared.sex).toBeNull()
    expect(cleared.heightCm).toBe(180)
  })

  it("only accepts the two sex values the body calculations understand", () => {
    expect(mergeGoals(DEFAULT_GOALS, { sex: "female" }).sex).toBe("female")
    expect(mergeGoals(DEFAULT_GOALS, { sex: "other" }).sex).toBeNull()
  })
})

describe("weight goal", () => {
  it("accepts the three modes and clears on empty", () => {
    expect(mergeGoals(DEFAULT_GOALS, { weightGoalMode: "lose" }).weightGoalMode).toBe("lose")
    expect(mergeGoals(DEFAULT_GOALS, { weightGoalMode: "bulk" }).weightGoalMode).toBeNull()
    const set = mergeGoals(DEFAULT_GOALS, { weightGoalMode: "gain", weightTargetKg: 75, weightPaceKgWk: 0.3 })
    expect(set).toMatchObject({ weightGoalMode: "gain", weightTargetKg: 75, weightPaceKgWk: 0.3 })
    expect(mergeGoals(set, { weightGoalMode: "" }).weightGoalMode).toBeNull()
  })

  it("keeps the pace inside the band people can hold", () => {
    expect(mergeGoals(DEFAULT_GOALS, { weightPaceKgWk: 3 }).weightPaceKgWk).toBeNull()
    expect(mergeGoals(DEFAULT_GOALS, { weightPaceKgWk: 0.05 }).weightPaceKgWk).toBeNull()
    expect(mergeGoals(DEFAULT_GOALS, { weightPaceKgWk: "0.5" }).weightPaceKgWk).toBe(0.5)
  })

  it("stores the start timestamp as ISO and rejects garbage", () => {
    expect(mergeGoals(DEFAULT_GOALS, { weightGoalStartedAt: "2026-09-01T08:00:00Z" }).weightGoalStartedAt).toBe("2026-09-01T08:00:00.000Z")
    expect(mergeGoals(DEFAULT_GOALS, { weightGoalStartedAt: "yesterday-ish" }).weightGoalStartedAt).toBeNull()
  })

  it("pins the starting line when a goal appears, from the freshest weight", () => {
    const now = new Date("2026-09-09T10:00:00Z")
    const next = mergeGoals(DEFAULT_GOALS, { weightGoalMode: "lose", weightTargetKg: 78, weightKg: 85 })
    const pinned = pinWeightGoalStart(DEFAULT_GOALS, next, 84.2, now)
    expect(pinned.weightGoalStartKg).toBe(84.2)
    expect(pinned.weightGoalStartedAt).toBe(now.toISOString())
    expect(pinned.weightPaceKgWk).toBe(0.5) // default pace when none given
  })

  it("keeps the starting line while the goal is unchanged, resets when it changes", () => {
    const start = new Date("2026-08-01T00:00:00Z")
    const goal = pinWeightGoalStart(DEFAULT_GOALS, mergeGoals(DEFAULT_GOALS, { weightGoalMode: "lose", weightTargetKg: 78 }), 85, start)
    const samePace = pinWeightGoalStart(goal, mergeGoals(goal, { weightPaceKgWk: 0.25 }), 83, new Date("2026-09-01T00:00:00Z"))
    expect(samePace.weightGoalStartKg).toBe(85)
    expect(samePace.weightGoalStartedAt).toBe(start.toISOString())
    const newTarget = pinWeightGoalStart(goal, mergeGoals(goal, { weightTargetKg: 75 }), 83, new Date("2026-09-01T00:00:00Z"))
    expect(newTarget.weightGoalStartKg).toBe(83)
    expect(newTarget.weightGoalStartedAt).toBe("2026-09-01T00:00:00.000Z")
  })

  it("clears target, pace and start when the goal is removed", () => {
    const goal = pinWeightGoalStart(DEFAULT_GOALS, mergeGoals(DEFAULT_GOALS, { weightGoalMode: "gain", weightTargetKg: 70, weightPaceKgWk: 0.3 }), 62)
    const off = pinWeightGoalStart(goal, mergeGoals(goal, { weightGoalMode: null }), 63)
    expect(off).toMatchObject({ weightGoalMode: null, weightTargetKg: null, weightPaceKgWk: null, weightGoalStartKg: null, weightGoalStartedAt: null })
  })
})
